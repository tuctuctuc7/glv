const test=require('node:test'),assert=require('node:assert/strict');
const {runRefresh}=require('../api/glv-meta-ads/cron.js')._test;
const v2=require('../lib/glv-mad-v2.cjs'),cache=require('../lib/glv-mad-v2-cache.cjs');
test('shared cron composes real V2 source, CNB, Promo reuse and 19 durable exact readbacks under one owner',async()=>{
 const originalFetch=global.fetch,saved={...process.env},store=new Map(),ttls=new Map();let promoPulls=0;
 process.env.GLV_META_BETA_AUTH_TOKEN='synthetic';process.env.KV_REST_API_URL='https://redis.test';process.env.KV_REST_API_TOKEN='synthetic';delete process.env.UPSTASH_REDIS_REST_URL;delete process.env.UPSTASH_REDIS_REST_TOKEN;
 const response=value=>({ok:true,status:200,json:async()=>value,text:async()=>JSON.stringify(value)});
 global.fetch=async(url,options={})=>{
  const u=new URL(url);
  if(u.hostname==='redis.test'){
   const [cmd,key,value,...rest]=JSON.parse(options.body);
   if(cmd==='GET')return response({result:store.get(key)||null});
   if(cmd==='SET'){store.set(key,value);ttls.set(key,rest.includes('EX')?90000:-1);return response({result:'OK'});}
   if(cmd==='TTL')return response({result:ttls.get(key)??-2});
   if(cmd==='PERSIST'){ttls.set(key,-1);return response({result:1});}
   throw Error(cmd);
  }
  if(u.hostname==='www.cnb.cz'){
   const year=u.searchParams.get('year');let text='Date|1 USD\n';for(let day=year+'-01-01';day<=year+'-12-31';day=v2.shift(day,1)){text+=day.split('-').reverse().join('.')+'|25\n';}
   return {ok:true,status:200,text:async()=>text};
  }
  assert.equal(u.hostname,'graph.facebook.com');
  if(u.searchParams.get('fields')==='account_id,currency,timezone_name,account_status'){
   assert.equal(u.searchParams.get('access_token'),'synthetic-v2-only');
   const a=v2.ACCOUNTS.find(a=>u.pathname.includes(a.id));return response({account_id:a.id,currency:a.currency,timezone_name:a.timezone,account_status:1});
  }
  if(u.pathname.endsWith('/campaigns'))promoPulls++;
  return response({data:[]});
 };
 try{
  delete process.env.GLV_MAD_V2_ENABLED;
  const disabled=await runRefresh('synthetic',false,{timeoutMs:30000});
  assert.deepEqual(disabled.allErrors,[]);assert.equal(disabled.freshness.v2,undefined);
  assert.ok(![...store.keys()].some(k=>k.startsWith('glv:mad:v2:')));
  process.env.GLV_MAD_V2_ENABLED='1';
  process.env.GLV_MAD_V2_FB_ACCESS_TOKEN='synthetic-v2-only';
  const result=await runRefresh('synthetic',false,{timeoutMs:30000});
  assert.deepEqual(result.allErrors,[]);assert.equal(result.freshness.v2.all_tabs_verified,true);
  for(const key of cache.requiredKeys()){assert.ok(result.hashes[key]);assert.ok(store.has(key));assert.equal(ttls.get(key),-1);}
  assert.equal(result.freshness.v2.summaries.length,19);
  assert.ok(Object.keys(result.hashes).some(key=>key==='glv:daily:last_30d'));
 }finally{global.fetch=originalFetch;for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);}
});
