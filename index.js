// Luna Transfer on Cloudflare: Worker + D1 (database) + R2 (encrypted files) + static assets.
// The URLs are the same as the PHP version (api.php?action=..., admin.php, download.php?...), so old links keep working.
import { CFG } from './config.js';
import { ApiError, json, SEC_HEADERS } from './lib.js';
import { makeCtx, requireLogin, cleanup } from './core.js';
import { publicActions } from './public.js';
import { loggedInAction } from './account.js';
import { renderIndex } from './index-template.js';

const PAGES = new Set(['account', 'admin', 'register', 'upgrade', 'upload', 'download', 'orders', 'adm-home', 'adm-users', 'adm-flags', 'adm-tx']);

async function handleApi(c) {
  try {
    const pub = publicActions[c.action];
    if (pub && Object.hasOwn(publicActions, c.action)) return await pub(c);
    const me = await requireLogin(c);
    return await loggedInAction(c, me, c.action);
  } catch (e) {
    if (e instanceof ApiError) return json({ error: e.code, params: e.params }, e.status);
    console.error('luna-transfer:', e?.stack || e);
    return json({ error: 'db_error', params: {} }, 500);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === '/api.php' || path === '/api') {
      const c = makeCtx(env, request, ctx, CFG);
      const res = await handleApi(c);
      for (const ck of c.cookies) res.headers.append('set-cookie', ck);
      return res;
    }
    if (path === '/' || path === '/index.php') {
      const html = renderIndex(CFG, CFG.tiers);
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' } });
    }
    const m = /^\/([a-z-]+)\.php$/.exec(path);
    if (m && PAGES.has(m[1])) {
      const r = await env.ASSETS.fetch(new Request(new URL(`/pages/${m[1]}.html`, url), { method: 'GET', headers: request.headers }));
      const h = new Headers(r.headers); h.set('content-type', 'text/html; charset=utf-8'); h.set('cache-control', 'no-cache'); h.set('referrer-policy', 'no-referrer'); h.set('x-content-type-options', 'nosniff');
      return new Response(r.body, { status: r.status, headers: h });
    }
    if (path.endsWith('.php') || path.startsWith('/pages/')) return new Response('Not found', { status: 404, headers: SEC_HEADERS });
    return env.ASSETS.fetch(request);
  },

  // Cron Trigger (see wrangler.toml): removes expired files and abandoned uploads, applies monthly resets.
  async scheduled(event, env, ctx) {
    const c = makeCtx(env, new Request('https://cron.local/'), ctx, CFG);
    ctx.waitUntil(cleanup(c));
  },
};
