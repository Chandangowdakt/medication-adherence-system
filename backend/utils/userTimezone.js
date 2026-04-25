import { startOfDay, addDays } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { startOfUtcDay } from '../models/MedicationLog.js';

/**
 * IANA time zone (e.g. "America/New_York"). Default UTC for existing users / invalid values.
 */
export function normalizeIanaTimeZone(tz) {
  const s = typeof tz === 'string' && tz.trim() ? tz.trim() : 'UTC';
  try {
    Intl.DateTimeFormat(undefined, { timeZone: s });
    return s;
  } catch {
    return 'UTC';
  }
}

/**
 * [start, end) UTC instants for the current calendar day in the given IANA time zone.
 */
export function getLocalDayBoundsUtc(timeZone, ref = new Date()) {
  const z = normalizeIanaTimeZone(timeZone);
  const zoned = toZonedTime(ref, z);
  const startLocal = startOfDay(zoned);
  const startUtc = fromZonedTime(startLocal, z);
  const endLocal = addDays(startLocal, 1);
  const endUtc = fromZonedTime(endLocal, z);
  return { start: startUtc, end: endUtc, timeZone: z };
}

/**
 * "HH:mm" 24h in the given time zone (for schedule comparison).
 */
export function getLocalTimeHm(timeZone, ref = new Date()) {
  const z = normalizeIanaTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: z,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(ref);
  const hour = parts.find((p) => p.type === 'hour')?.value;
  const minute = parts.find((p) => p.type === 'minute')?.value;
  if (hour == null || minute == null) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * YYYY-MM-DD in the given time zone (for dedupe keys).
 */
export function getLocalDateKey(timeZone, ref = new Date()) {
  const z = normalizeIanaTimeZone(timeZone);
  const s = new Intl.DateTimeFormat('en-CA', {
    timeZone: z,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ref);
  return s;
}

/**
 * Up to two UTC-midnight `Date` values that legacy MedicationLog `date` may use for a local calendar day.
 */
export function getUtcMidnightsOverlappingLocalDay(timeZone, ref = new Date()) {
  const { start, end } = getLocalDayBoundsUtc(timeZone, ref);
  const a = startOfUtcDay(start);
  const b = startOfUtcDay(new Date(end.getTime() - 1));
  if (a.getTime() === b.getTime()) return [a];
  return [a, b];
}
