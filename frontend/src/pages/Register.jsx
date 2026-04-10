import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { setToken } from '../utils/authStorage.js';

/**
 * Registration: POST /api/auth/register, then auto-login via returned token.
 */
export function Register() {
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('patient');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/api/auth/register', {
        name,
        email,
        password,
        role,
      });
      setToken(data.token);
      const isDoc = data.user?.role === 'doctor';
      navigate(isDoc ? '/doctor' : '/dashboard', { replace: true });
    } catch (err) {
      const msg = err.response?.data?.message || 'Registration failed';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="card">
        <h1>Create account</h1>
        <p className="muted">Medication Adherence Tracker</p>

        <form onSubmit={handleSubmit} className="form">
          {error && <div className="alert error">{error}</div>}
          <label>
            Name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="name"
            />
          </label>
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
              minLength={6}
              autoComplete="new-password"
            />
          </label>
          <label>
            Role
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="patient">Patient</option>
              <option value="doctor">Doctor</option>
            </select>
          </label>
          <button type="submit" className="btn primary" disabled={loading}>
            {loading ? 'Creating…' : 'Register'}
          </button>
        </form>

        <p className="footer-link">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
