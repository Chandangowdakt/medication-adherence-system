import 'dotenv/config';
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
import { startPushNotificationCron } from './services/pushNotificationCron.js';

const app = express();

const devOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'];
const envOrigin = process.env.FRONTEND_URL;
const allowedOrigins = [...new Set([...devOrigins, envOrigin].filter(Boolean))];

// Allow React dev server to call the API (localhost + 127.0.0.1)
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'Medication Adherence Tracker API',
    fcm: isFcmConfigured(),
  });
});

app.use('/api/auth', authRoutes);
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
  console.error('FATAL: Set JWT_SECRET in backend/.env (non-empty).');
  process.exit(1);
}

await connectDB();
initFirebaseAdmin();

const server = app.listen(PORT, () => {
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
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdownSignals);
process.on('SIGTERM', shutdownSignals);

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Stop the other process or set PORT in .env.`);
  } else {
    console.error('Server error:', err.message);
  }
  process.exit(1);
});
