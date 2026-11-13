import { buildRequest, OFFICIAL_EXAMPLE, computeRoutes } from '../api/tmap-routes.mjs';
import { analyzeResponse, summarizeAnalysis, compareRecords } from '../api/analyze-response.mjs';
import { InputError, nextWeekday, seoulDate, toSearchDttm } from './time.mjs';

export function parseArgs(args) {
  const options = {};
  const values = new Set(['start-x', 'start-y', 'end-x', 'end-y', 'count', 'search-dttm', 'date', 'time', 'scenario']);
  const flags = new Set(['live', 'dry-run', 'help']);
  for (let i = 0; i < args.length; i++) {
    const name = args[i].startsWith('--') ? args[i].slice(2) : '';
    if (!values.has(name) && !flags.has(name)) throw new InputError('알 수 없는 실행 인자입니다. --help를 확인하세요.');
    if (Object.hasOwn(options, name)) throw new InputError('같은 실행 인자를 중복 지정할 수 없습니다.');
    if (flags.has(name)) options[name] = true;
    else {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new InputError('실행 인자에 값이 필요합니다.');
      options[name] = value;
    }
  }
  if (options.live && options['dry-run']) throw new InputError('--live와 --dry-run은 동시에 지정할 수 없습니다.');
  return options;
}

export function createCases(options, now = new Date()) {
  const keys = ['start-x', 'start-y', 'end-x', 'end-y'];
  const specified = keys.filter(key => options[key] !== undefined).length;
  if (specified && specified !== 4) throw new InputError('좌표 변경 시 start-x/start-y/end-x/end-y를 모두 지정하세요.');
  const points = specified ? { startX: options['start-x'], startY: options['start-y'], endX: options['end-x'], endY: options['end-y'] } : OFFICIAL_EXAMPLE;
  const common = { ...points, count: options.count ?? 1 };
  const { scenario, date, time } = options;
  if (scenario !== undefined && scenario !== 'all') throw new InputError('--scenario에는 all만 사용할 수 있습니다.');
  if (scenario === 'all') {
    if (time !== undefined || options['search-dttm'] !== undefined) throw new InputError('scenario all은 time/search-dttm과 함께 지정할 수 없습니다.');
    const futureDate = date ?? nextWeekday(now);
    toSearchDttm(futureDate, '13:50');
    const day = new Date(`${futureDate}T12:00:00+09:00`);
    if (futureDate <= seoulDate(now) || [0, 6].includes(new Date(day.getTime() + 9 * 3_600_000).getUTCDay())) {
      throw new InputError('시나리오 날짜는 한국시간 실행일 이후의 평일이어야 합니다.');
    }
    return [
      { name: 'A-current', request: buildRequest(common) },
      { name: 'B-search-1350', request: buildRequest({ ...common, searchDttm: toSearchDttm(futureDate, '13:50') }) },
      { name: 'C-search-1340', request: buildRequest({ ...common, searchDttm: toSearchDttm(futureDate, '13:40') }) },
    ];
  }
  if (options['search-dttm'] !== undefined && (date !== undefined || time !== undefined)) throw new InputError('search-dttm과 date/time은 함께 지정할 수 없습니다.');
  if ((date === undefined) !== (time === undefined)) throw new InputError('date와 time을 함께 지정하세요.');
  const searchDttm = date !== undefined ? toSearchDttm(date, time) : options['search-dttm'];
  return [{ name: 'single', request: buildRequest({ ...common, ...(searchDttm !== undefined ? { searchDttm } : {}) }) }];
}

export async function runVerification(cases, { live = false, apiKey, fetchImpl, reserveAttempt, now = () => new Date() } = {}) {
  if (live !== true) return { mode: 'DRY_RUN_NO_HTTP', callCount: 0, cases };
  if (!apiKey?.trim()) return { mode: 'LIVE', callCount: 0, error: { category: 'MISSING_KEY' }, records: [] };
  if (!Array.isArray(cases) || cases.length < 1 || cases.length > 3) throw new InputError('한 번에 1~3개 요청만 검증할 수 있습니다.');
  if (typeof reserveAttempt !== 'function') throw new InputError('실제 호출에는 영구 호출 예산 기록이 필요합니다.');
  const records = [];
  let error;
  for (const item of cases) {
    // Reserve before fetch. A timeout or interrupted run still consumes the budget.
    let attempt;
    try { attempt = await reserveAttempt(); }
    catch { error = { category: 'LIVE_BUDGET_OR_STORAGE', message: '누적 호출 한도(3회) 또는 예산 파일을 확인하세요. 요청하지 않았습니다.' }; break; }
    const record = { requestId: `tmap-${attempt}`, scenario: item.name, requestedAt: now().toISOString(), request: item.request };
    const result = await computeRoutes(item.request, { live: true, apiKey, fetchImpl });
    if (!result.ok) {
      record.error = result.error;
      error = result.error;
      records.push(record);
      break;
    }
    record.httpStatus = result.httpStatus;
    record.analysis = analyzeResponse(result.data);
    records.push(record);
    if (record.analysis.status !== 'ROUTES_RETURNED') { error = { category: record.analysis.status }; break; }
  }
  const second = records.find(record => record.scenario === 'B-search-1350');
  const third = records.find(record => record.scenario === 'C-search-1340');
  const comparison = second && third ? compareRecords(second, third) : null;
  return {
    mode: 'LIVE', callCount: records.length, error,
    records: records.map(({ analysis, ...record }) => ({ ...record, ...(analysis ? { analysis: summarizeAnalysis(analysis) } : {}) })),
    comparison,
    futureChecks: {
      serviceAtSpecifiedTime: [second, third].every(record => record?.analysis?.routes.some(route => route.serviceComplete)) ? 'OBSERVED_FOR_TESTED_CASES' : 'UNVERIFIED',
      routeAndDurationVariation: comparison?.comparable && comparison.sameRouteStructure !== null && comparison.sameTravelTimes !== null ? 'COMPARED_FOR_TESTED_CASES' : 'UNVERIFIED',
      actualTripDepartureArrival: 'UNVERIFIED', arrivalBasedRecommendation: 'UNVERIFIED',
    },
  };
}
