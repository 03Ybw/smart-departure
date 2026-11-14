import { calculateScheduleTarget, calculateTargetArrival, formatSeoulDateTime } from '/src/app/arrival-plan.mjs';
import { createJourneyState, changeJourneyInput, choosePlace, createRequestGate, validSearchQuery, coordinatePair } from '/src/app/place-selection.mjs';

const form = document.querySelector('#arrival-form');
let state = createJourneyState();
const slots = ['origin', 'destination'];
const searchGates = Object.fromEntries(slots.map(slot => [slot, createRequestGate()]));
const searches = Object.fromEntries(slots.map(slot => [slot, { places: [], loading: false, message: '', query: null, receivedAt: 0 }]));
const recommendationGate = createRequestGate();
const recommendButton = document.querySelector('#recommend-button');
const searchExpiryTimers = { origin: null, destination: null };
let recommendationExpiryTimer;
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
  const result = state.scheduleResult;
  renderRecommendation(state.result?.route ? state.result : null);
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
    byId('empty-title').textContent = '도착 일정을 입력해 주세요';
    byId('empty-description').textContent = '날짜와 시각을 완성하면 목표 도착시각이 자동으로 계산돼요.';
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
  byId('result-origin').textContent = state.input.originText.trim() || '출발지 선택 전';
  byId('result-destination').textContent = state.input.destinationText.trim() || '목적지 선택 전';
}

function handleInput(event) {
  const { name, value } = event.target;
  if (!fields.includes(name) || String(state.input[name] ?? '') === value) return;
  recommendationGate.invalidate();
  recommendButton.disabled = false;
  recommendButton.textContent = '경로 조회하고 출발시각 추정';
  byId('recommendation-status').textContent = '';
  state = changeJourneyInput(state, { [name]: value });
  const slot = name === 'originText' ? 'origin' : name === 'destinationText' ? 'destination' : null;
  if (slot) {
    clearTimeout(searchExpiryTimers[slot]);
    searchGates[slot].invalidate();
    searches[slot] = { places: [], loading: false, message: '', query: null, receivedAt: 0 };
    renderSearch(slot);
  }
  renderErrors();
  renderResult();
}
form.addEventListener('input', handleInput);
form.addEventListener('change', handleInput);

// Enter must not implicitly issue a paid request; search and route buttons are explicit.
form.addEventListener('submit', event => event.preventDefault());

function duration(seconds) {
  return `${Math.floor(seconds / 60)}분${seconds % 60 ? ` ${seconds % 60}초` : ''}`;
}

function renderRecommendation(result) {
  if (!result) clearTimeout(recommendationExpiryTimer);
  byId('recommendation-result').hidden = !result;
  byId('departure-placeholder').hidden = Boolean(result);
  for (const id of ['departure-date', 'departure-time', 'total-duration', 'walk-duration', 'transfer-count']) byId(id).textContent = '';
  byId('departure-time').removeAttribute('datetime');
  byId('route-legs').replaceChildren();
  byId('estimate-limitations').replaceChildren();
  if (!result) return;
  const departure = formatSeoulDateTime(result.displayDepartureDateTime);
  byId('departure-date').textContent = departure.date;
  byId('departure-time').textContent = departure.time;
  byId('departure-time').dateTime = result.displayDepartureDateTime;
  byId('total-duration').textContent = duration(result.totalDurationSeconds);
  byId('walk-duration').textContent = duration(result.route.totalWalkTime);
  byId('transfer-count').textContent = `${result.route.transferCount}회`;
  for (const leg of result.route.legs) {
    const item = document.createElement('li');
    const heading = document.createElement('strong');
    heading.textContent = `${{ WALK: '도보', BUS: '버스', SUBWAY: '지하철' }[leg.mode]}${leg.route ? ` · ${leg.route}` : ''} · ${duration(leg.sectionTime)}`;
    const stops = document.createElement('span');
    stops.textContent = `${leg.start} → ${leg.end}`;
    item.append(heading, stops);
    byId('route-legs').append(item);
  }
  for (const message of result.limitations) { const item = document.createElement('li'); item.textContent = message; byId('estimate-limitations').append(item); }
}

function renderSearch(slot) {
  const search = searches[slot], selected = state.selectedPlaces[slot];
  const button = document.querySelector(`[data-search="${slot}"]`);
  button.disabled = search.loading;
  button.textContent = search.loading ? '검색 중' : '검색';
  byId(`${slot}-search-status`).textContent = search.message;
  const selection = byId(`${slot}-selection`);
  selection.hidden = !selected;
  selection.textContent = selected ? `선택 완료 · ${selected.address ?? '주소 정보 없음'} · ${selected.coordinateSource === 'ENTRANCE' ? '입구 좌표' : '중심 좌표'} 기준` : '';
  const list = byId(`${slot}-search-results`);
  list.replaceChildren();
  list.hidden = selected !== null || search.places.length === 0;
  for (const place of search.places) {
    const item = document.createElement('li');
    const choice = document.createElement('button'); choice.type = 'button';
    const title = document.createElement('strong'); title.textContent = place.name;
    const address = document.createElement('span'); address.textContent = place.address ?? '주소 정보 없음';
    const detail = document.createElement('small'); detail.textContent = [place.category, place.coordinateSource === 'CENTER' ? '중심 좌표 기준' : null].filter(Boolean).join(' · ');
    choice.append(title, address, detail);
    choice.addEventListener('click', () => {
      recommendationGate.invalidate(); recommendButton.disabled = false; recommendButton.textContent = '경로 조회하고 출발시각 추정';
      byId('recommendation-status').textContent = '';
      state = choosePlace(state, slot, place);
      form.elements[`${slot}Text`].value = place.name;
      searches[slot].message = '';
      renderSearch(slot); renderErrors(); renderResult();
    });
    item.append(choice); list.append(item);
  }
}

async function readResponse(response) {
  let data;
  try { data = await response.json(); }
  catch { throw { code: 'INVALID_RESPONSE', message: '서버 응답을 확인할 수 없어요.' }; }
  if (!response.ok || data?.error) throw data?.error ?? { code: 'REQUEST_FAILED', message: '요청을 처리할 수 없어요.' };
  return data;
}

function safeRequestMessage(error, fallback) {
  // Fetch exceptions are browser-specific; server responses use safe plain data.
  return !(error instanceof Error) && typeof error?.message === 'string' ? error.message : fallback;
}

for (const slot of slots) document.querySelector(`[data-search="${slot}"]`).addEventListener('click', async () => {
  const query = form.elements[`${slot}Text`].value.trim();
  recommendationGate.invalidate(); recommendButton.disabled = false; recommendButton.textContent = '경로 조회하고 출발시각 추정';
  byId('recommendation-status').textContent = '';
  state = changeJourneyInput(state, { [`${slot}Text`]: form.elements[`${slot}Text`].value });
  renderResult(); renderErrors();
  if (!validSearchQuery(query)) { searches[slot] = { places: [], loading: false, message: '장소명은 1~80자로 입력해 주세요.', query: null }; renderSearch(slot); return; }
  if (searches[slot].query === query && searches[slot].places.length && Date.now() - searches[slot].receivedAt < 10 * 60_000) {
    searches[slot].message = '검색된 장소의 주소를 확인하고 선택하세요.'; renderSearch(slot); return;
  }
  const ticket = searchGates[slot].begin();
  clearTimeout(searchExpiryTimers[slot]);
  searches[slot] = { places: [], loading: true, message: '장소를 검색하고 있어요.', query: null };
  renderSearch(slot);
  try {
    const data = await readResponse(await fetch(`/api/places?q=${encodeURIComponent(query)}`, { signal: ticket.signal }));
    if (!searchGates[slot].isCurrent(ticket)) return;
    if (!Array.isArray(data?.places) || data.places.some(place => !place || typeof place.name !== 'string' || !place.name.trim() || typeof place.selectionToken !== 'string' || !place.selectionToken || !coordinatePair(place.longitude, place.latitude))) throw { message: '장소 검색 응답을 확인할 수 없어요.' };
    searches[slot] = { places: data.places.slice(0, 5), loading: false, query, receivedAt: Date.now(), message: data.places.length ? '주소를 확인하고 장소를 선택해 주세요.' : '검색된 장소가 없어요. 다른 이름으로 검색해 주세요.' };
    if (data.places.length) searchExpiryTimers[slot] = setTimeout(() => {
      searchGates[slot].invalidate(); recommendationGate.invalidate();
      state = changeJourneyInput(state, { [`${slot}Text`]: state.input[`${slot}Text`] });
      searches[slot] = { places: [], loading: false, query: null, message: '검색 결과가 만료되었어요. 다시 검색해 주세요.' };
      recommendButton.disabled = false; recommendButton.textContent = '경로 조회하고 출발시각 추정';
      byId('recommendation-status').textContent = '';
      renderSearch(slot); renderResult();
    }, 10 * 60_000);
  } catch (error) {
    if (!searchGates[slot].isCurrent(ticket)) return;
    searches[slot] = { places: [], loading: false, query: null, message: safeRequestMessage(error, '장소 검색 서버에 연결할 수 없어요.') };
  } finally { if (searchGates[slot].isCurrent(ticket)) renderSearch(slot); }
});

recommendButton.addEventListener('click', async () => {
  const values = Object.fromEntries(new FormData(form));
  const calculation = calculateTargetArrival(values, { allowSameText: Boolean(state.selectedPlaces.origin && state.selectedPlaces.destination && state.selectedPlaces.origin.id !== state.selectedPlaces.destination.id) });
  const errors = { ...calculation.errors };
  for (const slot of slots) if (!state.selectedPlaces[slot]) errors[`${slot}Text`] = '검색 결과에서 장소를 선택해 주세요.';
  state = { ...state, input: values, scheduleResult: calculateScheduleTarget(values).result, result: calculation.result, errors };
  byId('recommendation-status').textContent = '';
  renderErrors(); renderResult();
  if (Object.keys(errors).length) { form.querySelector('[aria-invalid="true"]')?.focus(); return; }
  const ticket = recommendationGate.begin(), revision = state.revision;
  recommendButton.disabled = true; recommendButton.textContent = '경로 조회 중…';
  byId('recommendation-status').textContent = '선택한 장소의 대중교통 경로를 조회하고 있어요.';
  try {
    const data = await readResponse(await fetch('/api/recommendation', {
      method: 'POST', signal: ticket.signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...values, originSelectionToken: state.selectedPlaces.origin.selectionToken, destinationSelectionToken: state.selectedPlaces.destination.selectionToken }),
    }));
    if (!recommendationGate.isCurrent(ticket) || state.revision !== revision) return;
    if (!data?.route?.legs?.length || !Number.isSafeInteger(data.totalDurationSeconds) || data.totalDurationSeconds <= 0 || !Number.isSafeInteger(data.route.totalWalkTime) || !Number.isSafeInteger(data.route.transferCount) || !Number.isFinite(Date.parse(data.displayDepartureDateTime)) || data.targetArrivalDateTime !== calculation.result.targetArrivalDateTime || !Array.isArray(data.limitations) || data.limitations.some(message => typeof message !== 'string') || data.route.legs.some(leg => !['WALK', 'BUS', 'SUBWAY'].includes(leg.mode) || !Number.isSafeInteger(leg.sectionTime) || leg.sectionTime < 0 || typeof leg.start !== 'string' || typeof leg.end !== 'string')) throw { message: '경로 응답을 확인할 수 없어요.' };
    state = { ...state, result: data };
    byId('recommendation-status').textContent = '조회된 소요시간으로 출발시각을 추정했어요.';
    renderResult();
    clearTimeout(recommendationExpiryTimer);
    recommendationExpiryTimer = setTimeout(() => {
      recommendationGate.invalidate();
      state = { ...state, result: null, invalidated: true };
      byId('recommendation-status').textContent = '조회 결과가 만료되었어요. 다시 조회해 주세요.';
      renderResult();
    }, 10 * 60_000);
  } catch (error) {
    if (!recommendationGate.isCurrent(ticket) || state.revision !== revision) return;
    byId('recommendation-status').textContent = safeRequestMessage(error, '경로 조회 서버에 연결할 수 없어요.');
    if (error.fields) state.errors = Object.fromEntries(Object.entries(error.fields).filter(([name]) => fields.includes(name)));
    if (error.code === 'PLACE_SELECTION_EXPIRED') {
      for (const slot of slots) if (error.fields?.[`${slot}Text`]) { state.selectedPlaces[slot] = null; searches[slot] = { places: [], loading: false, message: '다시 검색해 주세요.', query: null }; renderSearch(slot); }
    }
    renderErrors(); renderResult();
  } finally {
    if (recommendationGate.isCurrent(ticket)) { recommendButton.disabled = false; recommendButton.textContent = '경로 조회하고 출발시각 추정'; }
  }
});

renderResult();
