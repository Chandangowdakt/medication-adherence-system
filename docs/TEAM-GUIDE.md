# Medication Adherence System — Production Upgrade Guide

This document matches the upgraded codebase: Express + MongoDB + React (Vite), optional `USE_DOSE_LEVEL`, FCM push, Socket.io real-time, and corrected analytics.

---

## 1. Architecture (text diagram)

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENTS                                     │
│  React Web (Vite)  │  Future: React Native (Expo) — same REST API │
└──────────┬───────────────────────────────┬────────────────────────┘
           │ HTTPS / WSS                   │
           │ JWT (Bearer)                  │ Socket.io (/socket.io)
           ▼                               ▼
┌──────────────────────────────────────────────────────────────────┐
│  Express API                                                      │
│  • Auth (JWT)  • Medications  • Logs / DoseLogs  • Analytics      │
│  • Reports  • Dashboard  • Notifications (FCM tokens)           │
│  • Doctor routes  • Socket.io hub (emit on data writes)           │
└──────────┬───────────────────────────────┬────────────────────────┘
           │                               │
           ▼                               ▼
┌──────────────────────┐       ┌──────────────────────┐
│  MongoDB Atlas       │       │  Firebase Admin      │
│  User, Medication,   │       │  (FCM send)          │
│  MedicationLog,      │       └──────────────────────┘
│  DoseLog, SideEffect,
│  PushDedupe          │
└──────────────────────┘

Background (ENABLE_CRON=true on one instance):
  • node-cron: reminder + missed push (FCM)
  • setInterval: auto-missed dose sweep
```

**Data flow:** Schedule and logs are computed in **UTC** on the server. The UI should format timestamps in the user’s local zone using `date-fns` helpers in `frontend/src/utils/dateTimeFormat.js`.

---

## 2. Database schema (MongoDB / Mongoose)

| Collection | Purpose | Key relationships |
|------------|---------|-------------------|
| **users** | Auth, roles, FCM `pushTokens[]`, `notificationPreferences` | `_id` referenced by all user-owned docs |
| **medications** | `userId`, `schedule[]` (HH:mm), `startDate` / `endDate` | Index: `userId + createdAt` |
| **medicationlogs** | Legacy: one row per user+med+**UTC calendar day** | Unique index on user+med+date (see model) |
| **doselogs** | Per-dose events (`datetime`, `status`, `legacyDailyRollup`) | Index: `userId+datetime`, `userId+medicationId+datetime`, status |
| **sideeffects** | `userId`, `medicationId`, `severity`, `date` | Index: `userId+date`, `userId+medicationId` |
| **pushdedupes** | Dedupe FCM sends per user+med+day+slot | — |

**USE_DOSE_LEVEL=false:** adherence uses `MedicationLog` with **slot-weighted** counts (each daily log × number of schedule slots).  
**USE_DOSE_LEVEL=true:** adherence uses **DoseLog** row counts; POST `/api/logs` writes a daily rollup `DoseLog` when no granular doses exist that day.

---

## 3. Adherence formula (fixed)

\[
\text{adherence\%} = \min\left(100,\ \frac{\text{taken\_doses}}{\text{expected\_doses}} \times 100\right)
\]

- **Expected doses** (range): for each medication active in the range,  
  `inclusive_UTC_days × schedule.length`, summed over medications.  
- Implemented in `backend/services/adherenceService.js` (capped at 100%).  
- **Trends API** adds per day: `expectedDoses`, `adherenceDayPercent` (taken ÷ expected for that UTC day).  
- **Legacy trends** aggregation now uses **slot-weighted** taken/missed so it aligns with the main stats.

---

## 4. Notifications (FCM)

| Layer | Responsibility |
|-------|----------------|
| **Frontend** | `registerDeviceForPush()` in `messagingClient.js` — requests permission, **registers `/firebase-messaging-sw.js`**, then `getToken` with VAPID; POSTs token to `/api/notifications/register-token`. |
| **Service worker** | `public/firebase-messaging-sw.js` — **must** use the same Firebase web config as `.env` (replace placeholders). |
| **Backend** | `FIREBASE_SERVICE_ACCOUNT_PATH` or `FIREBASE_SERVICE_ACCOUNT_JSON`; `pushNotificationCron.js` uses `node-cron` (not `setTimeout`) for schedule-aligned reminders. |

**Common failure:** `getToken` without `serviceWorkerRegistration` on web — fixed in code.

---

## 5. Real-time (Socket.io)

- Server: `backend/realtime/socketHub.js` — JWT in `auth.token` on connect; rooms `user:{userId}`.
- Emits `data:changed` after: log/dose create, medication create/delete, side effect create.
- Client: `useAppSocket` in Dashboard — refetches bundle without full-page reload.

**Production:** set `CORS` / `FRONTEND_URL` and ensure the client uses `VITE_API_URL` (or `VITE_SOCKET_URL` if the API host differs). Same machine: one origin for API + Socket.io.

---

## 6. Prediction algorithm (reactive to latest data)

File: `backend/services/missPredictionService.js`

\[
P_{\text{miss}} = 0.5(1 - a) + 0.3\min(1,\frac{s}{30}) + 0.2 \cdot r_7
\]

- \(a\) = adherence % (0–100) from last-30d stats (capped).  
- \(s\) = current missed-day streak (UTC).  
- \(r_7\) = last-7d miss share = `missedDoses / totalDoses` in window.

Pattern metrics (for explanation / API) come from `behaviorPatternService.js`: time-of-day concentration, weekend miss share, clustering copy.

**Reactive behavior:** any new dose or med change updates stats on next `GET` (and Dashboard refreshes via Socket.io or after POST).

---

## 7. React Native / Expo (reuse APIs)

1. `npx create-expo-app adherence-mobile` (TypeScript template).  
2. Add `expo-constants`, `@react-native-async-storage/async-storage` for JWT.  
3. Use the same `VITE_`-equivalent `EXPO_PUBLIC_API_URL` for `fetch` / axios to `https://your-api/...`.  
4. FCM: use `@react-native-firebase/messaging` or Expo push (different pipeline); for FCM, register the device token to the **same** `POST /api/notifications/register-token` endpoint.  
5. Reuse screens: login → dashboard; map existing JSON shapes from `/api/dashboard/summary`, `/api/analytics/*`.  
6. **Do not** embed service-account JSON in the app — only the Firebase **client** config (apiKey, etc.) is public; sending remains server-side.

---

## 8. Final production checklist

- [ ] Strong `JWT_SECRET`, HTTPS, `FRONTEND_URL` for CORS.  
- [ ] `MONGODB_URI` (Atlas with IP allow / `0.0.0.0/0` for PaaS).  
- [ ] FCM: Admin SDK env + web app config + VAPID + **update `firebase-messaging-sw.js`**.  
- [ ] `ENABLE_CRON=true` on **one** backend instance only.  
- [ ] `USE_DOSE_LEVEL` set intentionally; test both modes on staging.  
- [ ] Socket.io from browser reaches API host (firewall / same-site).  
- [ ] Health: `GET /api/health` shows `fcm: true` when push can send.  
- [ ] Load test: auto-missed job + FCM crons on single worker.

---

## 9. File index (this upgrade)

| Area | Files |
|------|--------|
| Adherence cap + trends | `backend/services/adherenceService.js`, `backend/controllers/analyticsController.js`, `backend/utils/medicationDateRange.js` |
| Socket.io | `backend/realtime/socketHub.js`, `backend/server.js`, `frontend/src/hooks/useAppSocket.js` |
| Emits | `logController`, `doseLogController`, `medicationController`, `sideEffectController` |
| FCM client | `frontend/src/firebase/messagingClient.js` |
| Patterns | `backend/services/behaviorPatternService.js`, `missPredictionService.js` |
| Models | `Medication.js`, `DoseLog.js` (indexes) |
| Date display | `frontend/src/utils/dateTimeFormat.js` |

---

*For deployment steps (Render, Vercel, Atlas), see prior deployment notes in project README and `.env.example` files.*
