import { startOfUtcDay } from '../models/MedicationLog.js';

/**
 * True when medication is active on a given UTC calendar day (inclusive start/end if set).
 */
export function isMedicationActiveOnDay(med, refDayStart) {
  const t = refDayStart.getTime();
  const start = med.startDate ? startOfUtcDay(med.startDate)?.getTime() : null;
  const end = med.endDate ? startOfUtcDay(med.endDate)?.getTime() : null;
  if (start != null && t < start) return false;
  if (end != null && t > end) return false;
  return true;
}

/**
 * Sum of schedule slots (doses per day) for all medications active on that UTC day.
 */
export function expectedDosesOnUtcDay(medications, dayStart) {
  let n = 0;
  for (const m of medications) {
    if (!isMedicationActiveOnDay(m, dayStart)) continue;
    n += Array.isArray(m.schedule) ? m.schedule.length : 0;
  }
  return n;
}
