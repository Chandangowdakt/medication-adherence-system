import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { medId } from '../utils/medId.js';
import { scheduleAllMedicationReminders } from '../utils/globalReminderManager.js';
import { sendMedicationNotification } from '../utils/notificationSender.js';

const MED_STORAGE_KEY = 'medications';

function parseSchedule(input) {
  if (!input || !String(input).trim()) return [];
  const normalize = (value) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(value).trim());
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h < 0 || h > 23 || min < 0 || min > 59) return null;
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  };
  return String(input)
    .split(',')
    .map((s) => normalize(s))
    .filter(Boolean);
}

function formatDisplayTime(raw) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(raw).trim());
  if (!match) return raw;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) return raw;
  const dt = new Date();
  dt.setHours(h, m, 0, 0);
  return dt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function nextDoseTimeLabel(schedule) {
  const slots = Array.isArray(schedule) ? schedule : parseSchedule(schedule);
  const now = new Date();
  const nextTimes = [];

  for (const slot of slots) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(slot).trim());
    if (!m) continue;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h < 0 || h > 23 || min < 0 || min > 59) continue;
    const target = new Date();
    target.setHours(h, min, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    nextTimes.push(target);
  }

  if (!nextTimes.length) return null;
  nextTimes.sort((a, b) => a.getTime() - b.getTime());
  return nextTimes[0].toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function totalDailyReminderCount(meds) {
  return meds.reduce((sum, med) => {
    const slots = Array.isArray(med?.schedule) ? med.schedule : parseSchedule(med?.schedule);
    return sum + slots.length;
  }, 0);
}

/**
 * CRUD medications: add form, list with search + active/inactive filter (server-side).
 */
export function MedicationsPage() {
  const [medications, setMedications] = useState([]);
  /** @type {Record<string, { medication: string; commonSideEffects: string[]; confidence: number; warning: string | null }>} */
  const [correlationByMedId, setCorrelationByMedId] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');

  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [name, setName] = useState('');
  const [dosage, setDosage] = useState('');
  const [scheduleStr, setScheduleStr] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(async () => {
    setError('');
    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (statusFilter) params.set('status', statusFilter);
      const qs = params.toString();
      const url = qs ? `/medications?${qs}` : '/medications';
      const [medRes, corrRes] = await Promise.all([
        api.get(url),
        api.get('/side-effects/correlations').catch(() => ({ data: { correlations: [] } })),
      ]);
      const data = medRes.data;
      const meds = data.medications ?? [];
      setMedications(meds);
      localStorage.setItem(MED_STORAGE_KEY, JSON.stringify(meds));
      const map = {};
      for (const row of corrRes.data?.correlations ?? []) {
        if (row.medicationId) map[String(row.medicationId)] = row;
      }
      setCorrelationByMedId(map);
      return meds;
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load medications.');
      return [];
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, statusFilter]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setFormError('');
    setSaving(true);
    try {
      const cleanName = name.trim();
      const cleanDosage = dosage.trim();
      const schedule = parseSchedule(scheduleStr);
      if (!cleanName) {
        setFormError('Medication name is required.');
        return;
      }
      if (schedule.length === 0) {
        setFormError('At least one schedule time is required.');
        return;
      }
      const body = { name: cleanName, dosage: cleanDosage, schedule };
      if (startDate) body.startDate = startDate;
      if (endDate) body.endDate = endDate;
      await api.post('/medications', body);
      setName('');
      setDosage('');
      setScheduleStr('');
      setStartDate('');
      setEndDate('');
      const meds = await load();
      localStorage.setItem(MED_STORAGE_KEY, JSON.stringify(meds));
      await scheduleAllMedicationReminders(sendMedicationNotification, meds);
    } catch (err) {
      setError(err.response?.data?.message || 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this medication?')) return;
    setError('');
    try {
      await api.delete(`/medications/${id}`);
      const meds = await load();
      localStorage.setItem(MED_STORAGE_KEY, JSON.stringify(meds));
      await scheduleAllMedicationReminders(sendMedicationNotification, meds);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not delete.');
    }
  }

  return (
    <div className="page">
      <h1 className="page-title">Medications</h1>
      <p className="page-lead muted">Add prescriptions and daily reminder times (comma-separated, e.g. 08:00, 20:00).</p>

      {error && <div className="alert error page-alert">{error}</div>}

      <section className="card page-card">
        <h2>Add medication</h2>
        {formError ? <div className="alert error page-alert">{formError}</div> : null}
        <form className="form" onSubmit={handleSubmit}>
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            Dosage
            <input value={dosage} onChange={(e) => setDosage(e.target.value)} placeholder="e.g. 10mg" />
          </label>
          <label>
            Schedule (times)
            <input
              value={scheduleStr}
              onChange={(e) => setScheduleStr(e.target.value)}
              placeholder="08:00, 20:00"
            />
          </label>
          <div className="form-row">
            <label>
              Start date (optional)
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <label>
              End date (optional)
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </label>
          </div>
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? 'Saving…' : 'Add medication'}
          </button>
        </form>
      </section>

      <section className="card page-card">
        <h2>Your medications</h2>
        <p className="muted small compact-bottom">
          Total reminders today: {totalDailyReminderCount(medications)}
        </p>
        <div className="filter-toolbar">
          <label className="filter-field">
            <span className="filter-label">Search name</span>
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Type to filter…"
              autoComplete="off"
            />
          </label>
          <label className="filter-field">
            <span className="filter-label">Status (today UTC)</span>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
        </div>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : medications.length === 0 ? (
          <p className="muted">
            {debouncedSearch || statusFilter
              ? 'No medications match your filters.'
              : 'No medications added yet'}
          </p>
        ) : (
          <ul className="item-list">
            {medications.map((m) => {
              const id = medId(m);
              const corr = correlationByMedId[String(id)];
              const nextDose = nextDoseTimeLabel(m.schedule);
              return (
                <li key={id} className="item-row">
                  <div className="item-body">
                    <strong>{m.name}</strong>
                    {m.dosage ? <span className="muted"> · {m.dosage}</span> : null}
                    {corr?.warning ? (
                      <p className="med-side-correlation-warn" role="status">
                        {corr.warning}
                        {typeof corr.confidence === 'number' ? (
                          <span className="muted small">
                            {' '}
                            (estimated strength {Math.round(corr.confidence * 100)}% — from your logged side
                            effects)
                          </span>
                        ) : null}
                      </p>
                    ) : null}
                    {Array.isArray(m.schedule) && m.schedule.length > 0 && (
                      <div className="chips">
                        {m.schedule.map((t) => (
                          <span key={t} className="chip">
                            {formatDisplayTime(t)}
                          </span>
                        ))}
                      </div>
                    )}
                    {nextDose ? (
                      <div className="muted small compact-top">
                        Next dose: {nextDose}
                      </div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="btn ghost btn-sm danger-text"
                    onClick={() => handleDelete(id)}
                  >
                    Delete
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
