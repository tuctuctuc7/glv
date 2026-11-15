'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const shared=require('../lib/glv-mad-shared.cjs'),storage=require('../lib/glv-mad-v2-storage.cjs');
const {fixture}=require('./mad-shared-publication.test.cjs');
const legacy=require('./helpers/mad-legacy-reader.cjs');
const handlers=[legacy.v1,legacy.v2];
function memory(){const values=new Map();return {values,redis:async(c,k,v)=>{if(c==='GET')return {result:values.get(k)||null};if(c==='SET'){values.set(k,v);return {result:'OK'};}if(c==='TTL')return {result:values.has(k)?-1:-2};if(c==='EVAL')return {result:1};throw Error(c);}};}
async function request(handler,query={},auth=true){const res={code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(s){this.code=s;return this;},json(p){this.body=p;return this;}};await handler({method:'GET',headers:{cookie:auth?'glv_meta_beta=test':''},query:{type:'ads',date_preset:'last_7d',currency:'CZK',account:'TUC',...query}},res);return res;}
test('legacy shared adapters read the immutable generation, not independent pieces',async()=>{
 const previous={...process.env},fetcher=global.fetch;const m=memory();
 try{
 Object.assign(process.env,{GLV_MAD_V2_ENABLED:'1',GLV_META_BETA_AUTH_TOKEN:'test',KV_REST_API_URL:'https://redis.invalid',KV_REST_API_TOKEN:'test'});
 const b=shared.compose(fixture());await shared.save(m.redis,'last_7d',b);
 global.fetch=async url=>({ok:true,json:async()=>({result:m.values.get(decodeURIComponent(String(url).split('/get/')[1]))||null})});
 for(const h of handlers)assert.equal((await request(h,{},false)).code,401);
 const responses=await Promise.all(handlers.map(h=>request(h)));
 for(const r of responses){assert.equal(r.code,200,JSON.stringify(r.body));assert.equal(r.body.shared_generation_id,b.generation_id);}
 assert.deepEqual(shared.facts(responses[0].body),shared.facts(responses[1].body));
 for(const h of handlers)assert.equal((await request(h,{time_range:JSON.stringify({since:'2026-01-01',until:'2026-11-01'})})).code,400);
 }finally{global.fetch=fetcher;process.env=previous;}
});
test('legacy shared custom adapters coalesce through their retired bounded cache',async()=>{
 const previous={...process.env},fetcher=global.fetch;const m=memory();let pulls=0;
 try{
 Object.assign(process.env,{GLV_MAD_V2_ENABLED:'1',GLV_META_BETA_AUTH_TOKEN:'test',GLV_META_FB_ACCESS_TOKEN:'test',KV_REST_API_URL:'https://redis.invalid',KV_REST_API_TOKEN:'test'});
 global.fetch=async(url,options={})=>{
  const u=new URL(url);let body;
  if(u.hostname==='redis.invalid')body=u.pathname.startsWith('/get/')?{result:m.values.get(decodeURIComponent(u.pathname.slice(5)))||null}:await m.redis(...JSON.parse(options.body));
  else if(u.hostname==='www.cnb.cz')return {ok:true,status:200,text:async()=> 'Date|1 USD\n01.11.2026|25\n02.11.2026|25\n'};
  else{pulls++;const a=require('../lib/glv-mad-v2.cjs').ACCOUNTS.find(a=>u.pathname.includes(a.id));body=u.searchParams.get('fields')==='account_id,currency,timezone_name,account_status'?{account_id:a.id,currency:a.currency,timezone_name:a.timezone,account_status:1}:{data:[]};}
  return {ok:true,status:200,json:async()=>body,text:async()=>JSON.stringify(body)};
 };
 const q={time_range:JSON.stringify({since:'2026-11-01',until:'2026-11-02'})};
 const a=await request(handlers[0],q);assert.equal(a.code,200,JSON.stringify(a.body));const calls=pulls;
 const b=await request(handlers[1],q);assert.equal(b.code,200,JSON.stringify(b.body));assert.equal(a.body.shared_generation_id,b.body.shared_generation_id);assert.equal(pulls,calls);assert.ok(calls>0);
 }finally{global.fetch=fetcher;process.env=previous;}
});
module.exports={memory,request};
const independent=require('./helpers/mad-independent-fixture.cjs');
test('active V1 and V2 APIs ignore shared generations and retain independent published facts after foreign corruption',()=>independent.environment(async h=>{
 const native=require('../api/glv-meta-ads/fb-data.js'),isolatedApi=require('../api/glv-meta-ads-v2/fb-data.js');
 const pipeline=require('../lib/glv-mad-v2-isolated.cjs');
 await require('../api/glv-meta-ads/cron.js')._test.runRefresh('test',false,{timeoutMs:30000});
 const result=await pipeline.refresh({redis:h.redis,token:'test',fetcher:h.fetcher,loadFx:async()=>({}),presets:['last_7d'],includePromo:false});
 assert.equal(result.verified,true,JSON.stringify(result.errors));
 const query={type:'ads',date_preset:'last_7d',currency:'CZK',account:'TUC'};
 const read=api=>independent.request(api,query);
 const a=await read(native),b=await read(isolatedApi);assert.equal(a.code,200);assert.equal(b.code,200);
 assert.ok(a.body.generation_id);assert.ok(b.body.generation_id);assert.notEqual(a.body.generation_id,b.body.generation_id);
 assert.equal(a.body.shared_generation_id,undefined);assert.equal(b.body.shared_generation_id,undefined);assert.equal(b.body.date_policy,'account-isolated');
 // A valid but unrelated retired shared publication is never a fallback.
 await shared.save(h.redis,'last_7d',shared.compose(fixture()));h.calls.length=0;
 assert.deepEqual((await read(native)).body,a.body);assert.deepEqual((await read(isolatedApi)).body,b.body);
 assert.ok(!h.calls.some(c=>String(c[1]).startsWith(shared.KEY)));
 const v1Keys=[...h.store.keys()].filter(k=>!k.startsWith('glv:mad:'));
 const v1Bytes=v1Keys.map(k=>[k,h.store.get(k)]);
 for(const key of v1Keys)h.store.delete(key);
 assert.deepEqual((await read(isolatedApi)).body,b.body);
 for(const [key,value] of v1Bytes)h.store.set(key,value);
 for(const key of [...h.store.keys()].filter(k=>k.startsWith(pipeline.PREFIX)))h.store.delete(key);
 assert.equal((await read(isolatedApi)).code,503);assert.deepEqual((await read(native)).body,a.body);
}));
test('active custom APIs do not reuse each other’s extraction or lease',()=>independent.environment(async h=>{
 const v1=require('../api/glv-meta-ads/fb-data.js'),v2Api=require('../api/glv-meta-ads-v2/fb-data.js');
 const query={type:'ads',time_range:JSON.stringify({since:'2026-11-01',until:'2026-11-02'}),currency:'CZK',account:'TUC'};
 h.store.set('glv:refresh:lease:v1','foreign-owner');
 const first=await independent.request(v1,query);assert.equal(first.code,200);
 const calls=h.calls.filter(c=>c[0]==='GRAPH').length;assert.ok(calls>0);
 const second=await independent.request(v2Api,query);assert.equal(second.code,200,JSON.stringify(second.body));assert.ok(h.calls.filter(c=>c[0]==='GRAPH').length>calls);
 assert.equal(first.body.shared_generation_id,undefined);assert.equal(second.body.shared_generation_id,undefined);
 const after=h.calls.filter(c=>c[0]==='GRAPH').length;
 assert.equal((await independent.request(v2Api,query)).code,200);assert.equal(h.calls.filter(c=>c[0]==='GRAPH').length,after);
 assert.equal(h.store.get('glv:refresh:lease:v1'),'foreign-owner');
}));
