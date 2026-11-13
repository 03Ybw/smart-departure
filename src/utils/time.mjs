const DAY = 86_400_000;
export class InputError extends Error {}

export function seoulDate(now = new Date()) {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

export function toTimestamp(date, time) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new InputError('날짜는 YYYY-MM-DD 형식이어야 합니다.');
  }
  if (typeof time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new InputError('시각은 24시간제 HH:mm 형식이어야 합니다.');
  }
  const timestamp = new Date(`${date}T${time}:00+09:00`);
  if (!Number.isFinite(timestamp.getTime()) || seoulDate(timestamp) !== date) {
    throw new InputError('실제로 존재하는 날짜를 입력하세요.');
  }
  return timestamp.toISOString();
}

export function nextWeekday(now = new Date()) {
  let day = new Date(`${seoulDate(now)}T12:00:00+09:00`);
  do { day = new Date(day.getTime() + DAY); }
  while ([0, 6].includes(new Date(day.getTime() + 9 * 3_600_000).getUTCDay()));
  return seoulDate(day);
}

export function toSearchDttm(date, time) {
  toTimestamp(date, time);
  if (Number(date.slice(0, 4)) < 1900) throw new InputError('searchDttm의 연도는 1900~9999여야 합니다.');
  return date.replaceAll('-', '') + time.replace(':', '');
}

export function validateSearchDttm(value) {
  if (typeof value !== 'string' || !/^\d{12}$/.test(value)) {
    throw new InputError('searchDttm은 한국시간 YYYYMMDDHHmm 형식이어야 합니다.');
  }
  const date = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  toSearchDttm(date, `${value.slice(8, 10)}:${value.slice(10, 12)}`);
  return value;
}

export function timestampInfo(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)
    || !Number.isFinite(Date.parse(value))) return null;
  // Date.parse normalizes some impossible calendar dates; reject those too.
  try { toTimestamp(value.slice(0, 10), value.slice(11, 16)); }
  catch { return null; }
  return {
    rfc3339: value,
    seoul: new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'medium', hourCycle: 'h23',
    }).format(new Date(value)) + ' Asia/Seoul',
  };
}
