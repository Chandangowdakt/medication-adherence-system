import cron from 'node-cron';
import { addHours, addMinutes } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { Medication } from '../models/Medication.js';
import { startOfUtcDay } from '../models/MedicationLog.js';
import { User } from '../models/User.js';
import { hasLoggedMedicationForUserLocalDay } from './adherenceLogBridge.js';
import { PushDedupe } from '../models/PushDedupe.js';
import { isFcmConfigured } from '../config/firebaseAdmin.js';
import { sendFcmToTokens, pruneInvalidPushTokens } from './fcmSendService.js';
import {
  getAdaptiveReminderStateForUser,
  subtractMinutesFromHHmm,
  isEveningSlotHm,
} from './adaptiveReminderService.js';
import {
  getLocalTimeHm,
  getLocalDateKey,
  getLocalDayBoundsUtc,
  normalizeIanaTimeZone,
} from '../utils/userTimezone.js';

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

function isMedicationActiveOnLocalDay(med, localDayStartUtc, localDayEndUtc) {
  const t0 = localDayStartUtc.getTime();
  const t1 = localDayEndUtc.getTime();
  const start = med.startDate ? startOfUtcDay(med.startDate)?.getTime() : null;
  const end = med.endDate ? startOfUtcDay(med.endDate)?.getTime() : null;
  if (start != null && t1 - 1 < start) return false;
  if (end != null && t0 > end) return false;
  return true;
}

/**
 * At each clock minute: reminder push if local schedule (per-user time zone) matches and no log for that local day yet.
 */
export async function runReminderPushTick() {
  if (!isFcmConfigured()) return;

  if (process.env.FCM_LOG_CRON_TICK === 'true' || process.env.FCM_LOG_TICKS === 'true') {
    console.log('[FCM] Cron tick running (reminder)', new Date().toISOString());
  }

  const now = new Date();
  const users = await User.find({
    role: 'patient',
    'pushTokens.0': { $exists: true },
    'notificationPreferences.remindersEnabled': { $ne: false },
  })
    .select('pushTokens timeZone')
    .lean();

  for (const u of users) {
    const userId = u._id;
    const tokens = (u.pushTokens || []).map((p) => p.token).filter(Boolean);
    if (!tokens.length) continue;

    const tz = normalizeIanaTimeZone(u.timeZone || 'UTC');
    const localHm = getLocalTimeHm(tz, now);
    if (!localHm) continue;
    const { start: dayStart, end: dayEnd } = getLocalDayBoundsUtc(tz, now);
    const dateKey = getLocalDateKey(tz, now);

    const adaptive = await getAdaptiveReminderStateForUser(String(userId));
    const earlyM = adaptive.active ? adaptive.eveningEarlyMinutes : 0;

    const medications = await Medication.find({ userId }).lean();

    for (const med of medications) {
      if (!isMedicationActiveOnLocalDay(med, dayStart, dayEnd)) continue;
      const slots = Array.isArray(med.schedule) ? med.schedule : [];

      let canonicalSlotHm = null;
      let usedAdaptive = false;
      for (const s of slots) {
        const norm = normalizeSlotToHHmm(s);
        if (!norm) continue;
        const evening = isEveningSlotHm(norm);
        const fireAt =
          earlyM > 0 && evening ? subtractMinutesFromHHmm(norm, earlyM) : norm;
        if (!fireAt || fireAt !== localHm) continue;
        canonicalSlotHm = norm;
        usedAdaptive = earlyM > 0 && evening && localHm !== norm;
        break;
      }

      if (!canonicalSlotHm) continue;
      if (await hasLoggedMedicationForUserLocalDay(userId, med._id, tz)) continue;

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
 * Every 10 minutes: if 45+ real minutes past a scheduled local slot today and still no log, send missed alert.
 */
export async function runMissedPushTick() {
  if (!isFcmConfigured()) return;

  if (process.env.FCM_LOG_CRON_TICK === 'true' || process.env.FCM_LOG_TICKS === 'true') {
    console.log('[FCM] Cron tick running (missed-dose check)', new Date().toISOString());
  }

  const now = new Date();
  const users = await User.find({
    role: 'patient',
    'pushTokens.0': { $exists: true },
    'notificationPreferences.missedAlertsEnabled': { $ne: false },
  })
    .select('pushTokens timeZone')
    .lean();

  for (const u of users) {
    const userId = u._id;
    const tokens = (u.pushTokens || []).map((p) => p.token).filter(Boolean);
    if (!tokens.length) continue;

    const tz = normalizeIanaTimeZone(u.timeZone || 'UTC');
    const { start: dayStart, end: dayEnd } = getLocalDayBoundsUtc(tz, now);
    const dateKey = getLocalDateKey(tz, now);
    const zMidnight = toZonedTime(dayStart, tz);
    const medications = await Medication.find({ userId }).lean();

    for (const med of medications) {
      if (!isMedicationActiveOnLocalDay(med, dayStart, dayEnd)) continue;
      const slots = Array.isArray(med.schedule) ? med.schedule : [];

      for (const slotRaw of slots) {
        const parts = parseSlotParts(slotRaw);
        if (!parts) continue;
        const { h, min } = parts;
        const atLocalSlot = addMinutes(addHours(zMidnight, h), min);
        const slotTimeUtc = fromZonedTime(atLocalSlot, tz);
        const deadline = new Date(slotTimeUtc.getTime() + MISSED_GRACE_MS);
        if (now.getTime() < deadline.getTime()) continue;

        if (await hasLoggedMedicationForUserLocalDay(userId, med._id, tz)) continue;

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
          `No dose log for ${med.name} after your scheduled time today (local time: ${tz}).`,
          { type: 'missed', medicationId: String(med._id) }
        );
        await pruneInvalidPushTokens(userId, invalidTokens);
      }
    }
  }
}

let reminderJob = null;
let missedJob = null;

/** @returns {boolean} true when reminder/missed crons are scheduled */
export function isPushCronScheduled() {
  return reminderJob != null && missedJob != null;
}

export function startPushNotificationCron() {
  if (!isFcmConfigured()) {
    console.warn(
      '[FCM] No Firebase Admin credentials (FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON). ' +
        'Push cron is disabled; no server-initiated FCM messages will be sent. The API /register-token can still run but sends will be skipped.'
    );
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

  console.log(
    '[FCM] Cron: reminder every minute, missed every 10 min. Schedule times use each user’s time zone (user.timeZone, default UTC).'
  );

  return () => {
    reminderJob?.stop();
    missedJob?.stop();
    reminderJob = null;
    missedJob = null;
  };
}
