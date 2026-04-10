import { Medication } from '../models/Medication.js';
import { MedicationLog, startOfUtcDay } from '../models/MedicationLog.js';
import { isDoseLevelEnabled } from '../config/features.js';
import { aggregateUserDoseLogsAsDailyRollup } from '../services/adherenceLogBridge.js';
import { computeAdherenceStats } from '../services/adherenceService.js';
import {
  getAdaptiveReminderStateForUser,
  adaptiveReminderClientPayload,
} from '../services/adaptiveReminderService.js';
import { formatLog } from './logController.js';

/**
 * GET /api/dashboard/summary — adherence stats, medications, todayLogs (UTC day).
 * Parallel Promise.all; `user` included so the client needs one request for the full dashboard.
 */
export async function getDashboardSummary(req, res) {
  try {
    const userId = req.user.id;
    const u = req.userDoc;

    const today = startOfUtcDay(new Date());
    if (!today) {
      return res.status(500).json({ message: 'Invalid server date' });
    }

    const [adherenceResult, medications, todayLogDocs, adaptiveState] = await Promise.all([
      computeAdherenceStats(userId, req.query),
      Medication.find({ userId }).sort({ createdAt: -1 }).lean(),
      isDoseLevelEnabled()
        ? aggregateUserDoseLogsAsDailyRollup(userId, { dayStart: today })
        : MedicationLog.find({ userId, date: today })
            .populate('medicationId', 'name dosage')
            .lean(),
      getAdaptiveReminderStateForUser(userId),
    ]);

    if (adherenceResult.error) {
      return res.status(400).json({ message: adherenceResult.error });
    }

    const todayLogs = todayLogDocs.map((row) => formatLog(row));

    return res.json({
      user: {
        id: u._id,
        name: u.name,
        email: u.email,
        role: u.role,
      },
      adherence: adherenceResult,
      medications,
      todayLogs,
      adaptiveReminder: adaptiveReminderClientPayload(adaptiveState),
    });
  } catch (err) {
    console.error('getDashboardSummary error:', err);
    return res.status(500).json({ message: 'Server error while loading dashboard summary' });
  }
}
