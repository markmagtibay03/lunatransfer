// Local stand-ins for D1 (SQLite via node:sqlite) and R2 (in-memory), so the Worker can be tested without Cloudflare.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export function makeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const stmt = (sql, params = []) => ({
    bind: (...p) => stmt(sql, p),
    async all() { return { results: db.prepare(sql).all(...params).map(r => ({ ...r })) }; },
    async first() { const r = db.prepare(sql).get(...params); return r ? { ...r } : null; },
    async run() { const r = db.prepare(sql).run(...params); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
    _exec() { const r = db.prepare(sql).run(...params); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
  });
  return { raw: db, prepare: sql => stmt(sql), async batch(list) { db.exec('BEGIN'); try { const out = list.map(s => s._exec()); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; } } };
}

export function makeR2() {
  const m = new Map();
  const mkBody = buf => new Response(buf).body;
  return {
    _m: m,
    async put(k, v) { m.set(k, new Uint8Array(v instanceof ArrayBuffer ? v : await new Response(v).arrayBuffer())); },
    async get(k, o) { const b = m.get(k); if (!b) return null; const s = o?.range ? b.slice(o.range.offset, o.range.offset + o.range.length) : b; return { body: mkBody(s), size: s.length }; },
    async head(k) { const b = m.get(k); return b ? { size: b.length } : null; },
    async delete(k) { for (const x of (Array.isArray(k) ? k : [k])) m.delete(x); },
    async list({ prefix = '', limit = 1000 } = {}) { const objects = [...m.keys()].filter(x => x.startsWith(prefix)).slice(0, limit).map(key => ({ key })); return { objects, truncated: false }; },
  };
}
