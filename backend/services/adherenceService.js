import mongoose from 'mongoose';
import { Medication } from '../models/Medication.js';
import { MedicationLog, startOfUtcDay } from '../models/MedicationLog.js';
import { DoseLog } from '../models/DoseLog.js';
import { SideEffect } from '../models/SideEffect.js';
import { isDoseLevelEnabled } from '../config/features.js';
import {
  resolveAdherenceRange,
  countInclusiveUtcDays,
  MS_PER_DAY,
} from '../utils/adherenceRange.js';
import {
  computeRiskAssessment,
  computeRiskAssessmentFallback,
} from './riskScoreService.js';

function computeMissedStreak(missedDayDates, rangeStart, rangeEnd) {
  const set = new Set(
    missedDayDates.map((d) => startOfUtcDay(d)?.getTime()).filter((t) => t != null)
  );
  let streak = 0;
  let cursor = rangeEnd.getTime();
  const startMs = rangeStart.getTime();

  while (cursor >= startMs) {
    if (!set.has(cursor)) break;
    streak++;
    cursor -= MS_PER_DAY;
  }

  return streak;
}

function computeTotalExpectedDoses(medications, rangeStart, rangeEnd) {
  let total = 0;

  for (const med of medications) {
    const slots = Array.isArray(med.schedule) ? med.schedule.length : 0;
    if (slots === 0) continue;

    const medStart = med.startDate ? startOfUtcDay(med.startDate) : rangeStart;
    const medEnd = med.endDate ? startOfUtcDay(med.endDate) : rangeEnd;
    if (!medStart || !medEnd) continue;

    const overlapStart =
      medStart.getTime() > rangeStart.getTime() ? medStart : rangeStart;
    const overlapEnd = medEnd.getTime() < rangeEnd.getTime() ? medEnd : rangeEnd;

    if (overlapStart > overlapEnd) continue;

    const days = countInclusiveUtcDays(overlapStart, overlapEnd);
    total += days * slots;
  }

  return total;
}

async function countSideEffectsBySeverity(userObjectId, rangeStart, rangeEnd) {
  const rangeEndExclusive = new Date(rangeEnd.getTime() + MS_PER_DAY);
  const rows = await SideEffect.aggregate([
    {
      $match: {
        userId: userObjectId,
        date: { $gte: rangeStart, $lt: rangeEndExclusive },
      },
    },
    {
      $group: {
        _id: '$severity',
        count: { $sum: 1 },
      },
    },
  ]);

  const out = { low: 0, medium: 0, high: 0 };
  for (const row of rows) {
    if (row._id === 'low') out.low = row.count;
    if (row._id === 'medium') out.medium = row.count;
    if (row._id === 'high') out.high = row.count;
  }
  return out;
}

/**
 * Shared adherence payload for analytics + reports (optional query.start / query.end).
 * @returns {{ error: string } | object}
 */
export async function computeAdherenceStats(userId, query = {}) {
  const resolved = resolveAdherenceRange(query);
  if (resolved.error) {
    return { error: resolved.error };
  }

  const { rangeStart, rangeEnd } = resolved;
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const rangeEndExclusive = new Date(rangeEnd.getTime() + MS_PER_DAY);

  const doseLevel = isDoseLevelEnabled();

  const [medications, logAgg, missedDistinctDates, sideEffectRows] = await Promise.all([
    Medication.find({ userId })
      .select({ schedule: 1, startDate: 1, endDate: 1 })
      .lean(),
    doseLevel
      ? DoseLog.aggregate([
          {
            $match: {
              userId: userObjectId,
              datetime: { $gte: rangeStart, $lt: rangeEndExclusive },
            },
          },
          {
            $group: {
              _id: '$status',
              doseCount: { $sum: 1 },
            },
          },
        ])
      : MedicationLog.aggregate([
          {
            $match: {
              userId: userObjectId,
              date: { $gte: rangeStart, $lte: rangeEnd },
            },
          },
          {
            $lookup: {
              from: Medication.collection.name,
              localField: 'medicationId',
              foreignField: '_id',
              as: 'med',
            },
          },
          { $unwind: { path: '$med', preserveNullAndEmptyArrays: true } },
          {
            $addFields: {
              slotCount: { $size: { $ifNull: ['$med.schedule', []] } },
            },
          },
          {
            $group: {
              _id: '$status',
              doseCount: { $sum: '$slotCount' },
            },
          },
        ]),
    doseLevel
      ? DoseLog.aggregate([
          {
            $match: {
              userId: userObjectId,
              status: 'missed',
              datetime: { $gte: rangeStart, $lt: rangeEndExclusive },
            },
          },
          {
            $group: {
              _id: {
                $dateFromParts: {
                  year: { $year: { date: '$datetime', timezone: 'UTC' } },
                  month: { $month: { date: '$datetime', timezone: 'UTC' } },
                  day: { $dayOfMonth: { date: '$datetime', timezone: 'UTC' } },
                  hour: 0,
                  minute: 0,
                  second: 0,
                  millisecond: 0,
                  timezone: 'UTC',
                },
              },
            },
          },
        ]).then((rows) => rows.map((r) => r._id).filter(Boolean))
      : MedicationLog.distinct('date', {
          userId: userObjectId,
          status: 'missed',
          date: { $gte: rangeStart, $lte: rangeEnd },
        }),
    countSideEffectsBySeverity(userObjectId, rangeStart, rangeEnd).catch(() => null),
  ]);

  const totalDoses = computeTotalExpectedDoses(medications, rangeStart, rangeEnd);

  let takenDoses = 0;
  let missedDoses = 0;
  for (const row of logAgg) {
    const c = Math.max(0, Number(row.doseCount) || 0);
    if (row._id === 'taken') takenDoses = c;
    if (row._id === 'missed') missedDoses = c;
  }

  // Formula: (taken / expected) * 100; cap at 100% when users log more doses than schedule implies.
  const rawRatio = totalDoses > 0 && Number.isFinite(takenDoses) ? takenDoses / totalDoses : 0;
  const adherencePercentage =
    totalDoses > 0
      ? Math.min(100, Math.max(0, Math.round(rawRatio * 10000) / 100))
      : 0;

  const missedStreak = computeMissedStreak(missedDistinctDates, rangeStart, rangeEnd);

  let assessment;
  if (sideEffectRows == null) {
    assessment = computeRiskAssessmentFallback(adherencePercentage, totalDoses);
  } else {
    assessment = computeRiskAssessment({
      adherencePercentage,
      totalDoses,
      missedStreak,
      sideEffectCounts: sideEffectRows,
    });
  }

  return {
    totalDoses,
    takenDoses,
    missedDoses,
    adherencePercentage,
    riskLevel: assessment.riskLevel,
    riskScore: assessment.score,
    riskReason: assessment.reason,
    missedStreak,
  };
}
