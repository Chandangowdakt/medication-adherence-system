import axios from 'axios';
import { clearToken, getToken } from '../utils/authStorage.js';

/**
 * Axios instance pointed at the Express API; sends JWT when present.
 */
const apiRoot = (import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');
const baseURL = apiRoot ? `${apiRoot}/api` : '';

if (!baseURL) {
  console.error('[api] Missing VITE_API_URL. Set frontend/.env for APK/production builds.');
}

console.log('API URL:', baseURL || '(not set)');

export const api = axios.create({
  baseURL,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    const bearer = `Bearer ${token}`;
    if (typeof config.headers?.set === 'function') {
      config.headers.set('Authorization', bearer);
    } else {
      Object.assign(config.headers || {}, { Authorization: bearer });
    }
    if (import.meta.env.DEV) {
      console.debug('[api] outgoing', config.method?.toUpperCase(), config.url);
      console.debug('[api] Authorization: Bearer <redacted>');
    }
  } else if (import.meta.env.DEV) {
    console.debug('[api] outgoing', config.method?.toUpperCase(), config.url, '(no token)');
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err.response?.status;
    const url = String(err.config?.url || '');
    if (status === 401 && !url.includes('/auth/login') && !url.includes('/auth/register')) {
      clearToken();
      const path = window.location.pathname;
      if (path !== '/login' && path !== '/register') {
        window.location.assign('/login');
      }
    }
    return Promise.reject(err);
  }
);
