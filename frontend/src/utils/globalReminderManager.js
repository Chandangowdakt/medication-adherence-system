import { api } from '../api/client.js';

const MED_STORAGE_KEY = 'medications';
const DAY_MS = 24 * 60 * 60 * 1000;
let activeTimers = [];
const scheduledKeys = new Set();

/** @type {Map<string, number>} */
const timerIdsBySlot = new Map();
/** @type {Set<(count: number) => void>} */
const listeners = new Set();

function parseScheduleString(schedule) {
  if (!schedule || typeof schedule !== 'string') return [];
  return schedule
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

function normalizeTime(raw) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(raw).trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    return null;
  }
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function timesFromMedication(med) {
  if (!med) return [];
  if (Array.isArray(med.schedule)) {
    return med.schedule.map(normalizeTime).filter(Boolean);
  }
  return parseScheduleString(med.schedule).map(normalizeTime).filter(Boolean);
}

function emitCount() {
  const count = timerIdsBySlot.size;
  listeners.forEach((fn) => fn(count));
}

export function getScheduledReminderCount() {
  return timerIdsBySlot.size;
}

export function subscribeReminderCount(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  listener(getScheduledReminderCount());
  return () => {
    listeners.delete(listener);
  };
}

export function clearMedicationReminderTimers() {
  activeTimers.forEach((timer) => clearTimeout(timer));
  activeTimers = [];
  timerIdsBySlot.clear();
  scheduledKeys.clear();
  emitCount();
}

function scheduleTime(reminderKey, time, sendNotification) {
  if (scheduledKeys.has(reminderKey)) return;
  const key = normalizeTime(time);
  if (!key) return;

  const [h, m] = key.split(':').map(Number);
  const now = new Date();
  const target = new Date();
  target.setHours(h, m, 0, 0);

  let delay = target.getTime() - now.getTime();
  if (delay < 0) delay += DAY_MS;

  const timeoutId = window.setTimeout(() => {
    console.log('💊 Medication Reminder Triggered:', key);
    timerIdsBySlot.delete(reminderKey);
    scheduledKeys.delete(reminderKey);
    activeTimers = [...timerIdsBySlot.values()];
    try {
      sendNotification?.();
    } catch (err) {
      console.error('Medication reminder notification failed:', err);
    }
    scheduleTime(reminderKey, key, sendNotification); // repeat daily
  }, delay);

  timerIdsBySlot.set(reminderKey, timeoutId);
  scheduledKeys.add(reminderKey);
  activeTimers = [...timerIdsBySlot.values()];
}

function readMedicationCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(MED_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function fetchMedicationsFromApi() {
  try {
    const { data } = await api.get('/medications');
    return Array.isArray(data?.medications) ? data.medications : [];
  } catch {
    return [];
  }
}

export async function scheduleAllMedicationReminders(sendNotification, sourceMedications) {
  clearMedicationReminderTimers();

  let meds = Array.isArray(sourceMedications) ? sourceMedications : readMedicationCache();
  if (meds.length === 0) {
    meds = await fetchMedicationsFromApi();
  }

  meds.forEach((med, idx) => {
    const medicationId = String(
      med?._id ?? med?.id ?? med?.medicationId ?? med?.name ?? `med-${idx}`
    );
    timesFromMedication(med).forEach((time) => {
      const reminderKey = `${medicationId}_${time}`;
      scheduleTime(reminderKey, time, sendNotification);
    });
  });

  emitCount();
}
