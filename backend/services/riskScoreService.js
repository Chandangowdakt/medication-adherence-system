/**
 * Legacy thresholds (adherence % only). Used when advanced scoring is unavailable.
 */
export function riskLevelFromAdherence(adherencePercentage) {
  if (adherencePercentage >= 80) return 'low';
  if (adherencePercentage >= 50) return 'medium';
  return 'high';
}

/**
 * Map aggregate score (0–100, higher = worse) to band.
 */
function riskLevelFromScore(score) {
  if (score < 28) return 'low';
  if (score < 58) return 'medium';
  return 'high';
}

/**
 * Build a short human-readable explanation.
 * @param {{ adherencePercentage: number; missedStreak: number; low: number; medium: number; high: number }} factors
 * @param {'low'|'medium'|'high'} riskLevel
 */
function buildRiskReason(factors, riskLevel) {
  const { adherencePercentage, missedStreak, low, medium, high } = factors;
  const parts = [];

  if (adherencePercentage < 50) {
    parts.push('low adherence');
  } else if (adherencePercentage < 80) {
    parts.push('moderate adherence');
  }

  if (missedStreak >= 3) {
    parts.push(`${missedStreak}-day missed streak`);
  } else if (missedStreak === 2) {
    parts.push('2-day missed streak');
  } else if (missedStreak === 1) {
    parts.push('recent missed day');
  }

  if (high > 0) {
    parts.push(high === 1 ? 'high-severity side effect' : `${high} high-severity side effects`);
  }
  if (medium > 0 && high === 0) {
    parts.push(medium === 1 ? 'medium-severity side effect' : `${medium} medium-severity side effects`);
  }
  if (low > 0 && medium === 0 && high === 0 && parts.length === 0) {
    parts.push(low === 1 ? 'low-severity side effect logged' : `${low} low-severity side effects`);
  }

  const label = riskLevel === 'high' ? 'High' : riskLevel === 'medium' ? 'Medium' : 'Low';

  if (parts.length === 0) {
    return `${label} risk — adherence and medication reporting look stable in this window.`;
  }

  return `${label} risk due to ${parts.join(', ')}.`;
}

/**
 * Weighted risk: adherence gap, missed streak, side-effect severity (same UTC window as adherence).
 * @param {object} input
 * @param {number} input.adherencePercentage 0–100
 * @param {number} input.totalDoses expected doses in window (0 → unknown)
 * @param {number} input.missedStreak consecutive UTC days with ≥1 missed log
 * @param {{ low?: number; medium?: number; high?: number }} input.sideEffectCounts
 * @returns {{ riskLevel: 'low'|'medium'|'high'|'unknown', score: number|null, reason: string }}
 */
function sanitizeAdherencePct(pct) {
  const n = Number(pct);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

export function computeRiskAssessment({
  adherencePercentage,
  totalDoses,
  missedStreak,
  sideEffectCounts = { low: 0, medium: 0, high: 0 },
}) {
  const ap = sanitizeAdherencePct(adherencePercentage);

  if (totalDoses === 0) {
    return {
      riskLevel: 'unknown',
      score: null,
      reason: 'No scheduled doses in this period — risk score cannot be calculated.',
    };
  }

  const streak = Math.max(0, Number(missedStreak) || 0);
  const se = {
    low: Math.max(0, Number(sideEffectCounts.low) || 0),
    medium: Math.max(0, Number(sideEffectCounts.medium) || 0),
    high: Math.max(0, Number(sideEffectCounts.high) || 0),
  };

  // Weights (higher contribution = more risk). Capped total conceptually 0–100.
  const adherencePoints = ((100 - ap) / 100) * 42;
  const streakPoints = Math.min(streak, 10) * 2.8;
  const rawSide = se.low * 3 + se.medium * 9 + se.high * 18;
  const sidePoints = Math.min(30, rawSide);

  const score = Math.round(Math.min(100, adherencePoints + streakPoints + sidePoints));
  const riskLevel = riskLevelFromScore(score);
  const reason = buildRiskReason(
    {
      adherencePercentage: ap,
      missedStreak: streak,
      low: se.low,
      medium: se.medium,
      high: se.high,
    },
    riskLevel
  );

  return { riskLevel, score, reason };
}

/**
 * Fallback when side-effect data cannot be loaded: legacy adherence-only band + explanation.
 */
export function computeRiskAssessmentFallback(adherencePercentage, totalDoses) {
  const ap = sanitizeAdherencePct(adherencePercentage);

  if (totalDoses === 0) {
    return {
      riskLevel: 'unknown',
      score: null,
      reason: 'No scheduled doses in this period — risk score cannot be calculated.',
    };
  }

  const riskLevel = riskLevelFromAdherence(ap);
  const label = riskLevel === 'high' ? 'High' : riskLevel === 'medium' ? 'Medium' : 'Low';
  return {
    riskLevel,
    score: null,
    reason: `${label} risk from adherence alone (${ap}%). Side effect data was not included.`,
  };
}
