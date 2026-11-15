'use strict';
// Contract (Tom, 2026-11-13): TUC/CZSK data arrives on the Prague cutoff for
// both dashboards before 08:00 GMT+7, never waiting on Los Angeles. V2's 8AM
// pull includes TGLV's partial last day with a note; a TGLV-only refresh after
// LA midnight + 1h completes it without re-pulling TUC, and says so.
const test=require('node:test'),assert=require('node:assert/strict');
const v2=require('../lib/glv-mad-v2.cjs'),cache=require('../lib/glv-mad-v2-cache.cjs');
const storage=require('../lib/glv-mad-v2-storage.cjs'),chunks=require('../lib/glv-mad-v2-chunks.cjs');
const [TUC,TGLV]=v2.ACCOUNTS;
const MORNING=new Date('2026-11-13T01:00:00Z'),COMPLETION=new Date('2026-11-13T09:05:00Z');

function redisStore(){const data=new Map();return {data,redis:async(cmd,key,value,...rest)=>{
 if(cmd==='GET')return {result:data.get(key)||null};
 if(cmd==='TTL')return {result:data.has(key)?-1:-2};
 if(cmd==='SET'){if(rest.includes('NX')&&data.has(key))return {result:null};data.set(key,value);return {result:'OK'};}
 if(cmd==='EVAL'){data.delete(rest[0]);return {result:1};}
 throw new Error(cmd);
}};}
function options(store,now,build){
 const fx={[v2.commonCutoff(now)]:{date:v2.commonCutoff(now),czk_per_usd:25,source:'test'}};
 return {token:'synthetic',redis:store.redis,now,clock:()=>Number(now),loadFx:async()=>fx,build:async opts=>build(opts,fx),
  promoPayload:async()=>({schema_version:1,classification_version:2,funnel_version:1,reconciled:true,generated_at:now.toISOString(),range:{since:'2026-03-01',until:v2.commonCutoff(now)},rows:[]})};
}
const snap=({type,range,now},fx,accounts)=>({schema_version:1,complete:true,type,range,generated_at:now.toISOString(),fx,accounts});

test('cutoff is the TUC Prague day: V1/TUC has yesterday before 08:00 GMT+7 while TGLV is still partial',()=>{
 assert.equal(v2.commonCutoff(MORNING),'2026-11-12');
 assert.deepEqual(v2.rangeFor('last_7d',MORNING),{since:'2026-11-06',until:'2026-11-12'});
 assert.equal(v2.refreshPhase(MORNING),'tglv-partial');
 assert.equal(v2.refreshPhase(COMPLETION),'final');
 assert.equal(v2.commonCutoff(COMPLETION),'2026-11-12','completion run never opens a new partial TUC day');
});

test('TGLV-only completion retains TUC verbatim, re-pulls TGLV, and moves every piece to the final phase',async()=>{
 const store=redisStore();
 const morning=await cache.refreshV2(options(store,MORNING,(opts,fx)=>snap(opts,fx,[{...TUC,rows:[],reach:[],marker:'tuc-morning'},{...TGLV,rows:[],reach:[],marker:'tglv-partial'}])));
 assert.equal(morning.verified,true,JSON.stringify(morning.errors));
 for(const p of cache.PRESETS)for(const t of cache.TYPES)assert.equal(storage.decode(store.data.get(cache.presetKey(t,p))).refresh_phase,'tglv-partial');

 let builds=0;
 const completion=await cache.refreshV2({...options(store,COMPLETION,(opts,fx)=>{
  builds++;
  const kept=opts.retainedAccounts?.get(TUC.id);
  assert.ok(kept,'TUC facts are provided for retention');assert.equal(kept.account.marker,'tuc-morning');
  assert.ok(!opts.retainedAccounts.has(TGLV.id),'TGLV is always re-pulled');
  return snap(opts,fx,[structuredClone(kept.account),{...TGLV,rows:[],reach:[],marker:'tglv-final'}]);
 }),tglvOnly:true});
 assert.equal(completion.verified,true,JSON.stringify(completion.errors));
 assert.equal(builds,18,'all six presets x three types');
 for(const p of cache.PRESETS)for(const t of cache.TYPES){
  const s=storage.decode(store.data.get(cache.presetKey(t,p)));
  assert.equal(s.refresh_phase,'final');assert.equal(s.refresh_through,'2026-11-12');
  assert.equal(s.accounts.find(a=>a.id===TUC.id).marker,'tuc-morning');assert.equal(s.accounts.find(a=>a.id===TGLV.id).marker,'tglv-final');
 }
 const again=await cache.refreshV2({...options(store,COMPLETION,()=>{throw Error('must reuse final pieces');}),tglvOnly:true});
 assert.equal(again.verified,true);
});

test('TGLV-only completion refuses to run without same-cutoff TUC facts (never pulls TUC)',async()=>{
 const store=redisStore();
 const result=await cache.refreshV2({...options(store,COMPLETION,()=>{throw Error('build must not be called');}),tglvOnly:true});
 assert.equal(result.verified,false);
 assert.ok(result.errors.every(e=>/refresh failed/.test(e)||/promo|bundle/.test(e)));
});

test('ad chunks: TGLV seven-day window is dropped once when its day completes; TUC chunks are kept',()=>{
 const raw=d=>({ad_id:'1',campaign_id:'2',adset_id:'3',ad_name:'a',campaign_name:'c',date_start:d,date_stop:d,spend:'1',impressions:'1'});
 const chunk=(since,until)=>{const rows=[];for(let d=since;d<=until;d=v2.shift(d,1))rows.push(raw(d));return {range:{since,until},generated_at:MORNING.toISOString(),rows};};
 const state={version:1,through:'2026-11-12',generated_at:MORNING.toISOString(),chunks:{[TUC.id]:[chunk('2026-11-01','2026-11-12')],[TGLV.id]:[chunk('2026-11-01','2026-11-12')]},metadata:{},splits:{[`${TGLV.id}:2026-11-06:2026-11-12`]:true},pending:{}};
 const next=chunks.finalizeAccount(state,TGLV.id,COMPLETION);
 assert.equal(next.tglv_final_for,'2026-11-12');
 assert.deepEqual(next.chunks[TUC.id],state.chunks[TUC.id],'TUC untouched');
 assert.deepEqual(next.chunks[TGLV.id][0].range,{since:'2026-11-01',until:'2026-11-05'});
 assert.ok(next.chunks[TGLV.id][0].rows.every(r=>r.date_start<='2026-11-05'));
 assert.deepEqual(next.splits,{});
 assert.equal(chunks.finalizeAccount(next,TGLV.id,COMPLETION),next,'idempotent per cutoff');
 assert.equal(chunks.rolloverState(undefined,COMPLETION).tglv_final_for,'2026-11-12','post-LA-midnight state starts final');
 assert.equal(chunks.rolloverState(undefined,MORNING).tglv_final_for,undefined);
});

test('builder records TGLV partial coverage with its pull time; reader notes give LA and GMT+7 times',()=>{
 const reader=require('../lib/glv-mad-shared-reader.cjs');
 assert.equal(reader.tglvCompletionAt('2026-11-12').toISOString(),'2026-11-13T09:00:00.000Z','PST: LA 01:00 = 09:00 UTC = 16:00 GMT+7');
 assert.equal(reader.tglvCompletionAt('2026-07-12').toISOString(),'2026-07-13T08:00:00.000Z','PDT: LA 01:00 = 08:00 UTC = 15:00 GMT+7');
 const partial={range:{since:'2026-11-06',until:'2026-11-12'},account_coverage:[{label:'TUC',complete_through:'2026-11-12',partial_day:null},{label:'TGLV',complete_through:'2026-11-11',partial_day:'2026-11-12',extracted_at:'2026-11-13T01:02:00Z'}]};
 const n=reader.refreshNotes(partial,'v2','All');
 assert.equal(n.tglv_partial,true);
 assert.match(n.partial_note,/TGLV \(US\) 2026-11-12 is partial: Meta data pulled at 17:02 PST Los Angeles time/);
 assert.match(n.partial_note,/~16:00 GMT\+7/);
 assert.deepEqual(reader.refreshNotes(partial,'v2','TUC'),{},'TUC-only view has no TGLV caveat');
 assert.deepEqual(reader.refreshNotes(partial,'v1','TUC'),{},'V1 is TUC-only');
 const full={...partial,account_coverage:[partial.account_coverage[0],{label:'TGLV',complete_through:'2026-11-12',partial_day:null,extracted_at:'2026-11-13T09:01:00Z'}]};
 assert.deepEqual(reader.refreshNotes(full,'v2','All'),{tglv_partial:false,refresh_note:'Both accounts have full data through 2026-11-12.'});
});

test('V1 serves its own TUC publication whenever it is newer than the shared V1+V2 bundle',async()=>{
 const reader=require('../lib/glv-mad-shared-reader.cjs'),shared=require('../lib/glv-mad-shared.cjs'),legacy=require('../lib/glv-history-v1.cjs');
 const original={read:shared.read,readPublished:legacy.readPublished,render:shared.render};
 const own=until=>({daily:{rows:[],range:{since:'2026-11-06',until},generated_at:'2026-11-13T00:03:00Z'}});
 try{
  legacy.readPublished=async()=>own('2026-11-12');
  shared.read=async()=>({range:{since:'2026-11-05',until:'2026-11-11'}});
  shared.render=()=>({rendered:'shared'});
  const v1=await reader.consumer(async()=>null,{version:'v1',type:'daily',preset:'last_7d'});
  assert.equal(v1.range.until,'2026-11-12');assert.equal(v1.v1_ahead_of_shared,true);
  const v2r=await reader.consumer(async()=>null,{version:'v2',type:'daily',preset:'last_7d'});
  assert.equal(v2r.rendered,'shared','V2 keeps the shared bundle');
  shared.read=async()=>({range:{since:'2026-11-06',until:'2026-11-12'}});
  assert.equal((await reader.consumer(async()=>null,{version:'v1',type:'daily',preset:'last_7d'})).rendered,'shared','parity restored once shared catches up');
 }finally{Object.assign(shared,{read:original.read,render:original.render});legacy.readPublished=original.readPublished;}
});

test('cron scopes are isolated: TUC scope writes no V2 data; V2 scope never rewrites V1 facts but publishes shared',async()=>{
 const {runRefresh}=require('../api/glv-meta-ads/cron.js')._test;
 const originalFetch=global.fetch,saved={...process.env},store=new Map(),ttls=new Map();const calls=[];
 Object.assign(process.env,{KV_REST_API_URL:'https://redis.test',KV_REST_API_TOKEN:'synthetic',GLV_MAD_V2_ENABLED:'1',GLV_MAD_V2_FB_ACCESS_TOKEN:'synthetic-v2-only'});
 delete process.env.UPSTASH_REDIS_REST_URL;delete process.env.UPSTASH_REDIS_REST_TOKEN;
 const response=value=>({ok:true,status:200,json:async()=>value,text:async()=>JSON.stringify(value)});
 global.fetch=async(url,options={})=>{
  const u=new URL(url);
  if(u.hostname==='redis.test'){
   const [cmd,key,value,...rest]=JSON.parse(options.body);
   if(cmd==='GET')return response({result:store.get(key)||null});
   if(cmd==='SET'){if(rest.includes('NX')&&store.has(key))return response({result:null});store.set(key,value);ttls.set(key,rest.includes('EX')?90000:-1);return response({result:'OK'});}
   if(cmd==='TTL')return response({result:ttls.get(key)??-2});
   if(cmd==='PERSIST'){ttls.set(key,-1);return response({result:1});}
   if(cmd==='EVAL'){store.delete(rest[0]);return response({result:1});}
   throw Error(cmd);
  }
  if(u.hostname==='www.cnb.cz'){const year=u.searchParams.get('year');let text='Date|1 USD\n';for(let day=year+'-01-01';day<=year+'-12-31';day=v2.shift(day,1))text+=day.split('-').reverse().join('.')+'|25\n';return {ok:true,status:200,text:async()=>text};}
  calls.push({path:u.pathname,token:u.searchParams.get('access_token')});
  if(u.searchParams.get('fields')==='account_id,currency,timezone_name,account_status'){const a=v2.ACCOUNTS.find(a=>u.pathname.includes(a.id));return response({account_id:a.id,currency:a.currency,timezone_name:a.timezone,account_status:1});}
  return response({data:[]});
 };
 try{
  const tuc=await runRefresh('synthetic',false,{timeoutMs:30000,scope:'tuc'});
  assert.deepEqual(tuc.allErrors,[]);assert.equal(tuc.freshness.scope,'tuc');assert.equal(tuc.freshness.v2,undefined);assert.equal(tuc.freshness.shared,undefined);
  assert.ok(![...store.keys()].some(k=>k.startsWith('glv:mad:')),'no V2 or shared writes from the TUC scope');
  assert.ok(!calls.some(c=>c.path.includes(TGLV.id)),'TUC scope never calls the TGLV account');
  const v1Keys=[...store.keys()].filter(k=>k.startsWith('glv:')&&!k.startsWith('glv:mad:')&&!k.startsWith('glv:refresh:')),before=Object.fromEntries(v1Keys.map(k=>[k,store.get(k)]));
  calls.length=0;
  const v2run=await runRefresh('synthetic',false,{timeoutMs:30000,scope:'v2'});
  assert.deepEqual(v2run.allErrors,[]);assert.equal(v2run.freshness.v2.all_tabs_verified,true);assert.equal(v2run.freshness.shared.all_tabs_verified,true);
  for(const k of v1Keys)assert.equal(store.get(k),before[k],`V2 scope must not rewrite ${k}`);
  assert.ok(calls.every(c=>c.token==='synthetic-v2-only'),'V2 scope uses only the V2 credential (no V1 extraction)');
 }finally{global.fetch=originalFetch;for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);}
});
