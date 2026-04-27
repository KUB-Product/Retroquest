// Backend REST client. One place to change the URL; everywhere else imports `api`.
// Dev: falls back to localhost:3001 when running on a localhost origin.
// Prod: set VITE_BACKEND_URL in Vercel.
export const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL ||
  (typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:3001'
    : 'https://virtuous-purpose-production-42d0.up.railway.app');

async function call(method, path, body, headers = {}) {
  const res = await fetch(BACKEND_URL + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

export const api = {
  get:  (path, headers)         => call('GET',    path, null, headers),
  post: (path, body, headers)   => call('POST',   path, body, headers),
  del:  (path, body, headers)   => call('DELETE', path, body, headers),
};

// Admin-authenticated variants. Token lives in localStorage['rq_admin_token'].
const ADMIN_TOKEN_KEY = 'rq_admin_token';
export const getAdminToken   = () => { try { return localStorage.getItem(ADMIN_TOKEN_KEY); } catch { return null; } };
export const setAdminToken   = (t) => { try { t ? localStorage.setItem(ADMIN_TOKEN_KEY, t) : localStorage.removeItem(ADMIN_TOKEN_KEY); } catch {} };
export const clearAdminToken = () => setAdminToken(null);

export const adminApi = {
  get:  (path) => {
    const t = getAdminToken();
    return call('GET', path, null, t ? { Authorization: 'Bearer ' + t } : {});
  },
};
