import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { buildPoiUrl, parsePoiResponse, searchPois } from '../src/api/tmap-pois.mjs';
import { coordinatePair, createJourneyState, changeJourneyInput, choosePlace, createRequestGate } from '../src/app/place-selection.mjs';
import { estimateDeparture } from '../src/app/departure-estimate.mjs';
import { stage3Config, assertLiveAllowed, reserveStage3Attempt } from '../src/utils/stage3-budget.mjs';
import { selectSupportedRoute } from '../src/api/select-route.mjs';
import { syntheticPois, syntheticRoutes } from './fixtures/stage3.mjs';

test('POI 공식 URL·필수 파라미터·UTF-8 검색어 인코딩', () => {
  const url = buildPoiUrl('  장소 & 이름  ');
  assert.equal(url.origin + url.pathname, 'https://apis.openapi.sk.com/tmap/pois');
  assert.deepEqual(Object.fromEntries(url.searchParams), { version: '1', searchKeyword: '장소 & 이름', searchType: 'all', page: '1', count: '5', reqCoordType: 'WGS84GEO', resCoordType: 'WGS84GEO', searchtypCd: 'A' });
  for (const query of ['', '   ', 'x'.repeat(81), undefined]) assert.throws(() => buildPoiUrl(query));
});

test('정상 POI 여러 결과 파싱, 입구 우선, 주소·장소명·분류 보존', () => {
  const parsed = parsePoiResponse(syntheticPois);
  assert.equal(parsed.places.length, 2);
  assert.equal(parsed.places[0].name, '합성 출발 장소');
  assert.equal(parsed.places[0].address, '합성시 시작로 1');
  assert.equal(parsed.places[0].coordinateSource, 'ENTRANCE');
  assert.equal(parsed.places[0].longitude, 127.1);
  assert.equal(parsed.places[1].address, '합성시 도착구 도착동 2');
});

test('POI 결과 없음과 잘못된 응답을 구분', () => {
  assert.deepEqual(parsePoiResponse({ searchPoiInfo: { totalCount: '0' } }).places, []);
  for (const data of [{}, null, { searchPoiInfo: { totalCount: 'x' } }, { searchPoiInfo: { totalCount: 1 } }]) assert.throws(() => parsePoiResponse(data), error => error.code === 'INVALID_RESPONSE');
});

test('입구가 없거나 유효하지 않으면 유효한 중심점 쌍 사용', () => {
  const data = structuredClone(syntheticPois);
  data.searchPoiInfo.pois.poi[0].frontLon = '';
  const point = parsePoiResponse(data).places[0];
  assert.equal(point.coordinateSource, 'CENTER');
  assert.equal(point.longitude, 127.11);
  assert.equal(point.latitude, 37.11);
});

test('누락·범위 밖·뒤바뀐 좌표 제외, 좌표 쌍을 임의로 혼합하지 않음', () => {
  for (const pair of [[undefined, 37], [127, ''], [37, 127], [181, 37], [127, 91], ['NaN', '37'], [0, 0], [true, 37]]) assert.equal(coordinatePair(...pair), null);
  const data = structuredClone(syntheticPois);
  Object.assign(data.searchPoiInfo.pois.poi[0], { frontLon: '', noorLat: '' });
  assert.equal(parsePoiResponse(data).places.length, 1);
  data.searchPoiInfo.pois.poi.pop();
  assert.throws(() => parsePoiResponse(data), error => error.code === 'INVALID_COORDINATES');
});

test('POI 출력은 최대 5개, HTML 문자열은 실행 없이 데이터로 보존', () => {
  const data = structuredClone(syntheticPois);
  data.searchPoiInfo.pois.poi = Array.from({ length: 9 }, (_, index) => ({ ...data.searchPoiInfo.pois.poi[0], id: `synthetic-${index}`, name: '<img src=x onerror=alert(1)>' }));
  assert.equal(parsePoiResponse(data).places.length, 5);
  assert.equal(parsePoiResponse(data).places[0].name, '<img src=x onerror=alert(1)>');
});

test('장소 선택 후 이름 변경 시 해당 좌표 선택과 이전 결과 즉시 해제', () => {
  const places = parsePoiResponse(syntheticPois).places;
  let state = createJourneyState();
  state = choosePlace(state, 'origin', { ...places[0], selectionToken: 'synthetic-token-a' });
  state = choosePlace(state, 'destination', { ...places[1], selectionToken: 'synthetic-token-b' });
  assert.equal(state.selectedPlaces.origin.longitude, 127.1);
  assert.equal(state.selectedPlaces.destination.longitude, 127.2);
  state.result = { synthetic: true };
  const changed = changeJourneyInput(state, { originText: '다른 장소' });
  assert.equal(changed.selectedPlaces.origin, null);
  assert.ok(changed.selectedPlaces.destination);
  assert.equal(changed.result, null);
  assert.ok(changed.revision > state.revision);
  assert.throws(() => choosePlace(state, 'origin', { ...places[0], selectionToken: '' }));
});

test('여유시간 변경 시 장소 선택은 유지하고 이전 추천은 무효화', () => {
  let state = createJourneyState();
  state = choosePlace(state, 'origin', { ...parsePoiResponse(syntheticPois).places[0], selectionToken: 'synthetic-token' });
  state.result = { synthetic: true };
  const next = changeJourneyInput(state, { bufferMinutes: 20 });
  assert.equal(next.result, null);
  assert.ok(next.selectedPlaces.origin);
});

test('오래된 비동기 검색·추천 응답을 최신 상태로 사용하지 않음', () => {
  const gate = createRequestGate();
  const old = gate.begin();
  const current = gate.begin();
  assert.equal(old.signal.aborted, true);
  assert.equal(gate.isCurrent(old), false);
  assert.equal(gate.isCurrent(current), true);
  gate.invalidate();
  assert.equal(gate.isCurrent(current), false);
});

test('실제 호출 비활성화·키 누락이면 POI fetch 0회', async () => {
  const fetchImpl = () => assert.fail('외부 요청 금지');
  await assert.rejects(searchPois('합성', { apiKey: 'synthetic', fetchImpl }), error => error.code === 'LIVE_DISABLED');
  await assert.rejects(searchPois('합성', { live: true, fetchImpl }), error => error.code === 'MISSING_KEY');
});

test('POI 인증·할당량·네트워크·시간초과·손상 응답 처리 및 비밀 제거', async () => {
  const key = 'synthetic-poi-secret';
  for (const [status, category] of [[403, 'POI_AUTH_PERMISSION'], [429, 'PROVIDER_QUOTA']]) {
    await assert.rejects(searchPois('합성', { live: true, apiKey: key, fetchImpl: async () => new Response(JSON.stringify({ error: { message: key } }), { status }) }), error => error.code === category && !error.message.includes(key));
  }
  for (const [name, category] of [['TypeError', 'NETWORK'], ['TimeoutError', 'TIMEOUT']]) await assert.rejects(searchPois('합성', { live: true, apiKey: key, fetchImpl: async () => { throw Object.assign(new Error(key), { name }); } }), error => error.code === category);
  await assert.rejects(searchPois('합성', { live: true, apiKey: key, fetchImpl: async () => new Response('broken') }), error => error.code === 'INVALID_RESPONSE');
});

test('정상 경로의 초 단위 총/도보시간, 환승, 버스·지하철·도보 정보', () => {
  const route = selectSupportedRoute(syntheticRoutes);
  assert.equal(route.totalDurationSeconds, 727);
  assert.equal(route.totalWalkTime, 394);
  assert.equal(route.transferCount, 1);
  assert.deepEqual(route.modes, ['WALK', 'SUBWAY', 'BUS']);
  assert.equal(route.legs[1].start, '합성 A역');
});

test('지원 밖 수단 제외 후 제공자 순서의 첫 유효 후보 선택, 최단 경로로 바꾸지 않음', () => {
  const data = structuredClone(syntheticRoutes);
  const unsupported = structuredClone(data.metaData.plan.itineraries[0]);
  unsupported.legs[1].mode = 'TRAIN';
  const shorter = structuredClone(data.metaData.plan.itineraries[0]); shorter.totalTime = 500;
  data.metaData.plan.itineraries = [unsupported, data.metaData.plan.itineraries[0], shorter];
  const route = selectSupportedRoute(data);
  assert.equal(route.providerIndex, 1);
  assert.equal(route.totalDurationSeconds, 727);
});

test('도보만 있는 경로, 지원 밖 경로, 누락된 시간·구간은 추천하지 않음', () => {
  for (const mutate of [route => { route.legs = route.legs.filter(leg => leg.mode === 'WALK'); }, route => { route.legs[1].mode = 'AIRPLANE'; }, route => { delete route.totalTime; }, route => { delete route.legs[0].sectionTime; }]) {
    const data = structuredClone(syntheticRoutes); mutate(data.metaData.plan.itineraries[0]);
    assert.throws(() => selectSupportedRoute(data), error => error.code === 'NO_SUPPORTED_ROUTE');
  }
  assert.throws(() => selectSupportedRoute({ metaData: { plan: { itineraries: [] } } }), error => error.code === 'NO_ROUTES');
  assert.throws(() => selectSupportedRoute({}), error => error.code === 'INVALID_RESPONSE');
});

test('일반 출발 추정은 목표 도착에서 총 소요시간만 차감', () => {
  const result = estimateDeparture('2026-11-16T13:50:00+09:00', 2400);
  assert.equal(result.estimatedDepartureDateTime, '2026-11-16T13:10:00+09:00');
  assert.equal(result.estimateBasis, 'CURRENT_ROUTE_DURATION');
  assert.ok(result.limitations.some(message => message.includes('미래 운행편')));
});

test('727초를 초 단위로 차감하고 이전 분으로 내림', () => {
  const result = estimateDeparture('2026-11-16T13:50:00+09:00', 727);
  assert.equal(result.estimatedDepartureDateTime, '2026-11-16T13:37:53+09:00');
  assert.equal(result.displayDepartureDateTime, '2026-11-16T13:37:00+09:00');
});

test('추정 출발의 자정·월말·연말·윤년 날짜 경계 처리', () => {
  for (const [date, expected] of [['2026-11-17', '2026-11-16'], ['2026-05-01', '2026-04-30'], ['2027-01-01', '2026-12-31'], ['2028-03-01', '2028-02-29']]) {
    assert.equal(estimateDeparture(`${date}T00:05:00+09:00`, 600).displayDepartureDateTime, `${expected}T23:55:00+09:00`);
  }
});

test('잘못된 총 이동시간과 절대시각은 추정하지 않음', () => {
  for (const seconds of [-1, NaN, '727', 1.5, Infinity]) assert.throws(() => estimateDeparture('2026-11-16T13:50:00+09:00', seconds));
  assert.throws(() => estimateDeparture('bad', 727));
});

test('기본 설정은 두 서비스 비활성화·예산 0, POI 별도 키와 기본 키 대체', () => {
  const config = stage3Config();
  assert.equal(config.poi.enabled, false); assert.equal(config.transit.enabled, false);
  assert.equal(config.poi.maxCalls, 0); assert.equal(config.transit.maxCalls, 0);
  assert.equal(stage3Config({ TMAP_APP_KEY: 'synthetic-a' }).poi.apiKey, 'synthetic-a');
  assert.equal(stage3Config({ TMAP_APP_KEY: 'synthetic-a', TMAP_POI_APP_KEY: 'synthetic-b' }).poi.apiKey, 'synthetic-b');
  assert.throws(() => assertLiveAllowed(config.poi, 'poi'), error => error.code === 'LIVE_DISABLED');
  assert.throws(() => assertLiveAllowed({ enabled: true, maxCalls: 0, apiKey: 'synthetic' }, 'poi'), error => error.code === 'BUDGET_EXHAUSTED');
  assert.throws(() => assertLiveAllowed({ enabled: true, maxCalls: 1 }, 'transit'), error => error.code === 'MISSING_KEY');
});

test('서비스 예산은 누적 기록하며 한도 소진·손상 파일·중복 잠금은 차단', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'smart-stage3-budget-'));
  const path = join(directory, 'poi.json');
  try {
    await assert.rejects(reserveStage3Attempt(path, 0)); assert.equal(existsSync(path), false);
    assert.equal(await reserveStage3Attempt(path, 1), 1);
    await assert.rejects(reserveStage3Attempt(path, 1), error => error.code === 'BUDGET_EXHAUSTED');
    assert.equal(JSON.parse(await readFile(path, 'utf8')).attempts.length, 1);
    await writeFile(path, 'broken');
    await assert.rejects(reserveStage3Attempt(path, 2), error => error.code === 'BUDGET_UNAVAILABLE');
    await writeFile(`${path}.lock`, '');
    await assert.rejects(reserveStage3Attempt(path, 2), error => error.code === 'BUDGET_UNAVAILABLE');
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    await rm(directory, { recursive: true });
  }
});
