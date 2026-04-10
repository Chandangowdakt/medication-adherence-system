import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import { createDoseLog } from '../controllers/doseLogController.js';

const router = Router();

router.use(requireAuth);

router.post('/', createDoseLog);

export default router;
