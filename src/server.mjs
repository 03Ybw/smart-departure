import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

// Serve only explicit public assets and two browser-safe modules.
// The repository root, API modules, .env and reports are never a static directory.
const assets = new Map([
  ['/', ['../public/index.html', 'text/html']],
  ['/index.html', ['../public/index.html', 'text/html']],
  ['/styles.css', ['../public/styles.css', 'text/css']],
  ['/app.mjs', ['../public/app.mjs', 'text/javascript']],
  ['/favicon.svg', ['../public/favicon.svg', 'image/svg+xml']],
  ['/src/app/arrival-plan.mjs', ['./app/arrival-plan.mjs', 'text/javascript']],
  ['/src/utils/time.mjs', ['./utils/time.mjs', 'text/javascript']],
]);

export function createAppServer() {
  return createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    const sendText = (status, message) => {
      response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(request.method === 'HEAD' ? undefined : message);
    };
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.setHeader('Allow', 'GET, HEAD');
      sendText(405, '허용되지 않은 요청 방식입니다.');
      return;
    }
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
    catch { sendText(400, '잘못된 요청 주소입니다.'); return; }
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
}

export function startLocalServer(port = 3000) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT는 0~65535의 정수여야 합니다.');
  const server = createAppServer();
  server.once('error', error => {
    console.error(error.code === 'EADDRINUSE' ? '포트가 사용 중입니다. PORT를 변경해 다시 실행해 주세요.' : '로컬 서버를 시작할 수 없습니다.');
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`Smart Departure: http://127.0.0.1:${server.address().port}`);
    console.log('종료하려면 Ctrl+C를 누르세요. 외부 API는 호출하지 않습니다.');
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
