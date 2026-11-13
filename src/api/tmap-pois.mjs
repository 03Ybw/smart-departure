import { validSearchQuery, coordinatePair } from '../app/place-selection.mjs';
import { ServiceError, providerFailure } from './service-error.mjs';
import { classifyApiError, apiError, redact } from './tmap-routes.mjs';

export const POI_ENDPOINT = 'https://apis.openapi.sk.com/tmap/pois';
const text = value => typeof value === 'string' && value.trim() ? value.trim().slice(0, 500) : null;

export function buildPoiUrl(query) {
  if (!validSearchQuery(query)) throw new ServiceError('INVALID_QUERY', 400, '장소명은 공백 없이 1~80자로 입력해 주세요.');
  const url = new URL(POI_ENDPOINT);
  for (const [name, value] of Object.entries({ version: '1', searchKeyword: query.trim(), searchType: 'all', page: '1', count: '5', reqCoordType: 'WGS84GEO', resCoordType: 'WGS84GEO', searchtypCd: 'A' })) url.searchParams.set(name, value);
  return url;
}

export function parsePoiResponse(data) {
  const info = data?.searchPoiInfo;
  if (!info || typeof info !== 'object' || !/^\d+$/.test(String(info.totalCount))) throw new ServiceError('INVALID_RESPONSE', 502, '장소 검색 응답을 확인할 수 없어요.');
  if (Number(info.totalCount) === 0) return { places: [], discardedCount: 0 };
  const entries = info.pois?.poi;
  if (!Array.isArray(entries) || entries.length === 0) throw new ServiceError('INVALID_RESPONSE', 502, '장소 검색 응답을 확인할 수 없어요.');
  let discardedCount = 0;
  const places = [];
  for (const poi of entries.slice(0, 5)) {
    const entrance = coordinatePair(poi?.frontLon, poi?.frontLat);
    const center = coordinatePair(poi?.noorLon, poi?.noorLat);
    const point = entrance ?? center;
    const id = typeof poi?.id === 'number' ? String(poi.id) : text(poi?.id);
    const name = text(poi?.name);
    if (!id || !name || !point) { discardedCount++; continue; }
    const addresses = Array.isArray(poi.newAddressList?.newAddress) ? poi.newAddressList.newAddress : [];
    const roadAddress = addresses.map(address => text(address?.fullAddressRoad)).find(Boolean);
    const oldAddress = [poi.upperAddrName, poi.middleAddrName, poi.lowerAddrName, poi.detailAddrName,
      [text(poi.firstNo), text(poi.secondNo) && poi.secondNo !== '0' ? text(poi.secondNo) : null].filter(Boolean).join('-')].map(text).filter(Boolean).join(' ');
    places.push({ id, name, address: roadAddress ?? (oldAddress || null), category: text(poi.lowerBizName) ?? text(poi.middleBizName), ...point, coordinateSource: entrance ? 'ENTRANCE' : 'CENTER' });
  }
  if (!places.length && discardedCount) throw new ServiceError('INVALID_COORDINATES', 422, '검색 결과의 좌표가 유효하지 않아요. 다른 장소명으로 검색해 주세요.');
  return { places, discardedCount };
}

export async function searchPois(query, { live = false, apiKey, fetchImpl = globalThis.fetch, signal, timeoutMs = 15_000 }) {
  const url = buildPoiUrl(query);
  if (live !== true) throw new ServiceError('LIVE_DISABLED', 503, '장소 검색이 아직 활성화되지 않았어요.');
  if (typeof apiKey !== 'string' || !apiKey.trim() || /\s/.test(apiKey) || apiKey === 'undefined') throw new ServiceError('MISSING_KEY', 503, '장소 검색 키 설정을 확인해 주세요.');
  try {
    const timeout = AbortSignal.timeout(timeoutMs);
    const response = await fetchImpl(url.href, {
      method: 'GET', redirect: 'error', headers: { appKey: apiKey, Accept: 'application/json' },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    let data;
    try { data = await response.json(); }
    catch (error) { if (error.name !== 'SyntaxError') throw error; throw new ServiceError('INVALID_RESPONSE', 502, '장소 검색 응답을 확인할 수 없어요.'); }
    if (!response.ok || apiError(data)) throw providerFailure(classifyApiError(response.status, data).category, 'poi');
    return parsePoiResponse(redact(data, apiKey));
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw providerFailure(['TimeoutError', 'AbortError'].includes(error.name) ? 'TIMEOUT' : 'NETWORK', 'poi');
  }
}
