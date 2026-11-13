// All names, addresses, coordinates and routes below are independently invented.
// SYNTHETIC DATA ONLY. Never copied from a real TMAP response.
export const syntheticPois = {
  searchPoiInfo: { totalCount: '2', pois: { poi: [
    { id: 'synthetic-a', name: '합성 출발 장소', frontLon: '127.1', frontLat: '37.1', noorLon: '127.11', noorLat: '37.11', newAddressList: { newAddress: [{ fullAddressRoad: '합성시 시작로 1' }] }, lowerBizName: '합성 시설' },
    { id: 'synthetic-b', name: '합성 도착 장소', frontLon: '127.2', frontLat: '37.2', noorLon: '127.21', noorLat: '37.21', upperAddrName: '합성시', middleAddrName: '도착구', lowerAddrName: '도착동', firstNo: '2', secondNo: '0' },
  ] } },
};
export const syntheticRoutes = {
  metaData: { plan: { itineraries: [{
    totalTime: 727, totalWalkTime: 394, transferCount: 1,
    legs: [
      { mode: 'WALK', sectionTime: 75, start: { name: '합성 출발 장소' }, end: { name: '합성 A역' } },
      { mode: 'SUBWAY', sectionTime: 237, route: '합성 지하철', start: { name: '합성 A역' }, end: { name: '합성 B역' }, service: 1 },
      { mode: 'WALK', sectionTime: 91, start: { name: '합성 B역' }, end: { name: '합성 정류장 B' } },
      { mode: 'BUS', sectionTime: 96, route: '합성 버스', start: { name: '합성 정류장 B' }, end: { name: '합성 정류장 C' }, service: 1 },
      { mode: 'WALK', sectionTime: 228, start: { name: '합성 정류장 C' }, end: { name: '합성 도착 장소' } },
    ],
  }] } },
};
export const syntheticTripInput = { originText: '합성 출발 장소', destinationText: '합성 도착 장소', desiredArrivalDate: '2026-11-16', desiredArrivalTime: '14:00', bufferMinutes: 10 };
export const enabledTestEnv = {
  TMAP_APP_KEY: 'synthetic-transit-secret', TMAP_POI_APP_KEY: 'synthetic-poi-secret',
  ENABLE_LIVE_POI: 'true', ENABLE_LIVE_TRANSIT: 'true', STAGE3_POI_MAX_CALLS: '20', STAGE3_TRANSIT_MAX_CALLS: '20',
};
