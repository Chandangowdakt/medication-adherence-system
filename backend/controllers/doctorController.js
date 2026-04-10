import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { Medication } from '../models/Medication.js';
import { MedicationLog } from '../models/MedicationLog.js';
import { isDoseLevelEnabled } from '../config/features.js';
import { aggregateUserDoseLogsAsDailyRollup } from '../services/adherenceLogBridge.js';
import { computeAdherenceStats } from '../services/adherenceService.js';
import { formatLog } from './logController.js';

const RECENT_LOG_LIMIT = 50;

const RISK_SORT_ORDER = { high: 0, medium: 1, low: 2, unknown: 3 };

function patientRowFromAdherence(p, stats) {
  const base = {
    id: p._id,
    name: p.name,
    email: p.email,
    role: p.role,
    createdAt: p.createdAt,
  };

  if (stats.error) {
    return {
      ...base,
      adherencePercentage: null,
      riskLevel: 'unknown',
      riskScore: null,
      totalDoses: 0,
      missedStreak: 0,
      highRisk: false,
      lowAdherence: false,
    };
  }

  const highRisk = stats.riskLevel === 'high';
  const lowAdherence = stats.totalDoses > 0 && stats.adherencePercentage < 50;

  return {
    ...base,
    adherencePercentage: stats.adherencePercentage,
    riskLevel: stats.riskLevel,
    riskScore: stats.riskScore,
    totalDoses: stats.totalDoses,
    missedStreak: stats.missedStreak,
    highRisk,
    lowAdherence,
  };
}

/**
 * GET /api/doctor/patients — linked patients + adherence/risk (default 30-day UTC window).
 * Response: patients (sorted by risk), highRiskPatients, lowAdherencePatients.
 */
export async function getDoctorPatients(req, res) {
  try {
    const doctorId = req.user.id;
    const patientDocs = await User.find({
      linkedDoctorId: doctorId,
      role: 'patient',
    })
      .select('name email role createdAt')
      .sort({ name: 1 })
      .lean();

    const enriched = await Promise.all(
      patientDocs.map(async (p) => {
        const stats = await computeAdherenceStats(p._id.toString(), req.query);
        return patientRowFromAdherence(p, stats);
      })
    );

    const highRiskPatients = enriched.filter((row) => row.highRisk);
    const lowAdherencePatients = enriched.filter((row) => row.lowAdherence);

    const patients = [...enriched].sort((a, b) => {
      const ra = RISK_SORT_ORDER[a.riskLevel] ?? 3;
      const rb = RISK_SORT_ORDER[b.riskLevel] ?? 3;
      if (ra !== rb) return ra - rb;
      const sa = a.riskScore ?? -1;
      const sb = b.riskScore ?? -1;
      if (sa !== sb) return sb - sa;
      return String(a.name || '').localeCompare(String(b.name || ''), undefined, {
        sensitivity: 'base',
      });
    });

    return res.json({
      patients,
      highRiskPatients,
      lowAdherencePatients,
    });
  } catch (err) {
    console.error('getDoctorPatients error:', err);
    return res.status(500).json({ message: 'Server error while loading patients' });
  }
}

/**
 * GET /api/doctor/patient/:id — one linked patient’s profile + adherence + meds + recent logs.
 */
export async function getDoctorPatientDetail(req, res) {
  try {
    const { id } = req.params;
    const doctorId = req.user.id;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: 'Invalid patient id' });
    }

    const patient = await User.findOne({
      _id: id,
      linkedDoctorId: doctorId,
      role: 'patient',
    })
      .select('-password')
      .lean();

    if (!patient) {
      return res.status(404).json({ message: 'Patient not found' });
    }

    const patientId = id;
    const [adherenceResult, medications, logDocs] = await Promise.all([
      computeAdherenceStats(patientId, req.query),
      Medication.find({ userId: patientId }).sort({ createdAt: -1 }).lean(),
      isDoseLevelEnabled()
        ? aggregateUserDoseLogsAsDailyRollup(patientId, { limit: RECENT_LOG_LIMIT })
        : MedicationLog.find({ userId: patientId })
            .populate('medicationId', 'name dosage')
            .sort({ date: -1 })
            .limit(RECENT_LOG_LIMIT)
            .lean(),
    ]);

    if (adherenceResult.error) {
      return res.status(400).json({ message: adherenceResult.error });
    }

    const recentLogs = logDocs.map((row) => formatLog(row));

    return res.json({
      patient: {
        id: patient._id,
        name: patient.name,
        email: patient.email,
        role: patient.role,
        createdAt: patient.createdAt,
      },
      adherence: adherenceResult,
      medications,
      recentLogs,
    });
  } catch (err) {
    console.error('getDoctorPatientDetail error:', err);
    return res.status(500).json({ message: 'Server error while loading patient' });
  }
}
