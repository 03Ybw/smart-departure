import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createStage3Service } from './api/stage3-service.mjs';
import { ServiceError } from './api/service-error.mjs';
import { readJsonBody, checkApiOrigin } from './api/http-handlers.mjs';
import { stage3Config } from './utils/stage3-budget.mjs';

// Serve only explicit public assets and browser-safe modules.
// The repository root, API modules, .env and reports are never a static directory.
const assets = new Map([
  ['/', ['../public/index.html', 'text/html']],
  ['/index.html', ['../public/index.html', 'text/html']],
  ['/styles.css', ['../public/styles.css', 'text/css']],
  ['/app.mjs', ['../public/app.mjs', 'text/javascript']],
  ['/favicon.svg', ['../public/favicon.svg', 'image/svg+xml']],
  ['/src/app/arrival-plan.mjs', ['./app/arrival-plan.mjs', 'text/javascript']],
  ['/src/utils/time.mjs', ['./utils/time.mjs', 'text/javascript']],
  ['/src/app/place-selection.mjs', ['./app/place-selection.mjs', 'text/javascript']],
]);

export function createAppServer(options = {}) {
  const service = createStage3Service(options);
  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    const sendText = (status, message) => {
      response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(request.method === 'HEAD' ? undefined : message);
    };
    let url, pathname;
    try { url = new URL(request.url, 'http://localhost'); pathname = decodeURIComponent(url.pathname); }
    catch { sendText(400, '잘못된 요청 주소입니다.'); return; }
    if (pathname === '/api/places' || pathname === '/api/recommendation') {
      const controller = new AbortController();
      response.once('close', () => { if (!response.writableEnded) controller.abort(); });
      const sendJson = (status, data) => {
        if (response.destroyed) return;
        response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify(data));
      };
      try {
        checkApiOrigin(request);
        const method = pathname === '/api/places' ? 'GET' : 'POST';
        if (request.method !== method) { response.setHeader('Allow', method); throw new ServiceError('METHOD_NOT_ALLOWED', 405, '허용되지 않은 요청 방식이에요.'); }
        let result;
        if (pathname === '/api/places') {
          if (url.searchParams.getAll('q').length !== 1 || [...url.searchParams.keys()].some(key => key !== 'q')) throw new ServiceError('INVALID_QUERY', 400, '장소 검색어를 확인해 주세요.');
          result = await service.search(url.searchParams.get('q'), controller.signal);
        } else result = await service.recommend(await readJsonBody(request), controller.signal);
        sendJson(200, result);
      } catch (error) {
        const safe = error instanceof ServiceError ? error : new ServiceError('INTERNAL_ERROR', 500, '요청을 처리할 수 없어요.');
        sendJson(safe.status, { error: { code: safe.code, message: safe.message, ...(safe.fields ? { fields: safe.fields } : {}) } });
      }
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.setHeader('Allow', 'GET, HEAD');
      sendText(405, '허용되지 않은 요청 방식입니다.');
      return;
    }
    const asset = assets.get(pathname);
    if (!asset) { sendText(404, '요청한 페이지를 찾을 수 없습니다.'); return; }
    try {
      const content = await readFile(new URL(asset[0], import.meta.url));
      response.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8`, 'Content-Length': content.length });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch (error) {
      sendText(error.code === 'ENOENT' ? 404 : 500, '페이지를 불러올 수 없습니다.');
    }
  });
  server.once('close', () => service.dispose());
  return server;
}

export function startLocalServer(port = 3000) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT는 0~65535의 정수여야 합니다.');
  const envPath = new URL('../.env', import.meta.url);
  if (existsSync(envPath)) process.loadEnvFile(fileURLToPath(envPath));
  const server = createAppServer({ config: stage3Config(process.env) });
  server.once('error', error => {
    console.error(error.code === 'EADDRINUSE' ? '포트가 사용 중입니다. PORT를 변경해 다시 실행해 주세요.' : '로컬 서버를 시작할 수 없습니다.');
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`Smart Departure: http://127.0.0.1:${server.address().port}`);
    console.log('종료하려면 Ctrl+C를 누르세요. 실제 API는 명시적 활성화와 예산이 모두 있어야 호출됩니다.');
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const portText = process.env.PORT ?? '3000';
  if (!/^\d{1,5}$/.test(portText) || Number(portText) > 65535) {
    console.error('PORT는 0~65535의 정수여야 합니다.');
    process.exitCode = 1;
  } else startLocalServer(Number(portText));
}
