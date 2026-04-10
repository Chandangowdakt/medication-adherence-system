import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { api } from '../api/client.js';
import { setToken } from '../utils/authStorage.js';

/**
 * Login form: POST /api/auth/login, store JWT, redirect to dashboard.
 */
export function Login() {
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/api/auth/login', { email, password });
      setToken(data.token);
      const from = location.state?.from?.pathname;
      const isDoc = data.user?.role === 'doctor';
      if (isDoc) {
        if (from?.startsWith('/doctor')) navigate(from, { replace: true });
        else navigate('/doctor', { replace: true });
      } else {
        if (from?.startsWith('/doctor')) navigate('/dashboard', { replace: true });
        else navigate(from || '/dashboard', { replace: true });
      }
    } catch (err) {
      const msg = err.response?.data?.message || 'Login failed';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="card">
        <h1>Sign in</h1>
        <p className="muted">Medication Adherence Tracker</p>

        <form onSubmit={handleSubmit} className="form">
          {error && <div className="alert error">{error}</div>}
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </label>
          <button type="submit" className="btn primary" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="footer-link">
          No account? <Link to="/register">Register</Link>
        </p>
      </div>
    </div>
  );
}
