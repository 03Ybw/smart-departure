# Smart Departure

희망 도착 날짜·시각과 여유시간을 고려하여 버스·지하철·도보 경로의 출발시각을 찾는 대학 프로젝트입니다. 현재는 **2단계 웹 앱 기본 화면**을 구현했습니다. 사용자가 입력한 일정에서 목표 도착시각을 계산하며, 실제 경로 조회·이동시간·추천 출발시각은 아직 연결하지 않았습니다.

## 2단계 웹 앱 실행

지원 중인 **Node.js LTS 22 이상**을 권장합니다. 외부 패키지가 없어 `npm install` 없이 프로젝트 폴더에서 실행할 수 있습니다.

```powershell
npm run dev
```

브라우저에서 **http://127.0.0.1:3000**에 접속합니다. 서버는 이 컴퓨터의 루프백 주소에서만 실행되며 Ctrl+C로 종료합니다. 포트가 이미 사용 중이면 PowerShell에서 `$env:PORT = '3001'`을 설정한 뒤 다시 실행하세요. 별도 빌드 단계는 없으며 파일 수정 후 브라우저를 새로고침합니다.

**API 키와 `.env` 없이 실행 가능합니다.** 웹 서버와 화면은 `.env`를 읽지 않으며 실제 TMAP·장소 검색·기타 외부 API를 호출하지 않습니다. 폰트와 화면 자산도 외부에서 다운로드하지 않습니다.

### 구현된 기능

- 한국어 모바일 우선 화면과 PC의 입력·결과 2열 배치.
- 자유 입력 출발지·목적지, 희망 도착 날짜·시각, 여유시간 0/5/10/15/20/30분(기본 10분).
- `목표 도착시각 = 희망 도착시각 - 여유시간` 계산. 여유시간 변경 후 원래 희망 도착시각으로 다시 계산합니다.
- 한국시간 Asia/Seoul 고정 계산과 날짜·월말·연말·윤년 경계 처리. 결과 데이터의 `targetArrivalDateTime`은 `2026-11-16T13:50:00+09:00` 형식입니다.
- 누락 입력, 실제 존재하지 않는 날짜, 잘못된 시각, 동일 출발지·목적지, 허용되지 않은 여유시간의 필드별 오류 표시와 첫 오류 포커스.
- 입력 변경 시 이전 계산 결과를 즉시 제거하고 재계산 안내. alert 창과 입력 데이터 저장은 사용하지 않습니다.

실제 장소 존재 여부·좌표 확인, 장소 검색, TMAP 경로 연동, 이동시간, 추천 출발시각, 시간표 기반 역산은 **미구현**입니다. 결과의 route/totalDurationSeconds/estimatedDepartureDateTime/estimateBasis는 null이며 임의 경로나 운행편을 만들지 않습니다. 입력·검증·계산과 화면 표시를 분리하여 3단계에 연결할 수 있도록 했습니다.

### 구조와 테스트

| 파일 | 역할 |
| --- | --- |
| `public/index.html`, `public/styles.css`, `public/favicon.svg` | 접근 가능한 입력·결과 화면, 반응형 스타일과 로컬 아이콘 |
| `public/app.mjs` | 폼 이벤트·필드 오류·결과 표시·결과 무효화 |
| `src/app/arrival-plan.mjs` | 순수 입력 검증·한국시간 계산·최소 상태 처리. 기존 time.mjs를 재사용 |
| `src/server.mjs` | 내장 Node HTTP 로컬 서버. 공개 자산과 브라우저용 시간 모듈만 명시적으로 제공 |
| `tests/arrival-plan.test.mjs` | 계산·날짜 경계·검증·무효화·시간대 독립성 테스트 |
| `tests/server.test.mjs` | 서버 실행·공개 자산·404·메서드·비공개 파일 접근 차단 테스트 |

```powershell
npm test
```

2단계 완료 확인: **기존 23개 + 신규 22개 = 45개 모두 통과**. 기존 API 코드·시간 유틸·API 테스트·합성 fixture는 변경하지 않았습니다. Node v20.19.5에서 실행을 확인했으며, 지원 중인 LTS에서도 재확인이 필요합니다.

실제 Chrome 헤드리스 브라우저로 1360/768/390/320px 배치, 계산·재계산·오류 포커스·자정/연말 경계·입력 무효화·텍스트 안전 표시를 확인했습니다. 브라우저 시간대를 LA로 바꿔도 한국시간 결과가 일치했고 화면 JavaScript 오류와 외부 HTTP 요청은 없었습니다. 실제 모바일 기기나 다른 브라우저의 별도 검증은 하지 않았습니다.

서버는 저장소 루트 전체를 공개하지 않습니다. `.env`, AGENTS, 검증 문서, reports, API 모듈과 서버 소스는 HTTP로 제공하지 않으며, 브라우저의 외부 연결은 CSP로 차단합니다. 기존 API 실호출 예산 파일과 키는 변경하지 않았습니다.

## 1단계 TMAP API 검증 기록

**1단계 결과: 기본 조회와 미래 2026-11-16 13:40·13:50 검색 모두 HTTP 200 및 실제 경로 1개 반환을 확인했습니다. 최종 기술 판단은 B입니다. 미래 조건 경로·운행 정보는 반환되지만 실제 운행편 절대 출발·도착시각이 없어 정확한 도착 기준 역산은 미검증입니다. 1단계 단위 테스트 23개도 모두 통과했습니다.** 상세 검증 보고서 `docs/api-verification.md`는 로컬 전용으로 유지하며 GitHub에는 포함하지 않습니다.

## 환경과 테스트

JavaScript ES Module, Node 내장 fetch·node:test를 사용합니다. 외부 의존성이 없어 `npm install` 없이 실행할 수 있습니다. 지원 중인 Node.js LTS 22 이상을 권장합니다. 현재 설치된 Node v20.19.5 / npm 10.8.2에서 테스트를 실행했으며 시스템 설정은 변경하지 않았습니다. Node 20은 지원 종료 상태이므로 [공식 다운로드](https://nodejs.org/en/download)의 지원 중인 LTS를 설치한 뒤 VS Code 터미널을 다시 여세요. [지원 현황](https://nodejs.org/en/about/previous-releases).

```powershell
npm test
npm run verify:transit -- --help
npm run verify:transit -- --scenario all
npm run verify:transit -- --scenario all --dry-run
```

기본 CLI 실행은 오프라인이며 `.env`도 읽지 않습니다. `npm test`는 별도로 만든 합성 데이터와 가짜 fetch만 사용합니다. 실제 응답을 fixture로 복사하지 않습니다.

## 키 설정

프로젝트 루트 `.env`에 `TMAP_APP_KEY=발급받은키`를 설정합니다. **이미 있는 `.env`는 덮어쓰지 마세요.** 처음 설정할 때만 `.env.example`을 복사한 뒤 로컬 편집기에서 값을 입력하세요. 예제에는 실제 키가 없습니다.

`--live` 실행에서만 Node의 내장 `process.loadEnvFile`로 `.env`를 읽습니다. 기존 프로세스의 `TMAP_APP_KEY` 환경변수가 있으면 그 값이 우선합니다. 키가 없으면 요청하지 않습니다. 키를 채팅·실행 인자·소스·문서에 적지 마세요.

키 설정과 상품 신청 절차는 [SK OPEN API 이용절차](https://transit.tmapmobility.com/guide)와 [TMAP 이용절차](https://transit.tmapmobility.com/guide/procedure)를 참고하세요. 과거 3회는 `INVALID_API_KEY`였으나 2026-11-13 15:31 KST 재검증에서는 인증과 기본 경로 조회가 성공했습니다. 이전 오류의 정확한 원인이나 해소 원인은 확정하지 않았습니다.

## 실제 검증 실행

**`--live`를 명시한 경우에만 네트워크 요청을 수행합니다.** 자동 재시도는 없으며 API 오류·네트워크 오류·무경로가 발생하면 후속 시나리오를 중단합니다.

```powershell
# 전체 시나리오: A 현재 기준, B 다음 평일 13:50, C 같은 날 13:40
npm run verify:transit -- --live --scenario all

# A만 실행: searchDttm 생략
npm run verify:transit -- --live

# 검색 기준시각 지정: 예시 날짜는 실행일에 맞게 바꾸세요.
npm run verify:transit -- --live --date 2026-11-16 --time 13:50
npm run verify:transit -- --live --search-dttm 202611161340 --count 1
```

최초 검증은 **최대 3회**로 제한했고, 후속 재검증 1회에 이어 사용자가 지정한 미래 조회 2회만 추가 허용해 누적 6회가 되었습니다. 기존 `reports/tmap-live-budget.json`의 attempts 목록에 계속 기록하며, 이번 2회의 한시적 승인 범위(누적 4→6회)는 같은 파일의 authorizations에 기록했습니다. 초기화나 자동 재시도는 없습니다. 이번 추가 예산은 모두 소진했고 기본 CLI의 3회 제한은 유지되어 위 실제 실행 명령은 현재 차단됩니다.

호출 전에 [공식 무료체험 하루 10건 한도](https://transit.tmapmobility.com/terms)와 로컬 기록 4회를 확인했고 이번 2회까지 기록상 6회입니다. 계정 대시보드의 다른 도구 사용량과 전체 잔여량은 확인하지 못했습니다. 추가 실행은 새 요청 범위·한도 확인 후 진행해야 합니다.

세 번째 전송 추적에서는 키 전달이 정상임에도 HTTP 403 / INVALID_API_KEY, Forbidden을 받았으나, 2026-11-13 15:31:51 KST의 기본 조회는 성공했습니다. 15:44:56·15:44:57 KST에는 같은 공식 예시 좌표로 searchDttm=202611161340 및 202611161350을 각각 1회 요청했습니다. 모두 HTTP 200, 비어 있지 않은 itineraries 배열과 경로 1개를 확인했습니다. 이전 인증 오류가 해소된 세부 원인은 미확정입니다.

| 비교 항목 | 미래 13:40 | 미래 13:50 |
| --- | --- | --- |
| 경로 개수 | 1 | 1 |
| totalTime | 727초(12분 7초) | 727초(12분 7초) |
| totalWalkTime / 환승 횟수 | 394초 / 1회 | 394초 / 1회 |
| 구간 | 도보→지하철→도보→버스→도보 | 동일 |
| 지하철·버스 service | 모두 1 | 모두 1 |
| 노선·승하차 지점·수단 기준 경로 차이 | 두 응답에서 차이 없음 | 동일 |
| 실제 운행편 절대 출발·도착시각 | 확인되지 않음 | 확인되지 않음 |

시간 차이는 0초이며 구간별 소요시간도 같았습니다. 두 시각의 동일 결과만으로 모든 미래 조건의 특성이나 배차 반영 여부를 일반화하지 않습니다. searchDttm은 희망 도착시각이 아니라 지정 시각의 운행 여부를 확인하는 검색 조건입니다. 2단계에서는 경로·운행 정보 표시와 명시적인 소요시간 기반 추정 범위를 검토할 수 있지만, 실제 시간표 기반 정확한 출발시각 역산은 추가 데이터가 필요합니다.

## 좌표와 시간

기본 좌표는 [공식 API 문서](https://transit.tmapmobility.com/docs/routes)의 **Request Sample**에서 가져왔습니다.

| 필드 | 값 | 의미 |
| --- | --- | --- |
| startX | 127.02479803562213 | 출발 경도 |
| startY | 37.504585233865086 | 출발 위도 |
| endX | 127.03747630119366 | 도착 경도 |
| endY | 37.479103923078995 | 도착 위도 |

WGS84 X=경도(-180~180), Y=위도(-90~90)를 검증합니다. 국내 좌표를 뒤집어 Y에 127 등을 넣으면 거부합니다. 범위만으로 모든 장소의 위치 정확성이나 모든 뒤바뀐 좌표를 검증할 수는 없습니다. 부평역→인하대학교 정문 좌표는 아직 검증하지 않았으므로 임의로 사용하지 않습니다.

검증한 좌표를 사용할 때는 아래 네 인자를 모두 지정하세요.

```powershell
npm run verify:transit -- --start-x 127.02479803562213 --start-y 37.504585233865086 --end-x 127.03747630119366 --end-y 37.479103923078995 --count 1
```

`count`는 1~10 정수(기본 1), `lang=0`, `format=json`입니다. `searchDttm`은 **한국시간 Asia/Seoul의 YYYYMMDDHHmm**이며 UTC로 바꾸어 보내지 않습니다. `--date YYYY-MM-DD --time HH:mm`으로도 생성할 수 있습니다. 전체 시나리오는 실행일 이후 다음 월~금 날짜를 고르며 `--date`로 변경할 수 있습니다. 공휴일은 판정하지 않습니다. Google의 과거 7일/미래 100일 제한은 TMAP에 적용하지 않습니다.

## 결과 해석과 데이터 관리

`searchDttm`은 지정 시각의 **운행 여부**를 `service`로 확인하기 위한 조건입니다. `arrivalTime`이나 실제 운행편의 출발시각 지정 기능으로 취급하지 않습니다. [공식 API 문서](https://transit.tmapmobility.com/docs/routes).

다음 세 항목을 분리하여 평가합니다.

1. 지정 시각에 운행 여부를 확인할 수 있는지.
2. 기준시각 변경 후 경로·전체/구간 소요시간·운행 여부가 달라지는지.
3. 실제 운행편의 출발·도착시각이 있어 희망 도착시간 기준 역산이 가능한지.

현재 공식 응답 스키마에는 실제 운행편 출발·도착 절대시각이 없습니다. 응답에서 시간 관련 필드 이름을 점검하되, 미문서화 필드가 나타나도 의미를 확인하기 전 시간표로 사용하지 않습니다. API를 요청한 `requestedAt`, API의 요청시각 `reqDttm`, 검색 조건 `searchDttm`을 운행편 시각으로 대입하지 않습니다.

분석은 `metaData.plan.itineraries`의 경로 수, `totalTime`, `transferCount`, `totalWalkTime`, 구간별 `mode`, `sectionTime`, `start/end`, `route`, `service`를 다룹니다. `lane` 및 공식 예시의 `Lane` 표기도 처리합니다. WALK/BUS/SUBWAY 밖의 수단은 `otherModes`로 구분하며 누락 값은 `null`과 `missing` 목록에 남깁니다.

콘솔에는 검증 요약과 비교 결과만 출력합니다. 원본 응답, 상세 경로·노선·지점·도형은 파일로 저장하지 않고 메모리에서만 분석합니다. B/C의 경로 구조와 시간·운행 여부는 각각 비교하며, 반환 순서 변경도 차이로 표시될 수 있습니다. 동일 결과가 나와도 정상 기록합니다.

[이용약관](https://transit.tmapmobility.com/terms)은 서비스로 얻은 데이터를 저장 후 24시간 이상 사용할 수 없도록 제한합니다. 실제 응답을 GitHub나 테스트에 넣지 않고, 검증 문서에는 필요한 관찰·결론만 남깁니다. 콘솔을 별도 파일로 리디렉션하여 서비스 데이터를 저장한다면 24시간 이상 재사용하지 말고 삭제하세요. `reports/`에는 횟수·예약시각만 저장하며 경로 데이터나 키를 넣지 않습니다.

오류는 키 누락, 인증/권한, 할당량, 잘못된 입력, 무경로(HTTP 200 오류 포함), 명시적 지역 미지원, 네트워크, 시간초과, 잘못된 응답으로 구분합니다. 무경로와 인증 실패는 지역 미지원의 증거가 아닙니다. 종료 코드는 0(오프라인/경로 반환), 1(오류), 2(키 없음), 3(무경로)입니다.

## 코드 구성과 전환 이유

| 파일 | 역할 |
| --- | --- |
| `src/api/tmap-routes.mjs` | 좌표·요청 생성, 안전한 fetch, 오류 분류 |
| `src/api/analyze-response.mjs` | TMAP 응답·누락·핵심 외 수단·시간 필드 분석 및 비교 |
| `src/utils/time.mjs` | 기존 한국시간·날짜 검증 재사용, searchDttm 생성 |
| `src/utils/verification.mjs` | 기존 인자/시나리오 구조 재사용, A/B/C 실행·요약 |
| `src/utils/live-budget.mjs` | 동시 실행 잠금과 영구 누적 3회 제한 |
| `scripts/verify-tmap-transit.mjs` | 기본 오프라인/명시적 --live CLI |
| `tests/verification.test.mjs`, `tests/fixtures/transit.mjs` | 기존 검증 영역을 TMAP용으로 전환·확장한 합성 테스트 |
| `.env.example`, `.gitignore`, `AGENTS.md`, `package.json` | 키 예제, 비밀 제외, 작업 규칙, 실행 명령 |

Google 전용 모듈과 CLI는 요청·응답 계약이 다르고 이전 CLI가 `--live` 없이 호출할 수 있어 제거했습니다. 날짜·시간 유틸과 테스트 기반, HTTP 처리 구조는 재사용했습니다. 기존 테스트 19개 통과를 먼저 확인한 뒤 Google 전용 검증을 TMAP 계약에 맞게 변경하고 호출 안전장치 테스트를 추가했습니다.

Git은 `main`, 원격은 `https://github.com/03Ybw/smart-departure.git`입니다. commit/push는 수행하지 않았습니다.

## GitHub 파일 관리

Git에는 실제 개발·실행에 필요한 README.md, .gitignore, .env.example, package.json 및 필요한 의존성 파일, src/, scripts/, tests/와 기타 앱 실행 파일을 포함합니다. 의존성을 추가할 때 필요한 잠금 파일도 함께 관리합니다.

`AGENTS.md`, `docs/api-verification.md`, `.env`, 비밀 환경 파일, 로그·비공개 응답·reports/·tmp/는 로컬에 보존하고 Git에서 제외합니다. `.env.example`은 실제 키 없이 포함합니다. docs/ 전체를 제외하는 규칙은 추가하지 않았으므로 다른 정상 문서는 계속 관리할 수 있습니다.

Commit 전에는 `git status`, `git ls-files`, `git check-ignore`로 포함·제외 상태를 확인합니다. 제외 대상이 이미 추적 중이면 로컬 파일을 유지하는 `git rm --cached -- 파일경로`로 추적만 해제합니다. 로컬 전용 파일을 강제로 추가하지 않으며, Commit·Push는 사용자 승인 후 수행합니다.
