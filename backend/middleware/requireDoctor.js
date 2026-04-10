/**
 * After requireAuth: only users with role doctor may proceed.
 */
export function requireDoctor(req, res, next) {
  if (req.user.role !== 'doctor') {
    return res.status(403).json({ message: 'Doctor access only' });
  }
  next();
}
