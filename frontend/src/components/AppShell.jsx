import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { ReminderBanner } from './ReminderBanner.jsx';
import { startMedicationReminderScheduler } from '../reminders/medicationReminders.js';
import { scheduleAllMedicationReminders } from '../utils/globalReminderManager.js';
import { clearToken, getToken } from '../utils/authStorage.js';
import { isDoctorToken } from '../utils/jwtPayload.js';
import { sendMedicationNotification } from '../utils/notificationSender.js';

/**
 * Shared chrome: primary nav + outlet for protected pages.
 */
export function AppShell() {
  const navigate = useNavigate();
  const isDoctor = isDoctorToken(getToken());
  const [notifPerm, setNotifPerm] = useState('default');

  /** Patient reminders only (doctors use a different home). */
  useEffect(() => {
    if (isDoctor) return undefined;
    return startMedicationReminderScheduler();
  }, [isDoctor]);

  useEffect(() => {
    if (isDoctorToken(getToken())) return;
    scheduleAllMedicationReminders(sendMedicationNotification);
  }, []);

  useEffect(() => {
    if (isDoctor) return;
    let active = true;
    (async () => {
      if (!Capacitor.isNativePlatform()) {
        if (active) setNotifPerm('unsupported');
        return;
      }
      try {
        await LocalNotifications.requestPermissions();
        const current = await LocalNotifications.checkPermissions();
        if (active) setNotifPerm(current.display ?? 'default');
      } catch {
        if (active) setNotifPerm('denied');
      }
    })();
    return () => {
      active = false;
    };
  }, [isDoctor]);

  async function logout() {
    clearToken();
    navigate('/login', { replace: true });
  }

  return (
    <div className="app-shell">
      <header className="shell-header">
        <span className="shell-brand">Medication Adherence</span>
        <nav className="shell-nav" aria-label="Main">
          {isDoctorToken(getToken()) ? (
            <NavLink
              to="/doctor"
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            >
              Patients
            </NavLink>
          ) : (
            <>
              <NavLink
                to="/dashboard"
                className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
              >
                Dashboard
              </NavLink>
              <NavLink
                to="/medications"
                className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
              >
                Medications
              </NavLink>
              <NavLink
                to="/side-effects"
                className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
              >
                Side effects
              </NavLink>
            </>
          )}
        </nav>
        <div className="shell-header-actions">
          {!isDoctor && notifPerm === 'granted' && <span className="shell-notif-hint muted small">💊 Notifications enabled</span>}
          {!isDoctor && notifPerm === 'denied' && <span className="shell-notif-hint muted small">❌ Permission denied</span>}
          {!isDoctor && notifPerm === 'unsupported' && <span className="shell-notif-hint muted small">Running in browser</span>}
          <button type="button" className="btn ghost btn-sm" onClick={logout}>
            Log out
          </button>
        </div>
      </header>
      {!isDoctor && <ReminderBanner />}
      <main className="shell-main">
        <Outlet />
      </main>
    </div>
  );
}
