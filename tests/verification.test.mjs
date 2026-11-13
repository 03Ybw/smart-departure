import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { toTimestamp, seoulDate, nextWeekday, timestampInfo, toSearchDttm, validateSearchDttm } from '../src/utils/time.mjs';
import { buildRequest, computeRoutes, classifyApiError, redact, ENDPOINT, OFFICIAL_EXAMPLE } from '../src/api/tmap-routes.mjs';
import { analyzeResponse, compareRecords, summarizeAnalysis } from '../src/api/analyze-response.mjs';
import { parseArgs, createCases, runVerification } from '../src/utils/verification.mjs';
import { reserveLiveAttempt } from '../src/utils/live-budget.mjs';
import { syntheticTransitResponse } from './fixtures/transit.mjs';

// Existing test areas are retained and adapted to the TMAP contract.
// All responses are synthetic, every transport test injects fake fetch.
const now = new Date('2026-11-13T01:00:00Z');
const request = () => buildRequest(OFFICIAL_EXAMPLE);
const mockResponse = () => new Response(JSON.stringify(syntheticTransitResponse));
const liveOptions = fetchImpl => ({ live: true, apiKey: 'synthetic-secret', fetchImpl });

test('필수 입력값, 좌표 누락, Google 시각 옵션 혼용 방지', () => {
  for (const patch of [{ startX: '' }, { startY: undefined }, { endX: ' ' }, { endY: null }, { arrivalTime: '2026-11-16T04:50:00Z' }, { departure: 'now' }]) {
    assert.throws(() => buildRequest({ ...OFFICIAL_EXAMPLE, ...patch }));
  }
});

test('기존 날짜/시각 형식, 실제 달력 날짜와 윤년 검증 유지', () => {
  for (const date of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-11-00', '26-11-16', undefined]) assert.throws(() => toTimestamp(date, '13:50'));
  for (const time of ['24:00', '13:60', '1:50', '13:50Z', '', undefined]) assert.throws(() => toTimestamp('2026-11-16', time));
  assert.equal(toTimestamp('2028-02-29', '00:00'), '2028-02-28T15:00:00.000Z');
});

test('호스트 시간대와 무관한 한국시간 처리 및 날짜 경계 유지', () => {
  assert.equal(toTimestamp('2026-11-16', '13:50'), '2026-11-16T04:50:00.000Z');
  assert.equal(toTimestamp('2026-11-16', '00:10'), '2026-11-15T15:10:00.000Z');
  assert.equal(seoulDate(new Date('2026-11-13T15:01:00Z')), '2026-11-14');
  assert.match(timestampInfo('2026-11-16T04:50:00Z').seoul, /13:50:00 Asia\/Seoul/);
  for (const input of ['bad', '2026-11-16T13:50:00', '2026-02-30T04:50:00Z', '2026-11-16T24:00:00Z']) assert.equal(timestampInfo(input), null);
  assert.equal(toSearchDttm('2026-11-16', '13:50'), '202611161350');
  assert.equal(toSearchDttm('2026-11-16', '00:10'), '202611160010');
});

test('공식 TMAP 요청 본문 생성, Google 필드와 searchDttm 기본 생략', () => {
  assert.deepEqual(request(), { ...OFFICIAL_EXAMPLE, count: 1, lang: 0, format: 'json' });
  for (const key of ['searchDttm', 'travelMode', 'arrivalTime', 'departureTime']) assert.equal(Object.hasOwn(request(), key), false);
});

test('WGS84 경도 X/위도 Y 범위와 뒤바뀐 국내 좌표 검증', () => {
  for (const patch of [{ startX: '181' }, { endY: 91 }, { startX: '37.5', startY: '127.0' }, { startY: NaN }, { endX: Infinity }, { endY: true }, { startX: '1e2' }]) assert.throws(() => buildRequest({ ...OFFICIAL_EXAMPLE, ...patch }));
  assert.equal(buildRequest({ ...OFFICIAL_EXAMPLE, startX: -180, startY: -90 }).startX, '-180');
  assert.equal(buildRequest({ ...OFFICIAL_EXAMPLE, count: '10' }).count, 10);
  for (const count of [0, 11, 1.5, '', true]) assert.throws(() => buildRequest({ ...OFFICIAL_EXAMPLE, count }));
});

test('searchDttm 형식, 실제 달력, 연도 범위 검증', () => {
  for (const value of ['202602291350', '202611162400', '202611161360', '20261116135000', '2026-11-16T13:50', '189911161350', '', 202611161350, null]) assert.throws(() => validateSearchDttm(value));
  assert.equal(validateSearchDttm('190001010000'), '190001010000');
  assert.equal(validateSearchDttm('999912312359'), '999912312359');
  assert.equal(buildRequest({ ...OFFICIAL_EXAMPLE, searchDttm: '202611161350' }).searchDttm, '202611161350');
});

test('실행일 이후 평일 선택, 동일 좌표와 변경된 시간의 별도 요청 생성', () => {
  assert.equal(nextWeekday(now), '2026-11-16');
  assert.equal(nextWeekday(new Date('2026-11-15T01:00:00Z')), '2026-11-16');
  const cases = createCases({ scenario: 'all' }, now);
  assert.equal(cases.length, 3);
  assert.equal(Object.hasOwn(cases[0].request, 'searchDttm'), false);
  assert.equal(cases[1].request.searchDttm, '202611161350');
  assert.equal(cases[2].request.searchDttm, '202611161340');
  assert.notStrictEqual(cases[1].request, cases[2].request);
  assert.equal(cases[1].request.startX, cases[2].request.startX);
  assert.throws(() => createCases({ scenario: 'all', date: '2026-11-14' }, now));
  assert.throws(() => createCases({ scenario: 'all', time: '13:50' }, now));
});

test('CLI 인자 및 날짜/시각 중복 지정 검증', () => {
  assert.deepEqual(parseArgs(['--count', '1', '--dry-run']), { count: '1', 'dry-run': true });
  for (const args of [['--other'], ['--count'], ['--date', '--time'], ['--time', '13:50', '--time', '13:40'], ['--live', '--dry-run'], ['--arrival', '13:50']]) assert.throws(() => parseArgs(args));
  assert.throws(() => createCases({ date: '2026-11-16' }));
  assert.throws(() => createCases({ 'start-x': '127.0' }));
  assert.throws(() => createCases({ date: '2026-11-16', time: '13:50', 'search-dttm': '202611161350' }));
});

test('합성 정상 응답: 경로/소요시간/도보/환승/노선/지점/service 분석', () => {
  const result = analyzeResponse(syntheticTransitResponse);
  assert.equal(result.status, 'ROUTES_RETURNED');
  assert.equal(result.routeCount, 1);
  const route = result.routes[0];
  assert.equal(route.totalTime, 2400);
  assert.equal(route.transferCount, 1);
  assert.equal(route.totalWalkTime, 600);
  assert.deepEqual(route.modes, ['WALK', 'SUBWAY', 'BUS']);
  assert.equal(route.legs[1].route, '합성 지하철');
  assert.equal(route.legs[1].start, '합성 A역');
  assert.equal(route.legs[3].service, 0);
  assert.equal(route.legs[3].lanes[0].service, 1);
  assert.deepEqual(route.missing, []);
});

test('핵심 대상 밖 이동수단은 원래 값으로 별도 구분', () => {
  const data = structuredClone(syntheticTransitResponse);
  data.metaData.plan.itineraries[0].legs[1].mode = 'TRAIN';
  const route = analyzeResponse(data).routes[0];
  assert.deepEqual(route.otherModes, ['TRAIN']);
  assert.equal(route.coreModesOnly, false);
  assert.equal(route.legs[1].mode, 'TRAIN');
});

test('무경로, 잘못된 응답, 필수 데이터 누락 구분', () => {
  assert.equal(analyzeResponse({ metaData: { plan: { itineraries: [] } } }).status, 'NO_ROUTES');
  for (const value of [null, [], {}, { metaData: { plan: { itineraries: {} } } }]) assert.equal(analyzeResponse(value).status, 'INVALID_RESPONSE');
  const route = analyzeResponse({ metaData: { plan: { itineraries: [{ legs: [{ mode: 'BUS' }] }] } } }).routes[0];
  assert.equal(route.totalTime, null);
  assert.equal(route.legs[0].sectionTime, null);
  assert.equal(route.legs[0].service, null);
  assert.ok(route.missing.includes('totalTime'));
  assert.ok(route.missing.includes('legs[0].start'));
  assert.ok(route.missing.includes('legs[0].service'));
  assert.equal(analyzeResponse({ metaData: { plan: { itineraries: [null] } } }).routes[0].coreModesOnly, null);
});

test('시간표 없음은 미검증 유지, 요청시각/검색시각을 운행편 시각으로 대입하지 않음', () => {
  const result = analyzeResponse(syntheticTransitResponse);
  assert.equal(result.providerRequestTime, '20261113100000');
  assert.equal(result.timetable.status, 'UNVERIFIED');
  assert.deepEqual(result.timetable.undocumentedTemporalFields, []);
  assert.equal(result.arrivalBasedRecommendation, 'UNVERIFIED');
  assert.equal(Object.hasOwn(result.routes[0], 'departureTime'), false);
  // A deliberately undocumented synthetic key must not be promoted to a schedule.
  const data = structuredClone(syntheticTransitResponse);
  data.metaData.plan.itineraries[0].unknownSchedule = 'synthetic';
  const unknown = analyzeResponse(data);
  assert.equal(unknown.timetable.undocumentedTemporalFields.length, 1);
  assert.equal(unknown.arrivalBasedRecommendation, 'UNVERIFIED');
});

test('동일/다른 경로·시간·운행여부의 개별 비교, 실패는 비교 불가', () => {
  const cases = createCases({ scenario: 'all' }, now);
  const a = { requestId: 'b', request: cases[1].request, analysis: analyzeResponse(syntheticTransitResponse) };
  const b = { requestId: 'c', request: cases[2].request, analysis: analyzeResponse(syntheticTransitResponse) };
  assert.equal(compareRecords(a, b).sameRouteStructure, true);
  assert.equal(compareRecords(a, b).sameTravelTimes, true);
  const changed = structuredClone(b);
  changed.analysis.routes[0].totalTime = 2500;
  assert.equal(compareRecords(a, changed).sameTravelTimes, false);
  assert.equal(compareRecords(a, changed).sameRouteStructure, true);
  assert.equal(compareRecords(a, { ...b, analysis: undefined }).comparable, false);
  assert.equal(compareRecords(undefined, undefined).sameServices, null);
  const incomplete = { ...b, analysis: analyzeResponse({ metaData: { plan: { itineraries: [{}] } } }) };
  assert.equal(compareRecords(incomplete, incomplete).sameTravelTimes, null);
  assert.equal(compareRecords(incomplete, incomplete).sameRouteStructure, null);
});

test('키 없음 또는 live 미지정이면 fetch 호출 0회', async () => {
  const fetchImpl = () => assert.fail('호출하면 안 됩니다.');
  assert.equal((await computeRoutes(request(), { live: true, fetchImpl })).error.category, 'MISSING_KEY');
  assert.equal((await computeRoutes(request(), { apiKey: 'synthetic-secret', fetchImpl })).error.category, 'LIVE_REQUIRED');
});

test('가짜 fetch로 메서드/헤더/본문/리디렉션 차단/호출 횟수 확인', async () => {
  let count = 0;
  const result = await computeRoutes(request(), liveOptions(async (url, options) => {
    count++;
    assert.equal(url, 'https://apis.openapi.sk.com/transit/routes');
    assert.equal(ENDPOINT, 'https://apis.openapi.sk.com/transit/routes');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.appKey, 'synthetic-secret');
    assert.equal(options.headers.Accept, 'application/json');
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(options.body), request());
    // Check fetch's serialized request too, not only the options object.
    // Synthetic credentials only: assertion failures cannot reveal the real key.
    const serialized = new Request(url, options);
    assert.equal(serialized.method, 'POST');
    assert.equal(serialized.headers.get('appKey'), 'synthetic-secret');
    assert.equal(serialized.headers.get('Content-Type'), 'application/json');
    assert.equal(serialized.headers.get('Accept'), 'application/json');
    assert.deepEqual(await serialized.json(), {
      startX: '127.02479803562213', startY: '37.504585233865086',
      endX: '127.03747630119366', endY: '37.479103923078995',
      count: 1, lang: 0, format: 'json',
    });
    return mockResponse();
  }));
  assert.equal(count, 1);
  assert.equal(result.ok, true);
});

test('오류 분류: 인증/할당량/HTTP 200 무경로/매개변수/지역/시간초과', () => {
  for (const [status, body, expected] of [
    [403, {}, 'AUTH_PERMISSION'], [401, {}, 'AUTH_PERMISSION'], [429, {}, 'QUOTA'],
    [200, { result: { status: 14, message: '합성 무경로' } }, 'NO_ROUTES'],
    [400, { result: { status: 21 } }, 'INVALID_REQUEST'], [400, { result: { status: 24 } }, 'INVALID_REQUEST'],
    [400, { result: { status: 23 } }, 'UNSUPPORTED_REGION'], [500, { result: { status: 31 } }, 'TIMEOUT'],
    [403, { error: { message: 'quota exceeded' } }, 'QUOTA'], [500, {}, 'API_ERROR'],
  ]) assert.equal(classifyApiError(status, body).category, expected);
});

test('API/네트워크/시간초과 실패: 재시도와 비밀 노출 없음', async () => {
  let count = 0;
  const result = await computeRoutes(request(), liveOptions(async () => {
    count++;
    return new Response(JSON.stringify({ error: { message: 'synthetic-secret' } }), { status: 403 });
  }));
  assert.equal(result.error.category, 'AUTH_PERMISSION');
  assert.equal(count, 1);
  assert.equal(JSON.stringify(result).includes('synthetic-secret'), false);
  for (const [name, category] of [['TimeoutError', 'TIMEOUT'], ['AbortError', 'TIMEOUT'], ['TypeError', 'NETWORK']]) {
    const failure = await computeRoutes(request(), liveOptions(async () => { throw Object.assign(new Error('synthetic-secret'), { name }); }));
    assert.equal(failure.error.category, category);
    assert.equal(JSON.stringify(failure).includes('synthetic-secret'), false);
  }
});

test('손상된 JSON/누락 구조와 빈 경로 및 HTTP 200 오류 처리', async () => {
  for (const body of ['broken', 'null', '[]', '{}', '{"metaData":{"plan":{"itineraries":{}}}}']) {
    assert.equal((await computeRoutes(request(), liveOptions(async () => new Response(body)))).error.category, 'INVALID_RESPONSE');
  }
  const empty = await computeRoutes(request(), liveOptions(async () => new Response('{"metaData":{"plan":{"itineraries":[]}}}')));
  assert.equal(analyzeResponse(empty.data).status, 'NO_ROUTES');
  const failure = await computeRoutes(request(), liveOptions(async () => new Response('{"result":{"status":14}}')));
  assert.equal(failure.error.category, 'NO_ROUTES');
});

test('중첩 비밀 제거와 요약에서 원본 노선·지점·응답 제외', () => {
  assert.deepEqual(redact({ nested: ['echo synthetic-secret'], appKey: 'another' }, 'synthetic-secret'), { nested: ['echo [REDACTED]'], appKey: '[REDACTED]' });
  const summary = JSON.stringify(summarizeAnalysis(analyzeResponse(syntheticTransitResponse)));
  assert.equal(summary.includes('합성 A역'), false);
  assert.equal(summary.includes('합성 지하철'), false);
  assert.equal(Object.hasOwn(JSON.parse(summary), 'metaData'), false);
});

test('CLI 기본 실행과 dry-run은 실제 키가 있어도 HTTP/예산 파일에 접근하지 않음', () => {
  for (const extra of [[], ['--dry-run']]) {
    const result = spawnSync(process.execPath, ['scripts/verify-tmap-transit.mjs', '--scenario', 'all', ...extra], { encoding: 'utf8', env: { ...process.env, TMAP_APP_KEY: 'synthetic-secret' } });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.mode, 'DRY_RUN_NO_HTTP');
    assert.equal(output.callCount, 0);
    assert.equal(output.cases.length, 3);
    assert.equal(result.stdout.includes('synthetic-secret'), false);
  }
});

test('실패 시 후속 요청 중단, 기본 실행 및 키 없음은 호출 예산 소비 없음', async () => {
  const cases = createCases({ scenario: 'all' }, now);
  let count = 0;
  let reservations = 0;
  const options = { ...liveOptions(async () => { count++; return new Response('{}', { status: 403 }); }), reserveAttempt: async () => ++reservations };
  const offline = await runVerification(cases, { ...options, live: false });
  assert.equal(offline.callCount, 0);
  assert.equal(reservations, 0);
  const missingKey = await runVerification(cases, { ...options, apiKey: '' });
  assert.equal(missingKey.error.category, 'MISSING_KEY');
  assert.equal(reservations, 0);
  const result = await runVerification(cases, options);
  assert.equal(result.callCount, 1);
  assert.equal(count, 1);
  assert.equal(reservations, 1);
  assert.equal(result.futureChecks.actualTripDepartureArrival, 'UNVERIFIED');
  const noRoutes = await runVerification(cases, {
    ...liveOptions(async () => new Response('{"metaData":{"plan":{"itineraries":[]}}}')),
    reserveAttempt: async () => 1,
  });
  assert.equal(noRoutes.callCount, 1);
  assert.equal(noRoutes.error.category, 'NO_ROUTES');
});

test('합성 A/B/C는 정확히 3회, 요청 갱신 및 미래 기능 3종 개별 평가', async () => {
  const requests = [];
  let reservations = 0;
  const result = await runVerification(createCases({ scenario: 'all' }, now), {
    ...liveOptions(async (_url, options) => { requests.push(JSON.parse(options.body)); return mockResponse(); }),
    reserveAttempt: async () => ++reservations,
  });
  assert.equal(result.callCount, 3);
  assert.deepEqual(requests.map(body => body.searchDttm), [undefined, '202611161350', '202611161340']);
  assert.equal(result.comparison.sameTravelTimes, true);
  assert.equal(result.futureChecks.serviceAtSpecifiedTime, 'OBSERVED_FOR_TESTED_CASES');
  assert.equal(result.futureChecks.routeAndDurationVariation, 'COMPARED_FOR_TESTED_CASES');
  assert.equal(result.futureChecks.actualTripDepartureArrival, 'UNVERIFIED');
  assert.equal(result.futureChecks.arrivalBasedRecommendation, 'UNVERIFIED');
  assert.equal(JSON.stringify(result).includes('합성 A역'), false);
});

test('실제 호출 예산은 누적 3회 제한, 손상 파일과 네 번째 시도는 차단', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'smart-departure-test-'));
  const path = join(directory, 'budget.json');
  try {
    assert.equal(await reserveLiveAttempt(path), 1);
    assert.equal(await reserveLiveAttempt(path), 2);
    assert.equal(await reserveLiveAttempt(path), 3);
    await assert.rejects(() => reserveLiveAttempt(path));
    const blocked = await runVerification(createCases({ scenario: 'all' }, now), {
      ...liveOptions(() => assert.fail('예산 소진 시 호출하면 안 됩니다.')),
      reserveAttempt: () => reserveLiveAttempt(path),
    });
    assert.equal(blocked.callCount, 0);
    assert.equal(blocked.error.category, 'LIVE_BUDGET_OR_STORAGE');
    assert.equal(JSON.parse(await readFile(path, 'utf8')).attempts.length, 3);
    await writeFile(path, 'broken');
    await assert.rejects(() => reserveLiveAttempt(path));
  } finally {
    // Delete only the exact temporary directory created by this test.
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + '\\') || resolve(directory).startsWith(resolve(tmpdir()) + '/'));
    await rm(directory, { recursive: true });
  }
});
