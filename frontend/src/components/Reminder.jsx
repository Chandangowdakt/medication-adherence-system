import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import {
  getScheduledReminderCount,
  scheduleAllMedicationReminders,
  subscribeReminderCount,
} from "../utils/globalReminderManager.js";
import { sendMedicationNotification } from "../utils/notificationSender.js";

const STORAGE_KEY = "medicine_reminder_time";
const REMINDER_ID = 1;

function getNextTriggerDate(time) {
  if (!time) return null;
  const [h, m] = time.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return null;

  const now = new Date();
  const target = new Date();
  target.setHours(h, m, 0, 0);

  if (target <= now) target.setDate(target.getDate() + 1);
  return target;
}

function formatTimeLeft(time) {
  const target = getNextTriggerDate(time);
  if (!target) return "";

  const diff = target.getTime() - Date.now();
  const mins = Math.max(0, Math.floor(diff / 60000));

  const h = Math.floor(mins / 60);
  const m = mins % 60;

  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function sendNotification() {
  console.log("🔥 sendNotification CALLED");

  const title = "💊 Medicine Reminder";
  const body = "Time to take your medicine!";

  // ANDROID (Capacitor)
  if (window.Capacitor?.isNativePlatform?.()) {
    try {
      LocalNotifications.schedule({
        notifications: [
          {
            id: Date.now(),
            title,
            body,
            schedule: { at: new Date(Date.now() + 100) },
            sound: "alert.mp3",
            vibration: true,
          },
        ],
      });
    } catch (e) {
      console.error("Notification error:", e);
    }
    return;
  }

  // WEB (Browser)
  if ("Notification" in window) {
    const playAlertEffects = () => {
      try {
        const audio = new Audio("/alert.mp3");
        audio.play().catch(() => {});
      } catch {}
      navigator.vibrate?.([300, 200, 300]);
    };

    if (Notification.permission === "granted") {
      new Notification(title, {
        body,
        icon: "/favicon.svg",
      });

      playAlertEffects();
      alert(body);
    } else if (Notification.permission !== "denied") {
      Notification.requestPermission().then((permission) => {
        if (permission === "granted") {
          new Notification(title, { body, icon: "/favicon.svg" });
          playAlertEffects();
          alert(body);
        } else {
          playAlertEffects();
          alert("Time to take your medicine!");
        }
      });
    } else {
      playAlertEffects();
      alert("Time to take your medicine!");
    }
  } else {
    navigator.vibrate?.([300, 200, 300]);
    alert("Time to take your medicine!");
  }
}

export function Reminder() {
  const [time, setTime] = useState("");
  const [savedTime, setSavedTime] = useState("");
  const [timeLeft, setTimeLeft] = useState("");
  const [nextTriggerAt, setNextTriggerAt] = useState("");
  const [status, setStatus] = useState("");
  const [isScheduling, setIsScheduling] = useState(false);
  const [scheduledCount, setScheduledCount] = useState(() => getScheduledReminderCount());

  const timerRef = useRef(null);
  const intervalRef = useRef(null);
  const restoredRef = useRef(false);

  async function clearReminder() {
    clearTimeout(timerRef.current);
    timerRef.current = null;
    localStorage.removeItem(STORAGE_KEY);

    if (Capacitor.isNativePlatform()) {
      await LocalNotifications.cancel({ notifications: [{ id: REMINDER_ID }] });
    }
  }

  // 🔐 Permission + Load
  useEffect(() => {
    async function init() {
      if (Capacitor.isNativePlatform()) {
        try {
          const perm = await LocalNotifications.requestPermissions();
          setStatus(
            perm.display === "granted"
              ? "🔔 Notifications enabled"
              : "❌ Permission denied"
          );
        } catch {
          setStatus("❌ Permission denied");
        }
      } else {
        if (typeof window !== "undefined" && "Notification" in window) {
          const perm = await Notification.requestPermission();
          setStatus(
            perm === "granted"
              ? "🔔 Notifications enabled"
              : "❌ Permission denied"
          );
        } else {
          setStatus("❌ Permission denied");
        }
      }

      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && !restoredRef.current) {
        restoredRef.current = true;
        setTime(saved);
        setSavedTime(saved);
        await scheduleReminder(saved);
      }
    }

    init();

    return () => {
      clearTimeout(timerRef.current);
      clearInterval(intervalRef.current);
    };
  }, []);

  useEffect(() => {
    if ("Notification" in window && Notification.permission !== "granted") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  useEffect(() => {
    return subscribeReminderCount(setScheduledCount);
  }, []);

  // ⏱ Countdown
  useEffect(() => {
    if (!savedTime) return;

    setTimeLeft(formatTimeLeft(savedTime));
    intervalRef.current = setInterval(() => {
      setTimeLeft(formatTimeLeft(savedTime));
    }, 60000);

    return () => clearInterval(intervalRef.current);
  }, [savedTime]);

  // 🔁 MAIN SCHEDULER
  async function scheduleReminder(time) {
    const [h, m] = time.split(":").map(Number);
    if (isNaN(h) || isNaN(m)) return;
    let triggerDate = new Date();
    triggerDate.setHours(h, m, 0, 0);
    if (triggerDate <= new Date()) {
      triggerDate.setDate(triggerDate.getDate() + 1);
    }
    const formattedTrigger = triggerDate.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
    setNextTriggerAt(formattedTrigger);

    // 📱 Android
    if (Capacitor.isNativePlatform()) {
      await LocalNotifications.cancel({ notifications: [{ id: REMINDER_ID }] });

      await LocalNotifications.schedule({
        notifications: [
          {
            id: REMINDER_ID,
            title: "💊 Medicine Reminder",
            body: "Time to take your medicine!",
            schedule: {
              on: { hour: h, minute: m },
              repeats: true,
            },
            sound: "alert.mp3",
          },
        ],
      });
    }

    // 🌐 Browser
    else {
      console.log("Trigger:", triggerDate);

      let delay = triggerDate.getTime() - Date.now();
      if (delay < 0) delay += 24 * 60 * 60 * 1000;
      console.log("Delay:", delay);

      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      timerRef.current = setTimeout(() => {
        console.log("⏰ Reminder triggered");
        sendNotification();
        scheduleReminder(time); // reschedule next day
      }, delay);
    }
  }

  // ✅ Set
  async function handleSet() {
    if (!time) return alert("Select time");
    setIsScheduling(true);
    try {
      localStorage.setItem(STORAGE_KEY, time);
      setSavedTime(time);
      await scheduleReminder(time);
    } finally {
      setIsScheduling(false);
    }
  }

  // ❌ Clear
  async function handleClear() {
    await clearReminder();

    setTime("");
    setSavedTime("");
    setTimeLeft("");
    setNextTriggerAt("");
  }

  const permissionHint = status.includes("Permission denied")
    ? "❌ Notifications blocked. Enable in browser settings."
    : status.includes("Notifications enabled")
      ? "✅ Notifications enabled"
      : status;

  return (
    <div className="card page-card reminder-card">
      <h2>Medicine Reminder</h2>
      <p className="muted small compact-bottom">Reminder Engine Active</p>
      <p className="reminder-status-badge" role="status">
        Scheduled: {scheduledCount} reminders
      </p>
      <p className="muted small compact-bottom">Next scheduled triggers: {scheduledCount}</p>

      <input
        className="reminder-time-input"
        type="time"
        value={time}
        onChange={(e) => setTime(e.target.value)}
      />

      <p>
        {savedTime
          ? `💊 Reminder set for ${savedTime}`
          : "No reminder set"}
      </p>

      {savedTime && <p>Next dose in: {timeLeft}</p>}
      {savedTime && nextTriggerAt && <p>Next trigger at: {nextTriggerAt}</p>}

      <div className="reminder-actions">
        <button className="btn primary btn-sm" onClick={handleSet} disabled={!time || isScheduling}>
          {isScheduling ? "Setting..." : "Set Reminder"}
        </button>
        <button className="btn ghost btn-sm" onClick={handleClear} disabled={!savedTime || isScheduling}>
          Clear
        </button>
        <button className="btn secondary btn-sm" onClick={() => sendNotification()} disabled={isScheduling}>
          Test Notification
        </button>
        <button
          className="btn ghost btn-sm"
          onClick={() => scheduleAllMedicationReminders(sendMedicationNotification)}
          disabled={isScheduling}
        >
          Test all reminders now
        </button>
      </div>

      <p className="muted compact-top">{permissionHint}</p>
    </div>
  );
}