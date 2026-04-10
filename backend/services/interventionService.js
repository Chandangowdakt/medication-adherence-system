import { computeMissPrediction } from './missPredictionService.js';

/**
 * Explainable intervention rules (priority order — first match wins).
 *
 * Inputs (all from the same heuristic as miss prediction, UTC):
 * - missProbability: 0–1
 * - riskLevel: 'low' | 'medium' | 'high' (bands: under 0.35, 0.35–0.6, 0.6+)
 * - missedStreak: consecutive UTC days with ≥1 missed log in the analytics window
 *
 * Types:
 * - doctor_notify: sustained misses + high risk → suggest care team
 * - reminder_adjustment: high miss probability → earlier secondary cue (e.g. +15 min)
 * - alert: medium risk → habit coaching; low risk → explicit “no action”
 */

function buildDoctorNotify(rationale) {
  return {
    interventionType: 'doctor_notify',
    message:
      'Your recent pattern suggests talking with your care team may help you stay on track with medications.',
    action:
      'Message or call your doctor or pharmacist about barriers to doses. If your clinic linked this app, they can review your adherence summary.',
    critical: true,
    rationale,
  };
}

function buildReminderAdjustment(rationale) {
  return {
    interventionType: 'reminder_adjustment',
    message:
      'Send an additional reminder about 15 minutes before each scheduled dose so you have time to prepare.',
    action:
      'Set a phone alarm or calendar alert 15 minutes before your usual reminder times; keep browser or push notifications on if you use them.',
    critical: false,
    rationale,
  };
}

function buildHabitAlert(rationale) {
  return {
    interventionType: 'alert',
    message:
      'Try linking each dose to a fixed daily habit (for example after breakfast or brushing teeth).',
    action:
      'For two weeks, take each medication immediately after the same daily anchor; note which times still feel difficult.',
    critical: false,
    rationale,
  };
}

function buildNoActionAlert(rationale) {
  return {
    interventionType: 'alert',
    message: 'Your recent logging pattern looks stable; no extra intervention is suggested right now.',
    action: 'No action — continue logging doses as you have been.',
    critical: false,
    rationale,
  };
}

function buildSetupAlert() {
  return {
    interventionType: 'alert',
    message:
      'We can’t personalize reminders until you have active medications with scheduled doses in the tracking window.',
    action: 'Add medications with reminder times on the Medications page.',
    critical: false,
    rationale: [
      'No expected doses in the last 30 days (UTC), so miss probability is not estimated the usual way.',
    ],
  };
}

/**
 * @returns {Promise<{ error: string } | object>}
 */
export async function computeIntervention(userId) {
  const pred = await computeMissPrediction(userId);
  if (pred.error) {
    return { error: pred.error };
  }

  const missProbability = Number(pred.missProbability) || 0;
  const riskLevel = pred.risk;
  const missedStreak = Math.max(0, Number(pred.breakdown?.missedStreak) || 0);
  const note = pred.breakdown?.note;

  if (note && String(note).includes('No expected doses')) {
    return buildSetupAlert();
  }

  const rationale = [];

  // 1) doctor_notify — sustained missed days + strong risk signals
  const doctorByStreak = missedStreak >= 7;
  const doctorHighRiskStreak = riskLevel === 'high' && missedStreak >= 5;
  const doctorProbStreak = missProbability >= 0.7 && missedStreak >= 4;

  if (doctorByStreak || doctorHighRiskStreak || doctorProbStreak) {
    if (doctorByStreak) {
      rationale.push('Rule: missed-day streak is 7 or more consecutive UTC days.');
    }
    if (doctorHighRiskStreak) {
      rationale.push(
        'Rule: next-dose risk band is “high” and missed-day streak is at least 5 (UTC).'
      );
    }
    if (doctorProbStreak) {
      rationale.push(
        'Rule: estimated miss probability is at least 70% with a missed streak of 4 or more days.'
      );
    }
    return buildDoctorNotify(rationale);
  }

  // 2) reminder_adjustment — high probability / high band / medium band with long streak
  const reminderHighBand = riskLevel === 'high';
  const reminderProb = missProbability >= 0.6;
  const reminderMediumStreak = riskLevel === 'medium' && missedStreak >= 3;

  if (reminderHighBand || reminderProb || reminderMediumStreak) {
    if (reminderHighBand) {
      rationale.push(
        'Rule: miss-risk band is “high” (estimated next-dose miss probability ≥ 60%).'
      );
    } else if (reminderProb) {
      rationale.push(
        `Rule: estimated miss probability is ${Math.round(missProbability * 100)}% (≥ 60% threshold).`
      );
    }
    if (reminderMediumStreak) {
      rationale.push(
        `Rule: medium risk band with missed-day streak ${missedStreak} (≥ 3 days triggers earlier reminders).`
      );
    }
    rationale.push(
      'Rationale: an extra cue shortly before the scheduled time reduces rushed or forgotten doses (habit / cueing).'
    );
    return buildReminderAdjustment(rationale);
  }

  // 3) alert — medium risk, habit focus
  if (riskLevel === 'medium') {
    rationale.push(
      'Rule: miss probability is in the medium band (35–59% in the app’s fixed formula).'
    );
    rationale.push(
      'Rationale: pairing medicines with stable daily routines improves adherence without changing dose times.'
    );
    return buildHabitAlert(rationale);
  }

  // 4) low — explicit no action
  rationale.push(
    'Rule: miss probability is below 35% and thresholds for earlier reminders or care-team escalation were not met.'
  );
  if (missedStreak > 0) {
    rationale.push(`Context: missed-day streak is ${missedStreak} (still below escalation rules).`);
  }
  return buildNoActionAlert(rationale);
}
