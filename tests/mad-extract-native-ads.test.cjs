'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {customEnvironment,request,now}=require('./helpers/mad-custom-fixture.cjs');
const runtime=require('../lib/glv-mad-v2-isolated.cjs'),handler=require('../api/glv-meta-ads-v2/fb-data.js');
test('actual V2 ads handler exposes validated same-generation daily creative facts',async()=>customEnvironment(async h=>{
 h.withAds=true;const result=await runtime.refresh({redis:h.redis,fetcher:h.fetcher,token:'test',now,presets:['last_30d'],includePromo:false});assert.equal(result.verified,true);
 h.rejectAll=true;const r=await request(handler,{type:'ads',date_preset:'last_30d',account:'All',currency:'CZK'});assert.equal(r.code,200);assert.ok(Array.isArray(r.body.daily_rows),'daily creative facts must be exposed');assert.ok(r.body.daily_rows.length>r.body.rows.length);assert.ok(r.body.daily_rows.every(r=>r.date_start===r.date_stop&&r.account_id&&r.report_currency==='CZK'));
}));

for(const scale of [40,100])test(`actual scheduled and custom ads handlers cap combined ${scale}-campaign accounts without inherited rows`,async()=>customEnvironment(async h=>{
 h.withAds=true;h.scale=scale;
 const seeded=await runtime.refresh({redis:h.redis,fetcher:h.fetcher,token:'test',now,presets:['last_30d'],includePromo:false});assert.equal(seeded.verified,true);
 h.rejectAll=true;
 const range={since:'2026-10-26',until:'2026-11-24'};
 for(const query of [{date_preset:'last_30d'},{time_range:JSON.stringify(range)}]){
  const all=await request(handler,{type:'ads',account:'All',currency:'CZK',...query});assert.equal(all.code,200);
  assert.ok(!Object.hasOwn(all.body,'daily_rows'),'oversized combined attachment must not inherit TUC rows');
  assert.match(all.body.daily_rows_unavailable,/size/);
  assert.equal(all.body.account_coverage.length,2);assert.ok(all.body.account_coverage.every(c=>!c.missing));
  assert.ok(all.body.account_coverage.some(c=>c.complete_through==='2026-11-24'&&!c.partial));
  assert.ok(all.body.account_coverage.some(c=>c.complete_through==='2026-11-23'&&c.partial),'LA day remains honestly incomplete');
  assert.equal(new Set(all.body.rows.map(r=>r.account_id)).size,2,'exact creatives retain both accounts');
  for(const account of ['TUC','TGLV']){
   const one=await request(handler,{type:'ads',account,currency:'CZK',...query});assert.equal(one.code,200);
   if(scale===40){assert.ok(one.body.daily_rows.length);assert.equal(new Set(one.body.daily_rows.map(r=>r.account_id)).size,1);assert.ok(Buffer.byteLength(JSON.stringify(one.body.daily_rows))<=2*1024*1024);}
   else {assert.ok(!Object.hasOwn(one.body,'daily_rows'));assert.match(one.body.daily_rows_unavailable,/size/);}
  }
 }
 assert.equal(h.blocked||0,0);
}));

test('optional native creative extract is bounded before HTTP serialization',()=>{
 const bounded=require('../lib/glv-mad-v2-source.cjs').browserDailyAds;
 assert.equal(typeof bounded,'function');
 const rows=[{name:'x'.repeat(2*1024*1024)}];
 assert.equal(bounded(rows).daily_rows,undefined);assert.match(bounded(rows).daily_rows_unavailable,/size/);
 assert.deepEqual(bounded([{id:'safe'}]).daily_rows,[{id:'safe'}]);
});
