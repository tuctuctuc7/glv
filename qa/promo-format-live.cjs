// Opt-in, read-only live verification. Never publishes the protected evidence.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { fetchPromoFormats } = require('../lib/glv-promo-format.cjs');
const { validPayload, monthlyMix } = require('../public/glv-meta-ads/promo-format.js');
(async () => {
  const line = fs.readFileSync('/home/tom/.config/fb-sync/.env','utf8').split('\n').find(line=>/^\s*(?:export\s+)?AGENTHIC_META_ACCESS_TOKEN\s*=/.test(line));
  const token = line?.split('=').slice(1).join('=').trim().replace(/^['"]|['"]$/g,'');
  assert.ok(token, 'Approved credential unavailable');
  const response = await fetch('https://graph.facebook.com/v21.0/act_359758259164738?fields=id,name,currency,timezone_name', {headers:{Authorization:`Bearer ${token}`}});
  const identity = await response.json();
  assert.deepEqual([identity.id,identity.name,identity.currency,identity.timezone_name],['act_359758259164738','Gelavis Ads','CZK','Europe/Prague']);
  const until = process.argv[3] || new Date(Date.now()-86400000).toISOString().slice(0,10);
  const data = await fetchPromoFormats(token,{since:process.argv[2]||'2026-03-01',until});
  assert.equal(validPayload(data),true);
  const dir = process.env.PROMO_FORMAT_EVIDENCE_DIR || '/tmp/glv-promo-format-evidence';
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  fs.writeFileSync(`${dir}/live-facts.json`,JSON.stringify(data),{mode:0o600});
  console.log(JSON.stringify({range:data.range,reconciled:data.reconciled,rows:data.rows.length,ads:new Set(data.rows.map(r=>r.ad_id)).size,unknownAds:new Set(data.rows.filter(r=>r.format==='Unknown').map(r=>r.ad_id)).size,months:monthlyMix(data.rows).map(m=>({month:m.month,total:m.total,formats:m.formats})),evidence:`${dir}/live-facts.json`},null,2));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
