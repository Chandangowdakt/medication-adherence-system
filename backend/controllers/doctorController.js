import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { Medication } from '../models/Medication.js';
import { MedicationLog, startOfUtcDay } from '../models/MedicationLog.js';
import { DoseLog } from '../models/DoseLog.js';
import { isDoseLevelEnabled } from '../config/features.js';
import { aggregateUserDoseLogsAsDailyRollup } from '../services/adherenceLogBridge.js';
import { computeAdherenceStats } from '../services/adherenceService.js';
import { formatLog } from './logController.js';

const RECENT_LOG_LIMIT = 50;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

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

async function computePatientAnalytics(patientId) {
  const now = new Date();
  const window30Start = new Date(now.getTime() - 30 * MS_PER_DAY);
  const window7Start = new Date(now.getTime() - 7 * MS_PER_DAY);

  let taken = 0;
  let missed = 0;
  let missedLast7Days = 0;

  if (isDoseLevelEnabled()) {
    const [rows, missed7Count] = await Promise.all([
      DoseLog.aggregate([
        { $match: { userId: new mongoose.Types.ObjectId(patientId), datetime: { $gte: window30Start } } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      DoseLog.countDocuments({
        userId: patientId,
        status: 'missed',
        datetime: { $gte: window7Start },
      }),
    ]);
    for (const row of rows) {
      if (row._id === 'taken') taken = Number(row.count) || 0;
      if (row._id === 'missed') missed = Number(row.count) || 0;
    }
    missedLast7Days = missed7Count;
  } else {
    const [rows, missed7Count] = await Promise.all([
      MedicationLog.aggregate([
        {
          $match: {
            userId: new mongoose.Types.ObjectId(patientId),
            date: { $gte: startOfUtcDay(window30Start) },
          },
        },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      MedicationLog.countDocuments({
        userId: patientId,
        status: 'missed',
        date: { $gte: startOfUtcDay(window7Start) },
      }),
    ]);
    for (const row of rows) {
      if (row._id === 'taken') taken = Number(row.count) || 0;
      if (row._id === 'missed') missed = Number(row.count) || 0;
    }
    missedLast7Days = missed7Count;
  }

  const total = taken + missed;
  const adherence = total === 0 ? 100 : Math.round((taken / total) * 100);
  const riskLevel = adherence >= 90 ? 'Low' : adherence >= 70 ? 'Medium' : 'High';

  return { adherence, missedLast7Days, riskLevel };
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
        const analytics = await computePatientAnalytics(p._id.toString());
        return {
          ...patientRowFromAdherence(p, stats),
          analytics,
        };
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

/**
 * POST /api/doctor/link-patient — link patient account to logged-in doctor.
 * Body: { patientEmail, doctorId }
 */
export async function linkDoctorPatient(req, res) {
  try {
    const authDoctorId = req.user.id;
    const { patientEmail, doctorId } = req.body || {};
    const cleanEmail = String(patientEmail || '')
      .trim()
      .toLowerCase();

    if (!cleanEmail) {
      return res.status(400).json({ message: 'patientEmail is required' });
    }

    if (doctorId && String(doctorId) !== String(authDoctorId)) {
      return res.status(403).json({ message: 'doctorId does not match authenticated doctor' });
    }

    const patient = await User.findOne({
      email: cleanEmail,
      role: 'patient',
    });

    if (!patient) {
      return res.status(404).json({ message: 'Patient not found for this email' });
    }

    patient.linkedDoctorId = authDoctorId;
    await patient.save();

    return res.json({
      message: 'Patient linked successfully',
      patient: {
        id: patient._id,
        name: patient.name,
        email: patient.email,
        linkedDoctorId: patient.linkedDoctorId,
      },
    });
  } catch (err) {
    console.error('linkDoctorPatient error:', err);
    return res.status(500).json({ message: 'Server error while linking patient' });
  }
}

/**
 * DELETE /api/doctor/unlink-patient/:id — unlink a patient from the logged-in doctor.
 */
export async function unlinkDoctorPatient(req, res) {
  try {
    const doctorId = req.user.id;
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: 'Invalid patient id' });
    }

    const patient = await User.findOne({
      _id: id,
      linkedDoctorId: doctorId,
      role: 'patient',
    });

    if (!patient) {
      return res.status(404).json({ message: 'Linked patient not found' });
    }

    patient.linkedDoctorId = null;
    await patient.save();

    return res.json({ message: 'Patient unlinked successfully' });
  } catch (err) {
    console.error('unlinkDoctorPatient error:', err);
    return res.status(500).json({ message: 'Server error while unlinking patient' });
  }
}
