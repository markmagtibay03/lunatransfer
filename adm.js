const g=s=>document.querySelector(s);
const api=async(a,body)=>{const r=await fetch('api.php?action='+a,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Luna':'1'},body:body?JSON.stringify(body):undefined});
const j=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(errText(j)),{status:r.status});return j};
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fB=b=>b>=1073741824?(b/1073741824).toFixed(2)+' GB':(b/1048576).toFixed(1)+' MB';
const fD=ms=>ms?new Date(+ms).toLocaleString():'-';const php=n=>'₱'+Number(n).toLocaleString();
const PN={gb:'Pay per GB',custom:'Custom',company:'Company',pro:'Company Pro',plus:'Company Pro Plus'};
const NAV=[['adm-home.php','Overview'],['adm-users.php','Users & accounts'],['adm-tx.php','Transactions'],['orders.php','Payments'],['adm-flags.php','Duplicates / Flags'],['admin.php?legacy=1','Links & files']];
async function guard(){try{const me=await api('me');if(me.role!=='admin')throw 0}catch(e){location.href='admin.php';return false}
const cur=location.pathname.split('/').pop();g('#nav').innerHTML=NAV.map(([h,t])=>`<a class="btn ${h===cur?'':'ghost'} sm" href="${h}">${t}</a>`).join(' ');return true}
function pager(total,size,page,fn){const n=Math.max(1,Math.ceil(total/size));return `<p class="hint">${total} total · page ${page}/${n} <button class="btn ghost sm" ${page<=1?'disabled':''} onclick="${fn}(${page-1})">‹ Prev</button> <button class="btn ghost sm" ${page>=n?'disabled':''} onclick="${fn}(${page+1})">Next ›</button></p>`}
