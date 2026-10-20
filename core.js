// Core logic shared by the API modules: context, sessions, plans/quotas, storage (R2), activity log.
import { err, nowMs, nowSec, int, str, cut, isId, randHex, sha256hex, ym, isUnique, hashPw, makeDb } from './lib.js';

export const OVERHEAD = 28; // 12-byte IV + 16-byte GCM tag, per chunk

export function makeCtx(env, request, ctx, CFG) {
  const url = new URL(request.url);
  const c = {
    env, req: request, url, ctx, CFG, db: makeDb(env.DB), cookies: [],
    method: request.method, action: url.searchParams.get('action') || '',
    ip: (request.headers.get('cf-connecting-ip') || '?').slice(0, 45),
    q: k => url.searchParams.get(k) ?? '',
    header: k => request.headers.get(k) || '',
    _body: undefined,
    async body() { if (c._body === undefined) { try { const j = JSON.parse(await request.text() || ''); c._body = (j && typeof j === 'object' && !Array.isArray(j)) ? j : {}; } catch { c._body = {}; } } return c._body; },
  };
  return c;
}
export const csrfOk = c => c.header('x-luna') === '1';

// ---------- activity log, transfers, notifications ----------
export const act = (c, uid, action, detail = '') => c.db.run('INSERT INTO activity (ts, user_id, action, detail, ip) VALUES (?, ?, ?, ?, ?)', [nowMs(), uid ?? null, action, cut(detail, 200), c.ip]);
export const tx = (c, uid, kind, bytes) => c.db.run('INSERT INTO transfers (ts, user_id, kind, bytes, ip) VALUES (?, ?, ?, ?, ?)', [nowMs(), uid ?? null, kind, bytes, c.ip]);
export function notify(c, uid, text) {
  const token = c.env.TELEGRAM_BOT_TOKEN; if (!uid || !token) return;
  c.ctx.waitUntil((async () => {
    const chat = await c.db.val('SELECT telegram_chat FROM users WHERE id = ?', [uid]); if (!chat) return;
    try { await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ chat_id: chat, text }) }); } catch {}
  })());
}
export const freeBytes = c => Math.floor((c.CFG.free_mb ?? 100) * 1048576);
export function normEmail(e) {
  e = str(e).trim().toLowerCase(); const i = e.indexOf('@'); let l = i < 0 ? e : e.slice(0, i), d = i < 0 ? '' : e.slice(i + 1);
  l = l.split('+')[0]; if (d === 'googlemail.com') d = 'gmail.com'; if (d === 'gmail.com') l = l.replaceAll('.', '');
  return l + '@' + d;
}

// ---------- sessions (cookie -> D1) ----------
const COOKIE = 'lunasid';
function readCookie(c) { const m = c.header('cookie').split(/;\s*/).find(x => x.startsWith(COOKIE + '=')); return m ? m.slice(COOKIE.length + 1) : ''; }
const setCookie = (c, v, maxAge) => c.cookies.push(`${COOKIE}=${v}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=${maxAge}`);
export async function getSession(c) {
  const t = readCookie(c); if (!t) return null;
  return c.db.first('SELECT * FROM sessions WHERE id = ? AND exp > ?', [await sha256hex(t), nowSec()]);
}
export async function startSession(c, uid) {
  const old = readCookie(c); if (old) await c.db.run('DELETE FROM sessions WHERE id = ?', [await sha256hex(old)]);
  const t = randHex(32);
  await c.db.run('INSERT INTO sessions (id, uid, exp, totp_pending) VALUES (?, ?, ?, NULL)', [await sha256hex(t), uid, nowSec() + 43200]);
  setCookie(c, t, 43200);
}
export async function endSession(c) {
  const t = readCookie(c); if (t) await c.db.run('DELETE FROM sessions WHERE id = ?', [await sha256hex(t)]);
  setCookie(c, '', 0);
}

// ---------- plans / quotas ----------
export const tiers = c => c.CFG.tiers ?? {};
export const poolId = async (c, uid) => { const p = await c.db.val('SELECT parent_id FROM users WHERE id = ?', [uid]); return p ? int(p) : uid; };
export async function poolOf(c, u) {
  if (!u.parent_id) return u;
  return (await c.db.first('SELECT * FROM users WHERE id = ?', [u.parent_id])) ?? u;
}
export function subLimitOf(c, u) {
  if (u.parent_id || int(u.plan_gb) <= 0) return 0;
  if (u.sub_limit !== null && u.sub_limit !== undefined) return int(u.sub_limit);
  return int(tiers(c)[str(u.plan_type)]?.subs ?? 0);
}
export function planNameOf(c, u) {
  const t = tiers(c)[str(u.plan_type)];
  return t?.name ?? (u.plan_type === 'custom' ? 'Custom' : (int(u.plan_gb) > 0 ? 'Pay per GB' : ''));
}
export async function userUsable(c, u) {
  if (!(u && u.active && (u.expires_at === null || int(u.expires_at) > nowMs()))) return false;
  if (!u.parent_id) return true;
  const p = await c.db.first('SELECT active, plan_gb, plan_type, sub_limit FROM users WHERE id = ?', [u.parent_id]);
  return !!(p && p.active && subLimitOf(c, p) > 0);
}
export function parsePlan(c, b) {
  const T = tiers(c); const plan = str(b.plan ?? 'free'); const gb = int(b.gb);
  const months = Math.max(0, Math.min(36, int(b.months))) || null; const subs = Math.max(0, Math.min(100, int(b.subs)));
  if (!['free', 'gb', 'custom'].includes(plan) && !T[plan]) err('bad_quota');
  if (['gb', 'custom'].includes(plan) && (gb < 1 || gb > 100000)) err('bad_quota');
  return [plan, gb, months, subs];
}
export async function applyPlan(c, uid, plan, gb, months, subs) {
  const T = tiers(c), m = ym(c.CFG);
  if (plan === 'free') { await c.db.run("UPDATE users SET quota_bytes = ?, plan_gb = 0, plan_type = '', plan_until = NULL, sub_limit = NULL, free_tier = 1, monthly_reset = 1, reset_month = ?, used_bytes = 0 WHERE id = ?", [freeBytes(c), m, uid]); return; }
  let sl = null, type = 'gb';
  if (T[plan]) { gb = int(T[plan].gb); type = plan; } else if (plan === 'custom') { type = 'custom'; sl = subs; }
  const until = months ? nowMs() + months * 30 * 86400000 : null;
  await c.db.run('UPDATE users SET quota_bytes = ?, plan_gb = ?, plan_type = ?, plan_until = ?, sub_limit = ?, monthly_reset = 1, reset_month = ?, used_bytes = 0, free_tier = 1 WHERE id = ?', [gb * 1073741824, gb, type, until, sl, m, uid]);
  await c.db.run('UPDATE users SET used_bytes = 0 WHERE parent_id = ?', [uid]);
}
export async function insertSub(c, parent, name, pw) {
  try { await c.db.run("INSERT INTO users (username, password_hash, role, quota_bytes, monthly_reset, reset_month, parent_id, active, free_tier, created_at) VALUES (?, ?, 'user', 0, 1, ?, ?, 1, 0, ?)", [name, await hashPw(pw), ym(c.CFG), parent, nowMs()]); }
  catch (e) { if (isUnique(e)) err('user_exists', 409); throw e; }
}
export async function rollMonths(c, force = false) {
  const m = ym(c.CFG), lim = int(c.CFG.free_resets ?? 2), now = nowMs();
  // at most once per 10 minutes (and immediately when the month changes) so normal requests stay cheap
  const last = str(await c.db.val("SELECT v FROM settings WHERE k = 'rolled'")); const [lm, lt] = last.split('|');
  if (!force && lm === m && now - int(lt) < 600000) return;
  await c.db.run("INSERT INTO settings (k, v) VALUES ('rolled', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", [m + '|' + now]);
  await c.db.batch([
    c.db.prep("UPDATE users SET quota_bytes = ?, plan_gb = 0, plan_type = '', plan_until = NULL, free_tier = 1 WHERE plan_gb > 0 AND plan_until IS NOT NULL AND plan_until < ?", [freeBytes(c), now]),
    // free sign-ups: only `lim` monthly refreshes, then they must upgrade
    c.db.prep('UPDATE users SET used_bytes = 0, free_resets = free_resets + 1, reset_month = ? WHERE monthly_reset = 1 AND free_tier = 1 AND plan_gb = 0 AND free_resets < ? AND (reset_month IS NULL OR reset_month <> ?)', [m, lim, m]),
    c.db.prep('UPDATE users SET reset_month = ? WHERE monthly_reset = 1 AND free_tier = 1 AND plan_gb = 0 AND free_resets >= ? AND (reset_month IS NULL OR reset_month <> ?)', [m, lim, m]),
    c.db.prep('UPDATE users SET used_bytes = 0, reset_month = ? WHERE monthly_reset = 1 AND (free_tier = 0 OR plan_gb > 0) AND (reset_month IS NULL OR reset_month <> ?)', [m, m]),
  ]);
}

// ---------- row mappers ----------
export const linkOut = r => ({ token: r.token, label: r.label, maxBytes: int(r.max_bytes), expiresAt: int(r.expires_at), oneTime: !!r.one_time, maxDownloads: int(r.max_downloads), retentionDays: int(r.retention_days), used: int(r.used), createdAt: int(r.created_at), owner: r.owner ?? null });
export const fileOut = r => ({ id: r.id, linkToken: r.link_token, meta: r.meta, size: int(r.plain_size), uploadedAt: int(r.uploaded_at), deleteAt: int(r.delete_at), downloads: int(r.downloads), maxDownloads: int(r.max_downloads), salt: r.salt, pw: !!r.pw, group: r.grp, chunks: int(r.chunks), chunkSize: int(r.chunk_size), owner: r.owner ?? null, linkLabel: r.link_label ?? null });
export const validLink = l => !!(l && l.expiresAt > nowMs() && !(l.oneTime && l.used >= 1));

// ---------- file storage in R2 ----------
// store = 0: one whole object  files/<id>          (files copied over from the old PHP server)
// store = 1: one object per encrypted chunk  files/<id>/<i>   (new uploads; no assembling step, resume is trivial)
export const objKey = (c, id, i) => c.CFG.r2_prefix + id + (i === undefined ? '' : '/' + i);
export async function deleteStored(c, id, store) {
  const B = c.env.BUCKET;
  if (store === 0) { await B.delete(objKey(c, id)); return; }
  let cursor;
  do {
    const l = await B.list({ prefix: objKey(c, id) + '/', cursor, limit: 1000 });
    if (l.objects.length) await B.delete(l.objects.map(o => o.key));
    cursor = l.truncated ? l.cursor : undefined;
  } while (cursor);
}
export async function deleteFileRow(c, id) {
  const r = await c.db.first('SELECT store FROM files WHERE id = ?', [id]);
  await c.db.batch([c.db.prep('DELETE FROM files WHERE id = ?', [id]), c.db.prep('DELETE FROM dl_tokens WHERE file_id = ?', [id])]);
  if (r) await deleteStored(c, id, int(r.store));
}
export async function deleteFilesWhere(c, col, val) {
  if (!['link_token', 'owner_id'].includes(col)) throw new Error('bad column');
  for (const r of await c.db.all(`SELECT id FROM files WHERE ${col} = ?`, [val])) await deleteFileRow(c, r.id);
}
export async function releaseSlot(c, token) { await c.db.run('UPDATE links SET used = MAX(used - 1, 0) WHERE token = ?', [token]); }
export async function releaseIfOrphan(c, u) {
  if (u.reserved && u.link_token && !(await c.db.first('SELECT 1 FROM files WHERE grp = ? LIMIT 1', [u.grp])) && !(await c.db.first('SELECT 1 FROM uploads WHERE grp = ? AND id <> ? LIMIT 1', [u.grp, u.id]))) await releaseSlot(c, u.link_token);
}
// Removes expired files, abandoned uploads and old log rows. Runs from the Cron Trigger and, rarely, from normal requests.
export async function cleanup(c) {
  for (const r of await c.db.all('SELECT id FROM files WHERE delete_at < ?', [nowMs()])) await deleteFileRow(c, r.id);
  for (const u of await c.db.all('SELECT * FROM uploads WHERE updated_at < ?', [nowMs() - 86400000])) {
    await deleteStored(c, u.id, 1); await c.db.run('DELETE FROM uploads WHERE id = ?', [u.id]); await releaseIfOrphan(c, u);
  }
  await c.db.run('DELETE FROM dl_tokens WHERE expires < ?', [nowMs()]);
  await c.db.run('DELETE FROM ip_hits WHERE bucket < ?', [Math.floor(nowSec() / 3600) - 48]);
  await c.db.run('DELETE FROM activity WHERE ts < ?', [nowMs() - 120 * 86400000]);
  await c.db.run('DELETE FROM sessions WHERE exp < ?', [nowSec()]);
  await rollMonths(c, true);
}

export async function requireLogin(c) {
  const s = await getSession(c);
  if (!s) err('login_required', 401);
  await rollMonths(c);
  const u = await c.db.first('SELECT * FROM users WHERE id = ?', [s.uid]);
  if (!(await userUsable(c, u))) err('login_required', 401);
  if (c.method === 'POST' && !csrfOk(c)) err('bad_request', 403);
  u._session = s;
  return u;
}
