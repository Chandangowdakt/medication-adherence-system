import { User } from '../models/User.js';
import { normalizeIanaTimeZone } from '../utils/userTimezone.js';
import { redactFcmToken } from '../utils/sensitiveLog.js';
import { sendFcmToTokens, pruneInvalidPushTokens } from '../services/fcmSendService.js';

const MAX_PUSH_TOKENS = 5;

/**
 * POST /api/notifications/register-token — store FCM token for the authenticated user.
 */
export async function registerPushToken(req, res) {
  try {
    const { token, timeZone: tzIn } = req.body;
    if (!token || typeof token !== 'string' || !token.trim()) {
      return res.status(400).json({ message: 'token is required' });
    }

    const t = token.trim();
    const userId = req.user.id;

    const toSet = {};
    if (typeof tzIn === 'string' && tzIn.trim()) {
      toSet.timeZone = normalizeIanaTimeZone(tzIn);
    }

    const existing = await User.findById(userId).select('pushTokens').lean();
    const tokenExists = (existing?.pushTokens || []).some((p) => p.token === t);

    if (tokenExists) {
      await User.updateOne(
        { _id: userId },
        { $set: { 'pushTokens.$[el].updatedAt': new Date() } },
        { arrayFilters: [{ 'el.token': t }] }
      );
    } else {
      await User.updateOne(
        { _id: userId },
        {
          $push: {
            pushTokens: {
              $each: [{ token: t, updatedAt: new Date() }],
              $position: 0,
              $slice: MAX_PUSH_TOKENS,
            },
          },
        }
      );
    }

    if (Object.keys(toSet).length) {
      await User.updateOne({ _id: userId }, { $set: toSet });
    }

    const user = await User.findById(userId)
      .select('notificationPreferences timeZone')
      .lean();

    console.log(
      `[API] FCM) POST /register-token OK user=${userId} token=${redactFcmToken(t)} timeZoneUpdated=${String(!!toSet.timeZone)} savedTz=${user?.timeZone ?? 'n/a'}`
    );

    return res.status(200).json({
      message: 'Token registered',
      preferences: user?.notificationPreferences ?? {
        remindersEnabled: true,
        missedAlertsEnabled: true,
      },
      timeZone: user?.timeZone ?? 'UTC',
    });
  } catch (err) {
    console.error('[API] registerPushToken error:', err.message);
    return res.status(500).json({ message: 'Server error while saving token' });
  }
}

/**
 * DELETE /api/notifications/token — remove one device token (e.g. on logout).
 */
export async function removePushToken(req, res) {
  try {
    const { token } = req.body;
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ message: 'token is required' });
    }

    await User.updateOne(
      { _id: req.user.id },
      { $pull: { pushTokens: { token: token.trim() } } }
    );

    return res.json({ message: 'Token removed' });
  } catch (err) {
    console.error('removePushToken error:', err);
    return res.status(500).json({ message: 'Server error while removing token' });
  }
}

/**
 * GET /api/notifications/preferences
 */
export async function getNotificationPreferences(req, res) {
  try {
    const user = await User.findById(req.user.id).select('notificationPreferences timeZone').lean();
    return res.json({
      preferences: user?.notificationPreferences ?? {
        remindersEnabled: true,
        missedAlertsEnabled: true,
      },
      timeZone: user?.timeZone ?? 'UTC',
    });
  } catch (err) {
    console.error('getNotificationPreferences error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

/**
 * PATCH /api/notifications/preferences — body: { remindersEnabled?, missedAlertsEnabled?, timeZone? (IANA) }
 */
export async function patchNotificationPreferences(req, res) {
  try {
    const { remindersEnabled, missedAlertsEnabled, timeZone: tzIn } = req.body;
    const patch = {};

    if (typeof remindersEnabled === 'boolean') {
      patch['notificationPreferences.remindersEnabled'] = remindersEnabled;
    }
    if (typeof missedAlertsEnabled === 'boolean') {
      patch['notificationPreferences.missedAlertsEnabled'] = missedAlertsEnabled;
    }
    if (typeof tzIn === 'string' && tzIn.trim()) {
      patch.timeZone = normalizeIanaTimeZone(tzIn);
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ message: 'No valid preference fields' });
    }

    await User.updateOne({ _id: req.user.id }, { $set: patch });

    const user = await User.findById(req.user.id).select('notificationPreferences timeZone').lean();
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    return res.json({
      preferences: user.notificationPreferences,
      timeZone: user.timeZone ?? 'UTC',
    });
  } catch (err) {
    console.error('patchNotificationPreferences error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

/**
 * POST /api/notifications/send-reminder — send immediate test push to current user devices.
 */
export async function sendReminderPushNow(req, res) {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId).select('pushTokens').lean();
    const tokens = (user?.pushTokens || []).map((p) => p.token).filter(Boolean);
    if (!tokens.length) {
      return res.status(400).json({ message: 'No push token registered for this user' });
    }

    const { sent, invalidTokens } = await sendFcmToTokens(
      tokens,
      '💊 Medicine Reminder',
      'Time to take your medicine!',
      { type: 'manual_reminder' }
    );
    await pruneInvalidPushTokens(userId, invalidTokens);

    return res.json({ message: 'Reminder push sent', sent });
  } catch (err) {
    console.error('sendReminderPushNow error:', err);
    return res.status(500).json({ message: 'Server error while sending reminder push' });
  }
}
