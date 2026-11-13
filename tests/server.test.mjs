import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { createAppServer } from '../src/server.mjs';

async function withServer(callback) {
  const server = createAppServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  try { await callback(url); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test('로컬 서버에서 HTML, CSS, 브라우저 JS와 재사용 시간 모듈 정상 제공', () => withServer(async url => {
  for (const [path, type] of [['/', 'text/html'], ['/styles.css', 'text/css'], ['/app.mjs', 'text/javascript'], ['/src/app/arrival-plan.mjs', 'text/javascript'], ['/src/utils/time.mjs', 'text/javascript'], ['/favicon.svg', 'image/svg+xml']]) {
    const response = await fetch(url + path);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type').startsWith(type));
    assert.ok((await response.text()).length > 0);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(response.headers.get('content-security-policy'), /connect-src 'none'/);
  }
}));

test('존재하지 않는 파일 요청은 HTML로 대체하지 않고 404 처리', () => withServer(async url => {
  const response = await fetch(url + '/does-not-exist.js');
  assert.equal(response.status, 404);
  assert.match(response.headers.get('content-type'), /text\/plain/);
  assert.equal(await response.text(), '요청한 페이지를 찾을 수 없습니다.');
}));

test('비밀 파일·로컬 문서·API 모듈·경로 탐색 요청은 제공하지 않음', () => withServer(async url => {
  for (const path of ['/.env', '/.env.example', '/AGENTS.md', '/docs/api-verification.md', '/reports/tmap-live-budget.json', '/package.json', '/src/api/tmap-routes.mjs', '/src/server.mjs', '/../.env', '/%2e%2e/.env', '/src/app/%2e%2e/%2e%2e/.env', '/.git/config', '/src/app/arrival-plan.mjs/../../.env']) {
    assert.equal((await fetch(url + path)).status, 404, path);
  }
}));

test('HEAD, 허용되지 않는 메서드, 잘못된 URL 처리', () => withServer(async url => {
  const head = await fetch(url, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.ok(Number(head.headers.get('content-length')) > 0);
  const post = await fetch(url, { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
  const status = await new Promise((resolve, reject) => {
    const req = request(url + '/%E0%A4%A', response => { response.resume(); resolve(response.statusCode); });
    req.on('error', reject);
    req.end();
  });
  assert.equal(status, 400);
}));

test('dev 명령의 서버 진입점은 API 키 없이 실제 프로세스로 실행 가능', async () => {
  const env = { ...process.env, PORT: '0' };
  delete env.TMAP_APP_KEY;
  const child = spawn(process.execPath, ['src/server.mjs'], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = '';
  let errorOutput = '';
  child.stderr.on('data', data => { errorOutput += data; });
  try {
    const address = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('로컬 서버 시작 시간 초과')), 5000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`서버 조기 종료 ${code}: ${errorOutput}`)); });
      child.stdout.on('data', data => {
        output += data;
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) { clearTimeout(timer); resolve(match[0]); }
      });
    });
    const response = await fetch(address);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Smart Departure/);
    assert.equal(errorOutput, '');
  } finally {
    if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
  }
});
