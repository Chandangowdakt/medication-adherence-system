import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';

/**
 * Lists patients linked to the logged-in doctor.
 */
export function DoctorDashboard() {
  const [patients, setPatients] = useState([]);
  const [highRiskPatients, setHighRiskPatients] = useState([]);
  const [lowAdherencePatients, setLowAdherencePatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError('');
      try {
        const { data } = await api.get('/api/doctor/patients');
        if (!cancelled) {
          setPatients(data.patients ?? []);
          setHighRiskPatients(data.highRiskPatients ?? []);
          setLowAdherencePatients(data.lowAdherencePatients ?? []);
        }
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
  }, []);

  return (
    <div className="page">
      <h1 className="page-title">Doctor dashboard</h1>
      <p className="page-lead muted">Patients assigned to you.</p>

      {error && <div className="alert error page-alert">{error}</div>}

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
          <p className="muted">No linked patients yet. Link patients by setting their linkedDoctorId.</p>
        ) : (
          <ul className="item-list doctor-patient-list">
            {patients.map((p) => (
              <li
                key={p.id}
                className={`item-row doctor-patient-row${p.highRisk ? ' doctor-patient-row--risky' : ''}`}
              >
                <div className="item-body">
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
                  {p.totalDoses > 0 && (
                    <div className="doctor-patient-metrics muted small">
                      Adherence {p.adherencePercentage ?? '—'}%
                      {p.riskScore != null ? ` · Risk score ${p.riskScore}` : ''}
                      {p.riskLevel && p.riskLevel !== 'unknown' ? ` · ${p.riskLevel}` : ''}
                    </div>
                  )}
                </div>
                <Link to={`/doctor/patient/${p.id}`} className="btn primary btn-sm">
                  View
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
