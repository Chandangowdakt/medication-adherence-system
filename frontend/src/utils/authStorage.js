const TOKEN_KEY = 'mat_token';

function normalizeStoredToken(raw) {
  if (raw == null || typeof raw !== 'string') return null;
  let t = raw.trim();
  if (!t) return null;
  if (/^bearer\s+/i.test(t)) {
    t = t.replace(/^bearer\s+/i, '').trim();
  }
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    t = t.slice(1, -1).trim();
  }
  return t || null;
}

/** Persist JWT after login/register. */
export function setToken(token) {
  const normalized = normalizeStoredToken(token);
  if (normalized) {
    localStorage.setItem(TOKEN_KEY, normalized);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export function getToken() {
  return normalizeStoredToken(localStorage.getItem(TOKEN_KEY));
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}
