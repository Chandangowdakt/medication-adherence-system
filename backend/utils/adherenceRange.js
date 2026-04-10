import { startOfUtcDay } from '../models/MedicationLog.js';

const DEFAULT_RANGE_DAYS = 30;
export const MS_PER_DAY = 86400000;

/**
 * Parse optional start/end query params (ISO strings). Returns inclusive UTC day bounds.
 * Default: last DEFAULT_RANGE_DAYS days ending today (UTC).
 */
export function resolveAdherenceRange(query) {
  const today = startOfUtcDay(new Date());
  if (!today) {
    return { error: 'Invalid server date' };
  }

  let rangeEnd = today;
  if (query.end != null && query.end !== '') {
    const parsed = startOfUtcDay(query.end);
    if (!parsed) return { error: 'Invalid end date' };
    rangeEnd = parsed;
  }

  let rangeStart = new Date(rangeEnd.getTime() - (DEFAULT_RANGE_DAYS - 1) * MS_PER_DAY);
  if (query.start != null && query.start !== '') {
    const parsed = startOfUtcDay(query.start);
    if (!parsed) return { error: 'Invalid start date' };
    rangeStart = parsed;
  }

  if (rangeStart > rangeEnd) {
    return { error: 'start must be on or before end' };
  }

  return { rangeStart, rangeEnd };
}

/**
 * Inclusive UTC calendar days between two startOfUtcDay dates.
 */
export function countInclusiveUtcDays(a, b) {
  return Math.floor((b.getTime() - a.getTime()) / MS_PER_DAY) + 1;
}
