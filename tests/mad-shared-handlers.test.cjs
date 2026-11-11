'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const shared=require('../lib/glv-mad-shared.cjs'),storage=require('../lib/glv-mad-v2-storage.cjs');
const {fixture}=require('./mad-shared-publication.test.cjs');
const handlers=[require('../api/glv-meta-ads/fb-data.js'),require('../api/glv-meta-ads-v2/fb-data.js')];
function memory(){const values=new Map();return {values,redis:async(c,k,v)=>{if(c==='GET')return {result:values.get(k)||null};if(c==='SET'){values.set(k,v);return {result:'OK'};}if(c==='TTL')return {result:values.has(k)?-1:-2};if(c==='EVAL')return {result:1};throw Error(c);}};}
async function request(handler,query={},auth=true){const res={code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(s){this.code=s;return this;},json(p){this.body=p;return this;}};await handler({method:'GET',headers:{cookie:auth?'glv_meta_beta=test':''},query:{type:'ads',date_preset:'last_7d',currency:'CZK',account:'TUC',...query}},res);return res;}
test('actual authenticated APIs read the shared immutable generation, not independent pieces',async()=>{
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
test('custom range extracts once through the same bounded cache for both actual APIs',async()=>{
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
