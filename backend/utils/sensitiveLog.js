/**
 * Redact FCM / device tokens in server logs.
 */
export function redactFcmToken(t) {
  if (!t || typeof t !== 'string') return '(empty)';
  if (t.length < 12) return '(short)';
  return `${t.slice(0, 8)}…${t.slice(-4)}`;
}
