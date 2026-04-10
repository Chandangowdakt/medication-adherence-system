import { admin, isFcmConfigured } from '../config/firebaseAdmin.js';
import { User } from '../models/User.js';

const INVALID_CODES = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
  'messaging/invalid-argument',
]);

/**
 * Send FCM notification to each token; returns tokens that should be removed.
 */
export async function sendFcmToTokens(tokens, title, body, data = {}) {
  if (!isFcmConfigured() || !tokens?.length) {
    return { sent: 0, invalidTokens: [] };
  }

  const unique = [...new Set(tokens.filter(Boolean))];
  const dataStrings = Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, v == null ? '' : String(v)])
  );

  let sent = 0;
  const invalidTokens = [];

  for (const token of unique) {
    try {
      await admin.messaging().send({
        token,
        notification: { title, body },
        data: dataStrings,
      });
      sent++;
    } catch (err) {
      const code = err?.code || err?.errorInfo?.code;
      if (INVALID_CODES.has(code)) {
        invalidTokens.push(token);
      } else {
        console.warn('[FCM] send error:', code, err.message);
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
