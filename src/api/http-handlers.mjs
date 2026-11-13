import { ServiceError } from './service-error.mjs';

export async function readJsonBody(request, maxBytes = 8192) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) throw new ServiceError('CONTENT_TYPE', 415, 'JSON 형식으로 요청해 주세요.');
  if (Number(request.headers['content-length']) > maxBytes) { request.resume(); throw new ServiceError('BODY_TOO_LARGE', 413, '요청 본문이 너무 커요.'); }
  return new Promise((resolve, reject) => {
    const chunks = []; let length = 0, finished = false;
    const cleanup = () => { request.off('data', onData); request.off('end', onEnd); request.off('error', onError); request.off('aborted', onAbort); };
    const fail = error => {
      if (finished) return;
      finished = true; cleanup();
      // Draining an oversized or aborted body can still emit a stream error.
      request.once('error', () => {});
      request.resume(); reject(error);
    };
    const onData = chunk => {
      length += chunk.length;
      if (length > maxBytes) { fail(new ServiceError('BODY_TOO_LARGE', 413, '요청 본문이 너무 커요.')); return; }
      chunks.push(chunk);
    };
    const onError = () => fail(new ServiceError('REQUEST_ERROR', 400, '요청을 읽을 수 없어요.'));
    const onAbort = () => fail(new ServiceError('REQUEST_ABORTED', 400, '요청이 취소되었어요.'));
    const onEnd = () => {
      if (finished) return;
      finished = true; cleanup();
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new ServiceError('INVALID_JSON', 400, '요청 형식을 확인해 주세요.')); }
    };
    request.on('data', onData); request.once('end', onEnd); request.once('error', onError); request.once('aborted', onAbort);
  });
}

export function checkApiOrigin(request) {
  const host = request.headers.host ?? '';
  if (!/^(?:127\.0\.0\.1|localhost)(?::\d{1,5})?$/.test(host)) throw new ServiceError('FORBIDDEN_ORIGIN', 403, '허용되지 않은 요청 출처예요.');
  if (request.headers.origin && request.headers.origin !== `http://${host}`) throw new ServiceError('FORBIDDEN_ORIGIN', 403, '허용되지 않은 요청 출처예요.');
  if (request.headers['sec-fetch-site'] === 'cross-site') throw new ServiceError('FORBIDDEN_ORIGIN', 403, '허용되지 않은 요청 출처예요.');
}
