import { mkdir, open, readFile, writeFile, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ServiceError } from '../api/service-error.mjs';

export function stage3Config(env = {}) {
  const maximum = value => typeof value === 'string' && /^\d{1,6}$/.test(value) ? Number(value) : 0;
  return {
    poi: { enabled: env.ENABLE_LIVE_POI === 'true', maxCalls: maximum(env.STAGE3_POI_MAX_CALLS), apiKey: env.TMAP_POI_APP_KEY || env.TMAP_APP_KEY },
    transit: { enabled: env.ENABLE_LIVE_TRANSIT === 'true', maxCalls: maximum(env.STAGE3_TRANSIT_MAX_CALLS), apiKey: env.TMAP_APP_KEY },
  };
}

export function assertLiveAllowed(config, service) {
  if (!config.enabled) throw new ServiceError('LIVE_DISABLED', 503, `${service === 'poi' ? '장소' : '경로'} 조회가 아직 활성화되지 않았어요. 서버 설정을 확인해 주세요.`);
  if (!Number.isSafeInteger(config.maxCalls) || config.maxCalls <= 0) throw new ServiceError('BUDGET_EXHAUSTED', 429, '허용된 실제 API 호출 예산이 없어요.');
  if (typeof config.apiKey !== 'string' || !config.apiKey.trim() || /\s/.test(config.apiKey) || config.apiKey.toLowerCase() === 'undefined') throw new ServiceError('MISSING_KEY', 503, `${service === 'poi' ? '장소 검색' : '경로 조회'} 키 설정을 확인해 주세요.`);
}

export async function reserveStage3Attempt(path, maxCalls, now = new Date()) {
  if (!Number.isSafeInteger(maxCalls) || maxCalls <= 0) throw new ServiceError('BUDGET_EXHAUSTED', 429, '허용된 실제 API 호출 예산이 없어요.');
  await mkdir(dirname(path), { recursive: true });
  let lock;
  try { lock = await open(`${path}.lock`, 'wx'); }
  catch { throw new ServiceError('BUDGET_UNAVAILABLE', 503, '호출 기록이 사용 중이거나 기록할 수 없어요.'); }
  try {
    let ledger = { attempts: [] };
    try { ledger = JSON.parse(await readFile(path, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!Array.isArray(ledger.attempts) || ledger.attempts.some((attempt, index) => attempt.attempt !== index + 1 || !Number.isFinite(Date.parse(attempt.reservedAt)))) throw new Error('Invalid ledger.');
    if (ledger.attempts.length >= maxCalls) throw new ServiceError('BUDGET_EXHAUSTED', 429, '허용된 실제 API 호출 예산을 모두 사용했어요.');
    const attempt = ledger.attempts.length + 1;
    ledger.attempts.push({ attempt, reservedAt: now.toISOString() });
    await writeFile(path, JSON.stringify(ledger, null, 2) + '\n');
    return attempt;
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError('BUDGET_UNAVAILABLE', 503, 'API 호출 기록을 확인하거나 저장할 수 없어요.');
  } finally { await lock.close(); await unlink(`${path}.lock`); }
}
