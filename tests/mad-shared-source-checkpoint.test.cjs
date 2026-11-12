'use strict';
// Regression: production runs on 2026-11-12 verified every source, then hit the
// cron time budget during shared publication. Each later run re-extracted all
// sources and timed out again. A verified source checkpoint lets the next run
// publish from byte-identical sources with the full budget.
const test=require('node:test'),assert=require('node:assert/strict');
const {runRefresh}=require('../api/glv-meta-ads/cron.js')._test;
const v2=require('../lib/glv-mad-v2.cjs'),shared=require('../lib/glv-mad-shared.cjs');
const CHECKPOINT='glv:mad:shared:1:sources';

test('shared publication resumes from verified sources after a budget failure, and only from unchanged bytes',async()=>{
 const originalFetch=global.fetch,saved={...process.env},store=new Map(),ttls=new Map(),originalMigrate=shared.migrate;
 let insightCalls=0;
 process.env.KV_REST_API_URL='https://redis.test';process.env.KV_REST_API_TOKEN='synthetic';delete process.env.UPSTASH_REDIS_REST_URL;delete process.env.UPSTASH_REDIS_REST_TOKEN;
 process.env.GLV_MAD_V2_ENABLED='1';process.env.GLV_MAD_V2_FB_ACCESS_TOKEN='synthetic-v2-only';
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
   const a=v2.ACCOUNTS.find(a=>u.pathname.includes(a.id));return response({account_id:a.id,currency:a.currency,timezone_name:a.timezone,account_status:1});
  }
  if(u.pathname.endsWith('/insights'))insightCalls++;
  return response({data:[]});
 };
 const failMigrate=()=>{shared.migrate=async()=>{throw Error('Cron refresh time budget exceeded');};};
 try{
  // 1. All sources verify, publication exhausts the budget: checkpoint is kept.
  failMigrate();
  const first=await runRefresh('synthetic',false,{timeoutMs:30000});
  assert.deepEqual(first.allErrors,['shared: publication incomplete; last-good retained']);
  assert.equal(first.freshness.shared.reason,'Cron refresh time budget exceeded');
  assert.ok(insightCalls>0);
  const checkpoint=JSON.parse(store.get(CHECKPOINT));
  assert.equal(checkpoint.version,1);assert.equal(checkpoint.correction_id,first.freshness.shared.correction_id);
  assert.equal(ttls.get(CHECKPOINT),-1);
  assert.ok(!JSON.stringify(checkpoint).includes('eligible_ad_ids'));

  // 2. A changed source byte invalidates the checkpoint: full re-extraction.
  const tampered='glv:daily:last_7d';assert.ok(checkpoint.hashes[tampered]);
  store.set(tampered,store.get(tampered).replace('"rows":[]','"rows": []'));
  insightCalls=0;
  const second=await runRefresh('synthetic',false,{timeoutMs:30000});
  assert.ok(insightCalls>0,'tampered checkpoint must not be reused');
  assert.equal(second.freshness.resumed_from_source_checkpoint,undefined);

  // 3. Unchanged sources: publication resumes with zero Meta extraction.
  shared.migrate=originalMigrate;insightCalls=0;
  const third=await runRefresh('synthetic',false,{timeoutMs:30000});
  assert.equal(insightCalls,0);
  assert.deepEqual(third.allErrors,[]);
  assert.ok(third.freshness.resumed_from_source_checkpoint);
  assert.equal(third.freshness.shared.all_tabs_verified,true);
  assert.equal(third.freshness.all_tabs_verified,true);
  for(const key of shared.requiredKeys())assert.ok(third.hashes[key],key);
  assert.ok(third.hashes['glv:daily:last_30d']);

  // 4. Forced full-history runs never take the shortcut.
  insightCalls=0;
  await runRefresh('synthetic',false,{timeoutMs:30000,fullHistory:true});
  assert.ok(insightCalls>0);
 }finally{
  shared.migrate=originalMigrate;global.fetch=originalFetch;
  for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);
 }
});
