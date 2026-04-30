import { useEffect, useState } from 'react';
import {
  setReminderBannerHandler,
  snoozeMedicationReminder,
  snoozeMedicationReminders,
} from '../reminders/medicationReminders.js';

const SNOOZE_MIN = 10;

/**
 * In-app strip for snooze/dismiss; complements OS notifications (action buttons need a service worker).
 */
export function ReminderBanner() {
  const [payload, setPayload] = useState(null);
  const [soundOn, setSoundOn] = useState(() => localStorage.getItem('mat_reminder_sound') !== '0');

  useEffect(() => {
    setReminderBannerHandler(setPayload);
    return () => setReminderBannerHandler(null);
  }, []);

  if (!payload?.items?.length) return null;

  const ids = payload.items.map((i) => i.medId);
  const habitMsg = payload.adaptiveHabitMessage;

  function handleSnoozeAll() {
    snoozeMedicationReminders(ids, SNOOZE_MIN);
    setPayload(null);
  }

  function handleDismiss() {
    setPayload(null);
  }

  function handleSnoozeOne(medId) {
    snoozeMedicationReminder(medId, SNOOZE_MIN);
    setPayload((prev) => {
      if (!prev?.items) return null;
      const next = prev.items.filter((i) => i.medId !== medId);
      if (!next.length) return null;
      return {
        items: next,
        adaptiveHabitMessage: prev.adaptiveHabitMessage,
      };
    });
  }

  function toggleSound() {
    const next = !soundOn;
    setSoundOn(next);
    if (next) localStorage.removeItem('mat_reminder_sound');
    else localStorage.setItem('mat_reminder_sound', '0');
  }

  return (
    <div className="reminder-banner" role="status" aria-live="polite">
      <div className="reminder-banner-main">
        <div className="reminder-banner-text">
          <strong>Medication reminder</strong>
          {habitMsg ? (
            <p className="reminder-banner-habit muted small">{habitMsg}</p>
          ) : null}
          <ul className="reminder-banner-list">
            {payload.items.map((i) => (
              <li key={i.medId}>
                Time to take your medicine: <strong>{i.name}</strong>
                <button
                  type="button"
                  className="btn ghost btn-sm reminder-snooze-one"
                  onClick={() => handleSnoozeOne(i.medId)}
                >
                  Snooze {SNOOZE_MIN}m
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="reminder-banner-actions">
          <label className="reminder-sound-toggle">
            <input type="checkbox" checked={soundOn} onChange={toggleSound} />
            Sound
          </label>
          <button type="button" className="btn ghost btn-sm" onClick={handleSnoozeAll}>
            Snooze all {SNOOZE_MIN}m
          </button>
          <button type="button" className="btn primary btn-sm" onClick={handleDismiss}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
