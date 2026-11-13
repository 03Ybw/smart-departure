import { createPlannerState, updatePlannerInput } from './arrival-plan.mjs';

export const MAX_SEARCH_LENGTH = 80;
export function validSearchQuery(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= MAX_SEARCH_LENGTH;
}

export function coordinatePair(longitude, latitude) {
  const numeric = value => (typeof value === 'string' || typeof value === 'number') && /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(String(value).trim());
  if (!numeric(longitude) || !numeric(latitude)) return null;
  const lon = Number(longitude), lat = Number(latitude);
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90 || (lon === 0 && lat === 0)) return null;
  return { longitude: lon, latitude: lat };
}

export function createJourneyState() {
  return { ...createPlannerState(), selectedPlaces: { origin: null, destination: null }, revision: 0 };
}

export function changeJourneyInput(state, patch) {
  const selectedPlaces = { ...state.selectedPlaces };
  if ('originText' in patch) selectedPlaces.origin = null;
  if ('destinationText' in patch) selectedPlaces.destination = null;
  return { ...updatePlannerInput(state, patch), selectedPlaces, revision: state.revision + 1 };
}

export function choosePlace(state, slot, place) {
  if (!['origin', 'destination'].includes(slot) || !place || !coordinatePair(place.longitude, place.latitude)
    || typeof place.selectionToken !== 'string' || !place.selectionToken || typeof place.name !== 'string' || !place.name.trim()) {
    throw new Error('유효한 검색 결과를 선택해 주세요.');
  }
  const next = changeJourneyInput(state, { [`${slot}Text`]: place.name });
  next.selectedPlaces[slot] = { ...place };
  return next;
}

export function createRequestGate() {
  let version = 0, controller;
  return {
    invalidate() { version++; controller?.abort(); },
    begin() { controller?.abort(); controller = new AbortController(); return { version: ++version, signal: controller.signal }; },
    isCurrent(ticket) { return ticket.version === version && !ticket.signal.aborted; },
  };
}
