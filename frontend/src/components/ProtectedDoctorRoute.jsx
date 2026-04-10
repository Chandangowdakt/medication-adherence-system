import { Navigate, useLocation } from 'react-router-dom';
import { getToken } from '../utils/authStorage.js';
import { isDoctorToken } from '../utils/jwtPayload.js';

/**
 * Requires JWT and role doctor (from token payload; re-login updates role after promotion).
 */
export function ProtectedDoctorRoute({ children }) {
  const location = useLocation();
  const token = getToken();

  if (!token) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (!isDoctorToken(token)) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
