import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import {
  createSideEffect,
  getSideEffectCorrelationForMedication,
  getSideEffectCorrelations,
  getUserSideEffects,
} from '../controllers/sideEffectController.js';

const router = Router();

router.use(requireAuth);

router.post('/', createSideEffect);
router.get('/correlations', getSideEffectCorrelations);
router.get('/correlations/:medicationId', getSideEffectCorrelationForMedication);
router.get('/', getUserSideEffects);

export default router;
