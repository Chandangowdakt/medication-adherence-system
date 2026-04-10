import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import { getAdherenceReport, exportLogsCsv } from '../controllers/reportsController.js';

const router = Router();

router.use(requireAuth);

router.get('/adherence', getAdherenceReport);
router.get('/export-csv', exportLogsCsv);

export default router;
