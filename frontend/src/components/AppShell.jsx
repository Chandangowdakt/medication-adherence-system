import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { ReminderBanner } from './ReminderBanner.jsx';
import {
  getNotificationPermission,
  requestReminderNotificationPermission,
  startMedicationReminderScheduler,
} from '../reminders/medicationReminders.js';
import { registerDeviceForPush, unregisterDevicePush } from '../firebase/messagingClient.js';
import { clearToken, getToken } from '../utils/authStorage.js';
import { isDoctorToken } from '../utils/jwtPayload.js';

/**
 * Shared chrome: primary nav + outlet for protected pages.
 */
export function AppShell() {
  const navigate = useNavigate();
  const isDoctor = isDoctorToken(getToken());
  const [notifPerm, setNotifPerm] = useState(() => getNotificationPermission());

  /** Patient reminders only (doctors use a different home). */
  useEffect(() => {
    if (isDoctor) return undefined;
    return startMedicationReminderScheduler();
  }, [isDoctor]);

  /** Register FCM token with API when patient is signed in (e.g. returning user already granted permission). */
  useEffect(() => {
    if (isDoctor) return;
    registerDeviceForPush().catch(() => {
      /* optional: user denied, not configured, or unsupported */
    });
  }, [isDoctor]);

  async function handleEnableNotifications() {
    const result = await requestReminderNotificationPermission();
    setNotifPerm(result);
    if (result === 'granted') {
      await registerDeviceForPush().catch(() => {});
    }
  }

  async function logout() {
    await unregisterDevicePush();
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
          {!isDoctor && notifPerm === 'default' && (
            <button type="button" className="btn ghost btn-sm" onClick={handleEnableNotifications}>
              Enable notifications
            </button>
          )}
          {!isDoctor && notifPerm === 'denied' && (
            <span className="shell-notif-hint muted small" title="Allow notifications in browser site settings">
              Notifications blocked
            </span>
          )}
          {!isDoctor && notifPerm === 'unsupported' && (
            <span className="shell-notif-hint muted small">Browser notifications unavailable</span>
          )}
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
