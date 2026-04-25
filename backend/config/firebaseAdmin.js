import { readFileSync } from 'fs';
import admin from 'firebase-admin';

let initialized = false;

/**
 * Initialize Firebase Admin from service account JSON (file path or raw JSON string).
 * @returns {boolean} true if FCM can send
 */
export function initFirebaseAdmin() {
  if (initialized) return true;

  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  const jsonRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  try {
    if (path) {
      const sa = JSON.parse(readFileSync(path, 'utf8'));
      admin.initializeApp({ credential: admin.credential.cert(sa) });
      initialized = true;
      console.log(
        `[FCM] Firebase Admin OK (file). project_id=${sa.project_id ?? '?'} client_email=${sa.client_email ? '(set)' : '(?)'}`
      );
      return true;
    }
    if (jsonRaw?.trim()) {
      const sa = JSON.parse(jsonRaw);
      admin.initializeApp({ credential: admin.credential.cert(sa) });
      initialized = true;
      console.log(
        `[FCM] Firebase Admin OK (JSON). project_id=${sa.project_id ?? '?'} client_email=${sa.client_email ? '(set)' : '(?)'}`
      );
      return true;
    }
  } catch (err) {
    console.warn('[FCM] Firebase Admin init failed:', err.message);
  }

  console.log('[FCM] Push sending disabled — set FIREBASE_SERVICE_ACCOUNT_PATH or JSON.');
  return false;
}

export function isFcmConfigured() {
  return initialized;
}

export { admin };
