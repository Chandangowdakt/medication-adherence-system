import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import { requireDoctor } from '../middleware/requireDoctor.js';
import { getDoctorPatients, getDoctorPatientDetail } from '../controllers/doctorController.js';

const router = Router();

router.use(requireAuth);
router.use(requireDoctor);

router.get('/patients', getDoctorPatients);
router.get('/patient/:id', getDoctorPatientDetail);

export default router;
