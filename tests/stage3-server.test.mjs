import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { request } from 'node:http';
import { createAppServer } from '../src/server.mjs';
import { stage3Config } from '../src/utils/stage3-budget.mjs';
import { syntheticPois, syntheticRoutes, syntheticTripInput, enabledTestEnv } from './fixtures/stage3.mjs';

// Real local HTTP server; all upstream requests are injected fake fetch calls.
async function usingServer(overrides, callback) {
  const directory = await mkdtemp(join(tmpdir(), 'smart-stage3-server-'));
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (overrides.fetchImpl) return overrides.fetchImpl(url, options);
    if (new URL(url).pathname === '/tmap/pois') return new Response(JSON.stringify(syntheticPois));
    assert.equal(url, 'https://apis.openapi.sk.com/transit/routes');
    return new Response(JSON.stringify(syntheticRoutes));
  };
  const server = createAppServer({ config: stage3Config(enabledTestEnv), budgetDirectory: directory, cooldownMs: 0, ...overrides, fetchImpl });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  const search = query => fetch(`${url}/api/places?q=${encodeURIComponent(query)}`);
  const recommend = body => fetch(`${url}/api/recommendation`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const selected = async () => {
    const response = await search('합성 장소');
    assert.equal(response.status, 200);
    const data = await response.json();
    return { ...syntheticTripInput, originText: data.places[0].name, destinationText: data.places[1].name, originSelectionToken: data.places[0].selectionToken, destinationSelectionToken: data.places[1].selectionToken };
  };
  try { await callback({ url, search, recommend, selected, calls, directory }); }
  finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    await rm(directory, { recursive: true });
  }
}

test('기본 서버의 POI·대중교통 실제 호출은 비활성화, 외부 요청 0회', () => usingServer({ config: stage3Config() }, async ({ search, recommend, calls, directory }) => {
  const response = await search('합성 장소');
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'LIVE_DISABLED');
  const missing = await recommend(syntheticTripInput);
  assert.equal(missing.status, 400);
  assert.equal(calls.length, 0);
  assert.deepEqual(await readdir(directory), []);
}));

test('키 없음·예산 0에서는 네트워크와 예산 파일 생성 모두 없음', async () => {
  for (const [config, expected] of [
    [stage3Config({ ENABLE_LIVE_POI: 'true', STAGE3_POI_MAX_CALLS: '1' }), 'MISSING_KEY'],
    [stage3Config({ ENABLE_LIVE_POI: 'true', TMAP_APP_KEY: 'synthetic' }), 'BUDGET_EXHAUSTED'],
  ]) await usingServer({ config }, async ({ search, calls, directory }) => {
    assert.equal((await (await search('합성 장소')).json()).error.code, expected);
    assert.equal(calls.length, 0); assert.deepEqual(await readdir(directory), []);
  });
});

test('공백·긴 검색어·중복 파라미터 차단, 검색 성공이 장소 자동 선택은 아님', () => usingServer({}, async ({ url, search, recommend, calls }) => {
  for (const query of ['', '   ', 'x'.repeat(81)]) assert.equal((await search(query)).status, 400);
  assert.equal((await fetch(url + '/api/places?q=a&q=b')).status, 400);
  assert.equal((await fetch(url + '/api/places?url=https://example.invalid')).status, 400);
  assert.equal(calls.length, 0);
  const results = await (await search('합성 장소')).json();
  assert.equal(results.places.length, 2);
  const response = await recommend(syntheticTripInput);
  assert.equal((await response.json()).error.code, 'PLACE_NOT_SELECTED');
  assert.equal(calls.length, 1);
}));

test('합성 장소 선택→검증된 좌표→실제 모듈 경로 처리→727초 추정 전체 흐름', () => usingServer({}, async ({ selected, recommend, calls }) => {
  const body = await selected();
  const response = await recommend({ ...body, startX: '9999', endX: '9999', url: 'https://example.invalid' });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.targetArrivalDateTime, '2026-11-16T13:50:00+09:00');
  assert.equal(result.totalDurationSeconds, 727);
  assert.equal(result.route.totalWalkTime, 394);
  assert.equal(result.route.transferCount, 1);
  assert.equal(result.estimatedDepartureDateTime, '2026-11-16T13:37:53+09:00');
  assert.equal(result.displayDepartureDateTime, '2026-11-16T13:37:00+09:00');
  assert.equal(result.estimateBasis, 'CURRENT_ROUTE_DURATION');
  assert.equal(calls.length, 2);
  const poi = calls[0], transit = calls[1];
  assert.equal(poi.options.headers.appKey, enabledTestEnv.TMAP_POI_APP_KEY);
  assert.equal(transit.options.headers.appKey, enabledTestEnv.TMAP_APP_KEY);
  assert.deepEqual(JSON.parse(transit.options.body), { startX: '127.1', startY: '37.1', endX: '127.2', endY: '37.2', count: 5, lang: 0, format: 'json' });
  assert.equal(JSON.stringify(result).includes('synthetic-transit-secret'), false);
  assert.equal(JSON.stringify(result).includes('synthetic-poi-secret'), false);
  assert.equal(Object.hasOwn(result, 'metaData'), false);
}));

test('장소명 수정·가짜 선택 토큰·직접 좌표 지정으로 경로를 조회할 수 없음', () => usingServer({}, async ({ selected, recommend, calls }) => {
  const body = await selected();
  for (const patch of [{ originText: '수정한 이름' }, { originSelectionToken: 'forged' }, { originSelectionToken: undefined, startX: 127.1, startY: 37.1 }]) {
    const response = await recommend({ ...body, ...patch });
    assert.ok([400, 422].includes(response.status));
  }
  assert.equal(calls.length, 1);
}));

test('동일한 장소 선택은 경로 API 호출 전에 차단', () => usingServer({}, async ({ selected, recommend, calls }) => {
  const body = await selected();
  const response = await recommend({ ...body, destinationText: body.originText, destinationSelectionToken: body.originSelectionToken });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'SAME_PLACE');
  assert.equal(calls.length, 1);
}));

test('실제로 다른 장소라면 같은 이름도 선택 가능, 텍스트만 같은 2단계 검증은 유지', () => usingServer({ fetchImpl: async url => {
  if (url.includes('/tmap/pois')) {
    const data = structuredClone(syntheticPois);
    for (const poi of data.searchPoiInfo.pois.poi) poi.name = '합성 동일 상호';
    return new Response(JSON.stringify(data));
  }
  return new Response(JSON.stringify(syntheticRoutes));
} }, async ({ selected, recommend }) => {
  assert.equal((await recommend(await selected())).status, 200);
}));

test('만료된 장소는 다시 검색·선택해야 하며 외부 경로 요청 없음', async () => {
  let time = new Date('2026-11-13T07:00:00Z');
  await usingServer({ now: () => time, selectionTtlMs: 1000 }, async ({ selected, recommend, calls }) => {
    const body = await selected();
    time = new Date(time.getTime() + 2000);
    const response = await recommend(body);
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error.code, 'PLACE_SELECTION_EXPIRED');
    assert.equal(calls.length, 1);
  });
});

test('POI 인증 오류와 원본 오류의 비밀을 브라우저에 반환하지 않음', () => usingServer({ fetchImpl: async () => new Response(JSON.stringify({ error: { code: 'INVALID_API_KEY', message: enabledTestEnv.TMAP_POI_APP_KEY } }), { status: 403 }) }, async ({ search }) => {
  const response = await search('합성');
  assert.equal(response.status, 403);
  const data = await response.json();
  assert.equal(data.error.code, 'POI_AUTH_PERMISSION');
  assert.equal(JSON.stringify(data).includes(enabledTestEnv.TMAP_POI_APP_KEY), false);
}));

test('POI 결과 없음·잘못된 좌표를 명확히 구분하고 좌표를 생성하지 않음', async () => {
  for (const [body, status, expected] of [
    [{ searchPoiInfo: { totalCount: 0 } }, 200, undefined],
    [{ searchPoiInfo: { totalCount: 1, pois: { poi: [{ id: 'synthetic', name: '좌표 없음' }] } } }, 422, 'INVALID_COORDINATES'],
  ]) await usingServer({ fetchImpl: async () => new Response(JSON.stringify(body)) }, async ({ search }) => {
    const response = await search('합성');
    assert.equal(response.status, status);
    const data = await response.json();
    if (expected) assert.equal(data.error.code, expected); else assert.deepEqual(data.places, []);
  });
});

test('지원 밖 첫 후보를 제외하고 이후의 첫 유효 경로 안내', () => usingServer({ fetchImpl: async url => {
  if (url.includes('/tmap/pois')) return new Response(JSON.stringify(syntheticPois));
  const data = structuredClone(syntheticRoutes);
  const unsupported = structuredClone(data.metaData.plan.itineraries[0]); unsupported.legs[1].mode = 'FERRY';
  data.metaData.plan.itineraries.unshift(unsupported);
  return new Response(JSON.stringify(data));
} }, async ({ selected, recommend }) => {
  const result = await (await recommend(await selected())).json();
  assert.equal(result.route.providerIndex, 1);
  assert.equal(result.totalDurationSeconds, 727);
}));

test('경로 무응답·인증·할당량·네트워크·시간초과·손상 응답의 한국어 오류', async () => {
  const cases = [
    [async () => new Response('{"metaData":{"plan":{"itineraries":[]}}}'), 'NO_ROUTES'],
    [async () => new Response('{"result":{"status":14}}'), 'NO_ROUTES'],
    [async () => new Response('{}', { status: 403 }), 'TRANSIT_AUTH_PERMISSION'],
    [async () => new Response('{}', { status: 429 }), 'PROVIDER_QUOTA'],
    [async () => { throw new TypeError('synthetic-secret'); }, 'NETWORK'],
    [async () => { throw Object.assign(new Error('synthetic-secret'), { name: 'TimeoutError' }); }, 'TIMEOUT'],
    [async () => new Response('broken'), 'INVALID_RESPONSE'],
  ];
  for (const [routeFetch, code] of cases) await usingServer({ fetchImpl: (url, options) => url.includes('/tmap/pois') ? Promise.resolve(new Response(JSON.stringify(syntheticPois))) : routeFetch(url, options) }, async ({ selected, recommend, calls }) => {
    const response = await recommend(await selected());
    assert.ok(response.status >= 400);
    const data = await response.json();
    assert.equal(data.error.code, code);
    assert.equal(JSON.stringify(data).includes('synthetic-secret'), false);
    assert.equal(calls.length, 2);
  });
});

test('지원 범위 밖 경로만 반환되면 추천 결과 없음', () => usingServer({ fetchImpl: async url => {
  if (url.includes('/tmap/pois')) return new Response(JSON.stringify(syntheticPois));
  const data = structuredClone(syntheticRoutes); data.metaData.plan.itineraries[0].legs[1].mode = 'TRAIN';
  return new Response(JSON.stringify(data));
} }, async ({ selected, recommend }) => {
  const response = await recommend(await selected());
  assert.equal((await response.json()).error.code, 'NO_SUPPORTED_ROUTE');
}));

test('여유시간 변경은 새 경로 요청·새 totalTime으로 재계산', async () => {
  let routes = 0;
  await usingServer({ fetchImpl: async url => {
    if (url.includes('/tmap/pois')) return new Response(JSON.stringify(syntheticPois));
    const data = structuredClone(syntheticRoutes);
    if (++routes === 2) { data.metaData.plan.itineraries[0].totalTime = 900; data.metaData.plan.itineraries[0].legs[1].sectionTime += 173; }
    return new Response(JSON.stringify(data));
  } }, async ({ selected, recommend }) => {
    const body = await selected();
    const first = await (await recommend(body)).json();
    const second = await (await recommend({ ...body, bufferMinutes: 20 })).json();
    assert.equal(first.displayDepartureDateTime, '2026-11-16T13:37:00+09:00');
    assert.equal(second.displayDepartureDateTime, '2026-11-16T13:25:00+09:00');
    assert.equal(routes, 2);
  });
});

test('POI·대중교통 예산은 별도 누적, 소진 후 외부 요청 없음', () => usingServer({ config: stage3Config({ ...enabledTestEnv, STAGE3_POI_MAX_CALLS: '1', STAGE3_TRANSIT_MAX_CALLS: '1' }) }, async ({ selected, search, recommend, calls, directory }) => {
  const body = await selected();
  assert.equal((await recommend(body)).status, 200);
  assert.equal((await search('다른 합성')).status, 429);
  assert.equal((await recommend({ ...body, bufferMinutes: 20 })).status, 429);
  assert.equal(calls.length, 2);
  for (const service of ['poi', 'transit']) {
    const ledger = JSON.parse(await readFile(join(directory, `stage3-${service}-budget.json`), 'utf8'));
    assert.equal(ledger.attempts.length, 1);
    assert.deepEqual(Object.keys(ledger.attempts[0]).sort(), ['attempt', 'reservedAt']);
  }
}));

test('실패·시간초과도 호출 예산에 포함하고 자동 재시도하지 않음', () => usingServer({ config: stage3Config({ ...enabledTestEnv, STAGE3_POI_MAX_CALLS: '1' }), fetchImpl: async () => { throw Object.assign(new Error(), { name: 'TimeoutError' }); } }, async ({ search, calls, directory }) => {
  assert.equal((await search('합성')).status, 504);
  assert.equal((await search('다른 합성')).status, 429);
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(await readFile(join(directory, 'stage3-poi-budget.json'), 'utf8')).attempts.length, 1);
}));

test('동일 검색의 짧은 반복 요청은 추가 예산 없이 차단', () => usingServer({ cooldownMs: 3000 }, async ({ search, calls }) => {
  assert.equal((await search('합성')).status, 200);
  const duplicate = await search('합성');
  assert.equal(duplicate.status, 429);
  assert.equal((await duplicate.json()).error.code, 'REPEATED_REQUEST');
  assert.equal(calls.length, 1);
}));

test('처리 중 동일 요청 중복은 외부 호출을 늘리지 않음', async () => {
  let release, started;
  const wait = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { started = resolve; });
  await usingServer({ fetchImpl: async () => { started(); await wait; return new Response(JSON.stringify(syntheticPois)); } }, async ({ search, calls }) => {
    const first = search('합성'); await ready;
    const second = await search('합성');
    assert.equal(second.status, 409);
    assert.equal(calls.length, 1);
    release(); assert.equal((await first).status, 200);
  });
});

test('본문 크기·JSON 형식·메서드·CORS 출처·Host를 검사', () => usingServer({}, async ({ url, recommend, calls }) => {
  assert.equal((await recommend(null)).status, 400);
  assert.equal((await fetch(url + '/api/recommendation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'broken' })).status, 400);
  assert.equal((await fetch(url + '/api/recommendation', { method: 'POST', body: '{}' })).status, 415);
  assert.equal((await recommend({ padding: 'x'.repeat(9000) })).status, 413);
  assert.equal((await fetch(url + '/api/recommendation')).status, 405);
  for (const headers of [{ Origin: 'https://example.invalid' }, { Host: 'example.invalid' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    // Native fetch normalizes Host; use raw local HTTP to exercise that check.
    const response = await new Promise((resolve, reject) => {
      const req = request(url + '/api/places?q=synthetic', { headers }, result => {
        result.resume(); resolve({ status: result.statusCode, headers: result.headers });
      });
      req.on('error', reject); req.end();
    });
    assert.equal(response.status, 403, JSON.stringify(headers));
    assert.equal(response.headers['access-control-allow-origin'], undefined);
  }
  const streamedStatus = await new Promise((resolve, reject) => {
    const req = request(url + '/api/recommendation', { method: 'POST', headers: { 'Content-Type': 'application/json' } }, response => { response.resume(); resolve(response.statusCode); });
    req.on('error', reject); req.write('x'.repeat(5000)); req.write('x'.repeat(5000)); req.end();
  });
  assert.equal(streamedStatus, 413);
  assert.equal(calls.length, 0);
}));

test('같은 출처 API만 CSP로 허용, 비공개 파일·설정은 HTTP 미제공', () => usingServer({}, async ({ url }) => {
  const response = await fetch(url);
  const csp = response.headers.get('content-security-policy');
  assert.match(csp, /connect-src 'self';/);
  assert.equal(csp.includes('openapi.sk.com'), false);
  for (const path of ['/.env', '/AGENTS.md', '/docs/api-verification.md', '/reports/stage3-poi-budget.json', '/src/api/stage3-service.mjs', '/src/utils/stage3-budget.mjs']) assert.equal((await fetch(url + path)).status, 404);
  const page = await response.text();
  assert.equal(page.includes(enabledTestEnv.TMAP_APP_KEY), false);
  assert.equal(page.includes(enabledTestEnv.TMAP_POI_APP_KEY), false);
}));

test('서버를 다시 만들어도 같은 누적 예산 파일의 사용 횟수를 보존', () => usingServer({ config: stage3Config({ ...enabledTestEnv, STAGE3_POI_MAX_CALLS: '1' }) }, async ({ search, directory }) => {
  assert.equal((await search('첫 합성')).status, 200);
  const restarted = createAppServer({ config: stage3Config({ ...enabledTestEnv, STAGE3_POI_MAX_CALLS: '1' }), budgetDirectory: directory, fetchImpl: () => assert.fail('재시작으로 예산을 초기화하면 안 됩니다.') });
  restarted.listen(0, '127.0.0.1'); await once(restarted, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${restarted.address().port}/api/places?q=second`);
    assert.equal(response.status, 429);
    assert.equal((await response.json()).error.code, 'BUDGET_EXHAUSTED');
  } finally { restarted.closeAllConnections(); await new Promise(resolve => restarted.close(resolve)); }
}));

test('제공자가 성공 데이터에 키를 반사해도 장소 결과에서 제거', () => usingServer({ fetchImpl: async () => {
  const data = structuredClone(syntheticPois);
  data.searchPoiInfo.pois.poi[0].name = enabledTestEnv.TMAP_POI_APP_KEY;
  data.searchPoiInfo.pois.poi[1].newAddressList = { newAddress: [{ fullAddressRoad: enabledTestEnv.TMAP_APP_KEY }] };
  return new Response(JSON.stringify(data));
} }, async ({ search }) => {
  const response = await search('합성');
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(JSON.stringify(data).includes(enabledTestEnv.TMAP_POI_APP_KEY), false);
  assert.equal(JSON.stringify(data).includes(enabledTestEnv.TMAP_APP_KEY), false);
}));
