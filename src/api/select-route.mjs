import { analyzeResponse } from './analyze-response.mjs';
import { ServiceError } from './service-error.mjs';

export function selectSupportedRoute(data) {
  const analysis = analyzeResponse(data);
  if (analysis.status === 'NO_ROUTES') throw new ServiceError('NO_ROUTES', 404, '선택한 장소 사이의 대중교통 경로가 없어요.');
  if (analysis.status !== 'ROUTES_RETURNED') throw new ServiceError('INVALID_RESPONSE', 502, '경로 응답을 확인할 수 없어요.');
  for (const candidate of analysis.routes) {
    if (candidate.coreModesOnly !== true || !candidate.legs.some(leg => ['BUS', 'SUBWAY'].includes(leg.mode))) continue;
    if (!Number.isSafeInteger(candidate.totalTime) || candidate.totalTime <= 0
      || candidate.totalWalkTime === null || candidate.totalWalkTime > candidate.totalTime || candidate.transferCount === null
      || candidate.legs.some(leg => leg.sectionTime === null || !leg.start || !leg.end || (leg.mode !== 'WALK' && !leg.route))) continue;
    return {
      providerIndex: candidate.index,
      selectionPolicy: 'FIRST_SUPPORTED_IN_PROVIDER_ORDER',
      totalDurationSeconds: candidate.totalTime, totalWalkTime: candidate.totalWalkTime,
      transferCount: candidate.transferCount, modes: candidate.modes,
      legs: candidate.legs.map(({ mode, sectionTime, start, end, route, service }) => ({ mode, sectionTime, start, end, route, service })),
    };
  }
  throw new ServiceError('NO_SUPPORTED_ROUTE', 422, '버스·지하철·도보로 안내할 수 있는 유효한 경로가 없어요.');
}
