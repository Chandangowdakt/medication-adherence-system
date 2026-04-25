import { Medication } from '../models/Medication.js';
import { computeAdherenceStats } from './adherenceService.js';
import { computeBehaviorPatterns } from './behaviorPatternService.js';
import { MS_PER_DAY } from '../utils/adherenceRange.js';
import { startOfUtcDay } from '../models/MedicationLog.js';

/**
 * Parse "HH:mm" to minutes from UTC midnight.
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

/**
 * Next scheduled slot after now (UTC); used for human-readable messages only.
 */
function nextDoseLabel(medications, now = new Date()) {
  const nowM = now.getUTCHours() * 60 + now.getUTCMinutes();
  let bestDelta = Infinity;
  let bestSlotM = null;

  for (const med of medications) {
    const slots = Array.isArray(med.schedule) ? med.schedule : [];
    for (const slot of slots) {
      const sm = slotToUtcMinutes(slot);
      if (sm == null) continue;
      let delta = sm - nowM;
      if (delta <= 0) delta += 24 * 60;
      if (delta < bestDelta) {
        bestDelta = delta;
        bestSlotM = sm;
      }
    }
  }

  if (bestSlotM == null) return { period: 'unknown', label: 'next dose' };

  const h = Math.floor(bestSlotM / 60);
  if (h < 12) return { period: 'morning', label: 'morning dose' };
  if (h < 17) return { period: 'afternoon', label: 'afternoon dose' };
  return { period: 'evening', label: 'evening dose' };
}

/** Share of schedule slots in evening (17:00–23:59 UTC) — explainable schedule pattern, not ML. */
function eveningSlotRatio(medications) {
  let total = 0;
  let evening = 0;
  for (const med of medications) {
    const slots = Array.isArray(med.schedule) ? med.schedule : [];
    for (const slot of slots) {
      const sm = slotToUtcMinutes(slot);
      if (sm == null) continue;
      total++;
      const h = Math.floor(sm / 60);
      if (h >= 17) evening++;
    }
  }
  if (total === 0) return 0;
  return evening / total;
}

/**
 * Heuristic miss probability (no external ML).
 * Uses last-30d stats for adherence + streak; last-7d miss share for recency; schedule shapes the message.
 */
export async function computeMissPrediction(userId) {
  const today = startOfUtcDay(new Date());
  if (!today) {
    return { error: 'Invalid server date' };
  }

  const start7 = new Date(today.getTime() - 6 * MS_PER_DAY);
  const startStr = start7.toISOString().slice(0, 10);
  const endStr = today.toISOString().slice(0, 10);

  const [stats30, stats7, medications] = await Promise.all([
    computeAdherenceStats(userId, {}),
    computeAdherenceStats(userId, { start: startStr, end: endStr }),
    Medication.find({ userId }).select('schedule').lean(),
  ]);

  if (stats30.error) {
    return { error: stats30.error };
  }
  if (stats7.error) {
    return { error: stats7.error };
  }

  const hasScheduledDoses = stats30.totalDoses > 0;
  if (!hasScheduledDoses) {
    return {
      missProbability: 0,
      risk: 'low',
      message: 'Add medications with reminder times to estimate next-dose risk.',
      breakdown: {
        adherence30: stats30.adherencePercentage,
        missedStreak: stats30.missedStreak,
        recentMissShare7: 0,
        eveningSlotRatio: eveningSlotRatio(medications),
        note: 'No expected doses in the last 30 days (UTC).',
        timeOfDayConcentration: null,
        weekendMissShare: null,
      },
    };
  }

  const patterns = await computeBehaviorPatterns(userId);

  const adherencePct = Math.min(100, Math.max(0, Number(stats30.adherencePercentage) || 0));
  const streak = Math.max(0, Number(stats30.missedStreak) || 0);

  const total7 = stats7.totalDoses;
  const missed7 = stats7.missedDoses;
  const recentMissShare =
    total7 > 0 ? Math.min(1, Math.max(0, missed7 / total7)) : 0;

  const adherenceGap = Math.min(1, Math.max(0, 1 - adherencePct / 100));
  const maxStreakScale = 30;
  const streakTerm = Math.min(1, streak / maxStreakScale);

  // Weighted: 0.5 * (1 - adherence) + 0.3 * (streak / max) + 0.2 * recent 7d miss rate
  const missProbability = Math.min(
    1,
    Math.max(0, adherenceGap * 0.5 + streakTerm * 0.3 + recentMissShare * 0.2)
  );

  const rounded = Math.round(missProbability * 100) / 100;

  let risk;
  if (rounded < 0.35) risk = 'low';
  else if (rounded < 0.6) risk = 'medium';
  else risk = 'high';

  const { period, label } = nextDoseLabel(medications);
  const evRatio = eveningSlotRatio(medications);

  let message;
  if (risk === 'high') {
    message =
      period === 'evening'
        ? 'High chance of missing evening dose'
        : `High chance of missing your ${label}`;
  } else if (risk === 'medium') {
    message =
      period === 'evening'
        ? 'Moderate chance of missing evening dose'
        : `Moderate chance of missing your ${label}`;
  } else {
    message = 'Lower chance of missing the next scheduled dose based on recent patterns.';
  }

  if (evRatio >= 0.5 && risk !== 'low') {
    message += ' Many of your reminder times are in the evening.';
  }

  return {
    missProbability: rounded,
    risk,
    message,
    breakdown: {
      formula:
        '(1 − adherence%)×0.5 + min(streak/30,1)×0.3 + min(recent miss share 7d,1)×0.2 (UTC-based)',
      adherenceGap: Math.round(adherenceGap * 1000) / 1000,
      streakTerm: Math.round(streakTerm * 1000) / 1000,
      recentMissShare7: Math.round(recentMissShare * 1000) / 1000,
      adherence30: adherencePct,
      missedStreak: streak,
      maxStreakScale: maxStreakScale,
      eveningSlotRatio: Math.round(evRatio * 100) / 100,
      nextDosePeriod: period,
      timeOfDayConcentration:
        patterns && !patterns.error && patterns.timeOfDayConcentration != null
          ? Math.round(patterns.timeOfDayConcentration * 1000) / 1000
          : null,
      weekendMissShare:
        patterns && !patterns.error && patterns.weekendMissShare != null
          ? Math.round(patterns.weekendMissShare * 1000) / 1000
          : null,
    },
  };
}
