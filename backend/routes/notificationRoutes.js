import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import {
  registerPushToken,
  removePushToken,
  getNotificationPreferences,
  patchNotificationPreferences,
} from '../controllers/notificationsController.js';

const router = Router();

router.use(requireAuth);

router.post('/register-token', registerPushToken);
router.delete('/token', removePushToken);
router.get('/preferences', getNotificationPreferences);
router.patch('/preferences', patchNotificationPreferences);

export default router;
