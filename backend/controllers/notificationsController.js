import { User } from '../models/User.js';

const MAX_PUSH_TOKENS = 10;

/**
 * POST /api/notifications/register-token — store FCM token for the authenticated user.
 */
export async function registerPushToken(req, res) {
  try {
    const { token } = req.body;
    if (!token || typeof token !== 'string' || !token.trim()) {
      return res.status(400).json({ message: 'token is required' });
    }

    const t = token.trim();
    const userId = req.user.id;

    await User.updateOne({ _id: userId }, { $pull: { pushTokens: { token: t } } });

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

    const user = await User.findById(userId)
      .select('notificationPreferences')
      .lean();

    return res.status(200).json({
      message: 'Token registered',
      preferences: user?.notificationPreferences ?? {
        remindersEnabled: true,
        missedAlertsEnabled: true,
      },
    });
  } catch (err) {
    console.error('registerPushToken error:', err);
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
    const user = await User.findById(req.user.id).select('notificationPreferences').lean();
    return res.json({
      preferences: user?.notificationPreferences ?? {
        remindersEnabled: true,
        missedAlertsEnabled: true,
      },
    });
  } catch (err) {
    console.error('getNotificationPreferences error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

/**
 * PATCH /api/notifications/preferences — body: { remindersEnabled?, missedAlertsEnabled? }
 */
export async function patchNotificationPreferences(req, res) {
  try {
    const { remindersEnabled, missedAlertsEnabled } = req.body;
    const patch = {};

    if (typeof remindersEnabled === 'boolean') {
      patch['notificationPreferences.remindersEnabled'] = remindersEnabled;
    }
    if (typeof missedAlertsEnabled === 'boolean') {
      patch['notificationPreferences.missedAlertsEnabled'] = missedAlertsEnabled;
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ message: 'No valid preference fields' });
    }

    await User.updateOne({ _id: req.user.id }, { $set: patch });

    const user = await User.findById(req.user.id).select('notificationPreferences').lean();
    return res.json({ preferences: user.notificationPreferences });
  } catch (err) {
    console.error('patchNotificationPreferences error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}
