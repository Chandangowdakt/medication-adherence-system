import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import { requireDoctor } from '../middleware/requireDoctor.js';
import {
  getDoctorPatients,
  getDoctorPatientDetail,
  linkDoctorPatient,
  unlinkDoctorPatient,
} from '../controllers/doctorController.js';

const router = Router();

router.use(requireAuth);
router.use(requireDoctor);

router.get('/patients', getDoctorPatients);
router.get('/patient/:id', getDoctorPatientDetail);
router.post('/link-patient', linkDoctorPatient);
router.delete('/unlink-patient/:id', unlinkDoctorPatient);

export default router;
