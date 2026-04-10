import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import { upsertTodayLog, getUserLogs } from '../controllers/logController.js';

const router = Router();

router.use(requireAuth);

router.post('/', upsertTodayLog);
router.get('/', getUserLogs);

export default router;
