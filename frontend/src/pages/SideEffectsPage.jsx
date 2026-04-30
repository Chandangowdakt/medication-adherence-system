import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { medId } from '../utils/medId.js';

const SEVERITIES = ['low', 'medium', 'high'];

/**
 * Report side effects and browse history with severity filter + date sort (server-side).
 */
export function SideEffectsPage() {
  const [medications, setMedications] = useState([]);
  const [sideEffects, setSideEffects] = useState([]);
  const [medsLoading, setMedsLoading] = useState(true);
  const [effectsLoading, setEffectsLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [severityFilter, setSeverityFilter] = useState('');
  const [dateOrder, setDateOrder] = useState('desc');

  const [medicationId, setMedicationId] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState('medium');
  const [occurredAt, setOccurredAt] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setMedsLoading(true);
      setError('');
      try {
        const { data } = await api.get('/medications');
        if (cancelled) return;
        const list = data.medications ?? [];
        setMedications(list);
        setMedicationId((prev) => prev || (list[0] ? medId(list[0]) : ''));
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.message || 'Could not load medications.');
        }
      } finally {
        if (!cancelled) setMedsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadEffects = useCallback(async () => {
    const params = new URLSearchParams();
    if (severityFilter) params.set('severity', severityFilter);
    params.set('order', dateOrder);
    const { data } = await api.get(`/side-effects?${params.toString()}`);
    return data.sideEffects ?? [];
  }, [severityFilter, dateOrder]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setEffectsLoading(true);
      setError('');
      try {
        const list = await loadEffects();
        if (!cancelled) setSideEffects(list);
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.message || 'Could not load side effects.');
        }
      } finally {
        if (!cancelled) setEffectsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadEffects]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const body = { medicationId, description: description.trim(), severity };
      if (occurredAt) {
        body.date = new Date(occurredAt).toISOString();
      }
      await api.post('/side-effects', body);
      setDescription('');
      setOccurredAt('');
      const list = await loadEffects();
      setSideEffects(list);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not submit.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page">
      <h1 className="page-title">Side effects</h1>
      <p className="page-lead muted">Log symptoms and review past entries.</p>

      {error && <div className="alert error page-alert">{error}</div>}

      <section className="card page-card">
        <h2>Report a side effect</h2>
        {medsLoading ? (
          <p className="muted">Loading…</p>
        ) : medications.length === 0 ? (
          <p className="muted">Add a medication first to link a side effect.</p>
        ) : (
          <form className="form" onSubmit={handleSubmit}>
            <label>
              Medication
              <select
                value={medicationId}
                onChange={(e) => setMedicationId(e.target.value)}
                required
              >
                {medications.map((m) => (
                  <option key={medId(m)} value={medId(m)}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Description
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
                placeholder="What did you experience?"
              />
            </label>
            <label>
              Severity
              <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Date (optional)
              <input
                type="datetime-local"
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
              />
            </label>
            <button type="submit" className="btn primary" disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit'}
            </button>
          </form>
        )}
      </section>

      <section className="card page-card">
        <h2>History</h2>
        <div className="filter-toolbar">
          <label className="filter-field">
            <span className="filter-label">Severity</span>
            <select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}>
              <option value="">All</option>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span className="filter-label">Sort by date</span>
            <select value={dateOrder} onChange={(e) => setDateOrder(e.target.value)}>
              <option value="desc">Newest first</option>
              <option value="asc">Oldest first</option>
            </select>
          </label>
        </div>
        {effectsLoading ? (
          <p className="muted">Loading…</p>
        ) : sideEffects.length === 0 ? (
          <p className="muted">
            {severityFilter ? 'No entries match your filters.' : 'No entries yet.'}
          </p>
        ) : (
          <ul className="history-list">
            {sideEffects.map((row) => (
              <li key={row.id} className="history-item">
                <div className="history-top">
                  <span className={`sev sev-${row.severity}`}>{row.severity}</span>
                  <time dateTime={row.date}>
                    {row.date ? new Date(row.date).toLocaleString() : '—'}
                  </time>
                </div>
                {row.medication?.name && (
                  <div className="muted small">{row.medication.name}</div>
                )}
                <p className="history-desc">{row.description}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
