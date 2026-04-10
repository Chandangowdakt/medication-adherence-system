import { initializeApp, getApps } from 'firebase/app';
import { getMessaging, getToken, isSupported } from 'firebase/messaging';
import { api } from '../api/client.js';

const FCM_TOKEN_KEY = 'mat_fcm_registered_token';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export function isFirebaseWebConfigured() {
  return !!(
    firebaseConfig.apiKey &&
    firebaseConfig.messagingSenderId &&
    firebaseConfig.appId &&
    import.meta.env.VITE_FIREBASE_VAPID_KEY
  );
}

function getFirebaseApp() {
  if (!getApps().length) {
    return initializeApp(firebaseConfig);
  }
  return getApps()[0];
}

/**
 * Request notification permission, obtain FCM token, register with API.
 * @returns {Promise<string|null>} token or null if unavailable
 */
export async function registerDeviceForPush() {
  if (!isFirebaseWebConfigured() || typeof window === 'undefined') {
    return null;
  }
  if (!(await isSupported())) {
    return null;
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return null;
  }

  const messaging = getMessaging(getFirebaseApp());
  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
  const token = await getToken(messaging, { vapidKey });

  if (!token) {
    return null;
  }

  await api.post('/api/notifications/register-token', { token });
  try {
    sessionStorage.setItem(FCM_TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
  return token;
}

/** Call before logout to stop server pushes to this browser. */
export async function unregisterDevicePush() {
  let token = null;
  try {
    token = sessionStorage.getItem(FCM_TOKEN_KEY);
  } catch {
    /* ignore */
  }
  if (!token) return;
  try {
    await api.delete('/api/notifications/token', { data: { token } });
  } catch {
    /* ignore */
  }
  try {
    sessionStorage.removeItem(FCM_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}
