import { computeBehaviorPatterns, utcHourToTimeOfDay } from './behaviorPatternService.js';
import { computeMissPrediction } from './missPredictionService.js';

/**
 * Evening reminders fire this many minutes before the scheduled UTC time when adaptation is on.
 * Chosen within the 10–15 minute window; fixed for explainability.
 */
export const EVENING_ADAPTIVE_EARLY_MINUTES = 12;

const CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * @typedef {{ active: boolean; eveningEarlyMinutes: number; reason: string | null }} AdaptiveReminderState
 */

/** @type {Map<string, { at: number; value: AdaptiveReminderState }>} */
const cache = new Map();

function parseHHmmToMinutes(hhmm) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function minutesToHHmm(totalMinutes) {
  const t = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(t / 60);
  const min = t % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/**
 * @param {string} hhmm — normalized HH:mm
 * @param {number} deltaM
 * @returns {string | null}
 */
export function subtractMinutesFromHHmm(hhmm, deltaM) {
  const sm = parseHHmmToMinutes(hhmm);
  if (sm == null) return null;
  return minutesToHHmm(sm - deltaM);
}

/**
 * True if this scheduled clock time falls in the evening bucket (UTC), same as behavior patterns.
 * @param {string} hhmm
 */
export function isEveningSlotHm(hhmm) {
  const sm = parseHHmmToMinutes(hhmm);
  if (sm == null) return false;
  const h = Math.floor(sm / 60);
  return utcHourToTimeOfDay(h) === 'evening';
}

/**
 * Explainable rules (pattern + prediction):
 * - Top miss bucket is evening (30d UTC)
 * - At least 2 missed records (avoid adapting on noise)
 * - Next-dose heuristic shows elevated risk (medium/high band OR miss probability ≥ 0.35)
 */
async function computeAdaptiveReminderStateUncached(userId) {
  const [patterns, pred] = await Promise.all([
    computeBehaviorPatterns(userId),
    computeMissPrediction(userId),
  ]);

  if (patterns.error || pred.error) {
    return { active: false, eveningEarlyMinutes: 0, reason: 'unavailable' };
  }

  if (pred.breakdown?.note?.includes('No expected doses')) {
    return { active: false, eveningEarlyMinutes: 0, reason: 'no_expected_doses' };
  }

  const missedCount = Number(patterns.missedDoseCount) || 0;
  if (missedCount < 2) {
    return { active: false, eveningEarlyMinutes: 0, reason: 'insufficient_misses' };
  }

  if (patterns.mostMissedTime !== 'evening') {
    return { active: false, eveningEarlyMinutes: 0, reason: 'not_evening_cluster' };
  }

  const prob = Number(pred.missProbability) || 0;
  const risk = pred.risk;
  const elevated =
    risk === 'high' || risk === 'medium' || prob >= 0.35;

  if (!elevated) {
    return { active: false, eveningEarlyMinutes: 0, reason: 'risk_not_elevated' };
  }

  return {
    active: true,
    eveningEarlyMinutes: EVENING_ADAPTIVE_EARLY_MINUTES,
    reason: 'evening_miss_pattern_and_elevated_miss_probability',
  };
}

/**
 * Cached adaptive state (per user) to limit work during per-minute scheduler ticks.
 * @returns {Promise<AdaptiveReminderState>}
 */
export async function getAdaptiveReminderStateForUser(userId) {
  const key = String(userId);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_TTL_MS) {
    return hit.value;
  }
  const value = await computeAdaptiveReminderStateUncached(userId);
  cache.set(key, { at: now, value });
  return value;
}

/**
 * JSON fragment for dashboard / clients.
 */
export function adaptiveReminderClientPayload(state) {
  if (!state.active || !state.eveningEarlyMinutes) {
    return {
      active: false,
      eveningEarlyMinutes: 0,
      message: null,
    };
  }
  return {
    active: true,
    eveningEarlyMinutes: state.eveningEarlyMinutes,
    message: 'Reminder adjusted based on your habits',
  };
}
