export class ServiceError extends Error {
  constructor(code, status, message, fields) {
    super(message); this.code = code; this.status = status; this.fields = fields;
  }
}

export function providerFailure(category, service) {
  const label = service === 'poi' ? '장소 검색' : '경로 조회';
  const errors = {
    AUTH_PERMISSION: new ServiceError(service === 'poi' ? 'POI_AUTH_PERMISSION' : 'TRANSIT_AUTH_PERMISSION', 403, `${label} 인증 또는 상품 권한을 확인해 주세요.`),
    QUOTA: new ServiceError('PROVIDER_QUOTA', 429, `${label} API 사용 한도를 초과했어요.`),
    TIMEOUT: new ServiceError('TIMEOUT', 504, `${label} 응답이 늦어지고 있어요. 잠시 후 다시 시도해 주세요.`),
    NETWORK: new ServiceError('NETWORK', 502, `${label} 서버에 연결할 수 없어요.`),
    NO_ROUTES: new ServiceError('NO_ROUTES', 404, '선택한 장소 사이의 대중교통 경로가 없어요.'),
    UNSUPPORTED_REGION: new ServiceError('UNSUPPORTED_REGION', 422, '경로를 제공하지 않는 지역이에요.'),
    INVALID_REQUEST: new ServiceError('PROVIDER_REQUEST', 502, `${label} 요청 조건을 처리하지 못했어요.`),
  };
  return errors[category] ?? new ServiceError('INVALID_RESPONSE', 502, `${label} 응답을 확인할 수 없어요.`);
}
