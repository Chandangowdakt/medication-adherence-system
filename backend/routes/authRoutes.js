import { Router } from 'express';
import { register, login, me } from '../controllers/authController.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.all('/register', (_req, res) => {
  res.status(405).json({ message: 'Method not allowed. Use POST /api/auth/register' });
});
router.all('/login', (_req, res) => {
  res.status(405).json({ message: 'Method not allowed. Use POST /api/auth/login' });
});
router.get('/me', requireAuth, me);

export default router;
