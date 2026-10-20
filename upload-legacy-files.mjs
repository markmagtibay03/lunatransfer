// Copies the OLD encrypted files (data/files from the PHP version) to your R2 bucket.
//   node scripts/upload-legacy-files.mjs <path-to-old-data/files> <d1-data.sql> <bucket-name>
// Only files that have a row in the database are uploaded. Safe to run again (it just overwrites the same objects).
import { readFileSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const [, , dir, sqlFile, bucket] = process.argv;
if (!dir || !sqlFile || !bucket) { console.error('Usage: node scripts/upload-legacy-files.mjs <old data/files folder> <d1-data.sql> <bucket>'); process.exit(1); }
const ids = [...readFileSync(sqlFile, 'utf8').matchAll(/^INSERT INTO files \(.*?\) VALUES \(\d+, '([a-f0-9]{24})'/gm)].map(m => m[1]);
console.log(`${ids.length} file(s) in the database.`);
let ok = 0, missing = 0, failed = 0;
for (const id of ids) {
  const p = join(dir, id);
  if (!existsSync(p)) { console.log(`MISSING  ${id} (not in the folder; its download will say "gone")`); missing++; continue; }
  const r = spawnSync('npx', ['wrangler', 'r2', 'object', 'put', `${bucket}/files/${id}`, '--file', p, '--remote'], { stdio: ['ignore', 'pipe', 'pipe'], shell: true, encoding: 'utf8' });
  if (r.status === 0) { ok++; console.log(`uploaded ${id} (${(statSync(p).size / 1048576).toFixed(2)} MB)`); }
  else { failed++; console.log(`FAILED   ${id}\n${(r.stderr || r.stdout || '').split('\n').slice(-6).join('\n')}`); }
}
console.log(`\nDone. uploaded: ${ok}, missing: ${missing}, failed: ${failed}`);
process.exit(failed ? 1 : 0);
