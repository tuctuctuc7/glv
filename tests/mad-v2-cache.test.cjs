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
 assert.equal(failed.verified,false);assert.equal(failed.errors.length,18);assert.deepEqual([...store.data],bytes);
 assert.equal((await cache.refreshV2({...options,loadFx:async()=>{throw Error();}})).verified,false);
 assert.equal((await cache.refreshV2({...options,deadline:Date.now()-1})).verified,false);
 assert.deepEqual([...store.data],bytes);
});
test('partial recovery reuses verified current-day pieces and retries only missing presets',async()=>{
 const store=redisStore(),options=params(store);let pulls=0;
 const first=await cache.refreshV2({...options,build:async opts=>{pulls++;if(pulls===2)throw Error('transient');return snapshot(opts);}});
 assert.equal(first.verified,false);assert.equal(pulls,18);
 pulls=0;const recovered=await cache.refreshV2({...options,build:async opts=>{pulls++;return snapshot(opts);}});
 assert.equal(recovered.verified,true);assert.equal(pulls,1);assert.equal(recovered.summaries.filter(s=>s.reused).length,17);
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
