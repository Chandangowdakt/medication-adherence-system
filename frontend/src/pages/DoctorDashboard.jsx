import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { getToken } from '../utils/authStorage.js';
import { getPayloadFromToken } from '../utils/jwtPayload.js';

/**
 * Lists patients linked to the logged-in doctor.
 */
export function DoctorDashboard() {
  const [patients, setPatients] = useState([]);
  const [highRiskPatients, setHighRiskPatients] = useState([]);
  const [lowAdherencePatients, setLowAdherencePatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [linkEmail, setLinkEmail] = useState('');
  const [linking, setLinking] = useState(false);
  const [linkStatus, setLinkStatus] = useState({ type: '', message: '' });
  const [unlinkingId, setUnlinkingId] = useState('');

  const loadPatients = useCallback(async () => {
    setError('');
    const { data } = await api.get('/doctor/patients');
    setPatients(data.patients ?? []);
    setHighRiskPatients(data.highRiskPatients ?? []);
    setLowAdherencePatients(data.lowAdherencePatients ?? []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError('');
      try {
        await loadPatients();
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.message || 'Could not load patients.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadPatients]);

  async function handleLinkPatient(e) {
    e.preventDefault();
    const patientEmail = linkEmail.trim().toLowerCase();
    if (!patientEmail) {
      setLinkStatus({ type: 'error', message: 'Patient email is required.' });
      return;
    }

    setLinking(true);
    setError('');
    setLinkStatus({ type: '', message: '' });
    try {
      const payload = getPayloadFromToken(getToken());
      const doctorId = payload?.userId || '';
      await api.post('/doctor/link-patient', { patientEmail, doctorId });
      setLinkStatus({ type: 'success', message: 'Patient linked successfully' });
      setLinkEmail('');
      await loadPatients();
    } catch (err) {
      const msg = err.response?.data?.message || 'Could not link patient.';
      setLinkStatus({
        type: 'error',
        message: msg.toLowerCase().includes('not found') ? 'Patient not found' : msg,
      });
    } finally {
      setLinking(false);
    }
  }

  async function handleUnlinkPatient(patientId) {
    if (!window.confirm('Unlink this patient from your dashboard?')) return;
    setUnlinkingId(String(patientId));
    setError('');
    setLinkStatus({ type: '', message: '' });
    try {
      await api.delete(`/doctor/unlink-patient/${patientId}`);
      setLinkStatus({ type: 'success', message: 'Patient unlinked successfully' });
      await loadPatients();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not unlink patient.');
    } finally {
      setUnlinkingId('');
    }
  }

  return (
    <div className="page">
      <h1 className="page-title">Doctor dashboard</h1>
      <p className="page-lead muted">Patients assigned to you.</p>

      {error && <div className="alert error page-alert">{error}</div>}

      <section className="card page-card">
        <h2>Link Patient</h2>
        <p className="muted small compact-bottom">
          Enter a patient email to link them to your doctor account.
        </p>
        <form className="form doctor-link-form" onSubmit={handleLinkPatient}>
          <label>
            Patient Email
            <input
              type="email"
              placeholder="patient@example.com"
              value={linkEmail}
              onChange={(e) => setLinkEmail(e.target.value)}
              required
            />
          </label>
          <button type="submit" className="btn primary btn-sm" disabled={linking}>
            {linking ? 'Linking…' : 'Link Patient'}
          </button>
        </form>
        {linkStatus.message ? (
          <p className={linkStatus.type === 'error' ? 'doctor-link-error' : 'doctor-link-success'}>
            {linkStatus.message}
          </p>
        ) : null}
      </section>

      {!loading && patients.length > 0 && (
        <section className="card page-card doctor-analytics-summary">
          <h2>At a glance</h2>
          <p className="muted small compact-bottom">
            Last 30 days (UTC), same window as patient detail. List is sorted by risk (highest first).
          </p>
          <div className="doctor-summary-chips">
            <span className="doctor-summary-chip doctor-summary-chip--alert">
              High risk: <strong>{highRiskPatients.length}</strong>
            </span>
            <span className="doctor-summary-chip doctor-summary-chip--warn">
              Low adherence (&lt;50%): <strong>{lowAdherencePatients.length}</strong>
            </span>
          </div>
        </section>
      )}

      <section className="card page-card">
        <h2>Patients</h2>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : patients.length === 0 ? (
          <p className="muted">No patients linked yet</p>
        ) : (
          <ul className="doctor-patient-cards">
            {patients.map((p) => (
              <li key={p.id} className={`doctor-patient-card${p.highRisk ? ' doctor-patient-card--risky' : ''}`}>
                <div className="item-body doctor-patient-card-body patient-card">
                  <div className="doctor-patient-name-row">
                    <strong>{p.name}</strong>
                    <span className="doctor-patient-badges">
                      {p.highRisk && (
                        <span className="patient-risk-badge patient-risk-badge--red" title="High risk score">
                          HIGH RISK
                        </span>
                      )}
                      {p.lowAdherence && (
                        <span
                          className="patient-risk-badge patient-risk-badge--yellow"
                          title="Adherence below 50% in window"
                        >
                          LOW ADHERENCE
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="muted small">{p.email}</div>
                  {p.createdAt ? (
                    <div className="muted small">
                      Linked date: {new Date(p.createdAt).toLocaleDateString()}
                    </div>
                  ) : null}
                  <div className="patient-stats">
                    <span>📊 Adherence: {p.analytics?.adherence ?? '—'}%</span>
                    <span>❌ Missed (7d): {p.analytics?.missedLast7Days ?? '—'}</span>
                    <span className={`risk ${(p.analytics?.riskLevel || 'Low').toLowerCase()}`}>
                      ⚠ Risk: {p.analytics?.riskLevel || 'Low'}
                    </span>
                  </div>
                </div>
                <div className="doctor-patient-actions">
                  <Link to={`/doctor/patient/${p.id}`} className="btn primary btn-sm">
                    View
                  </Link>
                  <button
                    type="button"
                    className="btn ghost btn-sm danger-text"
                    onClick={() => handleUnlinkPatient(p.id)}
                    disabled={unlinkingId === String(p.id)}
                  >
                    {unlinkingId === String(p.id) ? 'Removing…' : 'Remove'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
