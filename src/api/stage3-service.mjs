import { randomUUID, createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRequest, computeRoutes, redact, ENDPOINT } from './tmap-routes.mjs';
import { searchPois, buildPoiUrl } from './tmap-pois.mjs';
import { selectSupportedRoute } from './select-route.mjs';
import { ServiceError, providerFailure } from './service-error.mjs';
import { stage3Config, assertLiveAllowed, reserveStage3Attempt } from '../utils/stage3-budget.mjs';
import { calculateTargetArrival } from '../app/arrival-plan.mjs';
import { estimateDeparture } from '../app/departure-estimate.mjs';

export function createStage3Service({
  config = stage3Config(), fetchImpl = globalThis.fetch,
  budgetDirectory = fileURLToPath(new URL('../../reports/', import.meta.url)),
  now = () => new Date(), cooldownMs = 3000, selectionTtlMs = 10 * 60_000,
} = {}) {
  const places = new Map(), inFlight = new Set(), recent = new Map();
  const prune = () => {
    const time = now().getTime();
    for (const [token, entry] of places) if (entry.expires <= time) places.delete(token);
    for (const [key, timeOfRequest] of recent) if (time - timeOfRequest >= cooldownMs) recent.delete(key);
  };
  const timer = setInterval(prune, 60_000);
  timer.unref();
  const clean = data => [config.poi.apiKey, config.transit.apiKey].filter(Boolean).reduce((value, secret) => redact(value, secret), data);

  async function limited(service, fingerprint, operation) {
    assertLiveAllowed(config[service], service);
    prune();
    const key = createHash('sha256').update(`${service}:${fingerprint}`).digest('hex');
    if (inFlight.has(key)) throw new ServiceError('REQUEST_IN_PROGRESS', 409, '같은 요청을 처리하고 있어요. 잠시 기다려 주세요.');
    if (recent.has(key)) throw new ServiceError('REPEATED_REQUEST', 429, '같은 요청은 잠시 후 다시 시도해 주세요.');
    inFlight.add(key);
    try {
      await reserveStage3Attempt(join(budgetDirectory, `stage3-${service}-budget.json`), config[service].maxCalls, now());
      return await operation();
    } finally {
      inFlight.delete(key);
      recent.set(key, now().getTime());
      while (recent.size > 200) recent.delete(recent.keys().next().value);
    }
  }

  function selected(token, field, expectedName) {
    prune();
    if (typeof token !== 'string' || !token) throw new ServiceError('PLACE_NOT_SELECTED', 400, '검색 결과에서 출발지와 목적지를 선택해 주세요.', { [field]: '검색 결과에서 장소를 선택해 주세요.' });
    const entry = places.get(token);
    if (!entry || entry.place.name !== expectedName) throw new ServiceError('PLACE_SELECTION_EXPIRED', 422, '장소 선택이 만료되었어요. 다시 검색해 주세요.', { [field]: '다시 검색하고 장소를 선택해 주세요.' });
    return entry.place;
  }

  return {
    dispose() { clearInterval(timer); places.clear(); recent.clear(); },
    async search(query, signal) {
      buildPoiUrl(query); // Validate before reserving any paid call.
      return limited('poi', query.trim(), async () => {
        signal?.throwIfAborted();
        const result = await searchPois(query, { live: true, apiKey: config.poi.apiKey, fetchImpl, signal });
        const safe = clean(result);
        const expires = now().getTime() + selectionTtlMs;
        return {
          ...safe,
          places: safe.places.map(place => {
            const selectionToken = randomUUID();
            places.set(selectionToken, { place, expires });
            while (places.size > 100) places.delete(places.keys().next().value);
            return { ...place, selectionToken };
          }),
        };
      });
    },
    async recommend(input, signal) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ServiceError('INVALID_INPUT', 400, '입력값을 확인해 주세요.');
      if (['originText', 'destinationText'].some(field => typeof input[field] === 'string' && input[field].length > 500)) throw new ServiceError('INVALID_INPUT', 400, '장소 이름이 너무 길어요.');
      const plan = calculateTargetArrival(input, { allowSameText: true });
      if (!plan.ok) throw new ServiceError('INVALID_INPUT', 400, '일정 입력값을 확인해 주세요.', plan.errors);
      const origin = selected(input.originSelectionToken, 'originText', plan.result.originText);
      const destination = selected(input.destinationSelectionToken, 'destinationText', plan.result.destinationText);
      if (origin.id === destination.id || (origin.longitude === destination.longitude && origin.latitude === destination.latitude)) throw new ServiceError('SAME_PLACE', 400, '출발지와 다른 목적지를 선택해 주세요.', { destinationText: '출발지와 다른 목적지를 선택해 주세요.' });
      const body = buildRequest({ startX: origin.longitude, startY: origin.latitude, endX: destination.longitude, endY: destination.latitude, count: 5 });
      const fingerprint = JSON.stringify([origin, destination, plan.result.targetArrivalDateTime, plan.result.bufferMinutes]);
      return limited('transit', fingerprint, async () => {
        signal?.throwIfAborted();
        const guardedFetch = (url, options) => {
          if (url !== ENDPOINT) throw new Error('Unexpected upstream URL.');
          return fetchImpl(url, { ...options, signal: signal ? AbortSignal.any([signal, options.signal]) : options.signal });
        };
        const response = await computeRoutes(body, { live: true, apiKey: config.transit.apiKey, fetchImpl: guardedFetch });
        if (!response.ok) throw providerFailure(response.error.category, 'transit');
        const route = selectSupportedRoute(response.data);
        let estimate;
        try { estimate = estimateDeparture(plan.result.targetArrivalDateTime, route.totalDurationSeconds); }
        catch { throw new ServiceError('INVALID_DURATION', 502, '이동시간으로 출발시각을 계산할 수 없어요.'); }
        return clean({
          ...plan.result, route, totalDurationSeconds: route.totalDurationSeconds,
          ...estimate, queriedAt: now().toISOString(),
          origin: { id: origin.id, name: origin.name, address: origin.address },
          destination: { id: destination.id, name: destination.name, address: destination.address },
        });
      });
    },
  };
}
