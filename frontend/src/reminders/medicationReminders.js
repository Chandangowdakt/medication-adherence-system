import { api } from '../api/client.js';
import { medId } from '../utils/medId.js';

const INTERVAL_MS = 60_000;
const DEFAULT_SNOOZE_MINUTES = 10;
const SOUND_THROTTLE_MS = 900;

/** @typedef {{ medId: string; name: string }} ReminderItem */
/** @typedef {{ items: ReminderItem[]; adaptiveHabitMessage?: string | null }} ReminderBannerPayload */

/** @type {((payload: ReminderBannerPayload | null) => void) | null} */
let bannerHandler = null;

const snoozeUntil = new Map();
/** medId -> UTC minute key — prevents duplicate OS notifications same minute */
const lastNotifiedMinuteKey = new Map();

let lastSoundAt = 0;

/**
 * React UI can register to show snooze/dismiss (Notification actions are unreliable without a SW).
 * @param {(payload: ReminderBannerPayload | null) => void} fn
 */
export function setReminderBannerHandler(fn) {
  bannerHandler = fn;
}

export function snoozeMedicationReminder(medId, minutes = DEFAULT_SNOOZE_MINUTES) {
  const id = String(medId);
  snoozeUntil.set(id, Date.now() + minutes * 60 * 1000);
}

export function snoozeMedicationReminders(medIds, minutes = DEFAULT_SNOOZE_MINUTES) {
  const until = Date.now() + minutes * 60 * 1000;
  for (const raw of medIds) {
    snoozeUntil.set(String(raw), until);
  }
}

export function isReminderSoundEnabled() {
  return localStorage.getItem('mat_reminder_sound') !== '0';
}

export function setReminderSoundEnabled(on) {
  if (on) localStorage.removeItem('mat_reminder_sound');
  else localStorage.setItem('mat_reminder_sound', '0');
}

/**
 * @returns {'granted'|'denied'|'default'|'unsupported'}
 */
export function getNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

/**
 * Request browser notification permission (call from a user gesture for best results).
 * @returns {Promise<'granted'|'denied'|'default'|'unsupported'>}
 */
export async function requestReminderNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported';
  const result = await Notification.requestPermission();
  return result;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * Normalize schedule slot to HH:mm (24h UTC comparison).
 */
function normalizeSlot(t) {
  const s = String(t).trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** Matches backend evening bucket (UTC): 17:00–23:59. */
function isEveningSlotHm(utcHm) {
  const m = /^(\d{2}):(\d{2})$/.exec(utcHm);
  if (!m) return false;
  const h = Number(m[1]);
  return h >= 17;
}

/** Same wrap logic as server adaptiveReminderService. */
function subtractMinutesFromHHmm(hhmm, deltaM) {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  let t = Number(m[1]) * 60 + Number(m[2]) - deltaM;
  t = ((t % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(t / 60);
  const min = t % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** Current time as HH:mm in UTC. */
function currentUtcHHmm() {
  const now = new Date();
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mm = String(now.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** UTC minute bucket for de-duplication */
function currentUtcMinuteKey() {
  const n = new Date();
  return `${n.getUTCFullYear()}-${pad2(n.getUTCMonth() + 1)}-${pad2(n.getUTCDate())}T${pad2(n.getUTCHours())}:${pad2(n.getUTCMinutes())}`;
}

function hasLogToday(todayLogs, medicationId) {
  return todayLogs.some((l) => String(l.medicationId) === String(medicationId));
}

function isSnoozed(medicationId) {
  const until = snoozeUntil.get(String(medicationId));
  return typeof until === 'number' && until > Date.now();
}

function playReminderSoundOnce() {
  if (!isReminderSoundEnabled()) return;
  const now = Date.now();
  if (now - lastSoundAt < SOUND_THROTTLE_MS) return;
  lastSoundAt = now;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = 880;
    o.connect(g);
    g.connect(ctx.destination);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.07, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
    o.start(ctx.currentTime);
    o.stop(ctx.currentTime + 0.2);
    o.onended = () => ctx.close().catch(() => {});
  } catch {
    /* ignore */
  }
}

function showBrowserNotification(name, medId, minuteKey) {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  const title = 'Medication reminder';
  const body = `Time to take your medicine: ${name}`;
  const tag = `mat-${medId}-${minuteKey.replace(/[^0-9T:-]/g, '')}`;

  try {
    const n = new Notification(title, {
      body,
      tag,
      silent: false,
      icon: '/favicon.svg',
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* ignore */
  }
}

/**
 * One tick: match schedule to current UTC HH:mm; notify if no log today, not snoozed, not dup this minute.
 */
async function runReminderTick() {
  try {
    const nowMs = Date.now();
    for (const k of [...snoozeUntil.keys()]) {
      if ((snoozeUntil.get(k) ?? 0) <= nowMs) snoozeUntil.delete(k);
    }

    const utcHm = currentUtcHHmm();
    const minuteKey = currentUtcMinuteKey();
    const { data } = await api.get('/api/dashboard/summary');
    const medications = data.medications ?? [];
    const todayLogs = data.todayLogs ?? [];
    const ar = data.adaptiveReminder;
    const earlyM =
      ar?.active && Number(ar.eveningEarlyMinutes) > 0 ? Number(ar.eveningEarlyMinutes) : 0;

    /** @type {ReminderItem[]} */
    const due = [];
    let anyAdaptiveThisTick = false;

    for (const med of medications) {
      const slots = Array.isArray(med.schedule) ? med.schedule : [];
      let matched = false;
      for (const s of slots) {
        const norm = normalizeSlot(s);
        if (!norm) continue;
        const evening = isEveningSlotHm(norm);
        const fireAt =
          earlyM > 0 && evening ? subtractMinutesFromHHmm(norm, earlyM) : norm;
        if (!fireAt || fireAt !== utcHm) continue;
        matched = true;
        if (earlyM > 0 && evening && utcHm !== norm) {
          anyAdaptiveThisTick = true;
        }
        break;
      }
      if (!matched) continue;

      const id = medId(med);
      if (!id) continue;
      if (hasLogToday(todayLogs, id)) continue;
      if (isSnoozed(id)) continue;

      if (lastNotifiedMinuteKey.get(id) === minuteKey) continue;
      lastNotifiedMinuteKey.set(id, minuteKey);

      due.push({ medId: id, name: med.name || 'Medication' });
    }

    if (due.length === 0) {
      bannerHandler?.(null);
      return;
    }

    for (const { medId: id, name } of due) {
      showBrowserNotification(name, id, minuteKey);
    }

    playReminderSoundOnce();

    const adaptiveHabitMessage =
      anyAdaptiveThisTick && ar?.message ? ar.message : null;

    bannerHandler?.({ items: due, adaptiveHabitMessage });
  } catch {
    // Offline or expired session — avoid noisy errors
  }
}

/**
 * Starts 60s polling (plus one immediate run). Returns cleanup.
 */
export function startMedicationReminderScheduler() {
  runReminderTick();
  const handle = setInterval(runReminderTick, INTERVAL_MS);
  return () => {
    clearInterval(handle);
  };
}
