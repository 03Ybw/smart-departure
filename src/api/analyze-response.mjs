import { apiError, classifyApiError } from './tmap-routes.mjs';

const list = value => Array.isArray(value) ? value : [];
const number = value => Number.isInteger(value) && value >= 0 ? value : null;
const text = value => typeof value === 'string' && value.trim() ? value : null;
const flag = value => value === 0 || value === 1 ? value : null;
const CORE_MODES = new Set(['WALK', 'BUS', 'SUBWAY']);

function temporalPaths(value, path = '', paths = new Set()) {
  if (!value || typeof value !== 'object') return [...paths];
  for (const [key, item] of Object.entries(value)) {
    const next = `${path}${Array.isArray(value) ? '[]' : `.${key}`}`;
    if (!Array.isArray(value) && /time|dttm|date|arrival|departure|schedule/i.test(key)) paths.add(next.slice(1));
    temporalPaths(item, next, paths);
  }
  return [...paths].sort();
}

function analyzeRoute(route, index) {
  const missing = [];
  const result = { index };
  for (const key of ['totalTime', 'transferCount', 'totalWalkTime']) {
    result[key] = number(route?.[key]);
    if (result[key] === null) missing.push(key);
  }
  if (!Array.isArray(route?.legs) || !route.legs.length) missing.push('legs');
  result.legs = list(route?.legs).map((leg, legIndex) => {
    const record = {
      legIndex, mode: text(leg?.mode), sectionTime: number(leg?.sectionTime),
      start: text(leg?.start?.name), end: text(leg?.end?.name),
      route: text(leg?.route), service: flag(leg?.service),
      // Docs table says lane; the official JSON sample spells it Lane.
      lanes: list(leg?.lane ?? leg?.Lane).map(lane => ({ route: text(lane?.route), service: flag(lane?.service) })),
    };
    for (const key of ['mode', 'sectionTime', 'start', 'end']) {
      if (record[key] === null) missing.push(`legs[${legIndex}].${key}`);
    }
    if (record.mode && record.mode !== 'WALK' && record.route === null) missing.push(`legs[${legIndex}].route`);
    if (record.mode && record.mode !== 'WALK' && record.service === null) missing.push(`legs[${legIndex}].service`);
    return record;
  });
  result.modes = [...new Set(result.legs.map(leg => leg.mode).filter(Boolean))];
  result.otherModes = result.modes.filter(mode => !CORE_MODES.has(mode));
  result.coreModesOnly = result.legs.length && result.legs.every(leg => leg.mode !== null)
    ? result.otherModes.length === 0 : null;
  result.serviceObserved = result.legs.some(leg => leg.mode !== 'WALK' && (leg.service !== null || leg.lanes.some(lane => lane.service !== null)));
  const transitLegs = result.legs.filter(leg => leg.mode && leg.mode !== 'WALK');
  result.serviceComplete = transitLegs.length > 0 && transitLegs.every(leg => leg.service !== null);
  result.missing = missing;
  return result;
}

export function analyzeResponse(data) {
  const error = apiError(data);
  if (error) return { status: classifyApiError(200, data).category, routeCount: null, routes: [], timetable: { status: 'UNVERIFIED' } };
  const itineraries = data?.metaData?.plan?.itineraries;
  if (!Array.isArray(itineraries)) return { status: 'INVALID_RESPONSE', routeCount: null, routes: [], timetable: { status: 'UNVERIFIED' } };
  const routes = itineraries.map(analyzeRoute);
  const observedTemporalFields = temporalPaths(data);
  const undocumentedTemporalFields = observedTemporalFields.filter(path => !['totalTime', 'totalWalkTime', 'sectionTime', 'reqDttm', 'searchDttm'].includes(path.split('.').at(-1)));
  return {
    status: routes.length ? 'ROUTES_RETURNED' : 'NO_ROUTES', routeCount: routes.length, routes,
    providerRequestTime: text(data.metaData?.requestParameters?.reqDttm),
    timetable: {
      status: 'UNVERIFIED', documentedTripTimestampFields: [],
      observedTemporalFields, undocumentedTemporalFields,
      note: '공식 스키마에 실제 운행편 출발·도착시각 필드가 없습니다. 미문서화 시간 필드도 의미를 확인하기 전 운행편 시각으로 사용하지 않습니다.',
    },
    arrivalBasedRecommendation: 'UNVERIFIED',
  };
}

// This is an observation summary, not an API response cache.
export function summarizeAnalysis(analysis) {
  return {
    status: analysis.status, routeCount: analysis.routeCount,
    routes: analysis.routes.map(route => ({
      totalTime: route.totalTime, transferCount: route.transferCount, totalWalkTime: route.totalWalkTime,
      legCount: route.legs.length, modes: route.modes, otherModes: route.otherModes,
      coreModesOnly: route.coreModesOnly,
      serviceComplete: route.serviceComplete,
      sections: route.legs.map(leg => ({ mode: leg.mode, sectionTime: leg.sectionTime, service: leg.service, laneServices: leg.lanes.map(lane => lane.service) })),
      missing: route.missing,
    })),
    serviceObserved: analysis.routes.some(route => route.serviceObserved),
    providerRequestTime: analysis.providerRequestTime ?? null,
    timetable: analysis.timetable, arrivalBasedRecommendation: 'UNVERIFIED',
  };
}

export function compareRecords(first, second) {
  const comparable = first?.analysis?.status === 'ROUTES_RETURNED' && second?.analysis?.status === 'ROUTES_RETURNED';
  const select = (record, projection) => record.analysis.routes.map(projection);
  const same = (projection, complete = () => true) => comparable && [first, second].every(record => record.analysis.routes.every(complete))
    ? JSON.stringify(select(first, projection)) === JSON.stringify(select(second, projection)) : null;
  return {
    firstRequestId: first?.requestId ?? null, secondRequestId: second?.requestId ?? null,
    firstSearchDttm: first?.request?.searchDttm ?? null, secondSearchDttm: second?.request?.searchDttm ?? null,
    comparable,
    sameRouteStructure: same(route => route.legs.map(leg => ({ mode: leg.mode, route: leg.route, start: leg.start, end: leg.end })), route => route.legs.length > 0 && route.legs.every(leg => leg.mode !== null && leg.start !== null && leg.end !== null && (leg.mode === 'WALK' || leg.route !== null))),
    sameTravelTimes: same(route => ({ totalTime: route.totalTime, totalWalkTime: route.totalWalkTime, sections: route.legs.map(leg => leg.sectionTime) }), route => route.totalTime !== null && route.totalWalkTime !== null && route.legs.length > 0 && route.legs.every(leg => leg.sectionTime !== null)),
    sameServices: same(route => route.legs.map(leg => ({ service: leg.service, lanes: leg.lanes })), route => route.serviceComplete),
    note: '반환 순서 기준 비교입니다. 동일 결과도 정상 기록하며, 두 시각의 차이나 일치만으로 운행편 시간표 또는 인과관계를 확정하지 않습니다.',
  };
}
