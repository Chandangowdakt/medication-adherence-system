import { Medication } from '../models/Medication.js';
import { MedicationLog } from '../models/MedicationLog.js';
import { DoseLog } from '../models/DoseLog.js';
import { isDoseLevelEnabled } from '../config/features.js';
import { aggregateUserDoseLogsAsDailyRollup } from '../services/adherenceLogBridge.js';
import { computeAdherenceStats } from '../services/adherenceService.js';
import { formatLog } from './logController.js';

const RECENT_LOG_LIMIT = 50;

function csvEscape(value) {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function formatLogDateUtc(d) {
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  return x.toISOString().slice(0, 10);
}

function formatLogDateTimeUtc(d) {
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  return x.toISOString();
}

/**
 * GET /api/reports/export-csv — all adherence logs for the user (date, medication, status).
 */
export async function exportLogsCsv(req, res) {
  try {
    const userId = req.user.id;

    let header;
    let rows;

    if (isDoseLevelEnabled()) {
      const logs = await DoseLog.find({ userId })
        .populate('medicationId', 'name')
        .sort({ datetime: 1, medicationId: 1 })
        .lean();

      header = ['datetime_utc', 'medication', 'status'].map(csvEscape).join(',');
      rows = logs.map((log) => {
        const medName =
          log.medicationId && typeof log.medicationId === 'object' && log.medicationId.name
            ? log.medicationId.name
            : 'Unknown';
        return [
          csvEscape(formatLogDateTimeUtc(log.datetime)),
          csvEscape(medName),
          csvEscape(log.status),
        ].join(',');
      });
    } else {
      const logs = await MedicationLog.find({ userId })
        .populate('medicationId', 'name')
        .sort({ date: 1, medicationId: 1 })
        .lean();

      header = ['date', 'medication', 'status'].map(csvEscape).join(',');
      rows = logs.map((log) => {
        const medName =
          log.medicationId && typeof log.medicationId === 'object' && log.medicationId.name
            ? log.medicationId.name
            : 'Unknown';
        return [
          csvEscape(formatLogDateUtc(log.date)),
          csvEscape(medName),
          csvEscape(log.status),
        ].join(',');
      });
    }

    const csv = [header, ...rows].join('\r\n');
    const bom = '\uFEFF';

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="adherence-logs.csv"');
    return res.send(bom + csv);
  } catch (err) {
    console.error('exportLogsCsv error:', err);
    return res.status(500).json({ message: 'Server error while exporting CSV' });
  }
}

/**
 * GET /api/reports/adherence — bundled snapshot for exports (user, stats, meds, recent logs).
 */
export async function getAdherenceReport(req, res) {
  try {
    const stats = await computeAdherenceStats(req.user.id, req.query);
    if (stats.error) {
      return res.status(400).json({ message: stats.error });
    }

    const userId = req.user.id;
    const u = req.userDoc;

    const userInfo = {
      id: u._id,
      name: u.name,
      email: u.email,
      role: u.role,
    };

    const [medications, logDocs] = await Promise.all([
      Medication.find({ userId }).sort({ createdAt: -1 }).lean(),
      isDoseLevelEnabled()
        ? aggregateUserDoseLogsAsDailyRollup(userId, { limit: RECENT_LOG_LIMIT })
        : MedicationLog.find({ userId })
            .populate('medicationId', 'name dosage')
            .sort({ date: -1 })
            .limit(RECENT_LOG_LIMIT)
            .lean(),
    ]);

    const recentLogs = logDocs.map((row) => formatLog(row));

    return res.json({
      generatedAt: new Date().toISOString(),
      user: userInfo,
      adherence: stats,
      medications,
      recentLogs,
    });
  } catch (err) {
    console.error('getAdherenceReport error:', err);
    return res.status(500).json({ message: 'Server error while building report' });
  }
}
