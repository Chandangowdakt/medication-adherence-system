import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import {
  addMedication,
  getUserMedications,
  deleteMedication,
} from '../controllers/medicationController.js';

const router = Router();

// All medication routes require a valid JWT
router.use(requireAuth);

router.post('/', addMedication);
router.get('/', getUserMedications);
router.delete('/:id', deleteMedication);

export default router;
