import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { User } from '../models/User.js';

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Verifies JWT from Authorization: Bearer <token> and attaches req.user (id, role).
 */
export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (isDev) {
      console.log(
        '[auth] Authorization:',
        header && /^Bearer\s+/i.test(header) ? 'Bearer <redacted>' : 'missing or not Bearer'
      );
    }
    if (!header || !/^Bearer\s+/i.test(header)) {
      return res.status(401).json({ message: 'Not authorized, no token' });
    }

    const token = header.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return res.status(401).json({ message: 'Not authorized, no token' });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return res.status(500).json({ message: 'Server misconfiguration' });
    }

    const decoded = jwt.verify(token, secret);
    const userId = decoded?.userId;
    if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
      return res.status(401).json({ message: 'Not authorized, invalid token' });
    }

    const user = await User.findById(userId).select('-password');
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    req.user = { id: user._id.toString(), role: user.role };
    req.userDoc = user;
    next();
  } catch (err) {
    if (isDev) {
      console.warn('[auth] JWT verify / user load failed:', err?.name, err?.message);
    }
    const msg =
      err?.name === 'TokenExpiredError'
        ? 'Not authorized, token expired'
        : 'Not authorized, invalid token';
    return res.status(401).json({ message: msg });
  }
}
