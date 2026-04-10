import mongoose from 'mongoose';
import { MedicationLog, startOfUtcDay } from '../models/MedicationLog.js';
import { DoseLog } from '../models/DoseLog.js';
import { isDoseLevelEnabled } from '../config/features.js';
import { doseLogUtcDayStartExpr } from './adherenceLogBridge.js';
import { MS_PER_DAY } from '../utils/adherenceRange.js';

const MIN_DAYS_FOR_REGRESSION = 4;
const SLOPE_STABLE = 0.35; // adherence %-points per day (UTC index)
const FORECAST_DAYS = 7;

function utcDayKey(d) {
  const x = startOfUtcDay(d);
  if (!x) return '';
  return x.toISOString().slice(0, 10);
}

/**
 * Last 30 UTC days ending today — same shape as GET /api/analytics/trends default.
 */
async function loadLast30DaysSeries(userId) {
  const today = startOfUtcDay(new Date());
  if (!today) return { error: 'Invalid date' };

  const rangeEnd = today;
  const rangeStart = new Date(today.getTime() - 29 * MS_PER_DAY);
  const rangeEndExclusive = new Date(rangeEnd.getTime() + MS_PER_DAY);
  const userObjectId = new mongoose.Types.ObjectId(userId);

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

  return { days, rangeEnd, rangeStart };
}

/**
 * Least-squares line y = a + b*x
 */
function linearRegression(points) {
  const n = points.length;
  if (n < 2) {
    const y = points[0]?.y ?? 50;
    return { a: y, b: 0 };
  }
  let sumX = 0;
  let sumY = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    const dx = p.x - meanX;
    num += dx * (p.y - meanY);
    den += dx * dx;
  }
  const b = den === 0 ? 0 : num / den;
  const a = meanY - b * meanX;
  return { a, b };
}

function clampPct(v) {
  return Math.max(0, Math.min(100, Math.round(v * 10) / 10));
}

/**
 * Recent days (end of window) weighted heavier — explainable fallback when regression is thin.
 */
function weightedRecentAdherence(days) {
  const window = days.slice(-7);
  let sumW = 0;
  let sumYW = 0;
  window.forEach((d, i) => {
    const tot = d.takenDoses + d.missedDoses;
    if (tot === 0) return;
    const y = (d.takenDoses / tot) * 100;
    const w = i + 1;
    sumW += w;
    sumYW += w * y;
  });
  if (sumW === 0) return null;
  return sumYW / sumW;
}

function trendFromSlope(b, nPoints) {
  if (nPoints < MIN_DAYS_FOR_REGRESSION) return 'stable';
  if (b < -SLOPE_STABLE) return 'declining';
  if (b > SLOPE_STABLE) return 'improving';
  return 'stable';
}

/**
 * @returns {Promise<{ error: string } | object>}
 */
export async function computeAdherenceForecast(userId) {
  const loaded = await loadLast30DaysSeries(userId);
  if (loaded.error) return { error: loaded.error };
  const { days, rangeEnd } = loaded;

  const regressionPoints = [];
  days.forEach((d, i) => {
    const tot = d.takenDoses + d.missedDoses;
    if (tot === 0) return;
    regressionPoints.push({
      x: i,
      y: (d.takenDoses / tot) * 100,
    });
  });

  const lastIndex = days.length - 1;
  let a;
  let b;
  let method;

  if (regressionPoints.length >= MIN_DAYS_FOR_REGRESSION) {
    const fit = linearRegression(regressionPoints);
    a = fit.a;
    b = fit.b;
    method = 'linear_regression_on_daily_adherence';
  } else {
    const w = weightedRecentAdherence(days);
    if (w == null) {
      return {
        expectedAdherenceNextWeek: null,
        trend: 'stable',
        chartPoints: [],
        note: 'Not enough logged doses in the last 30 days (UTC) to forecast.',
      };
    }
    a = w;
    b = 0;
    method = 'weighted_average_last_7_days_with_logs';
  }

  const nextWeekPreds = [];
  for (let k = 1; k <= FORECAST_DAYS; k++) {
    const x = lastIndex + k;
    nextWeekPreds.push(clampPct(a + b * x));
  }
  const expectedAdherenceNextWeek = Math.max(
    0,
    Math.min(100, Math.round(nextWeekPreds.reduce((s, v) => s + v, 0) / nextWeekPreds.length))
  );

  const trend = trendFromSlope(b, regressionPoints.length);

  const chartPoints = [];

  days.forEach((d, i) => {
    const tot = d.takenDoses + d.missedDoses;
    const pct = tot === 0 ? null : clampPct((d.takenDoses / tot) * 100);
    chartPoints.push({
      date: d.date,
      adherence: pct,
      kind: 'actual',
    });
  });

  for (let k = 1; k <= FORECAST_DAYS; k++) {
    const t = new Date(rangeEnd.getTime() + k * MS_PER_DAY);
    const key = utcDayKey(t);
    chartPoints.push({
      date: key,
      adherence: clampPct(a + b * (lastIndex + k)),
      kind: 'forecast',
    });
  }

  return {
    expectedAdherenceNextWeek,
    trend,
    chartPoints,
    method,
    note:
      regressionPoints.length >= MIN_DAYS_FOR_REGRESSION
        ? 'Forecast from simple linear regression on daily % taken (days with logs only), extrapolated 7 days (UTC).'
        : 'Forecast from weighted average of recent days with logs (newer days weighted higher); trend shown as stable until enough data for a line fit.',
  };
}
