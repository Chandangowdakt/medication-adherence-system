import { Navigate, useLocation } from 'react-router-dom';
import { getToken } from '../utils/authStorage.js';

/**
 * Redirects guests to login; keeps intended path for optional post-login redirect.
 */
export function ProtectedRoute({ children }) {
  const location = useLocation();
  const token = getToken();

  if (!token) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}
