import { seoulDate, timestampInfo } from '../utils/time.mjs';

export const ESTIMATE_LIMITATIONS = Object.freeze([
  '현재 조회 소요시간 기준 추정입니다.',
  '실제 미래 운행편의 출발·도착시각은 확인되지 않았습니다.',
  '미래 배차, 환승 대기, 교통 지연 등에 따라 실제 이동시간이 달라질 수 있습니다.',
]);

function asSeoulTimestamp(milliseconds) {
  const value = new Date(milliseconds);
  const date = seoulDate(value);
  if (date.length !== 10 || date.startsWith('0000')) throw new Error('계산 가능한 날짜 범위를 벗어났습니다.');
  const time = new Date(milliseconds + 9 * 3_600_000).toISOString().slice(11, 19);
  return `${date}T${time}+09:00`;
}

export function estimateDeparture(targetArrivalDateTime, totalDurationSeconds) {
  if (!timestampInfo(targetArrivalDateTime) || !Number.isSafeInteger(totalDurationSeconds) || totalDurationSeconds < 0) {
    throw new Error('목표 도착시각과 초 단위 이동시간을 확인해 주세요.');
  }
  const milliseconds = Date.parse(targetArrivalDateTime) - totalDurationSeconds * 1000;
  if (!Number.isFinite(milliseconds)) throw new Error('계산 가능한 범위를 벗어났습니다.');
  return {
    estimatedDepartureDateTime: asSeoulTimestamp(milliseconds),
    displayDepartureDateTime: asSeoulTimestamp(Math.floor(milliseconds / 60_000) * 60_000),
    estimateBasis: 'CURRENT_ROUTE_DURATION', limitations: [...ESTIMATE_LIMITATIONS],
  };
}
