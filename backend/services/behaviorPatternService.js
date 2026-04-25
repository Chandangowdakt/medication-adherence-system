import mongoose from 'mongoose';
import { MedicationLog, startOfUtcDay } from '../models/MedicationLog.js';
import { DoseLog } from '../models/DoseLog.js';
import { Medication } from '../models/Medication.js';
import { isDoseLevelEnabled } from '../config/features.js';
import { MS_PER_DAY } from '../utils/adherenceRange.js';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Parse "HH:mm" → minutes since UTC midnight (same convention as miss prediction).
 */
function slotToUtcMinutes(t) {
  const s = String(t).trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Morning / afternoon / evening in UTC (explainable, matches prediction copy). */
export function utcHourToTimeOfDay(hourUtc) {
  if (hourUtc < 12) return 'morning';
  if (hourUtc < 17) return 'afternoon';
  return 'evening';
}

function slotStringToTimeOfDay(slot) {
  const sm = slotToUtcMinutes(slot);
  if (sm == null) return null;
  const h = Math.floor(sm / 60);
  return utcHourToTimeOfDay(h);
}

/**
 * For legacy daily misses: infer time-of-day from which bucket holds the most scheduled slots for that med.
 * Ties break toward earlier in the day (morning first).
 */
function dominantBucketFromSchedule(schedule) {
  const slots = Array.isArray(schedule) ? schedule : [];
  const counts = { morning: 0, afternoon: 0, evening: 0 };
  for (const slot of slots) {
    const b = slotStringToTimeOfDay(slot);
    if (b) counts[b] += 1;
  }
  const total = counts.morning + counts.afternoon + counts.evening;
  if (total === 0) return null;

  const order = ['morning', 'afternoon', 'evening'];
  let best = 'morning';
  let bestC = -1;
  for (const b of order) {
    if (counts[b] > bestC) {
      bestC = counts[b];
      best = b;
    }
  }
  return best;
}

function pickMaxKey(countsMap, keyOrder) {
  let bestKey = null;
  let bestC = -1;
  for (const k of keyOrder) {
    const c = countsMap[k] ?? 0;
    if (c > bestC) {
      bestC = c;
      bestKey = k;
    }
  }
  return bestC > 0 ? { key: bestKey, count: bestC } : { key: null, count: 0 };
}

function buildInsight(mostMissedTime, mostMissedDay, topTimeCount, topDayCount, totalMisses) {
  if (totalMisses === 0) {
    return {
      mostMissedTime: null,
      mostMissedDay: null,
      insight: 'No missed doses in the last 30 days (UTC) — keep it up.',
      missedDoseCount: 0,
    };
  }

  const hasTime = mostMissedTime && topTimeCount > 0;
  const hasDay = mostMissedDay && topDayCount > 0;

  if (!hasTime && !hasDay) {
    return {
      mostMissedTime: null,
      mostMissedDay: null,
      insight:
        'Not enough structured schedule data to separate misses by time of day; weekday pattern is also unclear.',
      missedDoseCount: totalMisses,
    };
  }

  let insight = '';
  if (hasTime && hasDay) {
    insight = `You frequently miss ${mostMissedTime} doses, most often on ${mostMissedDay}s.`;
  } else if (hasTime) {
    insight = `You frequently miss ${mostMissedTime} doses.`;
  } else {
    insight = `You frequently miss doses on ${mostMissedDay}s.`;
  }
  insight += ' (Last 30 days, UTC.)';

  return {
    mostMissedTime: hasTime ? mostMissedTime : null,
    mostMissedDay: hasDay ? mostMissedDay : null,
    insight,
    missedDoseCount: totalMisses,
  };
}

/**
 * Last 30 UTC days ending today (inclusive), same default window as analytics.
 */
function defaultRange30d() {
  const today = startOfUtcDay(new Date());
  if (!today) return null;
  const rangeEnd = today;
  const rangeStart = new Date(today.getTime() - 29 * MS_PER_DAY);
  return { rangeStart, rangeEnd };
}

async function analyzeFromDoseLogs(userObjectId, rangeStart, rangeEndExclusive) {
  const misses = await DoseLog.find({
    userId: userObjectId,
    status: 'missed',
    datetime: { $gte: rangeStart, $lt: rangeEndExclusive },
  })
    .select('datetime')
    .lean();

  const timeCounts = { morning: 0, afternoon: 0, evening: 0 };
  const dayCounts = Object.fromEntries(DAY_NAMES.map((d) => [d, 0]));

  for (const row of misses) {
    const d = new Date(row.datetime);
    if (Number.isNaN(d.getTime())) continue;
    const bucket = utcHourToTimeOfDay(d.getUTCHours());
    timeCounts[bucket] += 1;
    const dow = DAY_NAMES[d.getUTCDay()];
    dayCounts[dow] += 1;
  }

  return { timeCounts, dayCounts, totalMisses: misses.length };
}

async function analyzeFromMedicationLogs(userId, userObjectId, rangeStart, rangeEnd) {
  const misses = await MedicationLog.find({
    userId: userObjectId,
    status: 'missed',
    date: { $gte: rangeStart, $lte: rangeEnd },
  })
    .select('date medicationId')
    .lean();

  if (misses.length === 0) {
    return {
      timeCounts: { morning: 0, afternoon: 0, evening: 0 },
      dayCounts: Object.fromEntries(DAY_NAMES.map((d) => [d, 0])),
      totalMisses: 0,
    };
  }

  const medIds = [...new Set(misses.map((m) => String(m.medicationId)))];
  const meds = await Medication.find({
    _id: { $in: medIds.map((id) => new mongoose.Types.ObjectId(id)) },
    userId: new mongoose.Types.ObjectId(userId),
  })
    .select('schedule')
    .lean();
  const scheduleByMedId = new Map(meds.map((m) => [String(m._id), m.schedule]));

  const timeCounts = { morning: 0, afternoon: 0, evening: 0 };
  const dayCounts = Object.fromEntries(DAY_NAMES.map((d) => [d, 0]));

  for (const row of misses) {
    const d = new Date(row.date);
    if (!Number.isNaN(d.getTime())) {
      const dow = DAY_NAMES[d.getUTCDay()];
      dayCounts[dow] += 1;
    }

    const sched = scheduleByMedId.get(String(row.medicationId));
    const dom = dominantBucketFromSchedule(sched);
    if (dom) {
      timeCounts[dom] += 1;
    }
  }

  return { timeCounts, dayCounts, totalMisses: misses.length };
}

/**
 * Missed-dose behavior in the last 30 days (UTC).
 * Dose-level: uses each miss’s actual timestamp. Legacy: weekday from log date; time-of-day inferred from med schedule dominance.
 *
 * @returns {Promise<{ mostMissedTime: string | null, mostMissedDay: string | null, insight: string } | { error: string }>}
 */
export async function computeBehaviorPatterns(userId) {
  const range = defaultRange30d();
  if (!range) {
    return { error: 'Invalid server date' };
  }

  const { rangeStart, rangeEnd } = range;
  const rangeEndExclusive = new Date(rangeEnd.getTime() + MS_PER_DAY);
  const userObjectId = new mongoose.Types.ObjectId(userId);

  const { timeCounts, dayCounts, totalMisses } = isDoseLevelEnabled()
    ? await analyzeFromDoseLogs(userObjectId, rangeStart, rangeEndExclusive)
    : await analyzeFromMedicationLogs(userId, userObjectId, rangeStart, rangeEnd);

  const timePick = pickMaxKey(timeCounts, ['morning', 'afternoon', 'evening']);
  const dayPick = pickMaxKey(dayCounts, DAY_NAMES);

  const out = buildInsight(
    timePick.key,
    dayPick.key,
    timePick.count,
    dayPick.count,
    totalMisses
  );

  const maxT = Math.max(timeCounts.morning, timeCounts.afternoon, timeCounts.evening);
  const timeOfDayConcentration = totalMisses > 0 ? maxT / totalMisses : 0;
  const sat = dayCounts.Saturday ?? 0;
  const sun = dayCounts.Sunday ?? 0;
  const weekendMissShare = totalMisses > 0 ? (sat + sun) / totalMisses : 0;

  return {
    ...out,
    timeOfDayConcentration: Math.min(1, Math.max(0, timeOfDayConcentration)),
    weekendMissShare: Math.min(1, Math.max(0, weekendMissShare)),
  };
}

/**
 * Short clause for appending to prediction copy (optional integration).
 */
export function behaviorPatternClause(patterns) {
  if (!patterns || patterns.error) return '';
  if (!patterns.mostMissedTime && !patterns.mostMissedDay) return '';
  if (patterns.mostMissedTime && patterns.mostMissedDay) {
    return ` Your misses cluster in the ${patterns.mostMissedTime} and on ${patterns.mostMissedDay}s.`;
  }
  if (patterns.mostMissedTime) {
    return ` Your misses most often occur in the ${patterns.mostMissedTime}.`;
  }
  return ` Your misses most often fall on ${patterns.mostMissedDay}s.`;
}
