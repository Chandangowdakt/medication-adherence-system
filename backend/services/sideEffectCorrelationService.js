import mongoose from 'mongoose';
import { SideEffect } from '../models/SideEffect.js';
import { Medication } from '../models/Medication.js';

/**
 * Normalize free-text symptom for grouping (trim, lowercase, collapse spaces).
 */
export function normalizeSymptomKey(description) {
  return String(description ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Display label for UI (title-like words).
 */
export function symptomKeyToDisplayLabel(key) {
  if (!key) return '';
  return key
    .split(/\s+/)
    .map((w) => (w.length ? w.charAt(0).toUpperCase() + w.slice(1) : ''))
    .join(' ')
    .trim();
}

/**
 * Explainable confidence: share of reports covered by listed symptoms × sample-size factor.
 * @param {number} coveredCount — sum of frequencies for included symptoms
 * @param {number} total — all reports for this medication
 */
export function computeConfidence(coveredCount, total) {
  if (total <= 0 || coveredCount <= 0) return 0;
  const share = coveredCount / total;
  const sampleFactor = Math.min(1, total / (total + 2));
  return Math.round(share * sampleFactor * 100) / 100;
}

/**
 * Pick common symptoms: greedy cover ~45%+ of reports, cap 4 (requires total >= 2).
 * @returns {{ labels: string[]; covered: number }}
 */
function pickCommonSymptoms(sortedEntries, total) {
  if (total < 2 || sortedEntries.length === 0) {
    return { labels: [], covered: 0 };
  }

  const pickedKeys = [];
  let covered = 0;
  const target = Math.max(1, Math.ceil(0.45 * total));

  for (const [symKey, n] of sortedEntries) {
    pickedKeys.push(symKey);
    covered += n;
    if (covered >= target) break;
    if (pickedKeys.length >= 4) break;
  }

  return {
    labels: pickedKeys.map(symptomKeyToDisplayLabel),
    covered,
  };
}

function buildWarningSentence(topDisplayLabel) {
  if (!topDisplayLabel) return null;
  const frag =
    topDisplayLabel.charAt(0).toLowerCase() + topDisplayLabel.slice(1);
  return `This medication frequently causes ${frag}`;
}

/**
 * @returns {Promise<Array<{ medicationId: string, medication: string, commonSideEffects: string[], confidence: number, warning: string | null }>>}
 */
export async function computeCorrelationsForUser(userId) {
  const oid = new mongoose.Types.ObjectId(userId);

  const effects = await SideEffect.find({ userId: oid })
    .select('medicationId description')
    .lean();

  const byMed = new Map();
  for (const row of effects) {
    const mid = String(row.medicationId);
    const key = normalizeSymptomKey(row.description);
    if (!key) continue;
    if (!byMed.has(mid)) byMed.set(mid, new Map());
    const m = byMed.get(mid);
    m.set(key, (m.get(key) || 0) + 1);
  }

  const medIds = [...byMed.keys()].map((id) => new mongoose.Types.ObjectId(id));
  if (medIds.length === 0) return [];

  const meds = await Medication.find({
    _id: { $in: medIds },
    userId: new mongoose.Types.ObjectId(userId),
  })
    .select('name')
    .lean();

  const nameById = new Map(meds.map((m) => [String(m._id), m.name || 'Medication']));

  const out = [];
  for (const [mid, symMap] of byMed) {
    const medName = nameById.get(mid);
    if (!medName) continue;

    const sorted = [...symMap.entries()].sort((a, b) => b[1] - a[1]);
    const total = sorted.reduce((s, [, c]) => s + c, 0);
    const { labels: commonSideEffects, covered } = pickCommonSymptoms(sorted, total);

    const confidence =
      total >= 2 ? computeConfidence(covered, total) : 0;

    const topLabel = commonSideEffects[0] ?? null;
    const warning =
      topLabel && confidence >= 0.25 ? buildWarningSentence(topLabel) : null;

    out.push({
      medicationId: mid,
      medication: medName,
      commonSideEffects,
      confidence,
      warning,
    });
  }

  out.sort((a, b) => String(a.medication).localeCompare(String(b.medication)));
  return out;
}

/**
 * Single medication (must belong to user).
 */
export async function computeCorrelationForMedication(userId, medicationId) {
  const correlations = await computeCorrelationsForUser(userId);
  const hit = correlations.find((c) => c.medicationId === String(medicationId));
  if (hit) return hit;

  const med = await Medication.findOne({
    _id: medicationId,
    userId: new mongoose.Types.ObjectId(userId),
  })
    .select('name')
    .lean();

  return {
    medicationId: String(medicationId),
    medication: med?.name ?? null,
    commonSideEffects: [],
    confidence: 0,
    warning: null,
  };
}
