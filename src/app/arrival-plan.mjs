import { seoulDate, toTimestamp } from '../utils/time.mjs';

export const BUFFER_OPTIONS = Object.freeze([0, 5, 10, 15, 20, 30]);

export function createPlannerState() {
  return {
    input: {
      originText: '', destinationText: '',
      desiredArrivalDate: seoulDate(), desiredArrivalTime: '', bufferMinutes: 10,
    },
    errors: {}, result: null, invalidated: false,
  };
}

export function validateTripInput(values = {}, { allowSameText = false } = {}) {
  const input = {
    originText: typeof values.originText === 'string' ? values.originText.trim() : '',
    destinationText: typeof values.destinationText === 'string' ? values.destinationText.trim() : '',
    desiredArrivalDate: values.desiredArrivalDate,
    desiredArrivalTime: values.desiredArrivalTime,
    bufferMinutes: values.bufferMinutes,
  };
  const errors = {};
  if (!input.originText) errors.originText = '출발지를 입력해 주세요.';
  if (!input.destinationText) errors.destinationText = '목적지를 입력해 주세요.';
  if (!allowSameText && input.originText && input.originText === input.destinationText) {
    errors.destinationText = '출발지와 다른 목적지를 입력해 주세요.';
  }
  if (!input.desiredArrivalDate) errors.desiredArrivalDate = '도착 날짜를 선택해 주세요.';
  else {
    try {
      toTimestamp(input.desiredArrivalDate, '00:00');
      if (input.desiredArrivalDate.startsWith('0000')) throw new Error();
    } catch { errors.desiredArrivalDate = '올바른 날짜를 입력해 주세요.'; }
  }
  if (!input.desiredArrivalTime) errors.desiredArrivalTime = '도착시각을 입력해 주세요.';
  else {
    try { toTimestamp('2000-01-01', input.desiredArrivalTime); }
    catch { errors.desiredArrivalTime = '올바른 시각을 입력해 주세요. (00:00~23:59)'; }
  }
  const bufferIsNumber = typeof input.bufferMinutes === 'number';
  const bufferIsString = typeof input.bufferMinutes === 'string' && /^(0|5|10|15|20|30)$/.test(input.bufferMinutes);
  if ((!bufferIsNumber && !bufferIsString) || !BUFFER_OPTIONS.includes(Number(input.bufferMinutes))) {
    errors.bufferMinutes = '여유시간은 0, 5, 10, 15, 20, 30분 중 선택해 주세요.';
  } else input.bufferMinutes = Number(input.bufferMinutes);
  return { valid: Object.keys(errors).length === 0, input, errors };
}

export function calculateTargetArrival(values, options) {
  const { valid, input, errors } = validateTripInput(values, options);
  if (!valid) return { ok: false, errors, result: null };
  const desired = toTimestamp(input.desiredArrivalDate, input.desiredArrivalTime);
  const target = new Date(Date.parse(desired) - input.bufferMinutes * 60_000);
  const targetDate = seoulDate(target);
  if (targetDate.startsWith('0000') || targetDate.length !== 10) {
    return { ok: false, errors: { desiredArrivalDate: '계산 가능한 날짜 범위를 벗어났어요.' }, result: null };
  }
  const targetTime = new Date(target.getTime() + 9 * 3_600_000).toISOString().slice(11, 16);
  return {
    ok: true, errors: {},
    result: {
      ...input, targetArrivalDateTime: `${targetDate}T${targetTime}:00+09:00`,
      route: null, totalDurationSeconds: null, estimatedDepartureDateTime: null,
      estimateBasis: null, limitations: [],
    },
  };
}

// Every input edit clears the previous calculation before anything is displayed.
export function updatePlannerInput(state, patch) {
  const errors = { ...state.errors };
  for (const name of Object.keys(patch)) delete errors[name];
  if ('originText' in patch || 'destinationText' in patch) {
    delete errors.originText;
    delete errors.destinationText;
  }
  return {
    input: { ...state.input, ...patch }, errors, result: null,
    invalidated: state.result !== null || state.invalidated,
  };
}

export function formatSeoulDateTime(timestamp) {
  const date = new Date(timestamp);
  const day = seoulDate(date).replaceAll('-', '.');
  const weekday = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', weekday: 'short' }).format(date);
  const time = new Date(date.getTime() + 9 * 3_600_000).toISOString().slice(11, 16);
  return { date: `${day} (${weekday})`, time };
}
