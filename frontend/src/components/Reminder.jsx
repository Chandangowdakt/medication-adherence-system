import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { PushNotifications } from "@capacitor/push-notifications";
import { requestFCMToken } from "../firebase.js";
import { api } from "../api/client.js";

const STORAGE_KEY = "medicine_reminder_time";
const REMINDER_ID = 1;
let audioRef = null;

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

function playSound() {
  if (audioRef) {
    audioRef.pause();
    audioRef.currentTime = 0;
  }
  audioRef = new Audio("/alert.mp3");
  audioRef.play().catch(() => {});
}

function sendNotification() {
  const title = "💊 Medicine Reminder";
  const body = "Time to take your medicine!";

  if (Capacitor.isNativePlatform()) {
    return;
  }

  if (Notification.permission === "granted") {
    new Notification(title, {
      body,
      icon: "/favicon.svg",
    });
    playSound();
    if (import.meta.env.DEV) {
      alert(body);
    }
  } else {
    playSound();
    alert(body);
  }
}

export function Reminder() {
  const [time, setTime] = useState("");
  const [savedTime, setSavedTime] = useState("");
  const [timeLeft, setTimeLeft] = useState("");
  const [nextTriggerAt, setNextTriggerAt] = useState("");
  const [status, setStatus] = useState("");
  const [isScheduling, setIsScheduling] = useState(false);

  const timerRef = useRef(null);
  const intervalRef = useRef(null);
  const restoredRef = useRef(false);
  const pushInitRef = useRef(false);

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

      if (!pushInitRef.current) {
        pushInitRef.current = true;
        await initPushRegistration();
      }
    }

    init();

    return () => {
      clearTimeout(timerRef.current);
      clearInterval(intervalRef.current);
    };
  }, []);

  async function registerPushTokenToBackend(token) {
    if (!token || typeof token !== "string") return;
    try {
      await api.post("/notifications/register-token", { token: token.trim() });
    } catch {
      // keep local reminder working even if push token save fails
    }
  }

  async function initPushRegistration() {
    if (Capacitor.isNativePlatform()) {
      try {
        const perm = await PushNotifications.requestPermissions();
        if (perm.receive !== "granted") return;
        await PushNotifications.register();
        PushNotifications.addListener("registration", async (token) => {
          await registerPushTokenToBackend(token?.value);
        });
      } catch {
        // keep local notifications/timer fallback intact
      }
      return;
    }

    const token = await requestFCMToken();
    await registerPushTokenToBackend(token);
  }

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
      if (delay <= 0) {
        triggerDate.setDate(triggerDate.getDate() + 1);
        delay = triggerDate.getTime() - Date.now();
      }
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

  return (
    <div className="card page-card reminder-card">
      <h2>Medicine Reminder</h2>

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
      </div>

      <p className="muted compact-top">{status}</p>
    </div>
  );
}