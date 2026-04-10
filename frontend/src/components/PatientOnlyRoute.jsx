import { Navigate } from 'react-router-dom';
import { getToken } from '../utils/authStorage.js';
import { isDoctorToken } from '../utils/jwtPayload.js';

/** Redirects doctors to /doctor (patient UI only). */
export function PatientOnlyRoute({ children }) {
  const token = getToken();
  if (isDoctorToken(token)) {
    return <Navigate to="/doctor" replace />;
  }
  return children;
}
