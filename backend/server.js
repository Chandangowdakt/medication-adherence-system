import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import { connectDB } from './config/db.js';
import authRoutes from './routes/authRoutes.js';
import medicationRoutes from './routes/medicationRoutes.js';
import logRoutes from './routes/logRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import sideEffectRoutes from './routes/sideEffectRoutes.js';
import reportRoutes from './routes/reportRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import doctorRoutes from './routes/doctorRoutes.js';
import doseLogRoutes from './routes/doseLogRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import { initFirebaseAdmin, isFcmConfigured } from './config/firebaseAdmin.js';
import { isCronEnabled } from './config/features.js';
import { startAutoMissedDoseJob } from './services/autoMissedDoseJob.js';
import { startPushNotificationCron, isPushCronScheduled } from './services/pushNotificationCron.js';
import { initSocket } from './realtime/socketHub.js';
import { User } from './models/User.js';
import { requireAuth } from './middleware/authMiddleware.js';
import { sendTestNotificationToSelf } from './controllers/testFcmController.js';

const app = express();

const corsOriginEnv = process.env.CORS_ORIGIN?.trim() || '*';
const allowedOrigins =
  corsOriginEnv === '*'
    ? true
    : corsOriginEnv
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);

// For APK/demo simplicity, default is allow-all; set CORS_ORIGIN to lock it down.
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);
app.use(express.json());

/** Diagnostic: GET /api/test-notification (requires JWT + ALLOW_FCM_TEST=true) */
app.get('/api/test-notification', requireAuth, sendTestNotificationToSelf);

app.get('/api/health', async (_req, res) => {
  let usersWithPushTokens = 0;
  let deviceTokensRegistered = 0;
  try {
    const c = await User.countDocuments({ 'pushTokens.0': { $exists: true } });
    usersWithPushTokens = c;
    const agg = await User.aggregate([
      { $project: { n: { $size: { $ifNull: ['$pushTokens', []] } } } },
      { $group: { _id: null, t: { $sum: '$n' } } },
    ]);
    deviceTokensRegistered = agg[0]?.t ?? 0;
  } catch (e) {
    console.warn('[health] FCM token stats failed:', e.message);
  }

  const fcm = isFcmConfigured();
  const enableCron = isCronEnabled();
  const pushScheduled = isPushCronScheduled();

  const hasServiceAccount = !!(
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim() || process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim()
  );

  res.json({
    ok: true,
    service: 'Medication Adherence Tracker API',
    firebase: fcm,
    fcm,
    cron: enableCron ? 'running' : 'stopped',
    pushTokens: {
      users: usersWithPushTokens,
      total: deviceTokensRegistered,
    },
    scheduling: {
      enableCronFlag: enableCron,
      fcmAdminReady: fcm,
      fcmPushCronScheduled: pushScheduled,
    },
    /** Non-secret: which backend env *keys* are set (not values) */
    env: {
      firebaseServiceAccountConfigured: hasServiceAccount,
      firebaseAdminInitialized: fcm,
      enableCronFlag: enableCron,
      allTrueForPush:
        hasServiceAccount && fcm && enableCron && pushScheduled,
    },
  });
});

app.use('/api/auth', authRoutes);
console.log('Auth routes loaded');
app.use('/api/medications', medicationRoutes);
app.use('/api/logs', logRoutes);
app.use('/api/dose-logs', doseLogRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/side-effects', sideEffectRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/doctor', doctorRoutes);
app.use('/api/notifications', notificationRoutes);

/** Unknown routes → JSON 404 */
app.use((req, res) => {
  res.status(404).json({ message: 'Not found' });
});

/** Malformed JSON body */
app.use((err, _req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ message: 'Invalid JSON body' });
  }
  next(err);
});

/** Other errors → JSON 500 */
app.use((err, _req, res, _next) => {
  console.error(err);
  if (!res.headersSent) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

const PORT = Number(process.env.PORT) || 5001;

if (!process.env.JWT_SECRET?.trim()) {
  console.error('FATAL: Set JWT_SECRET in environment (non-empty).');
  process.exit(1);
}

if (!process.env.MONGO_URI?.trim() && !process.env.MONGODB_URI?.trim()) {
  console.error('FATAL: Set MONGO_URI in environment (MongoDB connection string).');
  process.exit(1);
}

await connectDB();
initFirebaseAdmin();

const hasServiceAccountInEnv = !!(
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim() || process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim()
);
if (!hasServiceAccountInEnv) {
  console.warn(
    '[BOOT] FCM: This missing config is the reason server-side push is disabled: set FIREBASE_SERVICE_ACCOUNT_PATH (file) or FIREBASE_SERVICE_ACCOUNT_JSON in backend/.env'
  );
} else if (!isFcmConfigured()) {
  console.warn(
    '[BOOT] FCM: Service account was set in env but Admin SDK did not initialize — check file path, JSON, or permissions.'
  );
}

const httpServer = http.createServer(app);
initSocket(httpServer, { corsOrigins: allowedOrigins });

httpServer.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

let stopAutoMissedDoseJob = () => {};
let stopPushNotificationCron = () => {};

if (isCronEnabled()) {
  stopAutoMissedDoseJob = startAutoMissedDoseJob();
  stopPushNotificationCron = startPushNotificationCron();
} else {
  console.log('[cron] Background jobs disabled (set ENABLE_CRON=true to enable).');
}

function shutdownSignals() {
  stopAutoMissedDoseJob();
  stopPushNotificationCron();
  httpServer.close(() => process.exit(0));
}

process.on('SIGINT', shutdownSignals);
process.on('SIGTERM', shutdownSignals);

httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Stop the other process or set PORT in .env.`);
  } else {
    console.error('Server error:', err.message);
  }
  process.exit(1);
});
