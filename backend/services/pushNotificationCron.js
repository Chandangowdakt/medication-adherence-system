import cron from 'node-cron';
import { Medication } from '../models/Medication.js';
import { startOfUtcDay } from '../models/MedicationLog.js';
import { User } from '../models/User.js';
import { hasLoggedMedicationDay } from './adherenceLogBridge.js';
import { PushDedupe } from '../models/PushDedupe.js';
import { isFcmConfigured } from '../config/firebaseAdmin.js';
import { sendFcmToTokens, pruneInvalidPushTokens } from './fcmSendService.js';
import {
  getAdaptiveReminderStateForUser,
  subtractMinutesFromHHmm,
  isEveningSlotHm,
} from './adaptiveReminderService.js';

const MISSED_GRACE_MS = 45 * 60 * 1000;

function normalizeSlotToHHmm(t) {
  const s = String(t).trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function parseSlotParts(t) {
  const s = String(t).trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return { h, min };
}

function currentUtcHHmm() {
  const now = new Date();
  return `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;
}

function isMedicationActiveOnDay(med, refDayStart) {
  const t = refDayStart.getTime();
  const start = med.startDate ? startOfUtcDay(med.startDate)?.getTime() : null;
  const end = med.endDate ? startOfUtcDay(med.endDate)?.getTime() : null;
  if (start != null && t < start) return false;
  if (end != null && t > end) return false;
  return true;
}

async function hasLogToday(userId, medicationId, dayUtc) {
  return hasLoggedMedicationDay(userId, medicationId, dayUtc);
}

/**
 * At each UTC minute: reminder push if schedule matches and no daily log yet.
 */
export async function runReminderPushTick() {
  if (!isFcmConfigured()) return;

  const today = startOfUtcDay(new Date());
  if (!today) return;
  const utcHm = currentUtcHHmm();
  const dateKey = today.toISOString().slice(0, 10);

  const users = await User.find({
    role: 'patient',
    'pushTokens.0': { $exists: true },
    'notificationPreferences.remindersEnabled': { $ne: false },
  })
    .select('pushTokens')
    .lean();

  for (const u of users) {
    const userId = u._id;
    const tokens = (u.pushTokens || []).map((p) => p.token).filter(Boolean);
    if (!tokens.length) continue;

    const adaptive = await getAdaptiveReminderStateForUser(String(userId));
    const earlyM = adaptive.active ? adaptive.eveningEarlyMinutes : 0;

    const medications = await Medication.find({ userId }).lean();

    for (const med of medications) {
      if (!isMedicationActiveOnDay(med, today)) continue;
      const slots = Array.isArray(med.schedule) ? med.schedule : [];

      let canonicalSlotHm = null;
      let usedAdaptive = false;
      for (const s of slots) {
        const norm = normalizeSlotToHHmm(s);
        if (!norm) continue;
        const evening = isEveningSlotHm(norm);
        const fireAt =
          earlyM > 0 && evening ? subtractMinutesFromHHmm(norm, earlyM) : norm;
        if (!fireAt || fireAt !== utcHm) continue;
        canonicalSlotHm = norm;
        usedAdaptive = earlyM > 0 && evening && utcHm !== norm;
        break;
      }

      if (!canonicalSlotHm) continue;
      if (await hasLogToday(userId, med._id, today)) continue;

      try {
        await PushDedupe.create({
          userId,
          medicationId: med._id,
          utcDateKey: dateKey,
          slotHm: canonicalSlotHm,
          kind: 'reminder',
        });
      } catch (e) {
        if (e.code === 11000) continue;
        throw e;
      }

      const body = usedAdaptive
        ? `Time to take your medicine: ${med.name} (reminder a few minutes early based on your usual pattern).`
        : `Time to take your medicine: ${med.name}`;

      const { invalidTokens } = await sendFcmToTokens(
        tokens,
        'Medication reminder',
        body,
        { type: 'reminder', medicationId: String(med._id), adaptiveEarlier: usedAdaptive }
      );
      await pruneInvalidPushTokens(userId, invalidTokens);
    }
  }
}

/**
 * Every 10 minutes: if 45+ minutes past a scheduled slot today and still no log, send missed alert.
 */
export async function runMissedPushTick() {
  if (!isFcmConfigured()) return;

  const now = new Date();
  const today = startOfUtcDay(now);
  if (!today) return;
  const dateKey = today.toISOString().slice(0, 10);
  const y = today.getUTCFullYear();
  const mo = today.getUTCMonth();
  const d = today.getUTCDate();

  const users = await User.find({
    role: 'patient',
    'pushTokens.0': { $exists: true },
    'notificationPreferences.missedAlertsEnabled': { $ne: false },
  })
    .select('pushTokens')
    .lean();

  for (const u of users) {
    const userId = u._id;
    const tokens = (u.pushTokens || []).map((p) => p.token).filter(Boolean);
    if (!tokens.length) continue;

    const medications = await Medication.find({ userId }).lean();

    for (const med of medications) {
      if (!isMedicationActiveOnDay(med, today)) continue;
      const slots = Array.isArray(med.schedule) ? med.schedule : [];

      for (const slotRaw of slots) {
        const parts = parseSlotParts(slotRaw);
        if (!parts) continue;
        const { h, min } = parts;
        const slotTime = new Date(Date.UTC(y, mo, d, h, min, 0));
        const deadline = new Date(slotTime.getTime() + MISSED_GRACE_MS);
        if (now.getTime() < deadline.getTime()) continue;

        if (await hasLogToday(userId, med._id, today)) continue;

        const slotHm = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;

        try {
          await PushDedupe.create({
            userId,
            medicationId: med._id,
            utcDateKey: dateKey,
            slotHm,
            kind: 'missed',
          });
        } catch (e) {
          if (e.code === 11000) continue;
          throw e;
        }

        const { invalidTokens } = await sendFcmToTokens(
          tokens,
          'Missed dose alert',
          `No dose log for ${med.name} after your scheduled time today (UTC).`,
          { type: 'missed', medicationId: String(med._id) }
        );
        await pruneInvalidPushTokens(userId, invalidTokens);
      }
    }
  }
}

let reminderJob = null;
let missedJob = null;

export function startPushNotificationCron() {
  if (!isFcmConfigured()) {
    return () => {};
  }

  if (reminderJob != null) {
    return () => {
      reminderJob?.stop();
      missedJob?.stop();
      reminderJob = null;
      missedJob = null;
    };
  }

  reminderJob = cron.schedule('* * * * *', () => {
    runReminderPushTick().catch((err) => console.error('[FCM] reminder tick:', err.message));
  });

  missedJob = cron.schedule('*/10 * * * *', () => {
    runMissedPushTick().catch((err) => console.error('[FCM] missed tick:', err.message));
  });

  console.log('[FCM] Cron: reminder every minute, missed alerts every 10 minutes (UTC).');

  return () => {
    reminderJob?.stop();
    missedJob?.stop();
    reminderJob = null;
    missedJob = null;
  };
}
