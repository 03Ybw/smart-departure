import { mkdir, open, readFile, writeFile, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

// Only attempt metadata is stored. No API response, key or route data.
export async function reserveLiveAttempt(path) {
  await mkdir(dirname(path), { recursive: true });
  const lockPath = `${path}.lock`;
  const lock = await open(lockPath, 'wx');
  try {
    let ledger = { attempts: [] };
    try { ledger = JSON.parse(await readFile(path, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!Array.isArray(ledger.attempts) || ledger.attempts.length >= 3) throw new Error('Live call budget exhausted or malformed.');
    const attempt = ledger.attempts.length + 1;
    ledger.attempts.push({ attempt, reservedAt: new Date().toISOString() });
    await writeFile(path, JSON.stringify(ledger, null, 2) + '\n');
    return attempt;
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}
