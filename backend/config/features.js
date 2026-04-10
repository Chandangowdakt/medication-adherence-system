/**
 * Feature flags (env-driven, migration-safe defaults).
 * USE_DOSE_LEVEL: DoseLog is the source of truth for adherence, analytics count real dose rows,
 * POST /api/dose-logs enabled; legacy POST /api/logs writes daily rollup DoseLog rows.
 */
export function isDoseLevelEnabled() {
  return String(process.env.USE_DOSE_LEVEL || '').toLowerCase() === 'true';
}

/** Auto-missed sweep + FCM cron schedules. Default true when unset (backward compatible). */
export function isCronEnabled() {
  return String(process.env.ENABLE_CRON ?? 'true').toLowerCase() === 'true';
}
