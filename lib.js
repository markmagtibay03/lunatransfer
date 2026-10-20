// Small helpers shared by all modules: responses, errors, database, crypto, TOTP.
export class ApiError extends Error {
  constructor(code, status = 400, params = {}) { super(code); this.code = code; this.status = status; this.params = params; }
}
export const err = (code, status = 400, params = {}) => { throw new ApiError(code, status, params); };

export const SEC_HEADERS = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' };
export const json = (data, status = 200, extra = []) => {
  const h = new Headers({ 'content-type': 'application/json; charset=utf-8', ...SEC_HEADERS });
  for (const c of extra) h.append('set-cookie', c);
  return new Response(JSON.stringify(data), { status, headers: h });
};

export const nowMs = () => Date.now();
export const nowSec = () => Math.floor(Date.now() / 1000);
export const int = v => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? n : 0; };
export const flt = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
export const str = v => (v === undefined || v === null) ? '' : String(v);
export const cut = (s, n) => Array.from(str(s)).slice(0, n).join('');
export const isId = s => /^[a-f0-9]{24}$/.test(str(s));
export const hex = (bytes) => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
export const randHex = n => hex(crypto.getRandomValues(new Uint8Array(n)));
export const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
export const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export async function sha256hex(s) { return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))); }
export function timingEqual(a, b) { a = str(a); b = str(b); if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
export const bool = v => !!(v && v !== '0' && v !== 0);

// "YYYY-MM" in the configured timezone (monthly quota resets)
export function ym(CFG, t = Date.now()) { const d = new Date(t + CFG.tz_offset_hours * 3600000); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'); }
export function monthStartMs(CFG, t = Date.now()) { const d = new Date(t + CFG.tz_offset_hours * 3600000); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - CFG.tz_offset_hours * 3600000; }

// ---------- database helpers (D1) ----------
const clean = p => p.map(v => v === undefined ? null : (typeof v === 'boolean' ? (v ? 1 : 0) : v));
export function makeDb(DB) {
  const prep = (sql, p = []) => DB.prepare(sql).bind(...clean(p));
  return {
    raw: DB, prep,
    all: async (sql, p = []) => (await prep(sql, p).all()).results,
    first: async (sql, p = []) => (await prep(sql, p).first()) ?? null,
    val: async (sql, p = []) => { const r = await prep(sql, p).first(); return r ? Object.values(r)[0] : null; },
    run: async (sql, p = []) => { const r = await prep(sql, p).run(); return { changes: r.meta?.changes ?? 0, lastId: r.meta?.last_row_id ?? null }; },
    batch: stmts => DB.batch(stmts),
  };
}
export const isUnique = e => /UNIQUE constraint failed|constraint failed/i.test(String(e?.message ?? e));

// ---------- passwords ----------
// New passwords: PBKDF2-SHA256 (native WebCrypto). Old PHP bcrypt hashes ($2y$...) still work and are upgraded on login.
const ITER = 100000;
export async function hashPw(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, key, 256);
  return `pbkdf2$${ITER}$${b64(salt)}$${b64(bits)}`;
}
export async function verifyPw(pw, stored) {
  stored = str(stored); pw = str(pw);
  if (stored.startsWith('pbkdf2$')) {
    const [, it, s, h] = stored.split('$');
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(s), iterations: int(it) }, key, 256);
    return timingEqual(b64(bits), h);
  }
  if (/^\$2[aby]\$/.test(stored)) {
    const bcrypt = (await import('bcryptjs')).default;
    return bcrypt.compare(pw, stored.replace(/^\$2y\$/, '$2a$'));
  }
  return false;
}
export const needsRehash = stored => !str(stored).startsWith('pbkdf2$');

// ---------- TOTP (RFC 6238) ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function b32enc(bytes) { let bits = '', o = ''; for (const b of bytes) bits += b.toString(2).padStart(8, '0'); for (let i = 0; i < bits.length; i += 5) o += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)]; return o; }
export function b32dec(s) { let bits = ''; for (const c of str(s).toUpperCase()) { const p = B32.indexOf(c); if (p >= 0) bits += p.toString(2).padStart(5, '0'); } const o = []; for (let i = 0; i + 8 <= bits.length; i += 8) o.push(parseInt(bits.slice(i, i + 8), 2)); return new Uint8Array(o); }
async function totpAt(secret, step) {
  const key = await crypto.subtle.importKey('raw', b32dec(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const msg = new Uint8Array(8); new DataView(msg.buffer).setUint32(4, step >>> 0);
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg)); const o = h[19] & 15;
  const v = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(v % 1000000).padStart(6, '0');
}
export async function totpOk(secret, code) {
  const s = Math.floor(Date.now() / 30000);
  for (const d of [-1, 0, 1]) if (timingEqual(await totpAt(secret, s + d), str(code))) return true;
  return false;
}
export { totpAt };
