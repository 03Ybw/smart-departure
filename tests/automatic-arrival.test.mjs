import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateScheduleTarget, calculateTargetArrival, validateScheduleInput } from '../src/app/arrival-plan.mjs';
import { createJourneyState, changeJourneyInput, choosePlace, createRequestGate } from '../src/app/place-selection.mjs';

const schedule = { desiredArrivalDate: '2026-11-16', desiredArrivalTime: '14:00', bufferMinutes: 10 };
const ready = () => changeJourneyInput(createJourneyState(), schedule);
const place = { id: 'synthetic-place', name: '합성 출발지', longitude: 127.1, latitude: 37.1, selectionToken: 'synthetic-token' };

test('일정 검증·계산은 누락·동일한 장소명과 독립적이며 API 값을 생성하지 않음', () => {
  for (const places of [{}, { originText: '', destinationText: '' }, { originText: '같은 이름', destinationText: '같은 이름' }]) {
    const input = { ...schedule, ...places, bufferMinutes: '10' };
    assert.equal(validateScheduleInput(input).valid, true);
    const result = calculateScheduleTarget(input).result;
    assert.equal(result.targetArrivalDateTime, '2026-11-16T13:50:00+09:00');
    assert.equal(result.bufferMinutes, 10);
    for (const field of ['route', 'totalDurationSeconds', 'estimatedDepartureDateTime']) assert.equal(field in result, false);
  }
});

test('날짜·시각 입력이 완성되는 즉시 별도 계산 없이 목표 도착시각 생성', () => {
  let state = createJourneyState();
  assert.equal(state.scheduleResult, null);
  state = changeJourneyInput(state, { desiredArrivalDate: schedule.desiredArrivalDate });
  assert.equal(state.scheduleResult, null);
  assert.deepEqual(state.errors, {});
  state = changeJourneyInput(state, { desiredArrivalTime: '14:00' });
  assert.equal(state.scheduleResult.targetArrivalDateTime, '2026-11-16T13:50:00+09:00');
  assert.equal(state.selectedPlaces.origin, null);
  assert.equal(state.result, null);
});

test('여유시간 반복 변경은 항상 원래 희망 도착시각에서 재계산', () => {
  let state = ready();
  for (const [bufferMinutes, time] of [[20, '13:40'], ['5', '13:55'], [0, '14:00'], [10, '13:50']]) {
    state = changeJourneyInput(state, { bufferMinutes });
    assert.equal(state.scheduleResult.targetArrivalDateTime, `2026-11-16T${time}:00+09:00`);
    assert.equal(state.input.desiredArrivalTime, '14:00');
  }
});

test('출발지·목적지 수정과 삭제는 목표를 유지하고 추천·해당 장소 선택만 무효화', () => {
  const selected = choosePlace(choosePlace(ready(), 'origin', place), 'destination', { ...place, id: 'synthetic-b', name: '합성 도착지', longitude: 127.2 });
  const previous = { ...selected, result: { route: { synthetic: true }, estimatedDepartureDateTime: '2026-11-16T13:00:00+09:00' } };
  for (const [slot, field] of [['origin', 'originText'], ['destination', 'destinationText']]) {
    for (const value of ['변경한 장소', '']) {
      const next = changeJourneyInput(previous, { [field]: value });
      assert.equal(next.scheduleResult.targetArrivalDateTime, '2026-11-16T13:50:00+09:00');
      assert.equal(next.selectedPlaces[slot], null);
      assert.equal(next.result, null);
      assert.ok(next.revision > previous.revision);
    }
  }
  assert.ok(previous.result.route);
});

test('장소를 새로 선택해도 자동 계산한 목표는 유지하고 이전 경로 제거', () => {
  const previous = { ...ready(), result: { route: { synthetic: true } } };
  const next = choosePlace(previous, 'origin', place);
  assert.equal(next.scheduleResult.targetArrivalDateTime, previous.scheduleResult.targetArrivalDateTime);
  assert.equal(next.selectedPlaces.origin.id, place.id);
  assert.equal(next.result, null);
});

test('일정 누락·잘못된 날짜/시각/여유시간은 목표와 추천을 숨기고 입력 중 오류를 추가하지 않음', () => {
  const previous = { ...ready(), result: { route: { synthetic: true } } };
  for (const patch of [{ desiredArrivalDate: '' }, { desiredArrivalTime: '' }, { desiredArrivalDate: '2026-02-29' }, { desiredArrivalTime: '24:00' }, { bufferMinutes: '' }, { bufferMinutes: 7 }]) {
    const next = changeJourneyInput(previous, patch);
    assert.equal(next.scheduleResult, null);
    assert.equal(next.result, null);
    assert.deepEqual(next.errors, {});
  }
});

test('조회 시 표시한 일정 오류는 입력을 다시 시작하면 지우고 장소 오류와 구분', () => {
  const previous = { ...ready(), errors: { originText: '장소를 선택해 주세요.', desiredArrivalDate: '계산 범위 오류', bufferMinutes: '이전 오류' } };
  const next = changeJourneyInput(previous, { bufferMinutes: 20 });
  assert.deepEqual(next.errors, { originText: '장소를 선택해 주세요.' });
  assert.equal(next.scheduleResult.targetArrivalDateTime, '2026-11-16T13:40:00+09:00');
});

test('목표가 자동 계산되어도 경로 요청에는 기존 장소 검증이 필요함', () => {
  const state = ready();
  const validation = calculateTargetArrival(state.input);
  assert.ok(state.scheduleResult);
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.originText);
  assert.ok(validation.errors.destinationText);
  assert.equal(validation.result, null);
});

test('날짜·시각 변경은 목표를 새로 계산하고 이전 추천 제거', () => {
  const previous = { ...ready(), result: { route: { synthetic: true } } };
  for (const [patch, expected] of [[{ desiredArrivalDate: '2026-11-17' }, '2026-11-17T13:50:00+09:00'], [{ desiredArrivalTime: '15:05' }, '2026-11-16T14:55:00+09:00']]) {
    const next = changeJourneyInput(previous, patch);
    assert.equal(next.scheduleResult.targetArrivalDateTime, expected);
    assert.equal(next.result, null);
  }
});

test('자동 일정 계산도 자정·월말·연말·윤년과 계산 범위 하한을 처리', () => {
  for (const [date, expected] of [['2026-11-17', '2026-11-16'], ['2026-05-01', '2026-04-30'], ['2027-01-01', '2026-12-31'], ['2028-03-01', '2028-02-29']]) {
    const state = changeJourneyInput(ready(), { desiredArrivalDate: date, desiredArrivalTime: '00:05' });
    assert.equal(state.scheduleResult.targetArrivalDateTime, `${expected}T23:55:00+09:00`);
  }
  const belowRange = changeJourneyInput(ready(), { desiredArrivalDate: '0001-01-01', desiredArrivalTime: '00:05' });
  assert.equal(belowRange.scheduleResult, null);
  assert.deepEqual(belowRange.errors, {});
});

test('변경된 입력의 요청 세대는 이전 추천 응답을 식별할 수 있고 새 목표와 분리됨', () => {
  const previous = ready();
  const gate = createRequestGate();
  const pending = gate.begin();
  const next = changeJourneyInput(previous, { bufferMinutes: 20 });
  gate.invalidate();
  assert.equal(gate.isCurrent(pending), false);
  assert.notEqual(next.revision, previous.revision);
  assert.equal(next.scheduleResult.targetArrivalDateTime, '2026-11-16T13:40:00+09:00');
  assert.equal(next.result, null);
});
