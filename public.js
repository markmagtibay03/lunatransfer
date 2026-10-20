// Public actions: login, register, link info, chunked upload, download.
import { err, json, nowMs, nowSec, int, flt, str, cut, isId, randHex, ym, isUnique, hashPw, verifyPw, needsRehash, totpOk, SEC_HEADERS } from './lib.js';
import { OVERHEAD, csrfOk, act, tx, notify, freeBytes, normEmail, tiers, poolId, poolOf, userUsable, linkOut, fileOut, validLink, objKey, deleteStored, deleteFileRow, releaseIfOrphan, getSession, startSession, endSession, rollMonths } from './core.js';

export const publicActions = {
  async site(c) { return json({ name: str(c.CFG.site_name ?? 'Luna Transfer'), logo: str(c.CFG.logo_url ?? '') }); },

  async login(c) {
    if (c.method !== 'POST') err('post_only', 405);
    if (!csrfOk(c)) err('bad_request', 403);
    const b = await c.body(), ip = c.ip;
    const f = await c.db.first('SELECT n, t FROM login_fails WHERE ip = ?', [ip]);
    if (f && f.n >= 5 && nowSec() - int(f.t) < 900) err('login_locked', 429);
    if (int(await c.db.val("SELECT COUNT(*) FROM users WHERE role = 'admin'")) === 0) err('no_admin', 409);
    const fail = async code => {
      const now = nowSec();
      await c.db.run('INSERT INTO login_fails (ip, n, t) VALUES (?, 1, ?) ON CONFLICT(ip) DO UPDATE SET n = CASE WHEN ? - t > 900 THEN 1 ELSE n + 1 END, t = ?', [ip, now, now, now]);
      err(code, 401);
    };
    const u = await c.db.first('SELECT * FROM users WHERE username = ?', [str(b.username)]);
    if (!u || !(await verifyPw(b.password, u.password_hash))) await fail('login_bad');
    if (!u.active) err('account_disabled', 403);
    if (u.expires_at !== null && int(u.expires_at) <= nowMs()) err('account_expired', 403);
    if (u.parent_id && !(await userUsable(c, u))) err('sub_suspended', 403);
    if (u.totp_secret) {
      const code = str(b.code).replace(/\D/g, '');
      if (code === '') err('code_required', 401);
      if (!(await totpOk(u.totp_secret, code))) await fail('code_bad');
    }
    if (needsRehash(u.password_hash)) await c.db.run('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPw(str(b.password)), u.id]); // upgrade old bcrypt hash
    await c.db.run('DELETE FROM login_fails WHERE ip = ?', [ip]);
    await startSession(c, int(u.id));
    await act(c, int(u.id), 'login', '');
    return json({ ok: true, role: u.role });
  },

  async plans(c) {
    const C = c.CFG;
    return json({ freeMB: int(C.free_mb ?? 100), freeResets: int(C.free_resets ?? 2), pricePerGB: int(C.price_per_gb ?? 50), maxGB: int(C.max_paid_gb ?? 200),
      tiers: Object.entries(tiers(c)).map(([key, t]) => ({ key, ...t })), currency: str(C.currency ?? 'PHP'),
      methods: [C.gcash_number ? 'gcash' : null, C.bank_account_no ? 'bank' : null].filter(Boolean) });
  },

  async verify(c) {
    const u = await c.db.first('SELECT id FROM users WHERE verify_token = ? AND email_verified = 0', [c.q('t')]);
    if (u) await c.db.run('UPDATE users SET email_verified = 1, verify_token = NULL, quota_bytes = ? WHERE id = ?', [freeBytes(c), u.id]);
    return new Response(null, { status: 302, headers: { location: 'account.php?verified=' + (u ? 1 : 0) } });
  },

  async register(c) {
    if (c.method !== 'POST') err('post_only', 405);
    if (!csrfOk(c)) err('bad_request', 403);
    const b = await c.body(), ip = c.ip, hour = Math.floor(nowSec() / 3600), C = c.CFG;
    await c.db.run('INSERT INTO ip_hits (ip, bucket, n) VALUES (?, ?, 1) ON CONFLICT(ip, bucket) DO UPDATE SET n = n + 1', ['reg:' + ip, hour]);
    if (int(await c.db.val('SELECT n FROM ip_hits WHERE ip = ? AND bucket = ?', ['reg:' + ip, hour])) > 5) err('login_locked', 429);
    const name = str(b.username).trim(), pw = str(b.password), email = str(b.email).trim();
    const dev = /^[a-f0-9]{32}$/.test(str(b.device)) ? str(b.device) : null;
    if (!/^[A-Za-z0-9_.-]{3,40}$/.test(name)) err('bad_username');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) err('bad_email');
    if (pw.length < 8) err('bad_password');
    const norm = normEmail(email), dom = norm.slice(norm.lastIndexOf('@') + 1);
    if ((C.blocked_domains ?? []).includes(dom)) err('bad_email');
    // strict duplicate checks: same real mailbox, same device, too many from one IP
    if (await c.db.first('SELECT 1 FROM users WHERE email_norm = ?', [norm])) err('dup_account', 409);
    if (dev && int(await c.db.val('SELECT COUNT(*) FROM users WHERE reg_device = ?', [dev])) >= int(C.max_per_device ?? 1)) { await act(c, null, 'signup_blocked', 'device ' + dev.slice(0, 8) + ' ' + name); err('dup_account', 409); }
    if (int(await c.db.val('SELECT COUNT(*) FROM users WHERE reg_ip = ? AND created_at > ?', [ip, nowMs() - 86400000])) >= int(C.max_per_ip_day ?? 3)) { await act(c, null, 'signup_blocked', 'ip ' + ip + ' ' + name); err('dup_account', 409); }
    let id;
    try { id = (await c.db.run("INSERT INTO users (username, password_hash, role, quota_bytes, monthly_reset, reset_month, email, email_norm, email_verified, verify_token, reg_ip, reg_device, active, free_tier, created_at) VALUES (?, ?, 'user', ?, 1, ?, ?, ?, 1, NULL, ?, ?, 1, 1, ?)",
      [name, await hashPw(pw), freeBytes(c), ym(C), email, norm, ip, dev, nowMs()])).lastId; }
    catch (e) { if (isUnique(e)) err('user_exists', 409); throw e; }
    await startSession(c, int(id));
    await act(c, int(id), 'register', name);
    return json({ ok: true, role: 'user', verify: false });
  },

  async logout(c) { await endSession(c); return json({ ok: true }); },

  async link_info(c) {
    const r = await c.db.first(`SELECT l.*, u.username ow_name, CASE WHEN u.parent_id IS NULL THEN u.quota_bytes ELSE p.quota_bytes END ow_q, CASE WHEN u.parent_id IS NULL THEN u.used_bytes ELSE p.used_bytes END ow_used,
      u.active ow_active, u.expires_at ow_exp, u.parent_id ow_parent, p.active p_active, p.plan_gb p_gb FROM links l LEFT JOIN users u ON u.id = l.owner_id LEFT JOIN users p ON p.id = u.parent_id WHERE l.token = ?`, [c.q('t')]);
    const l = r ? linkOut(r) : null;
    let ownerBad = !!(r && r.ow_active !== null && (!r.ow_active || (r.ow_exp !== null && int(r.ow_exp) <= nowMs())));
    if (r && r.ow_parent !== null && (!r.p_active || int(r.p_gb) <= 0)) ownerBad = true;
    if (!validLink(l) || ownerBad) err('link_invalid', 410);
    const left = (r.ow_name !== null && r.ow_q !== null) ? Math.max(0, int(r.ow_q) - int(r.ow_used)) : null;
    if (left !== null && left <= 0) err('quota_owner', 413);
    return json({ maxBytes: left !== null ? Math.min(l.maxBytes, left) : l.maxBytes, label: l.label, expiresAt: l.expiresAt, maxFiles: int(c.CFG.max_files_per_batch ?? 20), owner: r.ow_name, oneTime: l.oneTime, retentionDays: l.retentionDays, maxDownloads: l.maxDownloads });
  },

  // ---- chunked upload ----
  async upload_init(c) {
    if (c.method !== 'POST') err('post_only', 405);
    const b = await c.body(), t = c.q('t'), g = c.q('g'), C = c.CFG;
    const size = int(b.size), chunks = int(b.chunks), cs = int(b.chunkSize), meta = str(b.meta), salt = str(b.salt);
    if (salt !== '' && !/^[A-Za-z0-9_-]{16,64}$/.test(salt)) err('bad_salt');
    if (size <= 0) err('empty_file');
    if (cs < 65536 || cs > 16777216 || chunks !== Math.ceil(size / cs)) err('bad_request');
    if (meta === '' || meta.length > 4000) err('bad_meta');
    if (!isId(g)) err('bad_batch');
    const maxFiles = int(C.max_files_per_batch ?? 20);
    if (t !== '') { // guests: simple per-IP rate limit
      const bucket = Math.floor(nowSec() / 3600);
      await c.db.run('INSERT INTO ip_hits (ip, bucket, n) VALUES (?, ?, 1) ON CONFLICT(ip, bucket) DO UPDATE SET n = n + 1', [c.ip, bucket]);
      if (int(await c.db.val('SELECT n FROM ip_hits WHERE ip = ? AND bucket = ?', [c.ip, bucket])) > int(C.guest_uploads_per_hour ?? 60)) err('rate_limited', 429);
    }
    await rollMonths(c);
    let e = null, owner = null, l = null, uid = 0;
    if (t === '') {
      const s = await getSession(c);
      if (!s) e = [401, 'login_required'];
      else if (!csrfOk(c)) e = [403, 'bad_request'];
      else {
        uid = int(s.uid); owner = await c.db.first('SELECT * FROM users WHERE id = ?', [uid]);
        if (!(await userUsable(c, owner))) e = [401, 'login_required'];
        else l = { maxBytes: int(C.max_mb_cap) * 1048576, retentionDays: Math.max(1, Math.min(365, int(b.retentionDays ?? 7))), maxDownloads: Math.max(0, Math.min(1000, int(b.maxDownloads))), expiresAt: Infinity, oneTime: false, used: 0 };
      }
    } else {
      const lr = await c.db.first('SELECT * FROM links WHERE token = ?', [t]);
      if (!lr) e = [410, 'link_invalid'];
      else {
        l = linkOut(lr);
        if (lr.owner_id !== null) { uid = int(lr.owner_id); owner = await c.db.first('SELECT * FROM users WHERE id = ?', [uid]); if (!(await userUsable(c, owner))) e = [410, 'link_invalid']; }
      }
    }
    let id;
    if (!e) {
      let n = 0, total = 0;
      const rows = [...await c.db.all('SELECT link_token, salt, plain_size, owner_id FROM files WHERE grp = ?', [g]), ...await c.db.all('SELECT link_token, salt, plain_size, owner_id FROM uploads WHERE grp = ?', [g])];
      for (const f of rows) {
        if (str(f.link_token) !== t || str(f.salt) !== salt || int(f.owner_id ?? 0) !== uid) { e = [403, 'bad_batch']; break; }
        n++; total += int(f.plain_size);
      }
      if (!e) { if (n > 0) { if (t !== '' && l.expiresAt <= nowMs()) e = [410, 'link_expired']; } else if (t !== '' && !validLink(l)) e = [410, 'link_invalid']; }
      if (!e && n >= maxFiles) e = [413, 'too_many_files', { max: maxFiles }];
      if (!e && total + size > l.maxBytes) e = [413, 'over_limit'];
      if (!e && owner && owner.max_file_bytes !== null && size > int(owner.max_file_bytes)) e = [413, 'file_too_big', { maxb: int(owner.max_file_bytes) }];
      const pool = (owner && !e) ? await poolOf(c, owner) : null;
      if (!e && pool && pool.quota_bytes !== null) {
        const pending = int(await c.db.val('SELECT COALESCE(SUM(up.plain_size), 0) FROM uploads up JOIN users x ON x.id = up.owner_id WHERE x.id = ? OR x.parent_id = ?', [pool.id, pool.id]));
        if (int(pool.used_bytes) + pending + size > int(pool.quota_bytes))
          e = t === '' ? [413, 'quota_exceeded', { left: Math.max(0, int(pool.quota_bytes) - int(pool.used_bytes) - pending) }] : [413, 'quota_owner'];
      }
      if (!e) {
        const reserved = (n === 0 && t !== '');
        if (reserved) await c.db.run('UPDATE links SET used = used + 1 WHERE token = ?', [t]); // reserve now (for one-time links)
        id = randHex(12);
        await c.db.run('INSERT INTO uploads (id, link_token, owner_id, grp, meta, plain_size, chunks, chunk_size, salt, retention_days, max_downloads, reserved, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [id, t !== '' ? t : null, uid || null, g, meta, size, chunks, cs, salt !== '' ? salt : null, l.retentionDays, l.maxDownloads, reserved ? 1 : 0, nowMs(), nowMs()]);
      }
    }
    if (e) err(e[1], e[0], e[2] ?? {});
    return json({ id });
  },

  async upload_chunk(c) {
    if (c.method !== 'POST') err('post_only', 405);
    const id = c.q('id'), i = c.q('i') === '' ? -1 : int(c.q('i')), len = int(c.header('content-length'));
    if (!isId(id)) err('upload_gone', 410);
    const u = await c.db.first('SELECT * FROM uploads WHERE id = ?', [id]);
    if (!u) err('upload_gone', 410);
    const n = int(u.chunks), next = int(u.next_chunk);
    if (i >= 0 && i < next) return json({ next }); // already received
    if (i !== next || i >= n) err('chunk_order', 409, { next });
    const cs = int(u.chunk_size), last = int(u.plain_size) - (n - 1) * cs;
    if (len !== (i < n - 1 ? cs : last) + OVERHEAD) err('bad_chunk', 400);
    const buf = await c.req.arrayBuffer();
    if (buf.byteLength !== len) err('incomplete', 400);
    await c.env.BUCKET.put(objKey(c, id, i), buf); // same key on a retry, so it is safe to repeat
    const r = await c.db.run('UPDATE uploads SET next_chunk = next_chunk + 1, received = received + ?, updated_at = ? WHERE id = ? AND next_chunk = ?', [len, nowMs(), id, next]);
    return json({ next: r.changes ? next + 1 : int(await c.db.val('SELECT next_chunk FROM uploads WHERE id = ?', [id])) });
  },

  async upload_status(c) {
    const id = c.q('id'); const u = isId(id) ? await c.db.first('SELECT next_chunk, chunks FROM uploads WHERE id = ?', [id]) : null;
    if (!u) err('upload_gone', 410);
    return json({ next: int(u.next_chunk), chunks: int(u.chunks) });
  },

  async upload_abort(c) {
    const id = c.q('id'); let u;
    if (isId(id) && (u = await c.db.first('SELECT * FROM uploads WHERE id = ?', [id]))) {
      await c.db.run('DELETE FROM uploads WHERE id = ?', [id]); await deleteStored(c, id, 1); await releaseIfOrphan(c, u);
    }
    return json({ ok: true });
  },

  async upload_finish(c) {
    if (c.method !== 'POST') err('post_only', 405);
    const id = c.q('id'); if (!isId(id)) err('upload_gone', 410);
    const u = await c.db.first('SELECT * FROM uploads WHERE id = ?', [id]);
    if (!u) err('upload_gone', 410);
    const enc = int(u.plain_size) + OVERHEAD * int(u.chunks), plain = int(u.plain_size);
    if (int(u.next_chunk) !== int(u.chunks) || int(u.received) !== enc) err('incomplete', 400);
    const ownerId = u.owner_id !== null ? int(u.owner_id) : null;
    if (ownerId) {
      const pid = await poolId(c, ownerId);
      const o = await c.db.first('SELECT quota_bytes, used_bytes FROM users WHERE id = ?', [pid]);
      if (o) {
        // count the usage only if it still fits in the quota (one atomic statement)
        const r = await c.db.run('UPDATE users SET used_bytes = used_bytes + ? WHERE id = ? AND (quota_bytes IS NULL OR used_bytes + ? <= quota_bytes)', [plain, pid, plain]);
        if (!r.changes) {
          const left = Math.max(0, int(o.quota_bytes) - int(o.used_bytes));
          await c.db.run('DELETE FROM uploads WHERE id = ?', [id]); await deleteStored(c, id, 1); await releaseIfOrphan(c, u);
          if (!u.link_token) err('quota_exceeded', 413, { left });
          err('quota_owner', 413);
        }
        if (pid !== ownerId) await c.db.run('UPDATE users SET used_bytes = used_bytes + ? WHERE id = ?', [plain, ownerId]);
      }
    }
    const deleteAt = nowMs() + int(u.retention_days) * 86400000;
    await c.db.batch([
      c.db.prep('INSERT INTO files (id, link_token, owner_id, grp, meta, size, plain_size, chunks, chunk_size, uploaded_at, delete_at, downloads, max_downloads, salt, pw, store) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 1)',
        [id, u.link_token, ownerId, u.grp, u.meta, enc, plain, u.chunks, u.chunk_size, nowMs(), deleteAt, u.max_downloads, u.salt, u.salt ? 1 : 0]),
      c.db.prep('DELETE FROM uploads WHERE id = ?', [id]),
    ]);
    await act(c, ownerId, 'upload', (u.link_token ? 'via link ' + u.link_token.slice(0, 8) : 'direct') + ', ' + plain + ' bytes');
    await tx(c, ownerId, 'upload', plain);
    notify(c, ownerId, (u.link_token ? 'New file received through your upload link' : 'File uploaded') + ' (' + (Math.round(plain / 1048576 * 10) / 10) + ' MB).');
    return json({ ok: true, id, group: u.grp, deleteAt, maxDownloads: int(u.max_downloads) });
  },

  // ---- download ----
  async group_info(c) {
    const g = c.q('g'); if (!isId(g)) err('bad_link');
    const rows = await c.db.all('SELECT * FROM files WHERE grp = ? AND delete_at >= ? AND (max_downloads = 0 OR downloads < max_downloads) ORDER BY seq ASC', [g, nowMs()]);
    if (!rows.length) err('file_gone', 410);
    const o = rows.map(r => { const f = fileOut(r); return { id: f.id, size: int(r.size), meta: f.meta, deleteAt: f.deleteAt, salt: f.salt, chunks: f.chunks, remaining: f.maxDownloads > 0 ? f.maxDownloads - f.downloads : null }; });
    const own = rows[0].owner_id ? await c.db.val('SELECT username FROM users WHERE id = ?', [rows[0].owner_id]) : null;
    return json({ files: o, owner: own || null, viaLink: !!rows[0].link_token, uploadedAt: int(rows[0].uploaded_at) });
  },

  async file_open(c) {
    const id = c.q('f'); const f = await findFileForDownload(c, id, true);
    if (!f || !(await storedExists(c, f))) err('file_gone', 410);
    const tok = randHex(16);
    await c.db.run('INSERT INTO dl_tokens (token, file_id, expires) VALUES (?, ?, ?)', [tok, id, nowMs() + 6 * 3600000]);
    const ownerId = await c.db.val('SELECT owner_id FROM files WHERE id = ?', [id]);
    await act(c, ownerId ? int(ownerId) : null, 'download', 'file ' + id.slice(0, 8));
    await tx(c, ownerId ? int(ownerId) : null, 'download', f.encSize);
    if (ownerId) notify(c, int(ownerId), 'A file you shared was just downloaded.');
    return json({ token: tok, size: f.encSize, chunks: f.chunks, chunkSize: f.chunkSize, plain: f.size });
  },

  async file_get(c) {
    const id = c.q('f'); if (!isId(id)) err('file_gone', 410);
    const B = c.env.BUCKET;
    const done = fn => c.ctx.waitUntil(fn());
    if (c.url.searchParams.get('k') === null) { // old single-block files (made before chunking)
      const f = await findFileForDownload(c, id, true);
      if (!f || f.chunks > 0 || f.store !== 0) err('file_gone', 410);
      const o = await B.get(objKey(c, id)); if (!o) err('file_gone', 410);
      if (f.maxDownloads > 0 && f.downloads >= f.maxDownloads) done(() => deleteFileRow(c, id));
      return new Response(o.body, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(o.size), ...SEC_HEADERS } });
    }
    const tok = await c.db.first('SELECT 1 FROM dl_tokens WHERE token = ? AND file_id = ? AND expires >= ?', [c.q('k'), id, nowMs()]);
    const r = await c.db.first('SELECT * FROM files WHERE id = ?', [id]);
    if (!tok || !r) err('file_gone', 410);
    const s = int(c.q('s')), l = int(c.q('l')), size = int(r.size);
    if (s < 0 || l <= 0 || s + l > size || l > int(r.chunk_size) + OVERHEAD) err('bad_request');
    let body;
    if (int(r.store) === 1) { // one R2 object per chunk
      const step = int(r.chunk_size) + OVERHEAD, i = Math.floor(s / step);
      if (s !== i * step) err('bad_request');
      const o = await B.get(objKey(c, id, i)); if (!o || o.size !== l) err('file_gone', 410);
      body = o.body;
    } else { // whole object copied from the old server: read the requested byte range
      const o = await B.get(objKey(c, id), { range: { offset: s, length: l } }); if (!o) err('file_gone', 410);
      body = o.body;
    }
    if (s + l >= size) {
      done(async () => {
        await c.db.run('DELETE FROM dl_tokens WHERE token = ?', [c.q('k')]);
        if (int(r.max_downloads) > 0 && int(r.downloads) >= int(r.max_downloads)) await deleteFileRow(c, id); // last allowed download is complete
      });
    }
    return new Response(body, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(l), ...SEC_HEADERS } });
  },
};

export async function findFileForDownload(c, id, count) {
  if (!isId(id)) return null;
  if (count) {
    const s = await c.db.run('UPDATE files SET downloads = downloads + 1 WHERE id = ? AND delete_at >= ? AND (max_downloads = 0 OR downloads < max_downloads)', [id, nowMs()]);
    if (s.changes !== 1) return null;
  }
  const r = await c.db.first('SELECT * FROM files WHERE id = ?', [id]);
  if (!r) return null;
  const f = { ...fileOut(r), encSize: int(r.size), store: int(r.store) };
  if (!count && (f.deleteAt < nowMs() || (f.maxDownloads > 0 && f.downloads >= f.maxDownloads))) return null;
  return f;
}
async function storedExists(c, f) {
  const k = f.store === 1 ? objKey(c, f.id, 0) : objKey(c, f.id);
  return !!(await c.env.BUCKET.head(k));
}
