'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {memory,snapshot}=require('./fixtures/mad-v2-isolated.cjs');
test('cold custom builds isolated accounts and reuses exact period bundle',async()=>{
 const custom=require('../lib/glv-mad-v2-isolated-custom.cjs'),store=memory();let pulls=0;
 const scope={type:'aggregate',currency:'USD',account:'All',range:{since:'2026-10-02',until:'2026-10-05'},custom:true};
 const opts={redis:store.redis,scope,token:'x',now:new Date('2026-11-15T05:00:00Z'),build:async o=>{pulls++;return snapshot(o);},loadFx:async()=>({})};
 const a=await custom.get(opts);assert.deepEqual(a.range,scope.range);assert.equal(a.coverage_complete,true);assert.equal(pulls,6);
 assert.equal((await custom.get(opts)).generation_id,a.generation_id);assert.equal(pulls,6);assert.ok([...store.data.keys()].every(k=>k.startsWith('glv:mad:v2:isolated:1:')));
});
const {customEnvironment,request,range,now}=require('./helpers/mad-custom-fixture.cjs');
test('custom budget accommodates three bounded pieces per account without cron-sized reserves starving TUC',async()=>{
 const custom=require('../lib/glv-mad-v2-isolated-custom.cjs'),store=memory(),realNow=Date.now;let clock=realNow();
 Date.now=()=>clock;
 try{
  const result=await custom.get({redis:store.redis,scope:{type:'aggregate',currency:'CZK',account:'All',range,custom:true},token:'test',now,deadline:clock+45000,loadFx:async()=>({}),build:async o=>{clock+=3500;if(clock>=o.deadline)throw Error('budget');return snapshot(o);}});
  assert.ok(result);assert.equal(result.account_coverage[0].missing,undefined,'TUC must not be starved by scheduled-publication reserves');
  assert.equal(result.rows.length,0);
 }finally{Date.now=realNow;}
});
test('V2 actual concurrent Nov19–24 handlers reuse published daily facts but request exact period reach',()=>customEnvironment(async h=>{
 const runtime=require('../lib/glv-mad-v2-isolated.cjs'),api=require('../api/glv-meta-ads-v2/fb-data.js');
 const seeded=await runtime.refresh({redis:h.redis,fetcher:h.fetcher,token:'test',presets:['last_7d'],now,includePromo:false});
 assert.equal(seeded.verified,true,JSON.stringify(seeded.errors));
 h.rejectDaily=true;h.graph.length=0;
 const replies=await Promise.all(['aggregate','daily','ads'].map(type=>request(api,{type,time_range:JSON.stringify(range),currency:'CZK',account:'All'})));
 assert.deepEqual(replies.map(r=>r.code),[200,200,200]);
 for(const r of replies){assert.equal(r.body.account_coverage[0].missing,undefined,'TUC must remain available');assert.equal(r.body.account_coverage[1].complete_through,'2026-11-23');}
 assert.equal(replies[0].body.rows.find(r=>r.account_id==='359758259164738').reach,'123');
 assert.equal(replies[1].body.rows.length,12);
 assert.equal(h.graph.filter(g=>g.daily).length,0,'must not re-extract available daily campaigns/ads');
 assert.equal(h.graph.filter(g=>g.level==='campaign'&&!g.daily).length,2,'exact unique reach once per account');
 assert.equal(new Set(replies.map(r=>r.body.generation_id)).size,1);
}));
test('V2 genuinely cold concurrent actual handlers coalesce one exact extraction and preserve partial coverage',()=>customEnvironment(async h=>{
 const api=require('../api/glv-meta-ads-v2/fb-data.js');
 const replies=await Promise.all(['aggregate','daily','ads'].map(type=>request(api,{type,time_range:JSON.stringify(range),currency:'CZK',account:'All'})));
 assert.deepEqual(replies.map(r=>r.code),[200,200,200]);
 assert.equal(new Set(replies.map(r=>r.body.generation_id)).size,1);
 assert.equal(replies[1].body.rows.length,12);assert.equal(replies[0].body.account_coverage[1].complete_through,'2026-11-23');
 assert.equal(h.graph.filter(g=>g.level==='campaign'&&!g.daily).length,2);
 assert.equal(h.graph.filter(g=>g.level==='campaign'&&g.daily).length,2);
 assert.equal(h.graph.filter(g=>g.level==='ad'&&g.daily).length,2);
}));
