// SYNTHETIC ONLY: invented schema fixture, not copied from a live response.
export const syntheticTransitResponse = {
  metaData: {
    requestParameters: { reqDttm: '20261113100000' },
    plan: { itineraries: [{
      totalTime: 2400, transferCount: 1, totalWalkTime: 600,
      legs: [
        { mode: 'WALK', sectionTime: 300, start: { name: '합성 출발지' }, end: { name: '합성 A역' } },
        { mode: 'SUBWAY', sectionTime: 1000, route: '합성 지하철', service: 1, start: { name: '합성 A역' }, end: { name: '합성 B역' } },
        { mode: 'WALK', sectionTime: 100, start: { name: '합성 B역' }, end: { name: '합성 B정류장' } },
        { mode: 'BUS', sectionTime: 800, route: '합성 버스', service: 0, Lane: [{ route: '합성 대안 버스', service: 1 }], start: { name: '합성 B정류장' }, end: { name: '합성 C정류장' } },
        { mode: 'WALK', sectionTime: 200, start: { name: '합성 C정류장' }, end: { name: '합성 목적지' } },
      ],
    }] },
  },
};
