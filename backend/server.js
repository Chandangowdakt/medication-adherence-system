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
import { isCronEnabled } from './config/features.js';
import { startAutoMissedDoseJob } from './services/autoMissedDoseJob.js';
import { initSocket } from './realtime/socketHub.js';

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
    origin: '*',
    credentials: false,
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);
app.use(express.json());

app.get('/api/health', async (_req, res) => {
  const enableCron = isCronEnabled();

  res.json({
    ok: true,
    service: 'Medication Adherence Tracker API',
    cron: enableCron ? 'running' : 'stopped',
    scheduling: {
      enableCronFlag: enableCron,
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

const httpServer = http.createServer(app);
initSocket(httpServer, { corsOrigins: allowedOrigins });

httpServer.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

let stopAutoMissedDoseJob = () => {};

if (isCronEnabled()) {
  stopAutoMissedDoseJob = startAutoMissedDoseJob();
} else {
  console.log('[cron] Background jobs disabled (set ENABLE_CRON=true to enable).');
}

function shutdownSignals() {
  stopAutoMissedDoseJob();
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
