'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const handler=require('../api/glv-meta-ads/cron.js'),v2=require('../lib/glv-mad-v2.cjs'),shared=require('../lib/glv-mad-shared.cjs'),storage=require('../lib/glv-mad-v2-storage.cjs'),owner=require('../lib/glv-refresh-owner.cjs');
test('actual normal owner migrates old receipts, fails closed for one account, resumes then skips verified bytes',async()=>{
 const saved={...process.env},fetcher=global.fetch,log=console.log,error=console.error,store=new Map();let fail=true,insights=0;
 const response=b=>({ok:true,status:200,json:async()=>b,text:async()=>JSON.stringify(b)});
 Object.assign(process.env,{GLV_MAD_V2_ENABLED:'1',GLV_META_BETA_AUTH_TOKEN:'synthetic',CRON_SECRET:'synthetic',GLV_META_FB_ACCESS_TOKEN:'synthetic',KV_REST_API_URL:'https://redis.invalid',KV_REST_API_TOKEN:'synthetic'});
 delete process.env.UPSTASH_REDIS_REST_URL;delete process.env.UPSTASH_REDIS_REST_TOKEN;
 global.fetch=async(url,options={})=>{
  const u=new URL(url);
  if(u.hostname==='redis.invalid'){
   const [cmd,k,value,...rest]=JSON.parse(options.body);
   if(cmd==='GET')return response({result:store.get(k)||null});
   if(cmd==='SET'){if(rest.includes('NX')&&store.has(k))return response({result:null});store.set(k,value);return response({result:'OK'});}
   if(cmd==='TTL')return response({result:store.has(k)?-1:-2});
   if(cmd==='PERSIST')return response({result:store.has(k)?1:0});
   if(cmd==='EVAL'){const args=JSON.parse(options.body);if(k.includes("redis.call('DEL'")){const key=args[3],id=args[4];if(store.get(key)===id)store.delete(key);}return response({result:1});}
   throw Error(cmd);
  }
  if(u.hostname==='www.cnb.cz'){let body='Date|1 USD\n';const year=u.searchParams.get('year');for(let d=year+'-01-01';d<=year+'-12-31';d=v2.shift(d,1))body+=d.split('-').reverse().join('.')+'|25\n';return {ok:true,status:200,text:async()=>body};}
  assert.equal(u.hostname,'graph.facebook.com');
  if(u.pathname.endsWith('/insights'))insights++;
  if(u.searchParams.get('fields')==='account_id,currency,timezone_name,account_status'){
   const a=v2.ACCOUNTS.find(a=>u.pathname.includes(a.id));
   if(fail&&a.label==='TGLV')return {ok:false,status:403,json:async()=>({error:{code:190}})};
   return response({account_id:a.id,currency:a.currency,timezone_name:a.timezone,account_status:1});
  }
  return response({data:[]});
 };
 console.log=()=>{};console.error=()=>{};
 const invoke=async(auth='synthetic')=>{const res={code:200,status(c){this.code=c;return this;},json(b){this.body=b;return this;}};await handler({headers:{authorization:'Bearer '+auth},query:{}},res);return res;};
 try{
  store.set(owner.STATE_KEY,JSON.stringify({creator_completeness_version:1,through:`${require('../lib/glv-meta-dates.cjs').cutoffDate(false)}:v2:${v2.commonCutoff()}`,freshness:{all_tabs_verified:true},hashes:{}}));
  assert.equal((await invoke('wrong')).code,401);
  const failed=await invoke();assert.equal(failed.code,500);assert.equal(failed.body.freshness.all_tabs_verified,false);assert.equal(failed.body.freshness.shared.all_tabs_verified,false);
  const intent=storage.decode(store.get(shared.INTENT_KEY));assert.equal(intent.status,'pending');assert.equal(JSON.parse(store.get(owner.STATE_KEY)).freshness.all_tabs_verified,false);
  fail=false;const recovered=await invoke();assert.equal(recovered.code,200,JSON.stringify(recovered.body.freshness));assert.equal(recovered.body.freshness.shared.correction_id,intent.id);assert.equal(recovered.body.freshness.shared.all_tabs_verified,true);
  const count=insights,complete=storage.decode(store.get(shared.INTENT_KEY));assert.equal(complete.status,'complete');
  const verified=await invoke();assert.equal(verified.code,200);assert.equal(verified.body.skipped,'already_verified');assert.equal(insights,count);
  const receipt=JSON.parse(store.get(owner.STATE_KEY));for(const key of shared.requiredKeys())assert.ok(receipt.hashes[key]);
  const piece=Object.keys(receipt.hashes).find(k=>k.startsWith(shared.KEY)&&k.includes(':piece:ads:'));assert.ok(piece);store.set(piece,'corrupt');
  const repaired=await invoke();assert.equal(repaired.code,200);assert.notEqual(repaired.body.skipped,'already_verified');
  const active=await shared.read(async k=>store.has(k)?storage.decode(store.get(k)):null,'last_7d');assert.ok(active.generation_id);assert.equal((await invoke()).body.skipped,'already_verified');
 }finally{process.env=saved;global.fetch=fetcher;console.log=log;console.error=error;}
});
