// All encryption happens in the BROWSER. The server never sees the key or password.
const toB64u = u8 => { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const fromB64u = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
const importKey = s => crypto.subtle.importKey('raw', fromB64u(s), 'AES-GCM', false, ['encrypt', 'decrypt']);
async function newKey() {
  const k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  return toB64u(new Uint8Array(await crypto.subtle.exportKey('raw', k)));
}
async function encryptBytes(keyStr, data) {
  const key = typeof keyStr === 'string' ? await importKey(keyStr) : keyStr, iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return out;
}
async function decryptBytes(keyStr, data) {
  const key = typeof keyStr === 'string' ? await importKey(keyStr) : keyStr;
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.slice(0, 12) }, key, data.slice(12)));
}
const fmtSize = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.ceil(b / 1024) + ' KB';
async function deriveKey(password, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 300000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// ================= Chunked encryption (files are split in 4 MiB chunks) =================
const CHUNK = 4 * 1024 * 1024;
const chunkAad = (i, n) => { const b = new Uint8Array(8), v = new DataView(b.buffer); v.setUint32(0, i); v.setUint32(4, n); return b; }; // binds each chunk to its position
async function toKey(k) { return typeof k === 'string' ? importKey(k) : k; }
async function encChunk(key, data, i, n) {
  const k = await toKey(key), iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: chunkAad(i, n) }, k, data));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return out;
}
async function decChunk(key, data, i, n) {
  const k = await toKey(key);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.slice(0, 12), additionalData: chunkAad(i, n) }, k, data.slice(12)));
}
const hexId = () => [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(16).padStart(2, '0')).join('');

// ================= Streaming ZIP writer (store only, no compression) =================
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf, crc = 0) => { crc = ~crc >>> 0; for (let i = 0; i < buf.length; i++) crc = CRC_T[(crc ^ buf[i]) & 255] ^ (crc >>> 8); return ~crc >>> 0; };
class ZipWriter {
  constructor(write) { this.w = write; this.off = 0; this.entries = []; this.used = new Set(); }
  async _w(u8) { await this.w(u8); this.off += u8.length; }
  uniq(name) { name = name.replace(/\\/g, '/').split('/').filter(p => p && p !== '..' && p !== '.').join('/') || 'file'; let n = name, i = 1; while (this.used.has(n)) { const d = name.lastIndexOf('.'); n = d > 0 ? name.slice(0, d) + ' (' + i + ')' + name.slice(d) : name + ' (' + i + ')'; i++; } this.used.add(n); return n; }
  async add(name, chunks) { // chunks: async iterable of Uint8Array
    name = this.uniq(name); const nb = new TextEncoder().encode(name), now = new Date();
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1), date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0808, true); h.setUint16(8, 0, true); h.setUint16(10, time, true); h.setUint16(12, date, true); h.setUint16(26, nb.length, true);
    const off = this.off; await this._w(new Uint8Array(h.buffer)); await this._w(nb);
    let crc = 0, size = 0; for await (const c of chunks) { crc = crc32(c, crc); size += c.length; if (size > 0xFFFFFFFF) throw new Error('zip4g'); await this._w(c); }
    const d = new DataView(new ArrayBuffer(16)); d.setUint32(0, 0x08074b50, true); d.setUint32(4, crc, true); d.setUint32(8, size, true); d.setUint32(12, size, true); await this._w(new Uint8Array(d.buffer));
    this.entries.push({ nb, crc, size, off, time, date });
  }
  async finish() {
    const start = this.off;
    for (const e of this.entries) {
      const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0808, true); c.setUint16(12, e.time, true); c.setUint16(14, e.date, true);
      c.setUint32(16, e.crc, true); c.setUint32(20, e.size, true); c.setUint32(24, e.size, true); c.setUint16(28, e.nb.length, true); c.setUint32(42, e.off, true);
      await this._w(new Uint8Array(c.buffer)); await this._w(e.nb);
    }
    const size = this.off - start, z = new DataView(new ArrayBuffer(22)); z.setUint32(0, 0x06054b50, true); z.setUint16(8, this.entries.length, true); z.setUint16(10, this.entries.length, true); z.setUint32(12, size, true); z.setUint32(16, start, true);
    await this._w(new Uint8Array(z.buffer));
  }
}
