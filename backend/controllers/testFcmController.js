import { User } from '../models/User.js';
import { isFcmConfigured } from '../config/firebaseAdmin.js';
import { sendFcmToTokens, pruneInvalidPushTokens } from '../services/fcmSendService.js';

/**
 * GET /api/test-notification — send one FCM to the *current* user's first device token.
 * Enable only with: ALLOW_FCM_TEST=true in backend/.env (prevents production abuse).
 */
export async function sendTestNotificationToSelf(req, res) {
  if (String(process.env.ALLOW_FCM_TEST || '').toLowerCase() !== 'true') {
    return res.status(403).json({
      message: 'Set ALLOW_FCM_TEST=true in backend/.env to enable this diagnostic endpoint, then restart the server.',
      code: 'TEST_ENDPOINT_DISABLED',
    });
  }
  if (!isFcmConfigured()) {
    return res.status(503).json({
      message:
        'This missing config is the reason notifications are not working: set FIREBASE_SERVICE_ACCOUNT_PATH (or JSON) in backend/.env',
      fcm: false,
    });
  }

  try {
    const user = await User.findById(req.user.id).select('pushTokens role').lean();
    if (!user || user.role !== 'patient') {
      return res.status(403).json({ message: 'Test notification is for patient accounts with a registered FCM token.' });
    }
    const tokens = (user.pushTokens || []).map((p) => p.token).filter(Boolean);
    if (!tokens.length) {
      return res.status(400).json({
        message: 'No push token: complete [FCM] step 1–6 in the browser (Enable notifications) before calling this test.',
        stepFailed: 6,
      });
    }
    const first = tokens[0];
    const { sent, invalidTokens } = await sendFcmToTokens(
      [first],
      'Medication Adherence — test',
      'If you see this, FCM (server → device) is working.',
      { type: 'test' }
    );
    if (invalidTokens.length) {
      await pruneInvalidPushTokens(req.user.id, invalidTokens);
    }
    return res.json({
      ok: true,
      sent,
      hadInvalidToken: invalidTokens.length > 0,
      message: sent > 0 ? 'Test message sent. Check the device and OS notification center.' : 'No message sent; see server logs.',
    });
  } catch (err) {
    console.error('[test-notification]', err);
    return res.status(500).json({ message: 'Server error', detail: err.message });
  }
}
