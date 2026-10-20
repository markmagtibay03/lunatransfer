import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { CFG } from '../src/config.js';
import { hashPw, totpAt, b32dec } from '../src/lib.js';
import { makeD1, makeR2 } from './shim.mjs';

const DB = makeD1(), BUCKET = makeR2();
const env = { DB, BUCKET, ASSETS: { fetch: async r => new Response('asset:' + new URL(r.url).pathname) } };
const bg = []; const ctx = { waitUntil: p => bg.push(p) };
const flush = async () => { await Promise.all(bg.splice(0)); };
let ok = 0; const T = async (name, fn) => { try { await fn(); ok++; console.log('  ok  ' + name); } catch (e) { console.log('FAIL  ' + name + '\n', e); process.exitCode = 1; } };

class Client {
  constructor(ip = '1.1.1.1') { this.cookie = ''; this.ip = ip; }
  async call(action, { method = 'POST', body, q = {}, raw, headers = {} } = {}) {
    const url = new URL('https://luna.test/api.php'); url.searchParams.set('action', action); for (const [k, v] of Object.entries(q)) url.searchParams.set(k, v);
    const h = { 'cf-connecting-ip': this.ip, 'x-luna': '1', ...headers }; if (this.cookie) h.cookie = this.cookie;
    if (body !== undefined) h['content-type'] = 'application/json';
    const res = await worker.fetch(new Request(url, { method: raw || body !== undefined ? 'POST' : method, headers: h, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) }), env, ctx);
    const sc = res.headers.get('set-cookie'); if (sc) { const m = /lunasid=([^;]*)/.exec(sc); this.cookie = m && m[1] ? 'lunasid=' + m[1] : ''; }
    await flush(); return res;
  }
  async j(action, o) { const r = await this.call(action, o); return { status: r.status, data: await r.json() }; }
}
const now = Date.now();
// seed: admin (pbkdf2) + a normal paid user
await DB.raw.prepare("INSERT INTO users (username, password_hash, role, quota_bytes, active, created_at) VALUES ('admin', ?, 'admin', NULL, 1, ?)").run(await hashPw('adminpass1'), now);
const admin = new Client('9.9.9.9');

console.log('Login / sessions');
await T('login with wrong password is rejected', async () => { const r = await new Client().j('login', { body: { username: 'admin', password: 'x' } }); assert.equal(r.status, 401); assert.equal(r.data.error, 'login_bad'); });
await T('login without X-Luna header is rejected (CSRF)', async () => { const r = await new Client().call('login', { body: { username: 'admin', password: 'adminpass1' }, headers: { 'x-luna': '0' } }); assert.equal(r.status, 403); });
await T('admin login + me', async () => { const r = await admin.j('login', { body: { username: 'admin', password: 'adminpass1' } }); assert.equal(r.status, 200); assert.equal(r.data.role, 'admin'); const m = await admin.j('me', { method: 'GET' }); assert.equal(m.data.username, 'admin'); });
await T('requests without login get 401', async () => { const r = await new Client().j('me', { method: 'GET' }); assert.equal(r.status, 401); });
await T('lockout after 5 bad logins', async () => { const c = new Client('5.5.5.5'); for (let i = 0; i < 5; i++) await c.j('login', { body: { username: 'admin', password: 'bad' } }); const r = await c.j('login', { body: { username: 'admin', password: 'adminpass1' } }); assert.equal(r.status, 429); });

console.log('Accounts and plans');
let userId;
await T('admin creates an account with a 10 MB quota', async () => { const r = await admin.j('users_create', { body: { username: 'bob', password: 'bobpass123', quotaMB: 10 } }); assert.equal(r.data.ok, true); const l = await admin.j('users_list', { method: 'GET' }); userId = l.data.find(u => u.username === 'bob').id; assert.equal(l.data.find(u => u.username === 'bob').quotaBytes, 10 * 1048576); });
const bob = new Client('2.2.2.2');
await T('bob logs in', async () => { assert.equal((await bob.j('login', { body: { username: 'bob', password: 'bobpass123' } })).status, 200); });
await T('public signup creates a free account with the free quota', async () => { const c = new Client('3.3.3.3'); const r = await c.j('register', { body: { username: 'newbie', password: 'password1', email: 'newbie@gmail.com', device: 'a'.repeat(32) } }); assert.equal(r.data.ok, true); const m = await c.j('me', { method: 'GET' }); assert.equal(m.data.quotaBytes, 100 * 1048576); assert.equal(m.data.freeTier, true); });
await T('same mailbox (gmail dots/+tag) is blocked as duplicate', async () => { const r = await new Client('3.3.3.4').j('register', { body: { username: 'newbie2', password: 'password1', email: 'new.bie+x@gmail.com', device: 'b'.repeat(32) } }); assert.equal(r.status, 409); });
await T('same device is blocked', async () => { const r = await new Client('3.3.3.5').j('register', { body: { username: 'newbie3', password: 'password1', email: 'other@example.com', device: 'a'.repeat(32) } }); assert.equal(r.status, 409); });

console.log('Chunked upload + download (R2 per-chunk objects)');
const CS = 65536, OV = 28;
const rnd = n => { const a = new Uint8Array(n); for (let i = 0; i < n; i += 65536) crypto.getRandomValues(a.subarray(i, Math.min(n, i + 65536))); return a; };
const grp = 'a'.repeat(24);
let link, up, chunks = [];
const SIZE = CS * 2 + 1000; // 3 chunks
await T('bob creates an upload link', async () => { const r = await bob.j('my_links_create', { body: { maxMB: 5, expiryHours: 24, label: 'test' } }); assert.ok(r.data.token, JSON.stringify(r)); link = r.data.token; });
await T('guest sees link info', async () => { const r = await new Client('7.7.7.7').j('link_info', { method: 'GET', q: { t: link } }); assert.equal(r.data.owner, 'bob'); });
const guest = new Client('7.7.7.7');
await T('guest upload_init', async () => { const r = await guest.j('upload_init', { q: { t: link, g: grp }, body: { size: SIZE, chunks: 3, chunkSize: CS, meta: 'META', salt: '' } }); assert.equal(r.status, 200, JSON.stringify(r)); up = r.data.id; assert.match(up, /^[a-f0-9]{24}$/); });
const post = (id, i, buf) => guest.call('upload_chunk', { q: { id, i }, raw: buf, headers: { 'content-length': String(buf.length), 'content-type': 'application/octet-stream' } });
await T('chunks must arrive in order', async () => { const r = await post(up, 1, rnd(CS + OV)); assert.equal(r.status, 409); assert.equal((await r.json()).params.next, 0); });
await T('wrong chunk size is rejected', async () => { const r = await post(up, 0, rnd(100)); assert.equal(r.status, 400); });
await T('upload 3 chunks; a retried chunk is harmless; status works', async () => {
  chunks = [rnd(CS + OV), rnd(CS + OV), rnd(SIZE - 2 * CS + OV)];
  assert.equal((await (await post(up, 0, chunks[0])).json()).next, 1);
  assert.equal((await (await post(up, 0, chunks[0])).json()).next, 1); // retry
  assert.equal((await (await post(up, 1, chunks[1])).json()).next, 2);
  assert.equal((await guest.j('upload_status', { method: 'GET', q: { id: up } })).data.next, 2);
  assert.equal((await (await post(up, 2, chunks[2])).json()).next, 3);
});
await T('finishing counts quota and stores the file', async () => {
  const r = await guest.j('upload_finish', { q: { id: up } }); assert.equal(r.status, 200, JSON.stringify(r)); assert.equal(r.data.ok, true);
  assert.equal((await bob.j('me', { method: 'GET' })).data.usedBytes, SIZE);
  assert.equal((await DB.raw.prepare('SELECT store FROM files WHERE id = ?').get(up)).store, 1);
});
await T('group_info, file_open, file_get returns the exact chunk bytes', async () => {
  const g = await new Client('8.8.8.8').j('group_info', { method: 'GET', q: { g: grp } }); assert.equal(g.data.files.length, 1); assert.equal(g.data.files[0].id, up);
  const dl = new Client('8.8.8.8'); const o = await dl.j('file_open', { method: 'GET', q: { f: up } }); assert.equal(o.status, 200, JSON.stringify(o)); assert.equal(o.data.chunkSize, CS);
  for (let i = 0; i < 3; i++) { const s = i * (CS + OV), l = Math.min(CS + OV, o.data.size - s); const r = await dl.call('file_get', { method: 'GET', q: { f: up, k: o.data.token, s, l } }); assert.equal(r.status, 200); assert.equal(r.headers.get('content-length'), String(l)); assert.deepEqual(new Uint8Array(await r.arrayBuffer()), chunks[i]); }
});
await T('a download token cannot read another file / wrong offsets', async () => { const dl = new Client('8.8.8.8'); const o = await dl.j('file_open', { method: 'GET', q: { f: up } }); const r = await dl.call('file_get', { method: 'GET', q: { f: up, k: o.data.token, s: 5, l: 10 } }); assert.equal(r.status, 400); const r2 = await dl.call('file_get', { method: 'GET', q: { f: up, k: 'bad', s: 0, l: CS + OV } }); assert.equal(r2.status, 410); });
await T('quota: a second 9 MB upload is refused (10 MB quota)', async () => { const r = await guest.j('upload_init', { q: { t: link, g: 'b'.repeat(24) }, body: { size: 9 * 1048576, chunks: Math.ceil(9 * 1048576 / CS), chunkSize: CS, meta: 'M' } }); assert.equal(r.status, 413); });
await T('deleting the file removes every R2 object and row', async () => { assert.ok([...BUCKET._m.keys()].some(k => k.startsWith('files/' + up))); const r = await bob.j('my_file_delete', { body: { id: up } }); assert.equal(r.data.ok, true); assert.equal([...BUCKET._m.keys()].filter(k => k.includes(up)).length, 0); assert.equal(await DB.raw.prepare('SELECT 1 FROM files WHERE id = ?').get(up), undefined); });

console.log('Legacy whole-object file (copied from the PHP server)');
await T('range reads work on store=0 files', async () => {
  const id = 'c'.repeat(24), cs = 4194304, size = 100 + 28, buf = rnd(size);
  await BUCKET.put('files/' + id, buf.buffer);
  await DB.raw.prepare("INSERT INTO files (id, link_token, owner_id, grp, meta, size, plain_size, chunks, chunk_size, uploaded_at, delete_at, salt, pw, store) VALUES (?, NULL, ?, ?, 'M', ?, 100, 1, ?, ?, ?, NULL, 0, 0)").run(id, userId, 'd'.repeat(24), size, cs, now, now + 86400000);
  const dl = new Client('4.4.4.4'); const o = await dl.j('file_open', { method: 'GET', q: { f: id } }); assert.equal(o.status, 200);
  const r = await dl.call('file_get', { method: 'GET', q: { f: id, k: o.data.token, s: 0, l: size } }); assert.deepEqual(new Uint8Array(await r.arrayBuffer()), buf);
});
await T('old single-block files (chunks=0) download whole', async () => {
  const id = 'e'.repeat(24), buf = rnd(500); await BUCKET.put('files/' + id, buf.buffer);
  await DB.raw.prepare("INSERT INTO files (id, grp, meta, size, plain_size, chunks, chunk_size, uploaded_at, delete_at, store) VALUES (?, ?, 'M', 500, 472, 0, 0, ?, ?, 0)").run(id, 'f'.repeat(24), now, now + 86400000);
  const r = await new Client('4.4.4.4').call('file_get', { method: 'GET', q: { f: id } }); assert.deepEqual(new Uint8Array(await r.arrayBuffer()), buf);
});

console.log('Limits and cleanup');
await T('max downloads: file is deleted after the last allowed download', async () => {
  const c = new Client('6.6.6.6'); const g = '1'.repeat(24);
  const init = await c.j('upload_init', { q: { t: '' , g }, body: { size: CS, chunks: 1, chunkSize: CS, meta: 'M', maxDownloads: 1, retentionDays: 1 } }); assert.equal(init.status, 401); // not logged in
  const r = await bob.j('upload_init', { q: { g }, body: { size: CS, chunks: 1, chunkSize: CS, meta: 'M', maxDownloads: 1, retentionDays: 1 } }); assert.equal(r.status, 200, JSON.stringify(r));
  const id = r.data.id, buf = rnd(CS + OV); const pr = await bob.call('upload_chunk', { q: { id, i: 0 }, raw: buf, headers: { 'content-length': String(buf.length) } }); assert.equal(pr.status, 200);
  assert.equal((await bob.j('upload_finish', { q: { id } })).status, 200);
  const o = await c.j('file_open', { method: 'GET', q: { f: id } }); assert.equal(o.status, 200);
  const g1 = await c.call('file_get', { method: 'GET', q: { f: id, k: o.data.token, s: 0, l: CS + OV } }); await g1.arrayBuffer(); await flush();
  assert.equal(await DB.raw.prepare('SELECT 1 FROM files WHERE id = ?').get(id), undefined);
  assert.equal((await c.j('file_open', { method: 'GET', q: { f: id } })).status, 410);
});
await T('abandoned uploads are cleaned up (R2 chunks removed, slot released)', async () => {
  const l2 = (await bob.j('my_links_create', { body: { maxMB: 5, expiryHours: 24, oneTime: true } })).data.token;
  const r = await new Client('7.7.7.8').j('upload_init', { q: { t: l2, g: '2'.repeat(24) }, body: { size: CS, chunks: 1, chunkSize: CS, meta: 'M' } }); const id = r.data.id;
  const buf = rnd(CS + OV); await new Client('7.7.7.8').call('upload_chunk', { q: { id, i: 0 }, raw: buf, headers: { 'content-length': String(buf.length) } });
  assert.equal((await DB.raw.prepare('SELECT used FROM links WHERE token = ?').get(l2)).used, 1);
  DB.raw.prepare('UPDATE uploads SET updated_at = ?').run(now - 2 * 86400000);
  const { makeCtx, cleanup } = await import('../src/core.js'); await cleanup(makeCtx(env, new Request('https://x/'), ctx, CFG));
  assert.equal([...BUCKET._m.keys()].filter(k => k.includes(id)).length, 0); assert.equal((await DB.raw.prepare('SELECT used FROM links WHERE token = ?').get(l2)).used, 0);
});

console.log('Security / 2FA / admin');
await T('2FA: setup, enable, login now needs a code', async () => {
  const c = new Client('2.2.2.9'); await c.j('login', { body: { username: 'bob', password: 'bobpass123' } });
  const s = await c.j('totp_setup', { body: {} }); const step = Math.floor(Date.now() / 30000);
  const code = await totpAt(s.data.secret, step); assert.equal((await c.j('totp_enable', { body: { code } })).data.ok, true);
  const c2 = new Client('2.2.2.10'); assert.equal((await c2.j('login', { body: { username: 'bob', password: 'bobpass123' } })).data.error, 'code_required');
  assert.equal((await c2.j('login', { body: { username: 'bob', password: 'bobpass123', code: await totpAt(s.data.secret, step) } })).status, 200);
});
await T('non-admins cannot use admin actions', async () => { assert.equal((await bob.j('users_list', { method: 'GET' })).status, 403); });
await T('admin console endpoints run (stats, users, tx, flags, orders, activity)', async () => {
  for (const a of ['adm_stats', 'adm_users', 'adm_tx', 'adm_flags', 'orders_list', 'activity_list', 'links_list', 'files_list']) { const r = await admin.j(a, { method: 'GET' }); assert.equal(r.status, 200, a + ' ' + JSON.stringify(r.data)); }
  const st = (await admin.j('adm_stats', { method: 'GET' })).data; assert.ok(st.users >= 2);
});
await T('order flow: create, customer marks paid, admin approves -> plan applied', async () => {
  const c = new Client('2.2.2.20'); await c.j('login', { body: { username: 'newbie', password: 'password1' } });
  const o = await c.j('order_create', { body: { plan: 'gb', gb: 5, months: 2, method: 'gcash' } }); assert.equal(o.data.amount, 5 * 2 * 50);
  await c.j('order_paid', { body: { ref: o.data.ref, payRef: 'GC123' } });
  const list = (await admin.j('orders_list', { method: 'GET' })).data; const row = list.find(x => x.ref === o.data.ref); assert.equal(row.status, 'paid');
  assert.equal((await admin.j('orders_decide', { body: { id: row.id, approve: true } })).data.ok, true);
  const m = (await c.j('me', { method: 'GET' })).data; assert.equal(m.planGB, 5); assert.equal(m.quotaBytes, 5 * 1073741824);
});
await T('team accounts: grant Company plan, create sub, sub shares the pool', async () => {
  const mainId = (await admin.j('users_list', { method: 'GET' })).data.find(u => u.username === 'newbie').id;
  assert.equal((await admin.j('adm_grant', { body: { id: mainId, plan: 'company', months: 1 } })).data.ok, true);
  const c = new Client('2.2.2.20'); await c.j('login', { body: { username: 'newbie', password: 'password1' } });
  assert.equal((await c.j('sub_create', { body: { username: 'staff1', password: 'staffpass1' } })).data.ok, true);
  const s = new Client('2.2.2.21'); await s.j('login', { body: { username: 'staff1', password: 'staffpass1' } });
  const m = (await s.j('me', { method: 'GET' })).data; assert.equal(m.isSub, true); assert.equal(m.quotaBytes, 100 * 1073741824);
});
await T('logout ends the session', async () => { const c = new Client('2.2.2.30'); await c.j('login', { body: { username: 'bob', password: 'bobpass123', code: await totpAt((DB.raw.prepare("SELECT totp_secret s FROM users WHERE username='bob'").get()).s, Math.floor(Date.now() / 30000)) } }); await c.j('logout', { body: {} }); assert.equal((await c.j('me', { method: 'GET' })).status, 401); });

console.log('Pages / routing');
await T('index renders; *.php pages map to assets; config.php/setup.php are not served', async () => {
  const get = p => worker.fetch(new Request('https://luna.test' + p), env, ctx);
  const i = await get('/'); assert.equal(i.status, 200); assert.match(await i.text(), /Luna Transfer/);
  assert.equal(await (await get('/download.php?g=x')).text(), 'asset:/pages/download.html');
  assert.equal(await (await get('/transfer.js')).text(), 'asset:/transfer.js');
  assert.equal((await get('/config.php')).status, 404); assert.equal((await get('/setup.php')).status, 404);
});
console.log(`\n${ok} passed${process.exitCode ? ', SOME FAILED' : ''}`);
