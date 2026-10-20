export function renderIndex(CFG, tiers) {
  const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const nf = (n, d = 0) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const rtrim = (s, c) => { s = String(s); while (s.endsWith(c)) s = s.slice(0, -1); return s; };
  const int = v => Math.trunc(Number(v)) || 0;
  const name = esc(CFG.site_name ?? 'Luna Transfer');
  const freeMB = int(CFG.free_mb ?? 100), resets = int(CFG.free_resets ?? 2), ppg = int(CFG.price_per_gb ?? 50), max = int(CFG.max_paid_gb ?? 200);
  const first = Object.values(tiers)[0]; const cgb = int(first.gb), cp = int(first.price);
  const save = Math.max(0, Math.round((1 - cp / Math.max(1, cgb * ppg)) * 100));
  const capGB = Math.round(int(CFG.max_mb_cap ?? 2000) / 1024 * 10) / 10, files = int(CFG.max_files_per_batch ?? 20);
  const mail = esc(CFG.contact_email ?? '');
  let o = '';
  o += "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<title>";
  o += (name);
  o += " — Private file transfer, free to start</title>\n<meta name=\"description\" content=\"Send large files with links only the recipient can open. Encrypted in your browser. Start free with ";
  o += (freeMB);
  o += " MB, then pick a plan that fits.\">\n<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\"><link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\n<link href=\"https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=Figtree:wght@400;500;600&display=swap\" rel=\"stylesheet\">\n<style>\n:root{--night:#171a46;--night2:#23277a;--mist:#f4f5fb;--ink:#171936;--muted:#595c7e;--moon:#f4c64e;--line:#dcdff0;--r:14px;\n--d:\"Bricolage Grotesque\",\"Segoe UI\",system-ui,sans-serif;--b:Figtree,\"Segoe UI\",system-ui,sans-serif}\n*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;font:17px/1.6 var(--b);color:var(--ink);background:var(--mist)}\na{color:inherit}h1,h2,h3{font-family:var(--d);line-height:1.08;margin:0}\n:focus-visible{outline:3px solid var(--moon);outline-offset:3px;border-radius:6px}\n.w{max-width:1080px;margin:0 auto;padding:0 1.4rem}\n.btn{display:inline-block;font:600 1rem var(--b);padding:.8rem 1.35rem;border-radius:99px;background:var(--moon);color:#171936;text-decoration:none;border:2px solid var(--moon);cursor:pointer}\n.btn:hover{background:#ffd978;border-color:#ffd978}.btn.o{background:transparent;color:inherit;border-color:currentColor}.btn.o:hover{background:rgba(255,255,255,.1)}\n.btn.sm{padding:.45rem 1rem;font-size:.92rem}\n/* hero */\n.hero{background:radial-gradient(circle at 88% -10%,rgba(244,198,78,.22) 0 14%,transparent 15%),linear-gradient(170deg,var(--night),#10123a);color:#eef0ff;padding-bottom:5rem}\nnav{display:flex;align-items:center;gap:1.4rem;padding:1.2rem 0}nav .logo{font:800 1.3rem var(--d);text-decoration:none;display:flex;gap:.55rem;align-items:center;margin-right:auto}\nnav a.l{text-decoration:none;color:#c9ceff;font-size:.95rem}nav a.l:hover{color:#fff}\n.dot{width:26px;height:26px;border-radius:50%;background:var(--moon);box-shadow:inset -8px -2px 0 0 var(--night)}\n.hg{display:grid;grid-template-columns:1.1fr .9fr;gap:3rem;align-items:center;padding-top:3.5rem}\n.hero h1{font-size:clamp(2.4rem,5.4vw,4rem);font-weight:800;letter-spacing:-.025em}\n.hero p.lead{font-size:1.15rem;color:#c9ceff;max-width:34em;margin:1.2rem 0 1.8rem}.cta{display:flex;gap:.8rem;flex-wrap:wrap}\n.note{font-size:.88rem;color:#9ea4e6;margin-top:1rem}\n.demo{background:#0e1033;border:1px solid #3a3f9b;border-radius:var(--r);padding:1.3rem;font-size:.92rem}\n.file{display:flex;justify-content:space-between;gap:1rem;margin-bottom:.6rem}.file b{font-weight:600}\n.bar{height:8px;border-radius:9px;background:#252a73;overflow:hidden}.bar i{display:block;height:100%;width:0;background:var(--moon);transition:width 2.2s ease}\n.state{color:#9ea4e6;margin:.6rem 0 1rem;min-height:1.6em}\n.url{font:500 .95rem/1.5 ui-monospace,Consolas,monospace;word-break:break-all;background:#171a52;border-radius:10px;padding:.8rem;opacity:.25;transition:opacity .6s}\n.url em{font-style:normal;background:var(--moon);color:#171936;border-radius:4px;padding:0 .25rem}\n.demo.on .url{opacity:1}.cap{color:#9ea4e6;font-size:.85rem;margin:.7rem 0 0;opacity:0;transition:opacity .6s .4s}.demo.on .cap{opacity:1}\n/* sections */\nsection{padding:4.5rem 0}h2{font-size:clamp(1.9rem,3.6vw,2.7rem);font-weight:700;letter-spacing:-.02em;max-width:18em}\n.sub{color:var(--muted);max-width:38em;margin:.9rem 0 2.4rem}\n.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:2rem;list-style:none;padding:0;margin:0;counter-reset:s}\n.steps li{counter-increment:s;border-top:3px solid var(--ink);padding-top:1rem}.steps li::before{content:\"Step \" counter(s);font:700 .9rem var(--d);color:var(--night2)}\n.steps h3{font-size:1.35rem;margin:.3rem 0 .5rem}.steps p{margin:0;color:var(--muted)}\n.fl{display:grid;grid-template-columns:1fr 1fr;gap:0 3.5rem}.fl div{padding:1.1rem 0;border-bottom:1px solid var(--line)}.fl h3{font-size:1.12rem;margin-bottom:.2rem}.fl p{margin:0;color:var(--muted);font-size:.96rem}\n.alt{background:#fff;border-block:1px solid var(--line)}\n/* pricing */\n.pg{display:grid;grid-template-columns:.8fr 1.2fr;gap:1.6rem;align-items:stretch}\n.free{border:2px solid var(--ink);border-radius:var(--r);padding:2rem}.free .pr,.paid .pr{font:800 3rem var(--d);margin:.4rem 0}\nul.t{padding:0;margin:1rem 0 1.6rem;list-style:none}ul.t li{padding:.35rem 0 .35rem 1.6rem;position:relative}ul.t li::before{content:\"\";position:absolute;left:.2rem;top:.85rem;width:.55rem;height:.55rem;border-radius:50%;background:var(--moon);box-shadow:0 0 0 2px var(--night2)}\n.paid{background:var(--night);color:#eef0ff;border-radius:var(--r);padding:2rem;display:grid;grid-template-columns:1fr 150px;gap:1.2rem 1.5rem}\n.paid ul.t li::before{box-shadow:none}.paid .sub{color:#c9ceff;margin:0 0 1rem}.paid .full{grid-column:1/-1}\ninput[type=range]{width:100%;accent-color:var(--moon)}.seg{display:flex;gap:.4rem;margin:.8rem 0}.seg button{flex:1;font:600 .9rem var(--b);padding:.5rem;border-radius:10px;border:1px solid #4a50b8;background:transparent;color:#eef0ff;cursor:pointer}.seg button[aria-pressed=true]{background:var(--moon);color:#171936;border-color:var(--moon)}\n.moon{width:150px;height:150px;align-self:center}.tot{font:800 2.4rem var(--d)}.tot small{font:500 .95rem var(--b);color:#c9ceff}\ntable{width:100%;border-collapse:collapse;margin-top:2.6rem;font-size:.97rem;background:#fff;border-radius:var(--r);overflow:hidden}th,td{text-align:left;padding:.8rem 1rem;border-bottom:1px solid var(--line)}th{background:var(--ink);color:#fff;font-weight:600}\n.bill{display:grid;grid-template-columns:repeat(2,1fr);gap:.4rem 3.5rem;margin-top:2rem;padding:0;list-style:none;color:var(--muted)}.bill li{padding:.4rem 0}.bill b{color:var(--ink)}\n/* faq */\ndetails{border-bottom:1px solid var(--line);padding:1.05rem 0;max-width:46rem}summary{font:700 1.12rem var(--d);cursor:pointer;list-style:none;display:flex;justify-content:space-between;gap:1rem}summary::after{content:\"+\";color:var(--night2);font-size:1.4rem;line-height:1}\ndetails[open] summary::after{content:\"–\"}details p{margin:.7rem 0 0;color:var(--muted)}\n.end{background:var(--night);color:#eef0ff;text-align:center}.end h2{margin:0 auto}.end .sub{margin-inline:auto;color:#c9ceff}\nfooter{background:#0e1033;color:#9ea4e6;padding:2rem 0;font-size:.9rem}footer .w{display:flex;gap:1rem 2rem;flex-wrap:wrap;justify-content:space-between}footer a{color:#c9ceff}\n@media(max-width:860px){.hg,.pg,.fl,.bill{grid-template-columns:1fr}.steps{grid-template-columns:1fr}.paid{grid-template-columns:1fr}.moon{order:-1;margin:0 auto}nav a.l{display:none}section{padding:3.2rem 0}}\n@media(prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto}}\n.co{margin-top:1.6rem;background:#fff;border:2px solid var(--night2);border-radius:var(--r);padding:1.6rem 2rem;display:grid;grid-template-columns:1fr 1fr auto;gap:1.2rem 2rem;align-items:center}.co .tot small{color:var(--muted)}@media(max-width:860px){.co{grid-template-columns:1fr}}\n.th{font-size:1.5rem;margin-top:3.2rem}.tiers{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:1.3rem}.tier{background:#fff;border:2px solid var(--line);border-radius:var(--r);padding:1.7rem 1.6rem;position:relative}.tier.best{border-color:var(--night2);box-shadow:0 20px 40px -28px rgba(35,39,122,.8)}.tier .bv{position:absolute;top:-.8rem;right:1.2rem;background:var(--moon);color:#171936;border-radius:99px;padding:.15rem .75rem;font-size:.8rem;font-weight:600}.tp{font:800 2.3rem var(--d);margin-top:.3rem}.tp small{font:500 .95rem var(--b);color:var(--muted)}.tg{margin:.2rem 0 0;color:var(--muted)}.scroll2{overflow-x:auto;margin-top:2rem}.scroll2 table{min-width:720px;margin-top:0}\n</style></head><body>\n<header class=\"hero\"><div class=\"w\"><nav><a class=\"logo\" href=\"index.php\"><span class=\"dot\"></span>";
  o += (name);
  o += "</a>\n<a class=\"l\" href=\"#how\">How it works</a><a class=\"l\" href=\"#features\">Features</a><a class=\"l\" href=\"#pricing\">Pricing</a><a class=\"l\" href=\"#faq\">FAQ</a>\n<a class=\"btn o sm\" href=\"account.php\">Log in</a><a class=\"btn sm\" href=\"register.php\">Sign up free</a></nav>\n<div class=\"hg\"><div><h1>Send big files. Only your recipient can open them.</h1>\n<p class=\"lead\">Your files are locked in your browser before they upload, so not even we can read them. Share one link or QR code, and the person you send it to downloads everything—no account needed.</p>\n<div class=\"cta\"><a class=\"btn\" href=\"register.php\">Create free account</a><a class=\"btn o\" href=\"#pricing\">See pricing</a></div>\n<p class=\"note\">Start with ";
  o += (freeMB);
  o += " MB free. No credit card needed.</p></div>\n<div class=\"demo\" id=\"demo\" aria-label=\"Example of how a private link is made\"><div class=\"file\"><b>Wedding-photos.zip</b><span>240 MB</span></div>\n<div class=\"bar\"><i id=\"bar\"></i></div><div class=\"state\" id=\"st\">Waiting to upload…</div>\n<div class=\"url\">https://";
  o += (name ? name.replace(/<[^>]*>/g,'').replace(/\s+/g,'').toLowerCase() : 'yoursite');
  o += ".com/download.php?g=7f3a9c<em>#k9Xv2QpL…</em></div>\n<p class=\"cap\">The highlighted part is the key. It stays in your browser and is never sent to our server.</p></div></div></div></header>\n\n<section id=\"how\"><div class=\"w\"><h2>Three steps, and nobody in the middle can peek</h2><p class=\"sub\">Works for one photo or a whole folder.</p>\n<ol class=\"steps\"><li><h3>Pick your files</h3><p>Choose files or a whole folder. Each file is cut into 4 MB pieces and encrypted with AES-256-GCM right in your browser.</p></li>\n<li><h3>Share the link</h3><p>You get one link for the whole batch, plus a QR code and share buttons. Add a password if you want a second lock.</p></li>\n<li><h3>They download</h3><p>Your recipient opens the link and saves files one by one or all together as a ZIP. Decryption happens on their device.</p></li></ol></div></section>\n\n<section id=\"features\" class=\"alt\"><div class=\"w\"><h2>Everything you need to send files safely</h2><p class=\"sub\">Built for photos, videos, documents, and project folders that are too big for email or chat apps.</p>\n<div class=\"fl\">\n<div><h3>Encrypted before upload</h3><p>Without a password, the key lives after the # in your link. Our server and admins never see it.</p></div>\n<div><h3>Password protection</h3><p>Set a password and the link carries no key. The recipient types the password to unlock.</p></div>\n<div><h3>Large files that resume</h3><p>Uploads go piece by piece and pick up where they stopped if your connection drops. Up to ";
  o += (capGB);
  o += " GB and ";
  o += (files);
  o += " files per upload.</p></div>\n<div><h3>Upload links</h3><p>Need files from someone else? Create a link with a size limit and expiry. They upload without making an account.</p></div>\n<div><h3>You control how long files stay</h3><p>Set when links expire, how many downloads are allowed, or make a link work only once. Expired files are deleted automatically.</p></div>\n<div><h3>QR codes and ZIP downloads</h3><p>Scan from a phone or share by chat. Recipients can download everything as one ZIP.</p></div>\n<div><h3>2-step login</h3><p>Protect your account with an authenticator app. Check your recent activity any time.</p></div>\n<div><h3>Telegram alerts</h3><p>Get a message when someone uploads to your link or downloads your files.</p></div>\n<div><h3>English, Filipino, 日本語</h3><p>Switch language from the menu on any page.</p></div>\n<div><h3>Works in your browser</h3><p>No app to install. Chrome and Edge handle very large downloads best. On Firefox and Safari, keep files under about 500 MB.</p></div>\n</div></div></section>\n\n<section id=\"pricing\"><div class=\"w\"><h2>Start free. Upgrade when you need more.</h2><p class=\"sub\">Pay by GCash or bank transfer. Nothing renews on its own.</p>\n<div class=\"pg\"><div class=\"free\"><h3>Free</h3><div class=\"pr\">₱0</div><p style=\"margin:0;color:var(--muted)\">to try it out</p>\n<ul class=\"t\"><li><b>";
  o += (freeMB);
  o += " MB</b> to start</li><li>Refreshes ";
  o += (resets);
  o += " times, once a month</li><li>After that, pick a paid plan to keep sending</li><li>Encrypted links, QR codes, passwords</li></ul><a class=\"btn\" style=\"background:var(--ink);border-color:var(--ink);color:#fff\" href=\"register.php\">Start free</a></div>\n<div class=\"paid\"><div><h3>Pay per GB</h3><p class=\"sub\">₱";
  o += (ppg);
  o += " for each GB, each month.</p>\n<label for=\"gb\"><b id=\"gbv\">10</b> GB per month</label><input id=\"gb\" type=\"range\" min=\"1\" max=\"";
  o += (max);
  o += "\" value=\"10\">\n<div class=\"seg\" role=\"group\" aria-label=\"Number of months\"><button aria-pressed=\"true\" data-m=\"1\">1 month</button><button aria-pressed=\"false\" data-m=\"3\">3 months</button><button aria-pressed=\"false\" data-m=\"6\">6 months</button><button aria-pressed=\"false\" data-m=\"12\">12 months</button></div></div>\n<svg class=\"moon\" viewBox=\"0 0 150 150\" role=\"img\" aria-label=\"Moon that grows fuller as you add GB\"><defs><clipPath id=\"c\"><circle cx=\"75\" cy=\"75\" r=\"70\"/></clipPath></defs><circle cx=\"75\" cy=\"75\" r=\"70\" fill=\"#f4c64e\"/><g clip-path=\"url(#c)\"><circle id=\"sh\" cx=\"75\" cy=\"75\" r=\"72\" fill=\"#171a46\" style=\"transition:transform .25s\"/></g><circle cx=\"75\" cy=\"75\" r=\"70\" fill=\"none\" stroke=\"#3a3f9b\" stroke-width=\"2\"/></svg>\n<div class=\"full\"><div class=\"tot\"><span id=\"tot\">₱500</span> <small id=\"per\">total for 1 month</small></div><p class=\"sub\" style=\"margin:.2rem 0 .6rem\">You would have <b id=\"gb2\">10</b> GB to use each month.</p><p class=\"sub\" id=\"hint\" style=\"margin:0 0 1rem\" hidden></p>\n<a class=\"btn\" href=\"register.php\">Sign up, then upgrade</a></div></div></div>\n<h3 class=\"th\">For teams and businesses</h3><p class=\"sub\" style=\"margin:.4rem 0 1.6rem\">One main account, plus team accounts for your staff. Everyone shares your monthly space.</p>\n<div class=\"tiers\">";
  let best = null, bp = 1e9; for (const [k, t] of Object.entries(tiers)) { if (t.price / t.gb < bp) { bp = t.price / t.gb; best = k; } }
for (const [k, t] of Object.entries(tiers)) { const pgb = t.price / t.gb; const sv = Math.max(0, Math.round((1 - pgb / ppg) * 100));
  o += "\n<div class=\"tier";
  o += (k === best ? ' best' : '');
  o += "\">";
  if (k === best) {
  o += "<span class=\"bv\">Best value</span>";
  }
  o += "\n<h3>";
  o += (esc(t.name));
  o += "</h3><div class=\"tp\">₱";
  o += (nf(t.price));
  o += "<small> / month</small></div><p class=\"tg\"><b>";
  o += (nf(t.gb));
  o += " GB</b> every month</p>\n<ul class=\"t\"><li><b>1 main + ";
  o += (int(t.subs));
  o += " team accounts</b></li><li>₱";
  o += (rtrim(rtrim(nf(pgb, 2), '0'), '.'));
  o += " per GB";
  o += (sv > 0 ? ', ' + sv + '% less than Pay per GB' : '');
  o += "</li><li>Team members can send files and make upload links</li></ul>\n<a class=\"btn\" style=\"background:var(--ink);border-color:var(--ink);color:#fff\" href=\"register.php\">Sign up, then upgrade</a></div>";
  }
  o += "</div>\n<div class=\"scroll2\"><table><thead><tr><th>What you get</th><th>Free</th><th>Pay per GB</th>";
  for (const t of Object.values(tiers)) {
  o += "<th>";
  o += (esc(t.name));
  o += "</th>";
  }
  o += "</tr></thead><tbody>\n<tr><td>Space each month</td><td>";
  o += (freeMB);
  o += " MB, refreshed ";
  o += (resets);
  o += " times</td><td>1 to ";
  o += (max);
  o += " GB, your choice</td>";
  for (const t of Object.values(tiers)) {
  o += "<td>";
  o += (nf(t.gb));
  o += " GB</td>";
  }
  o += "</tr>\n<tr><td>Price</td><td>₱0</td><td>₱";
  o += (ppg);
  o += " per GB</td>";
  for (const t of Object.values(tiers)) {
  o += "<td>₱";
  o += (nf(t.price));
  o += " / month</td>";
  }
  o += "</tr>\n<tr><td>Accounts</td><td>1</td><td>1</td>";
  for (const t of Object.values(tiers)) {
  o += "<td>1 main + ";
  o += (int(t.subs));
  o += " team</td>";
  }
  o += "</tr>\n<tr><td>Encryption, QR codes, passwords, upload links</td><td>Yes</td><td>Yes</td>";
  for (const t of Object.values(tiers)) {
  o += "<td>Yes</td>";
  }
  o += "</tr>\n<tr><td>Pay by</td><td>Nothing to pay</td><td>GCash or bank</td>";
  for (const t of Object.values(tiers)) {
  o += "<td>GCash or bank</td>";
  }
  o += "</tr></tbody></table></div>\n<ul class=\"bill\"><li><b>How to pay.</b> Choose a plan in your account, pay by GCash or bank transfer, and enter your reference number.</li><li><b>Activation.</b> We check your payment and then turn on your plan.</li>\n<li><b>Length.</b> Each month you buy gives you 30 days. Buy more months any time to extend.</li><li><b>When it ends.</b> Your account goes back to the free plan. Nothing renews on its own. Team accounts pause, and come back when you renew.</li>\n<li><b>Team accounts.</b> Your main account creates them. Team members can send files and make upload links, but cannot create more accounts or buy plans.</li><li><b>One space for everyone.</b> What your team sends is taken from your plan’s space. Free and Pay per GB accounts are single accounts.</li>\n<li><b>What counts.</b> Only what you send. Files that stay stored do not use extra space, and deleting a file does not give space back.</li></ul></div></section>\n\n<section id=\"security\" class=\"alt\"><div class=\"w\"><h2>What we can see, and what we can’t</h2><p class=\"sub\">Plain answers, because you are trusting us with your files.</p>\n<div class=\"fl\"><div><h3>We can’t see</h3><p>File names, file contents, or the key in your link. Files are stored only as encrypted data.</p></div>\n<div><h3>We can see</h3><p>Your username and email, how much you transfer, when, and from which IP address. We use this to keep the service fair and stop abuse.</p></div>\n<div><h3>One account per person</h3><p>To keep the free plan fair, we limit duplicate accounts. Temporary email addresses are not accepted.</p></div>\n<div><h3>Lost your link or password?</h3><p>We can’t recover the files for you, because we never had the key. Senders can copy their link again from their account in the same browser.</p></div></div></div></section>\n\n<section id=\"faq\"><div class=\"w\"><h2>Questions people ask</h2><p class=\"sub\">&nbsp;</p>\n<details><summary>Does my recipient need an account?</summary><p>No. They open your link and download. Only senders who want their own space and upload links need an account.</p></details>\n<details><summary>What happens when I use up my free space?</summary><p>You start with ";
  o += (freeMB);
  o += " MB, and it refreshes ";
  o += (resets);
  o += " times, once a month. After the last refresh you need a paid plan to send more. Files you already sent keep working until they expire.</p></details>\n<details><summary>Does unused space carry over?</summary><p>No. On paid plans your space resets every month.</p></details>\n<details><summary>How big can one upload be?</summary><p>Up to ";
  o += (capGB);
  o += " GB and ";
  o += (files);
  o += " files at a time, as long as you have enough space left in your account.</p></details>\n<details><summary>How long are my files kept?</summary><p>You choose. Each upload link has its own expiry, and files are deleted automatically afterwards.</p></details>\n<details><summary>How can I pay?</summary><p>By GCash or bank transfer. After you pay, enter your reference number in your account and we turn on your plan once we confirm the payment.</p></details>\n<details><summary>What are team accounts?</summary><p>Company plans come with a main account plus team accounts for your staff (";
  o += (esc(Object.values(tiers).map(t => t.subs + ' on ' + t.name).join(', ')));
  o += "). Your main account creates them. Team members can send files and make upload links, but they cannot create more accounts or buy plans. Everything they send is taken from the same monthly space.</p></details>\n<details><summary>What counts toward my space?</summary><p>Only what you send. Files that stay stored do not use extra space, and deleting a file does not give space back. On paid plans your space refreshes every month.</p></details>\n<details><summary>My download won’t start.</summary><p>Open the complete link, including the part after the #. A shortened or cut-off link has no key, so it can’t unlock the files.</p></details></div></section>\n\n<section class=\"end\"><div class=\"w\"><h2>Send your first file in under a minute</h2><p class=\"sub\">Create a free account and start with ";
  o += (freeMB);
  o += " MB.</p><a class=\"btn\" href=\"register.php\">Create free account</a></div></section>\n<footer><div class=\"w\"><span>© ";
  o += (new Date().getUTCFullYear());
  o += " ";
  o += (name);
  o += "</span><span><a href=\"account.php\">Log in</a> &nbsp; <a href=\"register.php\">Sign up</a>";
  o += (mail ? ' &nbsp; <a href="mailto:' + mail + '">' + mail + '</a>' : '');
  o += "</span></div></footer>\n<script>\nconst $=s=>document.querySelector(s),PPG=";
  o += (ppg);
  o += ",CP=";
  o += (cp);
  o += ",CGB=";
  o += (cgb);
  o += ";let M=1;\nfunction calc(){const n=+$('#gb').value,f=1-Math.exp(-n/20);$('#gbv').textContent=$('#gb2').textContent=n;const h=$('#hint');h.hidden=n*PPG<CP;h.textContent='For ₱'+CP.toLocaleString()+' a month, the Company plan gives you '+CGB+' GB.';\n$('#tot').textContent='₱'+(n*M*PPG).toLocaleString();$('#per').textContent='total for '+M+(M>1?' months':' month');$('#sh').style.transform='translateX('+(f*150)+'px)'}\n$('#gb').oninput=calc;document.querySelectorAll('.seg button').forEach(b=>b.onclick=()=>{M=+b.dataset.m;document.querySelectorAll('.seg button').forEach(x=>x.setAttribute('aria-pressed',x===b));calc()});calc();\n(function(){const d=$('#demo'),s=$('#st'),b=$('#bar');if(matchMedia('(prefers-reduced-motion:reduce)').matches){b.style.width='100%';s.textContent='Encrypted in your browser. Ready to share.';d.classList.add('on');return}\nsetTimeout(()=>{s.textContent='Encrypting in your browser…';b.style.width='100%'},600);setTimeout(()=>{s.textContent='Encrypted. Ready to share.';d.classList.add('on')},3000)})();\n</script></body></html>\n";
  return o;
}
