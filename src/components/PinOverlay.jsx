// Admin sign-in modal. On success, stores the admin token and invokes onSuccess
// so the parent screen can re-render with authenticated data.
import { useRef, useState } from 'react';
import { BACKEND_URL, setAdminToken } from '../api.js';

export default function PinOverlay({ onSuccess, onCancel }) {
  const userRef = useRef(null);
  const pwRef = useRef(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    const u = (userRef.current?.value || '').trim();
    const p = pwRef.current?.value || '';
    if (!u || !p) { setError('Username and password are required'); return; }
    setLoading(true);
    setError('');
    try {
      const r = await fetch(BACKEND_URL + '/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: p }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.token) {
        setError(d.error || 'Sign-in failed');
      } else {
        setAdminToken(d.token);
        onSuccess?.(d);
      }
    } catch {
      setError('Network error — try again');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="pin-overlay" style={{ display: 'flex' }}>
      <div className="pin-box" style={{ maxWidth: 360 }}>
        <div style={{ fontFamily: "'Kanit',sans-serif", fontWeight: 800, fontSize: 20, marginBottom: 6 }}>Admin Sign-in</div>
        <div className="muted" style={{ fontSize: 13, marginBottom: 16 }}>Enter your admin credentials</div>
        <input
          ref={userRef}
          className="inp"
          type="text"
          placeholder="username"
          autoComplete="username"
          onKeyDown={(e) => { if (e.key === 'Enter') pwRef.current?.focus(); }}
          style={{ width: '100%', padding: '10px 12px', marginBottom: 10, background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 10, color: 'var(--tx)', fontFamily: "'JetBrains Mono',monospace" }}
        />
        <input
          ref={pwRef}
          className="inp"
          type="password"
          placeholder="password"
          autoComplete="current-password"
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          style={{ width: '100%', padding: '10px 12px', marginBottom: 14, background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 10, color: 'var(--tx)', fontFamily: "'JetBrains Mono',monospace" }}
        />
        <div className="muted" style={{ fontSize: 11, color: 'var(--pk)', marginBottom: 10, minHeight: 14 }}>{error}</div>
        <button className="btn btn-y btn-full" onClick={submit} disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
        <button className="btn btn-out btn-sm btn-full" onClick={onCancel} style={{ marginTop: 10 }}>Cancel</button>
        <div className="muted" style={{ fontSize: 11, marginTop: 14 }}>Password is generated via <code>npm run admin:reset</code></div>
      </div>
    </div>
  );
}
