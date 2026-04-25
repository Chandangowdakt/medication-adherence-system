import { admin, isFcmConfigured } from '../config/firebaseAdmin.js';
import { User } from '../models/User.js';
import { redactFcmToken } from '../utils/sensitiveLog.js';

const INVALID_CODES = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
  'messaging/invalid-argument',
]);

const FCM_MAX_RETRIES = 2;
const FCM_DEBUG = process.env.FCM_DEBUG === 'true' || process.env.FCM_LOG_TICKS === 'true';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Send FCM notification to each token; returns tokens that should be removed.
 * Retries transient errors up to FCM_MAX_RETRIES.
 */
export async function sendFcmToTokens(tokens, title, body, data = {}) {
  if (!isFcmConfigured()) {
    if (FCM_DEBUG && tokens?.length) {
      console.warn('[FCM] send skipped: Firebase Admin not initialized (FIREBASE_SERVICE_ACCOUNT_*)');
    }
    return { sent: 0, invalidTokens: [] };
  }
  if (!tokens?.length) {
    return { sent: 0, invalidTokens: [] };
  }

  const unique = [...new Set(tokens.filter(Boolean))];
  const dataStrings = Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, v == null ? '' : String(v)])
  );

  let sent = 0;
  const invalidTokens = [];

  for (const token of unique) {
    if (FCM_DEBUG) {
      console.log(`Sending notification to: ${redactFcmToken(token)}`);
      console.log(`[FCM] step 7) send → device token=${redactFcmToken(token)} title=${JSON.stringify(title)}`);
    }
    for (let attempt = 0; attempt <= FCM_MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await sleep(400 * attempt);
      }
      try {
        await admin.messaging().send({
          token,
          notification: { title, body },
          data: dataStrings,
        });
        sent++;
        break;
      } catch (err) {
        const code = err?.code || err?.errorInfo?.code;
        if (INVALID_CODES.has(code)) {
          invalidTokens.push(token);
          break;
        }
        if (attempt === FCM_MAX_RETRIES) {
          console.warn('[FCM] send error after retry:', code, err.message);
        }
      }
    }
  }

  return { sent, invalidTokens };
}

export async function pruneInvalidPushTokens(userId, invalidTokens) {
  if (!invalidTokens?.length) return;
  await User.updateOne(
    { _id: userId },
    { $pull: { pushTokens: { token: { $in: invalidTokens } } } }
  );
}
