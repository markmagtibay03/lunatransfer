/* Login screen helpers: texts, show/hide password, busy button, auto-focus. Works with the page's own login(). */
(function () {
  const T = {
    en: { 'l.hero': 'Locked before it leaves your device.', 'l.hero_sub': 'Files are encrypted in your browser, so only the person with your link can open them.', 'l.show': 'Show', 'l.hide': 'Hide', 'l.noacc': 'New here?', 'l.signup': 'Create a free account' },
    fil: { 'l.hero': 'Naka-lock bago pa lumabas sa device mo.', 'l.hero_sub': 'Ine-encrypt ang mga file sa browser mo, kaya ang may hawak lang ng link ang makakabukas.', 'l.show': 'Ipakita', 'l.hide': 'Itago', 'l.noacc': 'Bago ka dito?', 'l.signup': 'Gumawa ng libreng account' },
    ja: { 'l.hero': '端末を出る前に、ロック済み。', 'l.hero_sub': 'ファイルはブラウザ上で暗号化されるため、リンクを持つ人だけが開けます。', 'l.show': '表示', 'l.hide': '隠す', 'l.noacc': 'はじめての方は', 'l.signup': '無料アカウントを作成' }
  };
  for (const k in T) if (typeof I18N !== 'undefined' && I18N[k]) Object.assign(I18N[k], T[k]);

  function init() {
    const box = document.getElementById('login'); if (!box) return;
    const pw = document.getElementById('p'), tg = document.getElementById('pwtoggle'), btn = document.getElementById('lbtn');
    const label = () => { if (tg) tg.textContent = L(pw.type === 'password' ? 'l.show' : 'l.hide'); };
    if (tg) { tg.onclick = () => { pw.type = pw.type === 'password' ? 'text' : 'password'; tg.setAttribute('aria-pressed', pw.type === 'text'); label(); pw.focus(); }; label(); document.addEventListener('langchange', label); }

    // show a spinner and block double clicks while the page's own login() runs
    const orig = window.login;
    if (typeof orig === 'function' && btn) {
      window.login = async function () {
        if (btn.classList.contains('busy')) return;
        btn.classList.add('busy'); btn.setAttribute('aria-busy', 'true');
        try { await orig.apply(this, arguments); } finally { btn.classList.remove('busy'); btn.removeAttribute('aria-busy'); }
      };
    }
    // put the cursor in the first empty field when the login form appears
    const focusFirst = () => { if (box.hidden) return; const c = document.getElementById('codebox'); const f = (c && !c.hidden && document.getElementById('lc')) || (!document.getElementById('u').value ? document.getElementById('u') : pw); f.focus(); };
    new MutationObserver(focusFirst).observe(box, { attributes: true, attributeFilter: ['hidden'] });
    const cb = document.getElementById('codebox'); if (cb) new MutationObserver(focusFirst).observe(cb, { attributes: true, attributeFilter: ['hidden'] });
    focusFirst();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
