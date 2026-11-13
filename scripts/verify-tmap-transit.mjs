import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ENDPOINT, redact } from '../src/api/tmap-routes.mjs';
import { parseArgs, createCases, runVerification } from '../src/utils/verification.mjs';
import { reserveLiveAttempt } from '../src/utils/live-budget.mjs';
import { InputError } from '../src/utils/time.mjs';

const help = `Smart Departure — TMAP 대중교통 API 검증
기본은 오프라인 요청 확인입니다. --live를 명시해야 HTTP 요청을 수행합니다.

npm run verify:transit -- --scenario all
npm run verify:transit -- --live --scenario all
npm run verify:transit -- --live
npm run verify:transit -- --date YYYY-MM-DD --time 13:50
npm run verify:transit -- --search-dttm YYYYMMDDHHmm --count 1

기본 좌표는 공식 문서 Request Sample의 WGS84 좌표입니다.
좌표 변경: --start-x 경도 --start-y 위도 --end-x 경도 --end-y 위도
--scenario all: A 검색시각 생략, B 다음 평일 13:50, C 같은 날 13:40.
--date로 시나리오 날짜 변경. searchDttm은 한국시간의 운행 여부 조회 조건입니다.
도착시각 지정 기능 또는 실제 운행편 시간표로 해석하지 않습니다.
--dry-run은 기본 오프라인 동작과 같으며 --live와 함께 쓸 수 없습니다.

키: 프로젝트 .env 또는 환경변수 TMAP_APP_KEY. 키/응답 원본은 저장하지 않습니다.
누적 실제 요청 최대 3회: reports/tmap-live-budget.json, 자동 초기화/재시도 없음.
실패/무경로 발생 시 남은 시나리오를 중단합니다.
종료 코드: 0 경로 반환/오프라인, 1 오류, 2 키 없음, 3 경로 없음.`;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log(help); return; }
  const cases = createCases(options);
  if (Number(process.versions.node.split('.')[0]) < 22) console.error('Node.js 20은 지원 종료 상태입니다. 지원 중인 LTS를 사용하세요. 시스템 설정은 변경하지 않습니다.');
  const root = new URL('../', import.meta.url);
  // Offline mode never reads credentials.
  if (options.live && existsSync(new URL('.env', root))) process.loadEnvFile(fileURLToPath(new URL('.env', root)));
  const apiKey = options.live ? process.env.TMAP_APP_KEY : undefined;
  const result = await runVerification(cases, {
    live: options.live === true, apiKey,
    reserveAttempt: () => reserveLiveAttempt(fileURLToPath(new URL('reports/tmap-live-budget.json', root))),
  });
  console.log(JSON.stringify(redact({ endpoint: ENDPOINT, ...result }, apiKey), null, 2));
  if (result.error) {
    if (result.error.category === 'MISSING_KEY') console.error('TMAP_APP_KEY를 프로젝트 .env에 저장하세요. 실제 API는 미검증이며 요청하지 않았습니다.');
    process.exitCode = result.error.category === 'MISSING_KEY' ? 2 : result.error.category === 'NO_ROUTES' ? 3 : 1;
  }
}

main().catch(error => {
  console.error(error instanceof InputError ? error.message : '환경설정·로컬 호출 예산 기록 오류입니다. .env 형식과 reports 쓰기 권한을 확인하세요.');
  process.exitCode = 1;
});
