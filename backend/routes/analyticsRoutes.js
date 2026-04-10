import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import {
  getAdherence,
  getAdherenceForecast,
  getAdherenceTrends,
  getBehaviorPatterns,
  getIntervention,
  getMissPrediction,
} from '../controllers/analyticsController.js';

const router = Router();

router.use(requireAuth);

router.get('/trends', getAdherenceTrends);
router.get('/forecast', getAdherenceForecast);
router.get('/prediction', getMissPrediction);
router.get('/behavior-patterns', getBehaviorPatterns);
router.get('/intervention', getIntervention);
router.get('/adherence', getAdherence);

export default router;
