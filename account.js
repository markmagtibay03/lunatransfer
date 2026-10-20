// Actions that need a login: own account, links, files, orders, team accounts, and the admin console.
import { err, json, nowMs, int, flt, str, cut, isId, randHex, ym, monthStartMs, isUnique, hashPw, verifyPw, totpOk, b32enc, bool } from './lib.js';
import { act, freeBytes, normEmail, tiers, poolOf, subLimitOf, planNameOf, parsePlan, applyPlan, insertSub, linkOut, fileOut, deleteFileRow, deleteFilesWhere } from './core.js';

async function createLink(c, b, ownerId, remaining) {
  const mb = flt(b.maxMB), hrs = flt(b.expiryHours), days = int(b.retentionDays ?? 7) || 7, maxDl = Math.max(0, Math.min(1000, int(b.maxDownloads)));
  let cap = flt(c.CFG.max_mb_cap); if (remaining !== null) cap = Math.min(cap, Math.floor(remaining / 1048576));
  if (!(mb > 0 && mb <= cap)) err('size_range', 400, { max: Math.trunc(cap) });
  if (!(hrs > 0 && hrs <= 2160)) err('expiry_range');
  const token = randHex(16);
  await c.db.run('INSERT INTO links (token, owner_id, label, max_bytes, expires_at, one_time, max_downloads, retention_days, used, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)',
    [token, ownerId, cut(b.label, 80), Math.floor(mb * 1048576), nowMs() + Math.trunc(hrs * 3600000), b.oneTime ? 1 : 0, maxDl, Math.min(Math.max(days, 1), 365), nowMs()]);
  await act(c, ownerId, 'link_create', 'link ' + token.slice(0, 8));
  return linkOut(await c.db.first('SELECT * FROM links WHERE token = ?', [token]));
}
const NAME = /^[A-Za-z0-9_.-]{3,40}$/;
const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 120;
const digits = v => str(v).replace(/\D/g, '');

export async function loggedInAction(c, me, action) {
  const P = await poolOf(c, me), isAdmin = me.role === 'admin', db = c.db, CFG = c.CFG;
  const adminOnly = () => { if (!isAdmin) err('forbidden', 403); };
  const meId = int(me.id);
  switch (action) {
    case 'me': {
      const isSub = !!me.parent_id;
      const subUsed = isSub ? 0 : int(await db.val('SELECT COALESCE(SUM(used_bytes), 0) FROM users WHERE parent_id = ?', [me.id]));
      return json({ ok: true, uid: meId, role: me.role, username: me.username, quotaBytes: P.quota_bytes !== null ? int(P.quota_bytes) : null,
        usedBytes: int(P.used_bytes), maxFileBytes: me.max_file_bytes !== null ? int(me.max_file_bytes) : null, maxMBCap: int(CFG.max_mb_cap),
        maxFiles: int(CFG.max_files_per_batch ?? 20), publicUrl: str(CFG.public_url ?? '').replace(/\/+$/, ''), totp: !!me.totp_secret,
        telegram: me.telegram_chat, telegramAvailable: !!c.env.TELEGRAM_BOT_TOKEN, expiresAt: me.expires_at !== null ? int(me.expires_at) : null,
        monthlyReset: !!P.monthly_reset, planGB: int(P.plan_gb), planType: str(P.plan_type), planName: planNameOf(c, P),
        freeTier: !isSub && !!P.free_tier, freeResetsLeft: Math.max(0, int(CFG.free_resets ?? 2) - int(P.free_resets)),
        planUntil: P.plan_until !== null ? int(P.plan_until) : null, email: me.email,
        isSub, parentName: isSub ? P.username : null, subLimit: isSub ? 0 : subLimitOf(c, P),
        ownUsed: isSub ? int(me.used_bytes) : Math.max(0, int(me.used_bytes) - subUsed) });
    }

    // ---- security ----
    case 'change_password': {
      const b = await c.body();
      if (!(await verifyPw(b.current, me.password_hash))) err('wrong_current', 403);
      if (str(b.new).length < 8) err('bad_password');
      await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPw(str(b.new)), me.id]);
      await act(c, meId, 'password', '');
      return json({ ok: true });
    }
    case 'totp_setup': {
      if (me.totp_secret) err('bad_request');
      const secret = b32enc(crypto.getRandomValues(new Uint8Array(20)));
      await db.run('UPDATE sessions SET totp_pending = ? WHERE id = ?', [secret, me._session.id]);
      const site = str(CFG.site_name ?? 'Luna Transfer');
      return json({ secret, uri: 'otpauth://totp/' + encodeURIComponent(site + ':' + me.username) + '?secret=' + secret + '&issuer=' + encodeURIComponent(site) });
    }
    case 'totp_enable': {
      const secret = str(me._session.totp_pending), code = digits((await c.body()).code);
      if (secret === '' || !(await totpOk(secret, code))) err('code_bad', 400);
      await db.run('UPDATE users SET totp_secret = ? WHERE id = ?', [secret, me.id]);
      await db.run('UPDATE sessions SET totp_pending = NULL WHERE id = ?', [me._session.id]);
      await act(c, meId, '2fa_on', '');
      return json({ ok: true });
    }
    case 'totp_disable': {
      const b = await c.body(), code = digits(b.code);
      if (!(await verifyPw(b.password, me.password_hash))) err('wrong_current', 403);
      if (!me.totp_secret || !(await totpOk(me.totp_secret, code))) err('code_bad', 400);
      await db.run('UPDATE users SET totp_secret = NULL WHERE id = ?', [me.id]);
      await act(c, meId, '2fa_off', '');
      return json({ ok: true });
    }
    case 'set_telegram': {
      const ch = str((await c.body()).chat).trim();
      if (ch !== '' && !/^-?[0-9]{3,20}$/.test(ch)) err('bad_request');
      await db.run('UPDATE users SET telegram_chat = ? WHERE id = ?', [ch !== '' ? ch : null, me.id]);
      return json({ ok: true });
    }

    // ---- own links / files / activity ----
    case 'my_links_list': return json((await db.all('SELECT * FROM links WHERE owner_id = ? ORDER BY created_at DESC', [me.id])).map(linkOut));
    case 'my_links_create': return json(await createLink(c, await c.body(), meId, P.quota_bytes !== null ? Math.max(0, int(P.quota_bytes) - int(P.used_bytes)) : null));
    case 'my_links_delete': {
      const t = str((await c.body()).token);
      if (await db.first('SELECT 1 FROM links WHERE token = ? AND owner_id = ?', [t, me.id])) { await deleteFilesWhere(c, 'link_token', t); await db.run('DELETE FROM links WHERE token = ?', [t]); await act(c, meId, 'link_delete', 'link ' + t.slice(0, 8)); }
      return json({ ok: true });
    }
    case 'my_files_list': return json((await db.all('SELECT f.*, l.label link_label FROM files f LEFT JOIN links l ON l.token = f.link_token WHERE f.owner_id = ? ORDER BY f.seq DESC', [me.id])).map(fileOut));
    case 'my_file_delete': {
      const id = str((await c.body()).id);
      if (isId(id) && await db.first('SELECT 1 FROM files WHERE id = ? AND owner_id = ?', [id, me.id])) { await deleteFileRow(c, id); await act(c, meId, 'file_delete', 'file ' + id.slice(0, 8)); }
      return json({ ok: true });
    }
    case 'my_activity': return json(await db.all('SELECT ts, action, detail, ip FROM activity WHERE user_id = ? ORDER BY id DESC LIMIT 100', [me.id]));

    // ---- admin only ----
    case 'links_list': adminOnly(); return json((await db.all('SELECT l.*, u.username owner FROM links l LEFT JOIN users u ON u.id = l.owner_id ORDER BY l.created_at DESC')).map(linkOut));
    case 'links_create': adminOnly(); return json(await createLink(c, await c.body(), meId, null));
    case 'links_delete': { adminOnly(); const t = str((await c.body()).token); await deleteFilesWhere(c, 'link_token', t); await db.run('DELETE FROM links WHERE token = ?', [t]); return json({ ok: true }); }
    case 'files_list': adminOnly(); return json((await db.all('SELECT f.*, u.username owner, l.label link_label FROM files f LEFT JOIN users u ON u.id = f.owner_id LEFT JOIN links l ON l.token = f.link_token ORDER BY f.seq DESC')).map(fileOut));
    case 'file_delete': { adminOnly(); const id = str((await c.body()).id); if (isId(id)) await deleteFileRow(c, id); return json({ ok: true }); }
    case 'activity_list': adminOnly(); return json(await db.all('SELECT a.ts, a.action, a.detail, a.ip, u.username FROM activity a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 200'));

    // ---- paid plans (GCash / manual approval) ----
    case 'order_create': {
      if (me.parent_id) err('forbidden', 403);
      const b = await c.body(), mo = Math.max(1, Math.min(12, int(b.months ?? 1))), T = tiers(c);
      const kind = T[str(b.plan)] ? str(b.plan) : 'gb', method = b.method === 'bank' ? 'bank' : 'gcash';
      let gb, amount;
      if (kind !== 'gb') { gb = int(T[kind].gb); amount = int(T[kind].price) * mo; }
      else {
        if (int(await db.val('SELECT COUNT(*) FROM users WHERE parent_id = ?', [me.id])) > 0) err('plan_has_subs', 409);
        gb = int(b.gb); if (gb < 1 || gb > int(CFG.max_paid_gb ?? 200)) err('bad_quota'); amount = gb * mo * int(CFG.price_per_gb ?? 50);
      }
      const ref = randHex(5).slice(0, 8).toUpperCase();
      await db.run('INSERT INTO orders (user_id, ref, gb, months, amount, kind, method, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [me.id, ref, gb, mo, amount, kind, method, nowMs()]);
      await act(c, meId, 'order', `${ref} ${kind} ${gb}GB x${mo} ${method}`);
      const pay = method === 'bank' ? [['Bank', str(CFG.bank_name)], ['Account name', str(CFG.bank_account_name)], ['Account number', str(CFG.bank_account_no)]] : [['GCash number', str(CFG.gcash_number)], ['Name', str(CFG.gcash_name)]];
      return json({ ok: true, ref, amount, method, pay });
    }
    case 'order_paid': { // customer reports payment + GCash reference no.
      if (me.parent_id) err('forbidden', 403);
      const b = await c.body();
      await db.run("UPDATE orders SET status = 'paid', pay_ref = ? WHERE ref = ? AND user_id = ? AND status = 'pending'", [cut(str(b.payRef).trim(), 60), str(b.ref), me.id]);
      return json({ ok: true });
    }
    case 'my_orders':
      if (me.parent_id) return json([]);
      return json(await db.all('SELECT ref, kind, method, gb, months, amount, status, pay_ref, created_at FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 20', [me.id]));
    case 'orders_list':
      adminOnly();
      return json(await db.all("SELECT o.id, o.ref, o.kind, o.method, o.gb, o.months, o.amount, o.status, o.pay_ref, o.created_at, u.username, u.email FROM orders o JOIN users u ON u.id = o.user_id ORDER BY CASE o.status WHEN 'paid' THEN 0 WHEN 'pending' THEN 1 WHEN 'approved' THEN 2 ELSE 3 END, o.id DESC LIMIT 200"));
    case 'orders_decide': {
      adminOnly();
      const b = await c.body(), o = await db.first('SELECT * FROM orders WHERE id = ?', [int(b.id)]);
      if (!o || ['approved', 'rejected'].includes(o.status)) err('not_found', 404);
      if (!b.approve) { await db.run("UPDATE orders SET status = 'rejected', decided_at = ? WHERE id = ?", [nowMs(), o.id]); return json({ ok: true }); }
      const t = await db.first('SELECT * FROM users WHERE id = ?', [o.user_id]);
      const start = Math.max(nowMs(), int(t.plan_until ?? 0)), until = start + int(o.months) * 30 * 86400000;
      let gb = int(o.gb), type = str(o.kind);
      if (int(t.plan_gb) > gb) { gb = int(t.plan_gb); type = str(t.plan_type); } // keep the bigger plan if they already have one
      await db.run('UPDATE users SET quota_bytes = ?, plan_gb = ?, plan_type = ?, plan_until = ?, sub_limit = NULL, monthly_reset = 1, reset_month = ?, used_bytes = 0 WHERE id = ?', [gb * 1073741824, gb, type, until, ym(CFG), t.id]);
      await db.run('UPDATE users SET used_bytes = 0 WHERE parent_id = ?', [t.id]);
      await db.run("UPDATE orders SET status = 'approved', decided_at = ? WHERE id = ?", [nowMs(), o.id]);
      await act(c, meId, 'order_ok', o.ref + ' ' + t.username);
      return json({ ok: true });
    }

    // ---- team (sub) accounts: only Company plans, and a team member can never create more ----
    case 'sub_list': {
      const subs = me.parent_id ? [] : await db.all('SELECT id, username, used_bytes, active, created_at FROM users WHERE parent_id = ? ORDER BY id', [me.id]);
      const st = {};
      if (subs.length) for (const r of await db.all("SELECT user_id, COUNT(*) n, MAX(ts) last FROM transfers WHERE kind = 'upload' AND user_id IN (SELECT id FROM users WHERE parent_id = ?) GROUP BY user_id", [me.id])) st[r.user_id] = r;
      return json({ limit: me.parent_id ? 0 : subLimitOf(c, me), subs: subs.map(r => ({ id: int(r.id), username: r.username, usedBytes: int(r.used_bytes), active: !!r.active, createdAt: int(r.created_at), uploads: int(st[r.id]?.n ?? 0), lastAt: st[r.id] ? int(st[r.id].last) : null })) });
    }
    case 'sub_create': {
      if (me.parent_id) err('forbidden', 403);
      const lim = subLimitOf(c, me); if (lim < 1) err('sub_not_allowed', 403);
      const b = await c.body(), name = str(b.username).trim(), pw = str(b.password);
      if (!NAME.test(name)) err('bad_username');
      if (pw.length < 8) err('bad_password');
      if (int(await db.val('SELECT COUNT(*) FROM users WHERE parent_id = ?', [me.id])) >= lim) err('sub_limit', 409);
      await insertSub(c, meId, name, pw);
      await act(c, meId, 'sub_create', name);
      return json({ ok: true });
    }
    case 'sub_update': {
      if (me.parent_id) err('forbidden', 403);
      const b = await c.body(), sb = await db.first('SELECT id FROM users WHERE id = ? AND parent_id = ?', [int(b.id), me.id]); if (!sb) err('not_found', 404);
      if ('active' in b) await db.run('UPDATE users SET active = ? WHERE id = ?', [b.active ? 1 : 0, sb.id]);
      if (b.password) { if (str(b.password).length < 8) err('bad_password'); await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPw(str(b.password)), sb.id]); }
      return json({ ok: true });
    }
    case 'sub_delete': {
      if (me.parent_id) err('forbidden', 403);
      const b = await c.body(), sb = await db.first('SELECT id, username FROM users WHERE id = ? AND parent_id = ?', [int(b.id), me.id]); if (!sb) err('not_found', 404);
      for (const tb of ['files', 'links', 'uploads']) await db.run(`UPDATE ${tb} SET owner_id = ? WHERE owner_id = ?`, [me.id, sb.id]); // files stay with the company; the space they used stays counted
      await db.run('DELETE FROM users WHERE id = ?', [sb.id]); await act(c, meId, 'sub_delete', sb.username);
      return json({ ok: true });
    }

    // ---- admin: create accounts and give plans with no payment ----
    case 'adm_account_create': {
      adminOnly(); const b = await c.body();
      const name = str(b.username).trim(), pw = str(b.password), email = str(b.email).trim();
      if (!NAME.test(name)) err('bad_username');
      if (pw.length < 8) err('bad_password');
      if (email !== '' && !validEmail(email)) err('bad_email');
      const [plan, gb, months, subs] = parsePlan(c, b);
      let id;
      try { id = (await db.run("INSERT INTO users (username, password_hash, role, quota_bytes, monthly_reset, reset_month, email, email_norm, email_verified, active, free_tier, created_at) VALUES (?, ?, 'user', ?, 1, ?, ?, ?, 1, 1, 1, ?)",
        [name, await hashPw(pw), freeBytes(c), ym(CFG), email || null, email ? normEmail(email) : null, nowMs()])).lastId; }
      catch (e) { if (isUnique(e)) err('user_exists', 409); throw e; }
      await applyPlan(c, int(id), plan, gb, months, subs);
      await act(c, meId, 'grant', `${name} ${plan}`); return json({ ok: true, id });
    }
    case 'adm_grant': {
      adminOnly(); const b = await c.body(); const [plan, gb, months, subs] = parsePlan(c, b);
      const t = await db.first("SELECT id, username FROM users WHERE id = ? AND role = 'user' AND parent_id IS NULL", [int(b.id)]); if (!t) err('not_found', 404);
      await applyPlan(c, int(t.id), plan, gb, months, subs); await act(c, meId, 'grant', t.username + ' ' + plan); return json({ ok: true });
    }
    case 'adm_subs': adminOnly(); return json(await db.all('SELECT id, username, used_bytes, active FROM users WHERE parent_id = ? ORDER BY id', [int(c.q('parent'))]));
    case 'adm_sub_create': { // admin may go over the plan's team limit
      adminOnly(); const b = await c.body();
      const pr = await db.first("SELECT * FROM users WHERE id = ? AND role = 'user' AND parent_id IS NULL", [int(b.parent)]); if (!pr) err('not_found', 404);
      if (subLimitOf(c, pr) < 1) err('sub_not_allowed', 403);
      const name = str(b.username).trim(), pw = str(b.password);
      if (!NAME.test(name)) err('bad_username');
      if (pw.length < 8) err('bad_password');
      await insertSub(c, int(pr.id), name, pw); await act(c, meId, 'sub_create', name + ' > ' + pr.username); return json({ ok: true });
    }

    // ---- admin console (paged, searchable) ----
    case 'adm_stats': {
      adminOnly(); const day = 86400000, d = nowMs() - day, m = monthStartMs(CFG);
      const n = async (sql, p = []) => int(await db.val(sql, p));
      return json({ users: await n("SELECT COUNT(*) FROM users WHERE role='user'"), paid: await n('SELECT COUNT(*) FROM users WHERE plan_gb > 0'), new7: await n("SELECT COUNT(*) FROM users WHERE role='user' AND created_at > ?", [nowMs() - 7 * day]),
        unverified: await n('SELECT COUNT(*) FROM users WHERE email_verified = 0'), disabled: await n('SELECT COUNT(*) FROM users WHERE active = 0'),
        tx24: await n('SELECT COUNT(*) FROM transfers WHERE ts > ?', [d]), bytes30: await n("SELECT COALESCE(SUM(bytes),0) FROM transfers WHERE kind='upload' AND ts > ?", [nowMs() - 30 * day]),
        revenue: await n("SELECT COALESCE(SUM(amount),0) FROM orders WHERE status='approved'"), revenueMonth: await n("SELECT COALESCE(SUM(amount),0) FROM orders WHERE status='approved' AND decided_at >= ?", [m]),
        pending: await n("SELECT COUNT(*) FROM orders WHERE status IN ('pending','paid')"),
        flags: await n('SELECT COUNT(*) FROM (SELECT 1 FROM users WHERE reg_device IS NOT NULL GROUP BY reg_device HAVING COUNT(*)>1 UNION ALL SELECT 1 FROM users WHERE email_norm IS NOT NULL GROUP BY email_norm HAVING COUNT(*)>1) t') });
    }
    case 'adm_users': {
      adminOnly(); const pg = Math.max(1, int(c.q('page')) || 1), w = ["role = 'user'"], p = [];
      const qs = c.q('q').trim(); if (qs !== '') { w.push('(username LIKE ? OR email LIKE ? OR reg_ip LIKE ?)'); p.push(`%${qs}%`, `%${qs}%`, `%${qs}%`); }
      const f = c.q('f'); if (f === 'free') w.push('plan_gb = 0'); else if (f === 'paid') w.push('plan_gb > 0'); else if (f === 'unverified') w.push('email_verified = 0'); else if (f === 'disabled') w.push('active = 0');
      const W = w.join(' AND '), tot = int(await db.val(`SELECT COUNT(*) FROM users WHERE ${W}`, p));
      const rows = await db.all(`SELECT u.id, u.username, u.email, u.plan_type, u.free_resets, u.parent_id, u.sub_limit, (SELECT COUNT(*) FROM users s WHERE s.parent_id = u.id) subs, (SELECT username FROM users pp WHERE pp.id = u.parent_id) parent_name, u.plan_gb, u.plan_until, u.quota_bytes, u.used_bytes, u.active, u.email_verified, u.reg_ip, u.created_at,
        (SELECT COUNT(*) FROM users x WHERE x.id <> u.id AND ((x.reg_device IS NOT NULL AND x.reg_device = u.reg_device) OR (x.email_norm IS NOT NULL AND x.email_norm = u.email_norm))) dups,
        (SELECT COUNT(*) FROM transfers t WHERE t.user_id = u.id) txn FROM users u WHERE ${W} ORDER BY u.id DESC LIMIT 25 OFFSET ${(pg - 1) * 25}`, p);
      return json({ total: tot, rows: rows.map(r => ({ ...r, sub_cap: subLimitOf(c, r) })) });
    }
    case 'adm_tx': {
      adminOnly(); const pg = Math.max(1, int(c.q('page')) || 1), w = ['1=1'], p = [];
      const qs = c.q('q').trim(); if (qs !== '') { w.push('(u.username LIKE ? OR t.ip LIKE ?)'); p.push(`%${qs}%`, `%${qs}%`); }
      const k = c.q('k'); if (k === 'upload' || k === 'download') { w.push('t.kind = ?'); p.push(k); }
      const pl = c.q('f'); if (pl === 'free') w.push('u.plan_gb = 0'); else if (pl === 'paid') w.push('u.plan_gb > 0');
      const W = w.join(' AND '), tot = int(await db.val(`SELECT COUNT(*) FROM transfers t LEFT JOIN users u ON u.id = t.user_id WHERE ${W}`, p));
      return json({ total: tot, rows: await db.all(`SELECT t.ts, t.kind, t.bytes, t.ip, u.username, u.plan_gb FROM transfers t LEFT JOIN users u ON u.id = t.user_id WHERE ${W} ORDER BY t.id DESC LIMIT 50 OFFSET ${(pg - 1) * 50}`, p) });
    }
    case 'adm_flags': {
      adminOnly(); const o = [];
      for (const [col, kind] of [['reg_device', 'device'], ['email_norm', 'email'], ['reg_ip', 'ip']])
        for (const r of await db.all(`SELECT ${col} k, COUNT(*) n, group_concat(id) ids, group_concat(username, ', ') names FROM users WHERE role = 'user' AND ${col} IS NOT NULL GROUP BY ${col} HAVING COUNT(*) > 1 ORDER BY n DESC LIMIT 100`))
          o.push({ kind, key: kind === 'device' ? r.k.slice(0, 8) : r.k, n: int(r.n), ids: str(r.ids).split(',').map(int), names: r.names });
      return json(o);
    }

    case 'users_list': {
      adminOnly();
      return json((await db.all('SELECT u.*, (SELECT COUNT(*) FROM files WHERE owner_id = u.id) nfiles FROM users u WHERE u.id <> ? ORDER BY u.role, u.id', [me.id])).map(r => ({ id: int(r.id), username: r.username, role: r.role, quotaBytes: r.quota_bytes !== null ? int(r.quota_bytes) : null, usedBytes: int(r.used_bytes),
        maxFileBytes: r.max_file_bytes !== null ? int(r.max_file_bytes) : null, monthlyReset: !!r.monthly_reset, expiresAt: r.expires_at !== null ? int(r.expires_at) : null, files: int(r.nfiles), active: !!r.active, totp: !!r.totp_secret, createdAt: int(r.created_at) })));
    }
    case 'users_create': {
      adminOnly();
      const b = await c.body(), name = str(b.username).trim(), pw = str(b.password), role = b.role === 'admin' ? 'admin' : 'user', mb = flt(b.quotaMB);
      if (!/^[A-Za-z0-9_.@-]{3,40}$/.test(name)) err('bad_username');
      if (pw.length < 8) err('bad_password');
      if (role === 'user' && !(mb >= 1)) err('bad_quota');
      try { await db.run('INSERT INTO users (username, password_hash, role, quota_bytes, active, created_at) VALUES (?, ?, ?, ?, 1, ?)', [name, await hashPw(pw), role, role === 'user' ? Math.floor(mb * 1048576) : null, nowMs()]); }
      catch (e) { if (isUnique(e)) err('user_exists', 409); throw e; }
      await act(c, meId, 'user_create', name);
      return json({ ok: true });
    }
    case 'users_update': {
      adminOnly();
      const b = await c.body(), id = int(b.id), t = await db.first('SELECT * FROM users WHERE id = ? AND id <> ?', [id, me.id]);
      if (!t) err('not_found', 404);
      const otherAdmins = int(await db.val("SELECT COUNT(*) FROM users WHERE role = 'admin' AND active = 1 AND id <> ?", [id]));
      if ('active' in b && !b.active && t.role === 'admin' && otherAdmins < 1) err('last_admin', 400);
      if ('quotaMB' in b && t.role === 'user') { const mb = flt(b.quotaMB); if (!(mb >= 1)) err('bad_quota'); await db.run('UPDATE users SET quota_bytes = ? WHERE id = ?', [Math.floor(mb * 1048576), id]); }
      if ('maxFileMB' in b) { const mb = flt(b.maxFileMB); await db.run('UPDATE users SET max_file_bytes = ? WHERE id = ?', [mb >= 1 ? Math.floor(mb * 1048576) : null, id]); }
      if ('monthlyReset' in b) { const on = b.monthlyReset ? 1 : 0; await db.run('UPDATE users SET monthly_reset = ?, reset_month = ? WHERE id = ?', [on, on && !t.monthly_reset ? ym(CFG) : t.reset_month, id]); }
      if ('expiresAt' in b) await db.run('UPDATE users SET expires_at = ? WHERE id = ?', [b.expiresAt ? int(b.expiresAt) : null, id]);
      if (b.resetUsed) await db.run('UPDATE users SET used_bytes = 0 WHERE id = ?', [id]);
      if (b.resetTotp) await db.run('UPDATE users SET totp_secret = NULL WHERE id = ?', [id]);
      if ('active' in b) await db.run('UPDATE users SET active = ? WHERE id = ?', [b.active ? 1 : 0, id]);
      if (b.password) { if (str(b.password).length < 8) err('bad_password'); await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPw(str(b.password)), id]); }
      await act(c, meId, 'user_update', t.username);
      return json({ ok: true });
    }
    case 'users_delete': {
      adminOnly();
      const id = int((await c.body()).id), t = await db.first('SELECT * FROM users WHERE id = ? AND id <> ?', [id, me.id]);
      if (t) {
        if (t.role === 'admin' && int(await db.val("SELECT COUNT(*) FROM users WHERE role = 'admin' AND active = 1 AND id <> ?", [id])) < 1) err('last_admin', 400);
        await deleteFilesWhere(c, 'owner_id', id); await db.run('DELETE FROM links WHERE owner_id = ?', [id]); await db.run('DELETE FROM users WHERE id = ?', [id]); await db.run('DELETE FROM sessions WHERE uid = ?', [id]);
        await act(c, meId, 'user_delete', t.username);
      }
      return json({ ok: true });
    }
  }
  err('unknown_action', 404);
}
