import mongoose from 'mongoose';
import { MedicationLog, startOfUtcDay } from '../models/MedicationLog.js';
import { DoseLog } from '../models/DoseLog.js';
import { isDoseLevelEnabled } from '../config/features.js';
import { computeAdherenceStats } from '../services/adherenceService.js';
import { computeMissPrediction } from '../services/missPredictionService.js';
import { computeIntervention } from '../services/interventionService.js';
import { computeBehaviorPatterns, behaviorPatternClause } from '../services/behaviorPatternService.js';
import { doseLogUtcDayStartExpr } from '../services/adherenceLogBridge.js';
import { resolveAdherenceRange, MS_PER_DAY } from '../utils/adherenceRange.js';
import { computeAdherenceForecast } from '../services/adherenceForecastService.js';

function utcDayKey(d) {
  const x = startOfUtcDay(d);
  if (!x) return '';
  return x.toISOString().slice(0, 10);
}

/**
 * GET /api/analytics/trends — per-UTC-day counts of taken vs missed events (last 30 days by default).
 * Legacy: MedicationLog rows. Dose-level: one count per DoseLog document (real doses).
 */
export async function getAdherenceTrends(req, res) {
  try {
    const resolved = resolveAdherenceRange(req.query);
    if (resolved.error) {
      return res.status(400).json({ message: resolved.error });
    }
    const { rangeStart, rangeEnd } = resolved;
    const userObjectId = new mongoose.Types.ObjectId(req.user.id);
    const rangeEndExclusive = new Date(rangeEnd.getTime() + MS_PER_DAY);

    const agg = isDoseLevelEnabled()
      ? await DoseLog.aggregate([
          {
            $match: {
              userId: userObjectId,
              datetime: { $gte: rangeStart, $lt: rangeEndExclusive },
            },
          },
          { $addFields: { dayKey: doseLogUtcDayStartExpr } },
          {
            $group: {
              _id: '$dayKey',
              takenDoses: { $sum: { $cond: [{ $eq: ['$status', 'taken'] }, 1, 0] } },
              missedDoses: { $sum: { $cond: [{ $eq: ['$status', 'missed'] }, 1, 0] } },
            },
          },
        ])
      : await MedicationLog.aggregate([
          {
            $match: {
              userId: userObjectId,
              date: { $gte: rangeStart, $lte: rangeEnd },
            },
          },
          {
            $group: {
              _id: '$date',
              takenDoses: { $sum: { $cond: [{ $eq: ['$status', 'taken'] }, 1, 0] } },
              missedDoses: { $sum: { $cond: [{ $eq: ['$status', 'missed'] }, 1, 0] } },
            },
          },
        ]);

    const byDay = new Map();
    for (const row of agg) {
      const key = utcDayKey(row._id);
      if (!key) continue;
      byDay.set(key, {
        date: key,
        takenDoses: row.takenDoses,
        missedDoses: row.missedDoses,
      });
    }

    const days = [];
    for (let t = rangeStart.getTime(); t <= rangeEnd.getTime(); t += MS_PER_DAY) {
      const key = utcDayKey(new Date(t));
      days.push(byDay.get(key) ?? { date: key, takenDoses: 0, missedDoses: 0 });
    }

    return res.json({ days });
  } catch (err) {
    console.error('getAdherenceTrends error:', err);
    return res.status(500).json({ message: 'Server error while loading trends' });
  }
}

/**
 * GET /api/analytics/adherence — expected doses (from schedule) vs taken/missed from logs.
 * Legacy: MedicationLog rows weighted by slot count per day. Dose-level: one count per DoseLog document.
 */
export async function getAdherence(req, res) {
  try {
    const result = await computeAdherenceStats(req.user.id, req.query);
    if (result.error) {
      return res.status(400).json({ message: result.error });
    }
    return res.json(result);
  } catch (err) {
    console.error('getAdherence error:', err);
    return res.status(500).json({ message: 'Server error while computing adherence' });
  }
}

/**
 * GET /api/analytics/prediction — explainable next-dose miss heuristic (30d + 7d window, UTC).
 */
export async function getMissPrediction(req, res) {
  try {
    const result = await computeMissPrediction(req.user.id);
    if (result.error) {
      return res.status(400).json({ message: result.error });
    }
    const { missProbability, risk, message, breakdown } = result;

    const patterns = await computeBehaviorPatterns(req.user.id);
    const payload = { missProbability, risk, message, breakdown };
    if (!patterns.error) {
      payload.behaviorPatterns = {
        mostMissedTime: patterns.mostMissedTime,
        mostMissedDay: patterns.mostMissedDay,
        insight: patterns.insight,
      };
      /* Optional: short pattern clause appended to heuristic text (explainable, same 30d misses). */
      if (message && (patterns.mostMissedTime || patterns.mostMissedDay)) {
        payload.message = `${message}${behaviorPatternClause(patterns)}`;
      }
    }

    return res.json(payload);
  } catch (err) {
    console.error('getMissPrediction error:', err);
    return res.status(500).json({ message: 'Server error while computing prediction' });
  }
}

/**
 * GET /api/analytics/behavior-patterns — missed-dose clustering by UTC time-of-day and weekday (30d).
 */
export async function getBehaviorPatterns(req, res) {
  try {
    const result = await computeBehaviorPatterns(req.user.id);
    if (result.error) {
      return res.status(400).json({ message: result.error });
    }
    return res.json(result);
  } catch (err) {
    console.error('getBehaviorPatterns error:', err);
    return res.status(500).json({ message: 'Server error while computing behavior patterns' });
  }
}

/**
 * GET /api/analytics/intervention — explainable recommended action from miss probability, risk band, missed streak.
 */
export async function getIntervention(req, res) {
  try {
    const result = await computeIntervention(req.user.id);
    if (result.error) {
      return res.status(400).json({ message: result.error });
    }
    return res.json(result);
  } catch (err) {
    console.error('getIntervention error:', err);
    return res.status(500).json({ message: 'Server error while computing intervention' });
  }
}

/**
 * GET /api/analytics/forecast — next-week adherence expectation from 30d daily trend (UTC).
 */
export async function getAdherenceForecast(req, res) {
  try {
    const result = await computeAdherenceForecast(req.user.id);
    if (result.error) {
      return res.status(400).json({ message: result.error });
    }
    return res.json(result);
  } catch (err) {
    console.error('getAdherenceForecast error:', err);
    return res.status(500).json({ message: 'Server error while computing forecast' });
  }
}
