import { Navigate } from 'react-router-dom';
import { getToken } from '../utils/authStorage.js';
import { isDoctorToken } from '../utils/jwtPayload.js';

/** Default home after login: doctors → /doctor, others → /dashboard. */
export function RoleRedirect() {
  const token = getToken();
  if (isDoctorToken(token)) {
    return <Navigate to="/doctor" replace />;
  }
  return <Navigate to="/dashboard" replace />;
}
