import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  BUFFER_OPTIONS, createPlannerState, validateTripInput,
  calculateTargetArrival, updatePlannerInput, formatSeoulDateTime,
} from '../src/app/arrival-plan.mjs';

const input = {
  originText: '출발 장소', destinationText: '도착 장소',
  desiredArrivalDate: '2026-11-16', desiredArrivalTime: '14:00', bufferMinutes: 10,
};
const calculate = patch => calculateTargetArrival({ ...input, ...patch });

test('일반 목표 도착시각 계산과 한국시간 RFC3339 표현', () => {
  const outcome = calculate();
  assert.equal(outcome.ok, true);
  assert.equal(outcome.result.targetArrivalDateTime, '2026-11-16T13:50:00+09:00');
  assert.deepEqual(formatSeoulDateTime(outcome.result.targetArrivalDateTime), { date: '2026.11.16 (월)', time: '13:50' });
});

test('여유시간 변경 후 원래 희망 도착시각을 기준으로 새로 계산', () => {
  assert.equal(calculate().result.targetArrivalDateTime, '2026-11-16T13:50:00+09:00');
  assert.equal(calculate({ bufferMinutes: 20 }).result.targetArrivalDateTime, '2026-11-16T13:40:00+09:00');
  assert.equal(calculate({ desiredArrivalTime: '15:00', bufferMinutes: 5 }).result.targetArrivalDateTime, '2026-11-16T14:55:00+09:00');
});

test('자정 이전으로 넘어가는 목표 도착 날짜와 시각', () => {
  assert.equal(calculate({ desiredArrivalDate: '2026-11-17', desiredArrivalTime: '00:05' }).result.targetArrivalDateTime, '2026-11-16T23:55:00+09:00');
});

test('월말 경계 계산', () => {
  assert.equal(calculate({ desiredArrivalDate: '2026-05-01', desiredArrivalTime: '00:05' }).result.targetArrivalDateTime, '2026-04-30T23:55:00+09:00');
});

test('연말 경계 계산', () => {
  assert.equal(calculate({ desiredArrivalDate: '2027-01-01', desiredArrivalTime: '00:10', bufferMinutes: 20 }).result.targetArrivalDateTime, '2026-12-31T23:50:00+09:00');
});

test('윤년과 평년, 세기 연도의 달력 처리', () => {
  for (const [date, expected] of [['2028-03-01', '2028-02-29'], ['2027-03-01', '2027-02-28'], ['2000-03-01', '2000-02-29'], ['1900-03-01', '1900-02-28']]) {
    assert.equal(calculate({ desiredArrivalDate: date, desiredArrivalTime: '00:05' }).result.targetArrivalDateTime, `${expected}T23:55:00+09:00`);
  }
});

test('날짜 미입력과 실제 존재하지 않는 날짜는 계산하지 않음', () => {
  for (const date of ['', undefined, '2026-02-29', '2026-04-31', '2026-13-01', '2026-1-01', '0000-01-01']) {
    const outcome = calculate({ desiredArrivalDate: date });
    assert.equal(outcome.ok, false);
    assert.ok(outcome.errors.desiredArrivalDate);
    assert.equal(outcome.result, null);
  }
});

test('시각 미입력과 잘못된 시각은 필드 오류로 처리', () => {
  for (const time of ['', undefined, '24:00', '13:60', '2:05', '14:00Z', 1400]) {
    const outcome = calculate({ desiredArrivalTime: time });
    assert.equal(outcome.ok, false);
    assert.ok(outcome.errors.desiredArrivalTime);
    assert.equal(outcome.result, null);
  }
});

test('출발지 및 목적지 누락, 공백 입력 검증', () => {
  for (const field of ['originText', 'destinationText']) {
    for (const value of ['', '  ', undefined, null]) {
      const outcome = calculate({ [field]: value });
      assert.equal(outcome.ok, false);
      assert.ok(outcome.errors[field]);
      assert.equal(outcome.result, null);
    }
  }
});

test('앞뒤 공백 제거 후 출발지와 목적지가 같으면 오류', () => {
  const outcome = calculate({ originText: ' 서울역 ', destinationText: '서울역' });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.destinationText);
});

test('허용하지 않는 여유시간과 타입은 계산하지 않음', () => {
  for (const bufferMinutes of [-1, 1, 31, 60, NaN, Infinity, undefined, null, '', true, '10분', '05']) {
    const outcome = calculate({ bufferMinutes });
    assert.equal(outcome.ok, false);
    assert.ok(outcome.errors.bufferMinutes);
  }
});

test('허용된 6개 여유시간과 폼 문자열 입력 처리', () => {
  assert.deepEqual(BUFFER_OPTIONS, [0, 5, 10, 15, 20, 30]);
  for (const minutes of BUFFER_OPTIONS) {
    for (const value of [minutes, String(minutes)]) assert.equal(calculate({ bufferMinutes: value }).result.bufferMinutes, minutes);
  }
  assert.equal(calculate({ bufferMinutes: 0 }).result.targetArrivalDateTime, '2026-11-16T14:00:00+09:00');
});

test('어떤 입력이 바뀌어도 이전 계산 결과를 즉시 무효화', () => {
  const state = { input, errors: {}, result: calculate().result, invalidated: false };
  for (const patch of [{ originText: '다른 출발지' }, { destinationText: '다른 목적지' }, { desiredArrivalDate: '2026-11-17' }, { desiredArrivalTime: '15:00' }, { bufferMinutes: 20 }]) {
    const updated = updatePlannerInput(state, patch);
    assert.equal(updated.result, null);
    assert.equal(updated.invalidated, true);
    assert.ok(state.result);
  }
});

test('기본 상태와 API 값 미생성, 자유 입력 및 앞뒤 공백 정리', () => {
  const state = createPlannerState();
  assert.equal(state.input.originText, '');
  assert.equal(state.input.destinationText, '');
  assert.equal(state.input.bufferMinutes, 10);
  assert.equal(state.result, null);
  const result = calculate({ originText: '  임의의 장소 A  ', destinationText: ' 임의의 장소 B ' }).result;
  assert.equal(result.originText, '임의의 장소 A');
  assert.equal(result.destinationText, '임의의 장소 B');
  for (const name of ['route', 'totalDurationSeconds', 'estimatedDepartureDateTime', 'estimateBasis']) assert.equal(result[name], null);
});

test('검증 오류는 필드별로 반환하고 계산 함수를 호출해도 결과를 만들지 않음', () => {
  const invalid = validateTripInput({});
  assert.equal(invalid.valid, false);
  assert.deepEqual(Object.keys(invalid.errors).sort(), ['originText', 'destinationText', 'desiredArrivalDate', 'desiredArrivalTime', 'bufferMinutes'].sort());
  const state = { ...createPlannerState(), errors: { originText: '오류', destinationText: '오류', desiredArrivalTime: '오류' } };
  const changed = updatePlannerInput(state, { originText: '새 출발지' });
  assert.equal(changed.errors.originText, undefined);
  assert.equal(changed.errors.destinationText, undefined);
  assert.equal(changed.errors.desiredArrivalTime, '오류');
});

test('계산 가능한 날짜의 하한을 넘는 여유시간 처리', () => {
  const outcome = calculate({ desiredArrivalDate: '0001-01-01', desiredArrivalTime: '00:05' });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.desiredArrivalDate);
});

test('서로 다른 프로세스 로컬 시간대에서도 같은 계산 결과', () => {
  const url = new URL('../src/app/arrival-plan.mjs', import.meta.url).href;
  const source = `import { calculateTargetArrival, formatSeoulDateTime } from ${JSON.stringify(url)}; const result = calculateTargetArrival(${JSON.stringify({ ...input, desiredArrivalDate: '2027-01-01', desiredArrivalTime: '00:10', bufferMinutes: 20 })}).result; console.log(JSON.stringify([result.targetArrivalDateTime,formatSeoulDateTime(result.targetArrivalDateTime)]));`;
  const outputs = ['UTC', 'America/Los_Angeles', 'Asia/Seoul'].map(TZ => {
    const process = spawnSync(globalThis.process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', env: { ...globalThis.process.env, TZ } });
    assert.equal(process.status, 0, process.stderr);
    return JSON.parse(process.stdout);
  });
  assert.deepEqual(outputs[0], outputs[1]);
  assert.deepEqual(outputs[1], outputs[2]);
  assert.equal(outputs[0][0], '2026-12-31T23:50:00+09:00');
});
