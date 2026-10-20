// Upload / download logic shared by upload.php, account.php and download.php. (Needs i18n.js and crypto.js)
const sleep = ms => new Promise(r => setTimeout(r, ms));
const waitOnline = async () => { while (navigator.onLine === false) await sleep(1000); };
const ext = n => { const m = /\.([A-Za-z0-9]{1,4})$/.exec(n); return m ? m[1] : 'file'; };
const safeName = n => (n || 'file').split('/').pop().replace(/[\\/:*?"<>|]+/g, '_');

// ---------- history (saved in this browser) ----------
const loadHist = k => { try { return JSON.parse(localStorage.getItem(k) || '[]').filter(e => e.deleteAt > Date.now()); } catch { return []; } };
const saveHist = (k, a) => { try { localStorage.setItem(k, JSON.stringify(a)); } catch {} };

// ---------- share buttons + QR ----------
function linkTools(url) {
  const box = el('div', 'tools'), u = encodeURIComponent(url);
  [['Telegram', 'https://t.me/share/url?url=' + u], ['WhatsApp', 'https://wa.me/?text=' + u], ['Viber', 'viber://forward?text=' + u], ['Messenger', 'fb-messenger://share/?link=' + u], ['Email', 'mailto:?subject=' + encodeURIComponent(L('share.subject')) + '&body=' + u]]
    .forEach(([n, h]) => { const a = el('a', 'btn ghost sm', n); a.href = h; a.target = '_blank'; a.rel = 'noopener'; box.append(a); });
  const q = el('button', 'btn ghost sm', 'QR'), qb = el('div', 'qr'); qb.hidden = true;
  q.onclick = () => { if (qb.hidden && !qb.innerHTML) qb.innerHTML = qrSvg(url); qb.hidden = !qb.hidden; };
  box.append(q, qb); return box;
}
async function copyText(s, b) {
  try { await navigator.clipboard.writeText(s); } catch { const r = document.createRange(), c = b.closest('.url')?.querySelector('code'); if (c) { r.selectNodeContents(c); getSelection().removeAllRanges(); getSelection().addRange(r); } return alert(L('u.copy_fail')); }
  const o = b.textContent; b.textContent = L('copied'); setTimeout(() => b.textContent = o, 1400);
}

// ---------- upload one file in encrypted chunks (with retry + resume) ----------
function xhrPost(url, body, headers, onp) {
  return new Promise(res => {
    const x = new XMLHttpRequest(); x.open('POST', url); for (const k in headers) x.setRequestHeader(k, headers[k]);
    if (onp) x.upload.onprogress = e => { if (e.lengthComputable) onp(e.loaded, e.total); };
    x.onload = () => { let j = {}; try { j = JSON.parse(x.responseText); } catch {} res({ status: x.status, json: j }); };
    x.onerror = () => res({ status: 0, json: {} }); x.send(body);
  });
}
async function uploadFile(o) {
  const { file, name, key, salt, gid, token } = o, n = Math.max(1, Math.ceil(file.size / CHUNK));
  const meta = toB64u(await encryptBytes(key, new TextEncoder().encode(JSON.stringify({ name, type: file.type }))));
  const r0 = await fetch('api.php?action=upload_init' + (token ? '&t=' + encodeURIComponent(token) : '') + '&g=' + gid, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Luna': '1' },
    body: JSON.stringify({ size: file.size, chunks: n, chunkSize: CHUNK, meta, salt, retentionDays: o.retentionDays, maxDownloads: o.maxDownloads }) });
  const j0 = await r0.json().catch(() => ({})); if (!r0.ok) throw new Error(errText(j0));
  const id = j0.id; let i = 0, fails = 0;
  try {
    while (i < n) {
      const start = i * CHUNK, len = Math.min(file.size - start, CHUNK);
      const enc = await encChunk(key, new Uint8Array(await file.slice(start, start + len).arrayBuffer()), i, n);
      const r = await xhrPost('api.php?action=upload_chunk&id=' + id + '&i=' + i, enc, { 'Content-Type': 'application/octet-stream' }, (l, t) => o.onProgress && o.onProgress((start + len * l / t) / file.size));
      if (r.status === 200) { i = r.json.next; fails = 0; o.onProgress && o.onProgress(Math.min(1, i * CHUNK / file.size)); continue; }
      if (r.status === 409 && typeof r.json.params?.next === 'number') { i = r.json.params.next; continue; }
      if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) throw new Error(errText(r.json));
      if (++fails > 8) throw new Error(r.status === 0 ? L('e.net') : errText(r.json));
      o.onStage && o.onStage('retry'); await waitOnline(); await sleep(Math.min(8000, 500 * 2 ** fails));
      const s = await fetch('api.php?action=upload_status&id=' + id).then(x => x.json()).catch(() => null);
      if (s && typeof s.next === 'number') i = s.next;
    }
    for (let a = 0; ; a++) {
      let rf; try { rf = await fetch('api.php?action=upload_finish&id=' + id, { method: 'POST', headers: { 'X-Luna': '1' } }); } catch { if (a > 4) throw new Error(L('e.net')); await waitOnline(); await sleep(1000); continue; }
      const jf = await rf.json().catch(() => ({})); if (!rf.ok) throw new Error(errText(jf)); return jf;
    }
  } catch (e) { try { await fetch('api.php?action=upload_abort&id=' + id, { method: 'POST', headers: { 'X-Luna': '1' } }); } catch {} throw e; }
}

// ---------- drag & drop of folders ----------
async function droppedFiles(dt) {
  const out = [], walk = async (en, path) => {
    if (en.isFile) await new Promise(res => en.file(f => { f._path = path + f.name; out.push(f); res(); }, res));
    else if (en.isDirectory) { const rd = en.createReader(); for (;;) { const b = await new Promise(res => rd.readEntries(res, () => res([]))); if (!b.length) break; for (const c of b) await walk(c, path + en.name + '/'); } }
  };
  const items = [...(dt.items || [])].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  if (items.length) { for (const e of items) await walk(e, ''); return out; }
  return [...dt.files];
}

// ---------- the uploader widget (guest page + account page) ----------
function mountUploader(root, cfg) {
  root.innerHTML = `<div class="u-form"><div class="drop" id="udrop"><svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5M4 20h16"/></svg><b data-i="u.pick"></b><span data-i="u.drag"></span>
   <div class="pickers"><button type="button" class="btn sm" data-p="f" data-i="u.btn_files"></button><button type="button" class="btn ghost sm" data-p="d" data-i="u.btn_folder"></button></div>
   <input type="file" multiple hidden id="uf"><input type="file" webkitdirectory hidden id="ud"></div>
  <div id="urows"></div><div class="total" id="utot" hidden><span id="ucnt"></span><span id="usz"></span></div>
  <div id="uxtra">${cfg.extraHtml || ''}</div>
  <label class="check" style="margin-top:1rem"><input type="checkbox" id="upw"><span><span data-i="u.usepw"></span><small data-i="u.usepw_d"></small></span></label>
  <label class="field" id="upwbox" hidden><span data-i="u.pw"></span><input type="password" id="upwv" autocomplete="new-password"></label>
  <button class="btn block" id="ugo" disabled></button></div>
  <div class="u-done" hidden><svg class="tick" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30"/><path d="M19 33l9 9 17-19"/></svg><h1 data-i="u.done"></h1><p class="sub" id="udsub"></p>
   <div class="url"><code id="udl"></code><button class="btn sm" id="udcp"></button></div><div id="utools"></div><div class="alert note" id="udnote"></div><div class="alert" id="udfail" hidden></div>
   <button class="btn ghost block" style="margin-top:1rem" id="uagain" data-i="u.again"></button></div><div class="alert" id="umsg" hidden></div>`;
  const R = s => root.querySelector(s); let files = [], busy = false, doneState = null;
  const nameOf = f => f._path || f.webkitRelativePath || f.name;
  const total = () => files.reduce((s, f) => s + f.size, 0);
  const msg = (s, c) => { const m = R('#umsg'); m.textContent = s || ''; m.hidden = !s; m.className = 'alert' + (c ? ' ' + c : ''); };
  R('#upw').onchange = e => R('#upwbox').hidden = !e.target.checked;
  const drop = R('#udrop');
  drop.onclick = e => { if (!e.target.closest('button') && !busy) R('#uf').click(); };
  drop.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { if (!busy) R(b.dataset.p === 'f' ? '#uf' : '#ud').click(); });
  ['dragenter', 'dragover'].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', async ev => pick(await droppedFiles(ev.dataTransfer)));
  ['#uf', '#ud'].forEach(s => R(s).onchange = e => { pick([...e.target.files]); e.target.value = ''; });
  function pick(list) {
    if (busy) return; msg(); let err = '';
    for (const f of list) {
      const nm = nameOf(f);
      if (f.size === 0) { err = L('u.skip_empty', { name: nm }); continue; }
      if (files.some(x => nameOf(x) === nm && x.size === f.size)) continue;
      if (files.length >= cfg.maxFiles()) { err = L('u.max_files', { n: cfg.maxFiles() }); break; }
      const fm = cfg.maxFileBytes && cfg.maxFileBytes(); if (fm && f.size > fm) { err = errText({ error: 'file_too_big', params: { maxb: fm } }) + ' ' + nm; continue; }
      if (total() + f.size > cfg.limit()) { err = L('u.over', { size: fmtSize(cfg.limit()), name: nm }); continue; }
      files.push(f);
    }
    if (err) msg(err); renderRows();
  }
  function renderRows() {
    const box = R('#urows'), prev = [...box.children].map(r => [r.querySelector('.fst').textContent, r.querySelector('.fst').className, r.querySelector('.mini i').style.width]); box.innerHTML = '';
    files.forEach((f, i) => { const r = el('div', 'frow'), n = el('div', 'fname'), mini = el('div', 'mini'); mini.append(el('i')); n.append(el('b', '', nameOf(f)), el('small', '', fmtSize(f.size)), mini);
      const x = el('button', 'btn danger sm', L('remove')); x.onclick = () => { files.splice(i, 1); renderRows(); }; const fs = el('span', 'fst'); r.append(el('div', 'ext', ext(nameOf(f))), n, fs, x); box.append(r);
      if (busy && prev[i]) { fs.textContent = prev[i][0]; fs.className = prev[i][1]; mini.firstChild.style.width = prev[i][2]; } });
    drop.classList.toggle('compact', files.length > 0); R('#utot').hidden = !files.length; R('#ucnt').textContent = L('u.count', { n: files.length }); R('#usz').textContent = L('u.of', { a: fmtSize(total()), b: fmtSize(cfg.limit()) });
    if (!busy) R('#ugo').disabled = !files.length; R('#ugo').textContent = files.length > 1 ? L('u.upload_n', { n: files.length }) : L('u.upload');
  }
  const st = (i, s, c) => { const e = R('#urows').children[i].querySelector('.fst'); e.textContent = s; e.className = 'fst ' + (c || ''); };
  const pg = (i, p) => { R('#urows').children[i].querySelector('.mini i').style.width = Math.round(p * 100) + '%'; };
  R('#ugo').onclick = async () => {
    if (!files.length || busy) return; const usePw = R('#upw').checked, pw = R('#upwv').value;
    if (!crypto.subtle) return msg(L('e.no_https'));
    if (usePw && pw.length < 6) return msg(L('u.pw_short'));
    busy = true; root.querySelector('.u-form').classList.add('busy'); R('#ugo').disabled = true; drop.hidden = true; msg(L('u.working'), 'note');
    try {
      let k, salt = null; if (usePw) { const s = crypto.getRandomValues(new Uint8Array(16)); salt = toB64u(s); k = await deriveKey(pw, s); } else k = await newKey();
      const gid = hexId(), ok = [], bad = []; let deleteAt = 0, maxDl = 0; const x = cfg.extra ? cfg.extra() : {};
      for (let i = 0; i < files.length; i++) {
        const f = files[i]; st(i, L('u.encrypting'));
        try { const j = await uploadFile({ file: f, name: nameOf(f).slice(0, 200), key: k, salt, gid, token: cfg.token, retentionDays: x.retentionDays, maxDownloads: x.maxDownloads, onProgress: p => { pg(i, p); st(i, L('u.uploading')); }, onStage: () => st(i, L('u.retrying')) });
          pg(i, 1); st(i, L('u.ok'), 'ok'); ok.push({ name: nameOf(f).slice(0, 200), size: f.size }); deleteAt = j.deleteAt; maxDl = j.maxDownloads; }
        catch (e) { st(i, L('u.fail_row'), 'bad'); bad.push(nameOf(f) + ' (' + e.message + ')'); }
      }
      msg();
      if (!ok.length) { root.querySelector('.u-form').classList.remove('busy'); busy = false; drop.hidden = false; R('#ugo').disabled = false; return msg(L('u.none', { errs: bad.join(' ') })); }
      const e = { gid, key: usePw ? null : k, pw: usePw, files: ok, size: ok.reduce((s, f) => s + f.size, 0), deleteAt, maxDownloads: maxDl };
      const h = loadHist(cfg.histKey); h.push(e); saveHist(cfg.histKey, h);
      root.querySelector('.u-form').hidden = true; doneState = { e, bad }; renderDone(); root.querySelector('.u-done').hidden = false; cfg.onUploaded && cfg.onUploaded(e);
    } catch (e) { msg(e.message); busy = false; root.querySelector('.u-form').classList.remove('busy'); drop.hidden = false; R('#ugo').disabled = false; }
  };
  function renderDone() {
    if (!doneState) return; const { e, bad } = doneState, url = cfg.linkOf(e);
    R('#udl').textContent = url; R('#udcp').textContent = L('copy'); R('#udcp').onclick = ev => copyText(url, ev.target);
    R('#udsub').textContent = e.files.length === 1 ? L('u.done1') : L('u.donen', { n: e.files.length });
    R('#utools').innerHTML = ''; R('#utools').append(linkTools(url));
    R('#udnote').textContent = L('u.note') + (e.pw ? L('u.note_pw') : '');
    R('#udfail').hidden = !bad.length; if (bad.length) R('#udfail').textContent = L('u.failed', { list: bad.join(', ') });
  }
  function reset() { files = []; busy = false; doneState = null; root.querySelector('.u-done').hidden = true; const f = root.querySelector('.u-form'); f.hidden = false; f.classList.remove('busy'); drop.hidden = false; R('#upwv').value = ''; R('#upw').checked = false; R('#upwbox').hidden = true; msg(); renderRows(); }
  R('#uagain').onclick = reset;
  renderRows(); applyI18n();
  return { renderRows, renderDone, reset, msg };
}

// ---------- history panel (guest page) ----------
function renderHistPanel(panel, list, key, urlOf) {
  const a = loadHist(key); saveHist(key, a); panel.hidden = !a.length; list.innerHTML = '';
  a.slice().reverse().forEach(e => {
    const d = el('div', 'link'), h = el('div', 'link-h'); h.append(el('b', '', e.files.length === 1 ? e.files[0].name : L('u.nfiles', { n: e.files.length })), el('span', 'chip' + (e.pw ? '' : ' ok'), e.pw ? L('u.haspw') : L('u.nopw'))); d.append(h);
    const m = el('div', 'meta'); if (e.files.length > 1) m.append(el('span', '', e.files.map(f => f.name).join(', ').slice(0, 90)));
    m.append(el('span', '', fmtSize(e.size)), el('span', '', L('u.m_del', { date: DT(e.deleteAt) }))); if (e.maxDownloads > 0) m.append(el('span', '', L('u.m_dl', { n: e.maxDownloads }))); d.append(m);
    const row = el('div', 'url'), u = urlOf(e); row.append(el('code', '', u)); const b = el('button', 'btn sm', L('copy')); b.onclick = ev => copyText(u, ev.target); row.append(b);
    const x = el('button', 'btn danger sm', L('remove')); x.title = L('u.rm_title'); x.onclick = () => { if (confirm(L('u.rm_confirm'))) { saveHist(key, loadHist(key).filter(i => i.gid !== e.gid)); renderHistPanel(panel, list, key, urlOf); } }; row.append(x);
    d.append(row, linkTools(u)); list.append(d);
  });
}

// ================= download side =================
async function openFile(id) {
  const r = await fetch('api.php?action=file_open&f=' + encodeURIComponent(id)), j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(errText(j)); return j;
}
async function fetchRetry(url) {
  for (let a = 0; ; a++) {
    let r = null; try { r = await fetch(url); } catch {}
    if (r && r.ok) return r;
    if (r && r.status < 500 && r.status !== 408 && r.status !== 429) throw new Error(errText(await r.json().catch(() => ({}))));
    if (a >= 5) throw new Error(L('e.net'));
    await waitOnline(); await sleep(800 * (a + 1));
  }
}
async function* plainChunks(f, key, onp) {
  if (!f.chunks) { // old single-block files
    const r = await fetchRetry('api.php?action=file_get&f=' + encodeURIComponent(f.id));
    yield await decryptBytes(key, new Uint8Array(await r.arrayBuffer())); onp && onp(1); return;
  }
  const o = await openFile(f.id), n = o.chunks, cs = o.chunkSize;
  for (let i = 0; i < n; i++) {
    const s = i * (cs + 28), l = Math.min(cs + 28, o.size - s);
    const r = await fetchRetry('api.php?action=file_get&f=' + encodeURIComponent(f.id) + '&k=' + o.token + '&s=' + s + '&l=' + l);
    let p; try { p = await decChunk(key, new Uint8Array(await r.arrayBuffer()), i, n); } catch { throw new Error(L('d.corrupt')); }
    yield p; onp && onp((i + 1) / n);
  }
}
const canStream = () => typeof window.showSaveFilePicker === 'function';
async function saveFile(f, key, onp) {
  const name = safeName(f.name);
  if (canStream()) { // writes straight to disk: works for very large files
    const h = await showSaveFilePicker({ suggestedName: name }), w = await h.createWritable();
    try { for await (const c of plainChunks(f, key, onp)) await w.write(c); await w.close(); } catch (e) { try { await w.abort(); } catch {} throw e; }
    return;
  }
  const parts = []; for await (const c of plainChunks(f, key, onp)) parts.push(c);
  return blobSave(new Blob(parts, { type: 'application/octet-stream' }), name);
}
// Fallback for browsers without showSaveFilePicker (phones, Firefox, Safari, in-app browsers).
// The link is attached to the page before clicking (some browsers ignore detached links) and is returned so the page can
// show a manual "tap here" link in case the browser still blocks the automatic download.
function blobSave(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener'; a.style.display = 'none'; document.body.append(a);
  try { a.click(); } catch (e) {}
  setTimeout(() => a.remove(), 1000); setTimeout(() => URL.revokeObjectURL(url), 600000);
  return { url, name };
}
const inAppBrowser = () => /FBAN|FBAV|FB_IAB|Messenger|Instagram|Viber|Line\/|Snapchat|MicroMessenger|Telegram/i.test(navigator.userAgent);
async function zipSave(list, key, onFile) { // list of file objects; onFile(i, fraction)
  let write, close = async () => {}, parts = [];
  if (canStream()) { const h = await showSaveFilePicker({ suggestedName: 'files.zip', types: [{ description: 'ZIP', accept: { 'application/zip': ['.zip'] } }] }), w = await h.createWritable(); write = u => w.write(u); close = () => w.close(); }
  else write = async u => { parts.push(u); };
  const z = new ZipWriter(write);
  for (let i = 0; i < list.length; i++) await z.add(list[i].name, plainChunks(list[i], key, p => onFile && onFile(i, p)));
  await z.finish(); await close();
  if (!canStream()) return blobSave(new Blob(parts, { type: 'application/zip' }), 'files.zip');
}
