import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client.js';

/**
 * Single patient view: profile, adherence, medications, recent logs.
 */
export function DoctorPatientDetail() {
  const { patientId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const { data: res } = await api.get(`/api/doctor/patient/${patientId}`);
        if (!cancelled) setData(res);
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.message || 'Could not load patient.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  if (loading) {
    return (
      <div className="page">
        <div className="card page-card">
          <p className="muted">Loading patient…</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="page">
        <div className="alert error page-alert">{error || 'Not found.'}</div>
        <Link to="/doctor" className="btn ghost">
          ← Back to patients
        </Link>
      </div>
    );
  }

  const { patient, adherence, medications, recentLogs } = data;

  return (
    <div className="page">
      <p className="compact-bottom">
        <Link to="/doctor" className="muted small">
          ← All patients
        </Link>
      </p>
      <h1 className="page-title">{patient.name}</h1>
      <p className="page-lead muted">{patient.email}</p>

      <section className="card page-card">
        <h2>Adherence (last 30 days UTC)</h2>
        <div className="stats-grid doctor-stats">
          <div className="stat-block highlight">
            <span className="stat-label">Adherence</span>
            <span className="stat-value big">{adherence.adherencePercentage}%</span>
          </div>
          <div className="stat-block">
            <span className="stat-label">Total doses</span>
            <span className="stat-value">{adherence.totalDoses}</span>
          </div>
          <div className="stat-block">
            <span className="stat-label">Taken</span>
            <span className="stat-value ok">{adherence.takenDoses}</span>
          </div>
          <div className="stat-block">
            <span className="stat-label">Missed</span>
            <span className="stat-value warn">{adherence.missedDoses}</span>
          </div>
        </div>
        <div className="adherence-risk-row">
          <div className="adherence-risk-item">
            <span className="stat-label">Risk</span>
            {adherence.riskLevel === 'unknown' ? (
              <p className="muted risk-unknown-label">No sufficient data</p>
            ) : (
              <span className={`risk-badge risk-${adherence.riskLevel}`}>{adherence.riskLevel}</span>
            )}
          </div>
          {adherence.riskScore != null && (
            <div className="adherence-risk-item">
              <span className="stat-label">Risk score</span>
              <span className="stat-value">{adherence.riskScore}</span>
              <span className="muted small risk-score-hint">0–100</span>
            </div>
          )}
          <p className="missed-streak-line">
            Missed streak: <strong>{adherence.missedStreak ?? 0}</strong>{' '}
            {(adherence.missedStreak ?? 0) === 1 ? 'day' : 'days'}
          </p>
        </div>
        {adherence.riskReason && (
          <p className="risk-reason-explanation">{adherence.riskReason}</p>
        )}
      </section>

      <section className="card page-card">
        <h2>Medications</h2>
        {!medications?.length ? (
          <p className="muted">None recorded.</p>
        ) : (
          <ul className="item-list">
            {medications.map((m) => (
              <li key={m._id} className="item-row">
                <div className="item-body">
                  <strong>{m.name}</strong>
                  {m.dosage ? <span className="muted"> · {m.dosage}</span> : null}
                  {Array.isArray(m.schedule) && m.schedule.length > 0 && (
                    <div className="chips">
                      {m.schedule.map((t) => (
                        <span key={t} className="chip">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card page-card">
        <h2>Recent logs</h2>
        {!recentLogs?.length ? (
          <p className="muted">No logs yet.</p>
        ) : (
          <ul className="history-list">
            {recentLogs.map((log) => (
              <li key={log.id} className="history-item">
                <div className="history-top">
                  <span className={`log-status status-${log.status}`}>{log.status}</span>
                  <time>{log.date ? new Date(log.date).toLocaleDateString() : '—'}</time>
                </div>
                {log.medication?.name && (
                  <div className="muted small">{log.medication.name}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
