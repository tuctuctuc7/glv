'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {customEnvironment,request,range,now}=require('./helpers/mad-custom-fixture.cjs');
const runtime=require('../lib/glv-mad-v2-isolated.cjs'),custom=require('../lib/glv-mad-v2-isolated-custom.cjs');
const api=require('../api/glv-meta-ads-v2/fb-data.js');
async function seed(h){
 h.withAds=true;
 const scheduled=await runtime.refresh({redis:h.redis,fetcher:h.fetcher,token:'test',now,presets:['last_30d'],includePromo:false});assert.equal(scheduled.verified,true);
 await runtime.refresh({redis:h.redis,fetcher:h.fetcher,token:'test',now,presets:[custom.slot(range)],ranges:{[custom.slot(range)]:range},includePromo:false,tokenFor:a=>{if(a.label==='TUC')throw Error('Unavailable');return 'test';}});
 h.rejectAll=true;h.graph.length=0;h.calls.length=0;
}
test('V2 cold and repeated zoom supersedes TGLV-only custom cache with scheduled daily facts, no upstream or writes',()=>customEnvironment(async h=>{
 await seed(h);
 for(const currency of ['CZK','USD'])for(const account of ['All','TUC','TGLV']){
  const replies=await Promise.all(runtime.TYPES.map(type=>request(api,{type,currency,account,time_range:JSON.stringify(range)})));
  assert.deepEqual(replies.map(r=>r.code),[200,200,200]);
  const byType=Object.fromEntries(runtime.TYPES.map((t,i)=>[t,replies[i].body]));
  if(account!=='TGLV'){
   assert.equal(byType.daily.rows.filter(r=>r.account_label==='TUC').length,6);
   const tuc=byType.aggregate.rows.find(r=>r.account_label==='TUC');assert.ok(tuc);assert.equal(tuc.reach,null);assert.equal(tuc.frequency,null);assert.equal(Number(tuc['actions:lead']),12);
   assert.match(byType.aggregate.warning,/Daily-derived/);
   const ad=byType.ads.rows.find(r=>r.account_label==='TUC');assert.ok(ad);assert.equal(ad.reach,null);assert.ok(Math.abs(ad.amount_spent-(currency==='CZK'?24:0.96))<1e-9);assert.equal(ad['actions:lead'],6);assert.equal(ad.daily_provenance.length,6);
  }
  if(account!=='TUC')assert.equal(Number(byType.aggregate.rows.find(r=>r.account_label==='TGLV').reach),123,'retain available exact account period reach');
  for(const r of replies){assert.equal(r.body.report_currency,currency);assert.equal(r.body.account_filter,account);assert.ok(r.body.rows.every(row=>account==='All'||row.account_label===account));}
  const freshness=require('../public/glv-meta-ads-v2/freshness.js');freshness.bundle(replies.map(r=>r.body),{range,currency,account,now:+now,custom:true});
  assert.equal(new Set(replies.map(r=>r.body.generation_id)).size,1);
 }
 assert.equal(h.blocked||0,0);assert.equal(h.graph.length,0);assert.equal(h.calls.filter(c=>['SET','EVAL','DEL'].includes(c[0])).length,0);
}));
test('V2 projection rejects malformed scopes and validates original ownership, FX, timestamps and direct observations',()=>customEnvironment(async h=>{
 await seed(h);const projection=require('../lib/glv-mad-v2-cached-projection.cjs');
 const b=await runtime.readPreset(h.redis,'last_30d'),id='359758259164738',native=Object.fromEntries(runtime.TYPES.map(t=>[t,b[t].account_bundles[id]]));
 for(const mutate of [
  n=>n.daily.generated_at='2027-01-01T00:00:00Z',
  n=>n.daily.accounts[0].currency='USD',
  n=>n.daily.accounts[0].id='1021777267558882',
  n=>n.daily.accounts[0].rows[0].account_id='1021777267558882',
  n=>n.daily.accounts[0].rows[0].creator_rows=[{id:'bad',account_id:'1021777267558882'}],
  n=>n.daily.accounts[0].rows[0].date_stop='2026-11-25',
  n=>n.daily.accounts[0].rows.push(n.daily.accounts[0].rows[0]),
  n=>n.daily.accounts[0].rows[0].amount_spent='NaN',
  n=>n.daily.fx={},n=>delete n.aggregate.accounts[0].direct_observation,
 ]){const bad=structuredClone(native);mutate(bad);assert.throws(()=>projection.validateAccount(bad,id,now));}
 for(const bad of [null,[],{since:'2026-02-30',until:range.until},{since:range.until,until:range.since},{since:['2026-11-19'],until:range.until}])assert.throws(()=>projection.validateScope({type:'daily',currency:'USD',account:'All',range:bad}));
 for(const q of [{currency:'EUR'},{currency:['USD']},{account:'__proto__'},{account:['TUC']},{type:'constructor'}])assert.throws(()=>projection.validateScope({type:'daily',currency:'USD',account:'All',range,...q}));
}));
test('V2 projection preserves genuine missing daily rows and original extraction metadata',()=>customEnvironment(async h=>{
 await seed(h);const projection=require('../lib/glv-mad-v2-cached-projection.cjs');
 const b=await runtime.readPreset(h.redis,'last_30d'),id='359758259164738',native=Object.fromEntries(runtime.TYPES.map(t=>[t,b[t].account_bundles[id]]));
 for(const t of ['daily','aggregate'])native[t].accounts[0].rows=native[t].accounts[0].rows.filter(r=>r.date_start!=='2026-11-21');
 // Source daily gaps are not filled by the projection or wider period totals.
 const out=projection.project(native,'daily',range,'CZK','TUC');
 assert.equal(out.rows.length,5);assert.ok(out.rows.every(r=>r.date_start!=='2026-11-21'));assert.equal(out.generated_at,native.daily.generated_at);assert.deepEqual(out.source_extractions,native.daily.source_extractions);
 const total=projection.project(native,'aggregate',range,'CZK','TUC');assert.equal(total.rows[0].amount_spent,50);assert.equal(total.rows[0].reach,null);
}));
test('V2 preserves a complete exact historical period over a wider publication ending later',()=>customEnvironment(async h=>{
 const exact={since:'2026-11-19',until:'2026-11-20'};
 const scheduled=await runtime.refresh({redis:h.redis,fetcher:h.fetcher,token:'test',now,presets:['last_30d'],includePromo:false});assert.equal(scheduled.verified,true);
 const preset=custom.slot(exact);
 const saved=await runtime.refresh({redis:h.redis,fetcher:h.fetcher,token:'test',now,presets:[preset],ranges:{[preset]:exact},includePromo:false});assert.equal(saved.verified,true);
 h.rejectAll=true;h.graph.length=0;h.calls.length=0;
 const response=await request(api,{type:'aggregate',currency:'CZK',account:'All',time_range:JSON.stringify(exact)});
 assert.equal(response.code,200);
 assert.equal(response.body.rows.find(r=>r.account_label==='TUC').reach,'123');
 assert.notEqual(response.body.observation_contract,'cached-daily-v1');
 assert.equal(response.body.observation_complete,true);
 assert.equal(h.blocked||0,0);
 assert.ok(!h.calls.some(c=>c[0]==='GET'&&String(c[1]).startsWith(runtime.combinedKey('last_7d'))),'complete exact coverage needs no scheduled scan');
}));
