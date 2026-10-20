// Makes a password hash for the D1 database (needed for a brand-new admin, or a lost admin password).
//   node scripts/hash-password.mjs MyNewPassword
// Then run the SQL it prints with:  npx wrangler d1 execute luna-transfer --remote --command "<the SQL>"
const pw = process.argv[2];
if (!pw || pw.length < 8) { console.error('Usage: node scripts/hash-password.mjs <password, at least 8 characters>'); process.exit(1); }
const b64 = b => Buffer.from(b).toString('base64');
const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
const hash = `pbkdf2$100000$${b64(salt)}$${b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256))}`;
console.log('\nNew admin account:\n  INSERT INTO users (username, password_hash, role, active, created_at) VALUES (\'admin\', \'' + hash + '\', \'admin\', 1, ' + Date.now() + ');');
console.log('\nOr change an existing password:\n  UPDATE users SET password_hash = \'' + hash + '\' WHERE username = \'admin\';\n');
