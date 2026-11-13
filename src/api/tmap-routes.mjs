import { InputError, validateSearchDttm } from '../utils/time.mjs';

export const ENDPOINT = 'https://apis.openapi.sk.com/transit/routes';
// Official Request Sample, not coordinates inferred from a place name.
// https://transit.tmapmobility.com/docs/routes
export const OFFICIAL_EXAMPLE = Object.freeze({
  startX: '127.02479803562213', startY: '37.504585233865086',
  endX: '127.03747630119366', endY: '37.479103923078995',
});

function coordinate(value, limit) {
  if ((typeof value !== 'number' && typeof value !== 'string')
    || !/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(String(value).trim())
    || !Number.isFinite(Number(value)) || Math.abs(Number(value)) > limit) {
    throw new InputError('WGS84 좌표가 필요합니다. X는 경도(-180~180), Y는 위도(-90~90)입니다.');
  }
  return String(value).trim();
}

export function buildRequest(options) {
  for (const key of ['arrivalTime', 'departureTime', 'arrival', 'departure']) {
    if (Object.hasOwn(options, key)) throw new InputError('TMAP searchDttm은 arrivalTime/departureTime을 대신하지 않습니다.');
  }
  const count = options.count ?? 1;
  if (!/^(?:[1-9]|10)$/.test(String(count))) throw new InputError('count는 1~10의 정수여야 합니다.');
  const body = {
    startX: coordinate(options.startX, 180), startY: coordinate(options.startY, 90),
    endX: coordinate(options.endX, 180), endY: coordinate(options.endY, 90),
    count: Number(count), lang: 0, format: 'json',
  };
  if (options.searchDttm !== undefined) body.searchDttm = validateSearchDttm(options.searchDttm);
  return body;
}

export function redact(value, apiKey = '') {
  return JSON.parse(JSON.stringify(value, (key, item) => {
    if (/^(?:appkey|tmap_app_key|authorization)$/i.test(key)) return '[REDACTED]';
    return typeof item === 'string' && apiKey ? item.split(apiKey).join('[REDACTED]') : item;
  }));
}

export function apiError(body) {
  if (body?.error) return body.error;
  if (body?.result?.status !== undefined && Number(body.result.status) !== 0) return body.result;
  if (body?.metaData?.error) return body.metaData.error;
  if (body?.code !== undefined || body?.status !== undefined && !body.metaData) return body;
  return null;
}

export function classifyApiError(httpStatus, body) {
  const error = apiError(body) ?? {};
  const rawCode = error.status ?? error.code ?? error.id;
  const code = rawCode === undefined ? null : String(rawCode);
  const evidence = JSON.stringify(error);
  let category = 'API_ERROR';
  if (['11', '12', '13', '14'].includes(code)) category = 'NO_ROUTES';
  else if (httpStatus === 429 || /quota|rate.?limit|usage.?limit|한도|호출.*초과|사용량.*초과/i.test(evidence)) category = 'QUOTA';
  else if ([401, 403].includes(httpStatus) || /unauthor|forbidden|app.?key|인증|권한/i.test(evidence)) category = 'AUTH_PERMISSION';
  else if (code === '23') category = 'UNSUPPORTED_REGION';
  else if (code === '31' || httpStatus === 504) category = 'TIMEOUT';
  else if (['21', '22', '24'].includes(code) || httpStatus === 400) category = 'INVALID_REQUEST';
  // Do not echo provider error messages: they can contain credentials.
  return { category, httpStatus, code };
}

export async function computeRoutes(body, { live = false, apiKey, fetchImpl = globalThis.fetch, timeoutMs = 20_000 } = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    return { ok: false, error: { category: 'MISSING_KEY' } };
  }
  if (live !== true) return { ok: false, error: { category: 'LIVE_REQUIRED' } };
  try {
    const response = await fetchImpl(ENDPOINT, {
      method: 'POST', redirect: 'error',
      headers: { appKey: apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
    });
    let data;
    try { data = await response.json(); }
    catch (error) {
      if (error.name !== 'SyntaxError') throw error;
      return { ok: false, error: { category: response.ok ? 'INVALID_RESPONSE' : 'HTTP_ERROR', httpStatus: response.status } };
    }
    if (!response.ok || apiError(data)) return { ok: false, error: redact(classifyApiError(response.status, data), apiKey) };
    const itineraries = data?.metaData?.plan?.itineraries;
    if (!Array.isArray(itineraries)) return { ok: false, error: { category: 'INVALID_RESPONSE', httpStatus: response.status } };
    return { ok: true, httpStatus: response.status, data: redact(data, apiKey) };
  } catch (error) {
    return { ok: false, error: { category: ['TimeoutError', 'AbortError'].includes(error.name) ? 'TIMEOUT' : 'NETWORK' } };
  }
}
