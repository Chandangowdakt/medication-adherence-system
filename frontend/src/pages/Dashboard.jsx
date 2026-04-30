import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../api/client.js';
import { Reminder } from '../components/Reminder.jsx';
import { buildAdherencePdf } from '../utils/adherenceReportPdf.js';
import { getAxiosErrorMessage } from '../utils/axiosError.js';
import { medId } from '../utils/medId.js';
import { useAppSocket } from '../hooks/useAppSocket.js';

const CHART_TAKEN = '#0d9488';
const CHART_MISSED = '#c2410c';
const CHART_LINE = '#0d6efd';
const CHART_FORECAST = '#c026d3';

function interventionTypeLabel(type) {
  if (type === 'reminder_adjustment') return 'Reminder adjustment';
  if (type === 'doctor_notify') return 'Care team';
  if (type === 'alert') return 'Guidance';
  return type || '—';
}

function TrendLineTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-title">{row.fullDate}</div>
      <div className="chart-tooltip-body">
        {row.adherence == null
          ? 'No scheduled doses or no data'
          : row.labelMode === 'expected'
            ? `${row.adherence}% (taken ÷ expected doses that UTC day)`
            : `${row.adherence}% of logged dose events that day (taken vs taken+missed)`}
      </div>
    </div>
  );
}

function BarTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-title">{row.fullDate}</div>
      <div className="chart-tooltip-body">
        Taken: {row.takenDoses} · Missed: {row.missedDoses}
      </div>
    </div>
  );
}

function ForecastChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const parts = [];
  if (row.actual != null) parts.push(`Logged: ${row.actual}% taken`);
  if (row.projected != null) parts.push(`Projected: ${row.projected}%`);
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-title">{row.fullDate}</div>
      <div className="chart-tooltip-body">{parts.join(' · ') || '—'}</div>
    </div>
  );
}

async function fetchDashboardBundle() {
  const summaryPromise = api.get('/dashboard/summary');
  const trendsPromise = api
    .get('/analytics/trends')
    .then((r) => ({ ok: true, data: r.data }))
    .catch(() => ({ ok: false, data: { days: [] } }));
  const predictionPromise = api
    .get('/analytics/prediction')
    .then((r) => ({ ok: true, data: r.data }))
    .catch(() => ({ ok: false, data: null }));
  const interventionPromise = api
    .get('/analytics/intervention')
    .then((r) => ({ ok: true, data: r.data }))
    .catch(() => ({ ok: false, data: null }));
  const behaviorPromise = api
    .get('/analytics/behavior-patterns')
    .then((r) => ({ ok: true, data: r.data }))
    .catch(() => ({ ok: false, data: null }));
  const forecastPromise = api
    .get('/analytics/forecast')
    .then((r) => ({ ok: true, data: r.data }))
    .catch(() => ({ ok: false, data: null }));
  const [{ data }, trendOutcome, predOutcome, interventionOutcome, behaviorOutcome, forecastOutcome] =
    await Promise.all([
      summaryPromise,
      trendsPromise,
      predictionPromise,
      interventionPromise,
      behaviorPromise,
      forecastPromise,
    ]);
  return {
    data,
    trendOutcome,
    predOutcome,
    interventionOutcome,
    behaviorOutcome,
    forecastOutcome,
  };
}

/**
 * Overview: GET /api/dashboard/summary + /api/analytics/trends; charts from daily log counts (UTC).
 */
export function Dashboard() {
  const [user, setUser] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [medications, setMedications] = useState([]);
  const [todayLogs, setTodayLogs] = useState([]);
  const [trendDays, setTrendDays] = useState([]);
  const [trendsUnavailable, setTrendsUnavailable] = useState(false);
  const [prediction, setPrediction] = useState(null);
  const [predictionUnavailable, setPredictionUnavailable] = useState(false);
  const [intervention, setIntervention] = useState(null);
  const [interventionUnavailable, setInterventionUnavailable] = useState(false);
  const [behaviorPatterns, setBehaviorPatterns] = useState(null);
  const [behaviorUnavailable, setBehaviorUnavailable] = useState(false);
  const [adaptiveReminder, setAdaptiveReminder] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [forecastUnavailable, setForecastUnavailable] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [logBusyId, setLogBusyId] = useState('');
  const [pdfLoading, setPdfLoading] = useState(false);
  const [csvLoading, setCsvLoading] = useState(false);

  const { lineData, barData, pieData, trendLogTotal } = useMemo(() => {
    const barDataInner = trendDays.map((d) => ({
      label: d.date.slice(5),
      fullDate: d.date,
      takenDoses: d.takenDoses,
      missedDoses: d.missedDoses,
    }));
    const lineDataInner = trendDays.map((d) => {
      const hasServerDay =
        d.adherenceDayPercent != null && !Number.isNaN(Number(d.adherenceDayPercent));
      if (hasServerDay) {
        return {
          label: d.date.slice(5),
          fullDate: d.date,
          adherence: Math.min(100, Math.max(0, Number(d.adherenceDayPercent))),
          labelMode: 'expected',
        };
      }
      const total = (d.takenDoses ?? 0) + (d.missedDoses ?? 0);
      return {
        label: d.date.slice(5),
        fullDate: d.date,
        adherence: total === 0 ? null : Math.round((d.takenDoses / total) * 1000) / 10,
        labelMode: 'logged',
      };
    });
    const taken = trendDays.reduce((s, d) => s + d.takenDoses, 0);
    const missed = trendDays.reduce((s, d) => s + d.missedDoses, 0);
    const pieDataInner = [
      { name: 'Taken', value: taken, fill: CHART_TAKEN },
      { name: 'Missed', value: missed, fill: CHART_MISSED },
    ].filter((x) => x.value > 0);
    return {
      lineData: lineDataInner,
      barData: barDataInner,
      pieData: pieDataInner,
      trendLogTotal: taken + missed,
    };
  }, [trendDays]);

  const forecastChartData = useMemo(() => {
    if (!forecast?.chartPoints?.length) return [];
    return forecast.chartPoints.map((p) => ({
      label: p.date.slice(5),
      fullDate: p.date,
      actual: p.kind === 'actual' ? p.adherence : null,
      projected: p.kind === 'forecast' ? p.adherence : null,
    }));
  }, [forecast]);

  const runLoad = useCallback(async (options = { showLoading: true }) => {
    const showLoading = options?.showLoading !== false;
    if (showLoading) setLoading(true);
    setError('');
    try {
      const bundle = await fetchDashboardBundle();
      const {
        data,
        trendOutcome,
        predOutcome,
        interventionOutcome,
        behaviorOutcome,
        forecastOutcome,
      } = bundle;
      setUser(data.user ?? null);
      setAnalytics(data.adherence ?? null);
      setMedications(data.medications ?? []);
      setTodayLogs(data.todayLogs ?? []);
      setTrendsUnavailable(!trendOutcome.ok);
      setTrendDays(
        trendOutcome.ok && Array.isArray(trendOutcome.data?.days) ? trendOutcome.data.days : []
      );
      setPredictionUnavailable(!predOutcome.ok);
      setPrediction(predOutcome.ok ? predOutcome.data : null);
      setInterventionUnavailable(!interventionOutcome.ok);
      setIntervention(interventionOutcome.ok ? interventionOutcome.data : null);
      setBehaviorUnavailable(!behaviorOutcome.ok);
      setBehaviorPatterns(behaviorOutcome.ok ? behaviorOutcome.data : null);
      setAdaptiveReminder(data.adaptiveReminder ?? null);
      setForecastUnavailable(!forecastOutcome.ok);
      setForecast(forecastOutcome.ok ? forecastOutcome.data : null);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load dashboard.');
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    runLoad({ showLoading: true });
  }, [runLoad]);

  useAppSocket(() => {
    runLoad({ showLoading: false });
  });

  function todayStatusForMed(medicationId) {
    const row = todayLogs.find((l) => String(l.medicationId) === String(medicationId));
    return row?.status ?? null;
  }

  async function postLog(medicationId, status) {
    setError('');
    setLogBusyId(medicationId);
    try {
      await api.post('/logs', { medicationId, status });
      await runLoad({ showLoading: false });
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save log.');
    } finally {
      setLogBusyId('');
    }
  }

  async function handleDownloadReport() {
    setError('');
    setPdfLoading(true);
    try {
      const { data } = await api.get('/reports/adherence');
      buildAdherencePdf(data);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not download report.');
    } finally {
      setPdfLoading(false);
    }
  }

  async function handleExportCsv() {
    setError('');
    setCsvLoading(true);
    try {
      const res = await api.get('/reports/export-csv', { responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const cd = res.headers['content-disposition'];
      const match = cd && /filename="?([^";\n]+)"?/i.exec(cd);
      a.download =
        match?.[1]?.trim() || `adherence-logs-${new Date().toISOString().slice(0, 10)}.csv`;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(await getAxiosErrorMessage(err, 'Could not export CSV.'));
    } finally {
      setCsvLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="page">
        <div className="card page-card">
          <p className="muted">Loading dashboard…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="dashboard-header">
        <h1 className="page-title">Dashboard</h1>
        <div className="dashboard-actions">
          <button
            type="button"
            className="btn ghost btn-sm"
            disabled={csvLoading}
            onClick={handleExportCsv}
          >
            {csvLoading ? 'Exporting…' : 'Export CSV'}
          </button>
          <button
            type="button"
            className="btn primary btn-sm"
            disabled={pdfLoading}
            onClick={handleDownloadReport}
          >
            {pdfLoading ? 'Generating…' : 'Download Report'}
          </button>
        </div>
      </div>

      {error && <div className="alert error page-alert">{error}</div>}

      {adaptiveReminder?.active && adaptiveReminder?.message && (
        <div className="alert adaptive-reminder-hint" role="status">
          <strong>Adaptive reminders</strong>
          <p className="muted small compact-top">
            {adaptiveReminder.message}. Evening doses (UTC, 17:00+) may notify about{' '}
            {adaptiveReminder.eveningEarlyMinutes} minutes before your scheduled time, based on recent
            misses and miss-risk estimate.
          </p>
        </div>
      )}

      {prediction && prediction.missProbability > 0.6 && (
        <div className="alert prediction-warning-banner" role="alert">
          <strong>Miss prediction warning</strong>
          <p>{prediction.message}</p>
          <p className="muted small compact-top">
            Estimated probability of missing the next scheduled dose:{' '}
            <strong>{Math.round(prediction.missProbability * 100)}%</strong> ({prediction.risk} risk).
            This is a simple heuristic, not a diagnosis.
          </p>
        </div>
      )}

      {prediction && (
        <section className="card page-card prediction-card">
          <h2>Next dose prediction</h2>
          <p className="muted small compact-bottom">
            Based on your last 30 days (adherence %, missed streak) and last 7 days miss share, plus
            when your next reminder time falls (UTC). No machine learning — fixed weighted formula.
            If you have clear miss patterns by time or weekday, a short note may be appended to the
            message below.
          </p>
          <div className="prediction-main">
            <div>
              <span className="stat-label">Miss probability</span>
              <div className="prediction-probability">
                {Math.round(prediction.missProbability * 100)}%
              </div>
            </div>
            <div>
              <span className="stat-label">Risk band</span>
              <div>
                <span className={`risk-badge risk-${prediction.risk}`}>{prediction.risk}</span>
              </div>
            </div>
          </div>
          <p className="prediction-message">{prediction.message}</p>
          {prediction.breakdown?.formula && (
            <p className="muted small compact-top">
              Formula: <code className="prediction-formula">{prediction.breakdown.formula}</code>
            </p>
          )}
        </section>
      )}

      {predictionUnavailable && !prediction && !loading && (
        <section className="card page-card">
          <h2>Next dose prediction</h2>
          <p className="muted">Could not load prediction. Other dashboard data is still available.</p>
        </section>
      )}

      {behaviorPatterns && (
        <section className="card page-card behavior-patterns-card" aria-labelledby="behavior-patterns-heading">
          <h2 id="behavior-patterns-heading">Miss pattern insights</h2>
          <p className="muted small compact-bottom">
            Last 30 days (UTC), from logged misses. Time-of-day uses the miss timestamp when
            dose-level logging is on; otherwise it is inferred from your medication schedule.
          </p>
          <div className="behavior-patterns-chips" aria-label="Summary">
            <div className="behavior-chip">
              <span className="muted small">Most missed time of day</span>
              <strong>{behaviorPatterns.mostMissedTime ?? '—'}</strong>
            </div>
            <div className="behavior-chip">
              <span className="muted small">Most missed weekday</span>
              <strong>{behaviorPatterns.mostMissedDay ?? '—'}</strong>
            </div>
          </div>
          <p className="behavior-patterns-insight">{behaviorPatterns.insight}</p>
        </section>
      )}

      {behaviorUnavailable && !behaviorPatterns && !loading && (
        <section className="card page-card">
          <h2>Miss pattern insights</h2>
          <p className="muted">Could not load behavior patterns.</p>
        </section>
      )}

      {intervention && (
        <section
          className={`card page-card intervention-card${intervention.critical ? ' intervention-card--critical' : ''}`}
          aria-labelledby="intervention-heading"
        >
          <div className="intervention-card-header">
            <h2 id="intervention-heading">Recommended action</h2>
            {intervention.critical && (
              <span className="intervention-critical-pill" role="status">
                Critical
              </span>
            )}
          </div>
          <p className="intervention-type-line">
            <span className="muted small">Type</span>{' '}
            <span className="intervention-type-badge">{interventionTypeLabel(intervention.interventionType)}</span>
          </p>
          <p className="intervention-message">{intervention.message}</p>
          <div className="intervention-action-block">
            <span className="stat-label">Suggested action</span>
            <p className="intervention-action">{intervention.action}</p>
          </div>
          {Array.isArray(intervention.rationale) && intervention.rationale.length > 0 && (
            <details className="intervention-rationale-details">
              <summary>Why this recommendation</summary>
              <ul className="intervention-rationale-list">
                {intervention.rationale.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {interventionUnavailable && !intervention && !loading && (
        <section className="card page-card">
          <h2>Recommended action</h2>
          <p className="muted">Could not load intervention suggestion. Other dashboard data is still available.</p>
        </section>
      )}

      {user && (
        <section className="card page-card">
          <h2>Account</h2>
          <p className="muted compact-bottom">
            <strong>{user.name}</strong> · {user.email} ·{' '}
            <span className="role-badge">{user.role}</span>
          </p>
        </section>
      )}

      <Reminder />

      <section
        className={`card page-card adherence-card${analytics?.riskLevel === 'high' ? ' adherence-card--risk-high' : ''}`}
      >
        <h2>Adherence</h2>
        {analytics ? (
          <>
            {analytics.riskLevel === 'high' && (
              <div className="adherence-high-risk-alert" role="alert">
                <strong>High risk</strong>
                <p>
                  Review the explanation below, adjust reminders as needed, or contact your care team
                  for support.
                </p>
              </div>
            )}

            <div className="stats-grid">
              <div className="stat-block highlight">
                <span className="stat-label">Adherence</span>
                <span className="stat-value big">
                  {Number.isFinite(Number(analytics.adherencePercentage))
                    ? Math.min(100, Math.max(0, Math.round(analytics.adherencePercentage * 10) / 10))
                    : '—'}
                  {Number.isFinite(Number(analytics.adherencePercentage)) ? '%' : ''}
                </span>
              </div>
              <div className="stat-block">
                <span className="stat-label">Total doses (window)</span>
                <span className="stat-value">{analytics.totalDoses}</span>
              </div>
              <div className="stat-block">
                <span className="stat-label">Taken</span>
                <span className="stat-value ok">{analytics.takenDoses}</span>
              </div>
              <div className="stat-block">
                <span className="stat-label">Missed</span>
                <span className="stat-value warn">{analytics.missedDoses}</span>
              </div>
            </div>

            <div className="adherence-risk-row">
              <div className="adherence-risk-item">
                <span className="stat-label">Risk level</span>
                {analytics.riskLevel === 'unknown' ? (
                  <p className="muted risk-unknown-label">No sufficient data</p>
                ) : (
                  <span className={`risk-badge risk-${analytics.riskLevel ?? 'medium'}`}>
                    {analytics.riskLevel ?? '—'}
                  </span>
                )}
              </div>
              {analytics.riskScore != null && (
                <div className="adherence-risk-item">
                  <span className="stat-label">Risk score</span>
                  <span className="stat-value">{analytics.riskScore}</span>
                  <span className="muted small risk-score-hint">0–100 (higher = more concern)</span>
                </div>
              )}
              <p className="missed-streak-line">
                Missed streak:{' '}
                <strong>{analytics.missedStreak ?? 0}</strong>{' '}
                {(analytics.missedStreak ?? 0) === 1 ? 'day' : 'days'}
              </p>
            </div>
            {analytics.riskReason && (
              <p className="risk-reason-explanation">{analytics.riskReason}</p>
            )}
          </>
        ) : (
          <p className="muted">No analytics yet.</p>
        )}
        <p className="muted small compact-top">
          Last 30 days (UTC). Risk score weighs adherence, missed streak, and side-effect severity in
          the same window. If side effects cannot be loaded, risk falls back to adherence-only bands.
        </p>
      </section>

      <section className="card page-card dashboard-charts-card">
        <h2>Analytics charts</h2>
        <p className="muted small compact-top">
          Based on daily dose logs (UTC). Each chart uses raw log counts — not slot-weighted totals.
        </p>

        <div className="charts-grid">
          {trendsUnavailable ? (
            <div className="chart-panel chart-panel--wide">
              <p className="muted chart-empty">
                Chart data could not be loaded. Summary and dose logging still work — try refreshing the
                page.
              </p>
            </div>
          ) : (
            <>
            <div className="chart-panel chart-panel--wide">
              <h3 className="chart-title">Daily adherence % (logged doses only)</h3>
              {trendLogTotal === 0 ? (
                <p className="muted chart-empty">No logs in the last 30 days — mark Taken or Missed to see trends.</p>
              ) : (
                <div className="chart-wrap">
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={lineData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={4} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" width={36} />
                      <Tooltip content={<TrendLineTooltip />} />
                      <Line
                        type="monotone"
                        dataKey="adherence"
                        name="Adherence"
                        stroke={CHART_LINE}
                        strokeWidth={2}
                        dot={{ r: 2 }}
                        connectNulls={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="chart-panel">
              <h3 className="chart-title">Taken vs missed (30 days)</h3>
              {pieData.length === 0 ? (
                <p className="muted chart-empty">No data available.</p>
              ) : (
                <div className="chart-wrap chart-wrap--pie">
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={52}
                        outerRadius={80}
                        paddingAngle={2}
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      >
                        {pieData.map((entry) => (
                          <Cell key={entry.name} fill={entry.fill} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v) => [v, 'Logs']} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="chart-panel chart-panel--wide">
              <h3 className="chart-title">Logs per day</h3>
              {trendLogTotal === 0 ? (
                <p className="muted chart-empty">No logs to display.</p>
              ) : (
                <div className="chart-wrap">
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={barData} margin={{ top: 8, right: 8, left: 0, bottom: 24 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="label" tick={{ fontSize: 9 }} interval={2} angle={-35} textAnchor="end" height={48} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={28} />
                      <Tooltip content={<BarTooltip />} />
                      <Legend />
                      <Bar dataKey="takenDoses" name="Taken" fill={CHART_TAKEN} radius={[2, 2, 0, 0]} />
                      <Bar dataKey="missedDoses" name="Missed" fill={CHART_MISSED} radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
            </>
          )}

            {!forecastUnavailable && forecast && forecast.expectedAdherenceNextWeek != null && (
              <div className="chart-panel chart-panel--wide forecast-adherence-panel">
                <h3 className="chart-title">Adherence forecast (next 7 days, UTC)</h3>
                <p className="muted small compact-bottom">
                  <strong>Trend:</strong>{' '}
                  <span className={`forecast-trend forecast-trend--${forecast.trend}`}>
                    {forecast.trend}
                  </span>
                  {' · '}
                  <strong>Expected average next week:</strong> {forecast.expectedAdherenceNextWeek}%
                  {forecast.note ? (
                    <>
                      <br />
                      {forecast.note}
                    </>
                  ) : null}
                </p>
                {forecastChartData.length > 0 ? (
                  <div className="chart-wrap">
                    <ResponsiveContainer width="100%" height={280}>
                      <LineChart
                        data={forecastChartData}
                        margin={{ top: 8, right: 8, left: 0, bottom: 24 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 9 }}
                          interval={3}
                          angle={-30}
                          textAnchor="end"
                          height={44}
                        />
                        <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" width={36} />
                        <Tooltip content={<ForecastChartTooltip />} />
                        <Legend />
                        <Line
                          type="monotone"
                          dataKey="actual"
                          name="Logged % taken"
                          stroke={CHART_LINE}
                          strokeWidth={2}
                          dot={{ r: 2 }}
                          connectNulls={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="projected"
                          name="Projected % taken"
                          stroke={CHART_FORECAST}
                          strokeWidth={2}
                          strokeDasharray="6 4"
                          dot={{ r: 3 }}
                          connectNulls={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : null}
              </div>
            )}

            {!forecastUnavailable &&
              forecast &&
              forecast.expectedAdherenceNextWeek == null &&
              forecast.note && (
                <div className="chart-panel chart-panel--wide">
                  <h3 className="chart-title">Adherence forecast</h3>
                  <p className="muted chart-empty">{forecast.note}</p>
                </div>
              )}

            {forecastUnavailable && !loading && (
              <div className="chart-panel chart-panel--wide">
                <h3 className="chart-title">Adherence forecast</h3>
                <p className="muted chart-empty">Forecast could not be loaded.</p>
              </div>
            )}
        </div>
      </section>

      <section className="card page-card">
        <h2>Today&apos;s dose log</h2>
        <p className="muted compact-bottom">Mark each medication for today (UTC calendar day).</p>
        {medications.length === 0 ? (
          <p className="muted">Add medications to log doses.</p>
        ) : (
          <ul className="log-list">
            {medications.map((m) => {
              const id = medId(m);
              const status = todayStatusForMed(id);
              const busy = logBusyId === id;
              return (
                <li key={id} className="log-row">
                  <div className="log-row-info">
                    <strong>{m.name}</strong>
                    {status && (
                      <span className={`log-status status-${status}`}>Today: {status}</span>
                    )}
                  </div>
                  <div className="log-row-actions">
                    <button
                      type="button"
                      className="btn btn-sm btn-taken"
                      disabled={busy}
                      onClick={() => postLog(id, 'taken')}
                    >
                      {busy ? '…' : 'Taken'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-missed"
                      disabled={busy}
                      onClick={() => postLog(id, 'missed')}
                    >
                      {busy ? '…' : 'Missed'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
