# Luna Transfer sa Cloudflare (Workers + D1 + R2)

Buong system na nasa Cloudflare na: **Worker** (backend), **D1** (database), **R2** (encrypted files), at ang mga page/JS/CSS mo.
Pareho pa rin ang mga URL (`/api.php?action=...`, `/admin.php`, `/download.php?g=...#key`), kaya gumagana pa rin ang mga lumang links.

## Kailangan
- Node.js 20 o mas bago (https://nodejs.org) at Cloudflare account na may domain.
- **Workers Paid plan ($5/buwan) ang irekomenda.** Ang login ay gumagamit ng password hashing na mas mabigat sa 10 ms CPU ng Free plan.
  Ang mga lumang bcrypt na password mo ay gumagana pa rin, pero sa Free plan maaaring mag-error ang login.

## Steps (Windows: gamitin ang Command Prompt o PowerShell sa loob ng folder na ito)
1. `npm install`
2. `npx wrangler login`
3. Gumawa ng database: `npx wrangler d1 create luna-transfer` → kopyahin ang `database_id` sa `wrangler.toml`.
4. Bucket: kung wala pa, `npx wrangler r2 bucket create luna-files`. Ilagay ang pangalan ng bucket sa `wrangler.toml` (`bucket_name`). Panatilihing **private**.
5. Gawin ang mga table: `npx wrangler d1 execute luna-transfer --remote --file=schema.sql`
6. Ilipat ang data mo:
   - `node scripts/convert-dump.mjs luna_transfer.sql d1-data.sql`
   - `npx wrangler d1 execute luna-transfer --remote --file=d1-data.sql`
7. Ilipat ang lumang encrypted files (galing sa `data/files` ng PHP version):
   `node scripts/upload-legacy-files.mjs C:\path\to\old\data\files d1-data.sql luna-files`
8. Buksan ang `src/config.js`: ilagay ang `public_url`, GCash/bank details, contact email. Tingnan din ang `gb` ng tier na may "KUMPIRMAHIN" (1000 vs 700).
9. Sa `wrangler.toml`, i-uncomment ang `routes` at ilagay ang address mo (hal. `files.yourdomain.com`). Dapat nasa Cloudflare ang domain.
10. `npx wrangler deploy`
11. (Opsyonal) Telegram: `npx wrangler secret put TELEGRAM_BOT_TOKEN`

## Checklist pagkatapos ng deploy
Login bilang admin → mag-upload ng maliit na file → download → mag-upload ng file na >4 MB → i-download ang isa sa mga lumang file mo → gumawa ng upload link at subukan bilang guest.
Nawawalang admin password? `node scripts/hash-password.mjs BagongPassword` at patakbuhin ang SQL na ilalabas nito.

## Ano ang pagkakaiba sa PHP version
- Bawat chunk ng bagong upload ay hiwalay na R2 object (`files/<id>/<n>`). Walang "assembling" at gumagana ang resume. Ang mga lumang file ay isang object (`files/<id>`) at binabasa gamit ang byte range.
- Sessions ay nasa D1 (cookie na HttpOnly). Lahat ng naka-login ay kailangang mag-login ulit pagkatapos lumipat.
- Bagong password ay PBKDF2; ang lumang bcrypt hash ay awtomatikong ina-upgrade pagka-login.
- Cleanup at monthly reset ay tumatakbo kada oras (Cron Trigger) at hindi na kailangan ng `run-cleanup.bat`.
- Wala na ang `setup.php`, `backup.php`, `restore.php`. Backup ng database: `npx wrangler d1 export luna-transfer --remote --output=backup.sql`. D1 ay may Time Travel (30 araw) din.
- Hindi na gumagana ang email verification (walang `mail()` sa Workers). Naka-off din ito dati (`verify_email`).
- Sa D1 walang row locks, kaya kung dalawang upload ang magsabay sa halos-puno nang quota, ang quota ay sinisiguro pa rin sa dulo ng upload (atomic).
- Binago rin: ang "new7" at "bytes30" sa admin stats ay may bug sa PHP (mali ang kuwenta); tama na ngayon.

## Test sa sariling computer
`npm test` (Node 22+) ay nagpapatakbo ng 32 test gamit ang pekeng D1/R2. `npx wrangler dev` para sa lokal na bersyon.
