import { createPlannerState, updatePlannerInput, calculateTargetArrival, formatSeoulDateTime } from '/src/app/arrival-plan.mjs';

const form = document.querySelector('#arrival-form');
let state = createPlannerState();
form.elements.desiredArrivalDate.value = state.input.desiredArrivalDate;
const fields = ['originText', 'destinationText', 'desiredArrivalDate', 'desiredArrivalTime', 'bufferMinutes'];
const byId = id => document.getElementById(id);

function renderErrors() {
  for (const name of fields) {
    const error = state.errors[name];
    const message = byId(`${name}-error`);
    message.textContent = error ?? '';
    message.hidden = !error;
    const inputs = name === 'bufferMinutes' ? form.querySelectorAll('[name="bufferMinutes"]') : [form.elements[name]];
    for (const input of inputs) {
      if (error) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
  }
}

function renderResult() {
  const result = state.result;
  byId('calculated-result').hidden = !result;
  byId('empty-result').hidden = Boolean(result);
  if (!result) {
    byId('target-time').textContent = '';
    byId('target-time').removeAttribute('datetime');
    byId('target-date').textContent = '';
    byId('desired-arrival').textContent = '';
    byId('result-buffer').textContent = '';
    byId('result-origin').textContent = '';
    byId('result-destination').textContent = '';
    byId('previous-day').hidden = true;
    byId('empty-title').textContent = state.invalidated ? '입력값이 변경되었어요' : '아직 계산된 일정이 없어요';
    byId('empty-description').textContent = state.invalidated ? '새로운 일정으로 다시 계산해 주세요.' : '일정을 입력하면 목표 도착시각을 확인할 수 있어요.';
    return;
  }
  const target = formatSeoulDateTime(result.targetArrivalDateTime);
  const desired = formatSeoulDateTime(`${result.desiredArrivalDate}T${result.desiredArrivalTime}:00+09:00`);
  byId('target-date').textContent = target.date;
  byId('target-time').textContent = target.time;
  byId('target-time').dateTime = result.targetArrivalDateTime;
  byId('previous-day').hidden = result.targetArrivalDateTime.slice(0, 10) === result.desiredArrivalDate;
  byId('desired-arrival').textContent = `${desired.date} ${desired.time}`;
  byId('result-buffer').textContent = `${result.bufferMinutes}분`;
  byId('result-origin').textContent = result.originText;
  byId('result-destination').textContent = result.destinationText;
}

form.addEventListener('input', event => {
  const { name, value } = event.target;
  if (!fields.includes(name)) return;
  state = updatePlannerInput(state, { [name]: value });
  renderErrors();
  renderResult();
});

form.addEventListener('submit', event => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(form));
  const calculation = calculateTargetArrival(values);
  state = { input: values, result: calculation.result, errors: calculation.errors, invalidated: false };
  renderErrors();
  renderResult();
  if (!calculation.ok) form.querySelector('[aria-invalid="true"]')?.focus();
});
