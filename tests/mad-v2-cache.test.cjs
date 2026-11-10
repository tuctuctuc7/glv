const test=require('node:test'),assert=require('node:assert/strict');
const cache=require('../lib/glv-mad-v2-cache.cjs'),v2=require('../lib/glv-mad-v2.cjs');
const {CACHE_KEY}=require('../lib/glv-mad-v2-promo.cjs');
const {scheduledRefresh}=require('../lib/glv-refresh-owner.cjs');
const now=new Date('2026-11-09T12:00:00Z');
const fx={'2026-11-06':{date:'2026-11-06',czk_per_usd:25,source:'test'}};
function redisStore(){const data=new Map();return {data,redis:async(cmd,key,value,...rest)=>{
 if(cmd==='GET')return {result:data.get(key)||null};
 if(cmd==='TTL')return {result:data.has(key)?-1:-2};
 if(cmd==='SET'){if(rest.includes('NX')&&data.has(key))return {result:null};data.set(key,value);return {result:'OK'};}
 if(cmd==='EVAL'){data.delete(rest[0]);return {result:1};}
 throw new Error(cmd);
}};}
function snapshot({type,range}){return {schema_version:1,complete:true,type,range,generated_at:now.toISOString(),fx,accounts:v2.ACCOUNTS.map(a=>({...a,rows:[],reach:[]}))};}
function params(store){return {token:'synthetic',redis:store.redis,now,clock:()=>Number(now),loadFx:async()=>fx,build:async opts=>snapshot(opts),promoPayload:async()=>({schema_version:1,classification_version:2,funnel_version:1,reconciled:true,generated_at:now.toISOString(),range:{since:'2026-03-01',until:'2026-11-08'},rows:[]})};}
test('V2 publishes every isolated durable preset and Promo with exact readback and repeated replacement',async()=>{
 const store=redisStore(),options=params(store);
 const first=await cache.refreshV2(options),bytes=[...store.data];
 assert.equal(first.verified,true);assert.equal(Object.keys(first.hashes).length,19);assert.deepEqual(Object.keys(first.hashes).sort(),cache.requiredKeys().sort());
 assert.ok([...store.data.keys()].every(k=>k.startsWith('glv:mad:v2:')));
 assert.equal((await cache.refreshV2(options)).verified,true);assert.deepEqual([...store.data],bytes);
});
test('V2 partial extraction/FX/budget failures retain last-good and cannot create completion',async()=>{
 const store=redisStore(),options=params(store);await cache.refreshV2(options);const bytes=[...store.data];
 const failed=await cache.refreshV2({...options,force:true,build:async()=>{throw new Error('account unavailable');}});
 assert.equal(failed.verified,false);assert.equal(failed.errors.length,18);assert.deepEqual(bytes.map(([k])=>[k,store.data.get(k)]),bytes);
 assert.equal((await cache.refreshV2({...options,loadFx:async()=>{throw Error();}})).verified,false);
 assert.equal((await cache.refreshV2({...options,deadline:Date.now()-1})).verified,false);
 assert.deepEqual(bytes.map(([k])=>[k,store.data.get(k)]),bytes);
});
test('partial recovery reuses verified current-day pieces and retries only missing presets',async()=>{
 const store=redisStore(),options=params(store);let pulls=0;
 const first=await cache.refreshV2({...options,build:async opts=>{pulls++;if(pulls===2)throw Error('transient');return snapshot(opts);}});
 assert.equal(first.verified,false);assert.equal(pulls,18);
 pulls=0;const recovered=await cache.refreshV2({...options,build:async opts=>{pulls++;return snapshot(opts);}});
 assert.equal(recovered.verified,true);assert.equal(pulls,1);assert.equal(recovered.summaries.filter(s=>s.reused).length,17);
});
test('force failure before ads durably invalidates old pieces and normal recovery resumes once',async()=>{
 const store=redisStore(),options=params(store);await cache.refreshV2(options);
 const storage=require('../lib/glv-mad-v2-storage.cjs'),source=require('../lib/glv-mad-v2-source.cjs');
 const workKey=source.CACHE_PREFIX+'work:ads';store.data.set(workKey,storage.encode({old:true}));
 const failed=await cache.refreshV2({...options,force:true,loadFx:async()=>{throw Error('budget');}});
 assert.equal(failed.verified,false);
 let ads=0,loads=[];
 const partial=await cache.refreshV2({...options,build:async opts=>{
  if(opts.type==='ads'){
   ads++;loads.push(await opts.progress.load());
   if(ads===1){await opts.progress.save({completed_chunks:['post-force']});return snapshot(opts);}
   throw Error('budget');
  }return snapshot(opts);
 }});
 assert.equal(partial.verified,false,'normal must not reuse pre-force ads');assert.equal(ads,6);
 assert.equal(loads[0],undefined,'pre-force raw work cannot carry old names forward');
 ads=0;
 const recovered=await cache.refreshV2({...options,force:true,build:async opts=>{
  assert.equal(opts.type,'ads','completed campaign pieces are not reset');ads++;
  assert.deepEqual((await opts.progress.load()).completed_chunks,['post-force']);return snapshot(opts);
 }});
 assert.equal(recovered.verified,true);assert.equal(ads,5,'completed ads piece is not reset');
 const repeated=await cache.refreshV2({...options,build:async()=>{throw Error('must reuse');}});
 assert.equal(repeated.verified,true);assert.equal(repeated.summaries.filter(s=>s.reused).length,18);
});
test('real source force recovery replaces old names and resumes saved chunks',async()=>{
 const source=require('../lib/glv-mad-v2-source.cjs'),storage=require('../lib/glv-mad-v2-storage.cjs');
 const store=redisStore(),options=params(store);let name='PAC999_V1',requests=[],interrupt=false,saved=false;
 const fetcher=async url=>{const u=new URL(url),a=v2.ACCOUNTS.find(a=>u.pathname.includes(a.id));let data;
  if(u.searchParams.has('ids'))data=Object.fromEntries(u.searchParams.get('ids').split(',').map(id=>[id,{effective_status:'ACTIVE',creative:{}}]));
  else if(!u.pathname.endsWith('/insights'))data={account_id:a.id,currency:a.currency,timezone_name:a.timezone,account_status:1};
  else if(u.searchParams.get('level')!=='ad')data={data:[]};
  else {const r=JSON.parse(u.searchParams.get('time_range'));requests.push(`${a.id}:${r.since}:${r.until}`);data={data:[{ad_id:'111',ad_name:name,adset_id:'222',adset_name:'Set',campaign_id:'333',campaign_name:'TUC_001_US_Sales',date_start:r.since,date_stop:r.since,spend:'25',impressions:'10'}]};}
  return {ok:true,status:200,json:async()=>data};
 };
 const fx=Object.fromEntries(Array.from({length:100},(_,i)=>{const date=v2.shift(v2.commonCutoff(now),-i);return [date,{date,czk_per_usd:25}];}));
 const run={...options,fetcher,loadFx:async()=>fx,build:async opts=>{
  if(interrupt&&opts.type==='ads'){
   if(saved)throw Error('budget');
   return source.buildSnapshot({...opts,progress:{load:opts.progress.load,save:async state=>{await opts.progress.save(state);saved=true;throw Error('budget');}}});
  }return source.buildSnapshot(opts);
 }};
 assert.equal((await cache.refreshV2(run)).verified,true);
 name='Kristyna_PAC999_V1';requests=[];interrupt=true;
 assert.equal((await cache.refreshV2({...run,force:true})).verified,false);assert.equal(requests.length,1);
 const completed=requests[0];requests=[];interrupt=false;
 const recovered=await cache.refreshV2(run);assert.equal(recovered.verified,true);assert.ok(!requests.includes(completed),'saved page is resumed, not pulled again');
 for(const p of cache.PRESETS){const s=storage.decode(store.data.get(cache.presetKey('ads',p)));assert.ok(s.accounts.flatMap(a=>a.rows).every(r=>r.name===name));}
 requests=[];assert.equal((await cache.refreshV2(run)).verified,true);assert.equal(requests.length,0);
});
test('failed forced owner cannot skip recovery using an older completion receipt',async()=>{
 const store=redisStore();let calls=0;
 const refresh=async()=>{calls++;const r=await cache.refreshV2(params(store));return {allErrors:r.errors,hashes:r.hashes,summaries:r.summaries,freshness:{all_tabs_verified:r.verified}};};
 const options={redis:store.redis,refresh,keys:cache.requiredKeys(),through:'test'};
 await scheduledRefresh(options);
 await scheduledRefresh({...options,force:true,refresh:async()=>({allErrors:['budget'],freshness:{all_tabs_verified:false}})});
 await scheduledRefresh(options);assert.equal(calls,2);
});
test('cron summaries count strict creator prefixes from verified post-force ads without IDs or names',async()=>{
 const store=redisStore(),options=params(store);
 const build=async opts=>{const s=snapshot(opts);s.fx=Object.fromEntries(Array.from({length:100},(_,i)=>{const date=v2.shift(v2.commonCutoff(now),-i);return [date,{date,czk_per_usd:25}];}));if(opts.type==='ads')for(const a of s.accounts){
  a.rows=['Kristyna_PAC999_V1','PAC999_V1','xKristyna_PAC999_V1'].map((name,i)=>({id:String(i+1),name,campaign_id:'123',campaign_name:'TUC_001_US_Sales',date_start:opts.range.until,date_stop:opts.range.until,amount_spent:'25','action_values:omni_purchase':'50',impressions:'10'}));
 }return s;};
 const result=await cache.refreshV2({...options,force:true,build});assert.equal(result.verified,true);
 for(const s of result.summaries.filter(s=>s.type==='ads')){
  assert.equal(s.naming_freshness.post_force_readback_verified,true);
  assert.equal(s.naming_freshness.requested_at,now.toISOString());
  assert.equal(s.naming_freshness.unique_ads,6);assert.equal(s.naming_freshness.strict_creator_prefix_ads,2);
  assert.ok(!JSON.stringify(s.naming_freshness).includes('PAC999'));
 }
 const again=await cache.refreshV2({...options,build:async()=>{throw Error('must reuse');}});
 assert.equal(again.verified,true);assert.deepEqual(again.summaries.filter(s=>s.type==='ads').map(s=>s.naming_freshness),result.summaries.filter(s=>s.type==='ads').map(s=>s.naming_freshness));
});
test('V2 SET requires explicit acknowledgement, exact GET, and no expiry',async()=>{
 for(const redis of [async()=>({result:null}),async cmd=>({result:cmd==='SET'?'OK':'wrong'}),async cmd=>({result:cmd==='SET'?'OK':cmd==='GET'?'{}':60})])await assert.rejects(cache.publish(redis,'test',{}));
});
test('V2 source age and requested coverage independently mark stale; future timestamp fails closed',()=>{
 const range={since:'2026-11-02',until:'2026-11-08'},s=snapshot({type:'daily',range});
 assert.equal(cache.cacheState(s,{type:'daily',range,now}).stale,false);
 assert.equal(cache.cacheState(s,{type:'daily',range:{...range,until:'2026-11-09'},now}).stale,true);
 assert.equal(cache.cacheState({...s,generated_at:'2026-11-07T00:00:00Z'},{range,now}).stale,true);
 assert.throws(()=>cache.cacheState({...s,generated_at:'2026-11-10T00:00:00Z'},{range,now}));
});
test('V2 bounded transport stops ignored abort/body stalls and rejects new requests after deadline',async()=>{
 let calls=0;const deadline=Date.now()+25;
 const fetcher=cache.boundedTransport(async()=>{calls++;return {ok:true,text:()=>new Promise(()=>{})};},deadline);
 await assert.rejects(fetcher('https://example.test'),/budget/);await assert.rejects(fetcher('https://example.test'),/budget/);assert.equal(calls,1);
});
test('existing shared receipt skips only verified V2 bytes and recovers corruption',async()=>{
 const store=redisStore();let pulls=0;
 const refresh=async()=>{pulls++;const r=await cache.refreshV2(params(store));return {allErrors:r.errors,hashes:r.hashes,summaries:r.summaries,freshness:{all_tabs_verified:r.verified}};};
 const options={redis:store.redis,refresh,keys:cache.requiredKeys(),through:'2026-11-09:v2:2026-11-08'};
 assert.equal((await scheduledRefresh(options)).allErrors.length,0);
 assert.equal((await scheduledRefresh(options)).skipped,'already_verified');assert.equal(pulls,1);
 store.data.set(CACHE_KEY,'corrupted');assert.equal((await scheduledRefresh(options)).allErrors.length,0);assert.equal(pulls,2);
 assert.equal((await scheduledRefresh({...options,through:'2026-11-09:v2:2026-11-09'})).allErrors.length,0);assert.equal(pulls,3);
});
