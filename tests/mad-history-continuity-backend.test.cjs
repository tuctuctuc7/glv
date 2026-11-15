const test=require('node:test'),assert=require('node:assert/strict');
const cache=require('../lib/glv-mad-v2-cache.cjs'),v2=require('../lib/glv-mad-v2.cjs'),storage=require('../lib/glv-mad-v2-storage.cjs');
function harness(){
 const store=new Map(),writes=[];let fail=()=>false;
 const redis=async(cmd,key,value,...args)=>{if(cmd==='SET'){writes.push({key,args});if(fail(key))throw Error('Redis synthetic failure');store.set(key,value);return {result:'OK'};}return {result:cmd==='TTL'?-1:cmd==='PERSIST'?1:store.get(key)||null};};
 const build=async({type,range,now})=>({schema_version:1,creator_ad_version:1,complete:true,type,range,generated_at:now.toISOString(),accounts:v2.ACCOUNTS.map(a=>({...a,rows:[],reach:[]})),fx:{}});
 const run=(now,extra={})=>cache.refreshV2({token:'synthetic',now,clock:()=>+now,redis,build,loadFx:async()=>({}),promoPayload:async()=>({schema_version:1,classification_version:2,reconciled:true,generated_at:now.toISOString(),range:{since:'2026-03-01',until:v2.commonCutoff(now)},rows:[]}),...extra});
 return {store,writes,redis,run,build,setFailure:f=>{fail=f;}};
}
test('V2 published bundle survives a failed one-piece next-day replacement and two missed days',async()=>{
 const h=harness(),first=new Date('2026-11-08T12:00:00Z');
 assert.equal((await h.run(first)).verified,true);
 const key='glv:mad:v2:native:1:published:last_30d',before=h.store.get(key);
 assert.ok(before,'a durable published bundle must exist independently of mutable staging keys');
 h.setFailure(k=>k===cache.presetKey('ads','last_30d'));
 const later=new Date('2026-11-11T12:00:00Z');
 assert.equal((await h.run(later)).verified,false);
 assert.equal(h.store.get(key),before);
 const pieces=await cache.readPublished(async k=>storage.decode(h.store.get(k)), 'last_30d');
 assert.equal(pieces.daily.range.until,'2026-11-07');
 assert.equal(new Set(Object.values(pieces).map(p=>p.generation_id)).size,1);
 assert.deepEqual(cache.cacheState(pieces.daily,{type:'daily',range:v2.rangeFor('last_30d',later),now:later}),{stale:true,coverage_complete:false,requested_range:v2.rangeFor('last_30d',later),cached_range:pieces.daily.range});
 assert.ok(h.writes.every(w=>!w.args.includes('EX')));
 h.setFailure(()=>false);
 assert.equal((await h.run(later)).verified,true);
 const recovered=await cache.readPublished(async k=>storage.decode(h.store.get(k)), 'last_30d');
 assert.equal(recovered.daily.range.until,'2026-11-10');
 assert.equal(new Set(Object.values(recovered).map(p=>p.generation_id)).size,1);
 assert.equal((await h.run(new Date('2026-11-12T12:00:00Z'))).verified,true);
});
module.exports={harness};
test('successful refresh repairs a malformed manifest without certifying malformed old data',async()=>{
 const h=harness();await h.run(new Date('2026-11-08T12:00:00Z'));h.store.set(cache.bundleKey('last_30d'),'broken');
 const next=new Date('2026-11-09T12:00:00Z');assert.equal((await h.run(next)).verified,true);
 const pieces=await cache.readPublished(async k=>{const bytes=h.store.get(k);return bytes?storage.decode(bytes):null;},'last_30d');assert.equal(pieces.daily.range.until,'2026-11-08');
});
test('month rollover retains the actual old full-month interval until the whole replacement succeeds',async()=>{
 const h=harness(),first=new Date('2026-10-31T12:00:00Z'),next=new Date('2026-11-02T12:00:00Z');await h.run(first);
 h.setFailure(k=>k===cache.presetKey('ads','last_month'));
 assert.equal((await h.run(next)).verified,false);
 const pieces=await cache.readPublished(async k=>{const bytes=h.store.get(k);return bytes?storage.decode(bytes):null;},'last_month');
 assert.deepEqual(pieces.aggregate.range,{since:'2026-09-01',until:'2026-09-30'});
 const state=cache.cacheState(pieces.aggregate,{type:'aggregate',range:v2.rangeFor('last_month',next),now:next});
 assert.deepEqual(state.requested_range,{since:'2026-10-01',until:'2026-10-31'});assert.equal(state.coverage_complete,false);assert.equal(state.stale,true);
 h.setFailure(()=>false);assert.equal((await h.run(next)).verified,true);
 const recovered=await cache.readPublished(async k=>{const bytes=h.store.get(k);return bytes?storage.decode(bytes):null;},'last_month');assert.deepEqual(recovered.aggregate.range,state.requested_range);
});
test('freshness receipts include the exact published manifests, not only working keys',async()=>{
 const h=harness(),result=await h.run(new Date('2026-11-08T12:00:00Z'));
 assert.equal(result.verified,true);
 for(const preset of cache.PRESETS){assert.ok(cache.requiredKeys().includes(cache.bundleKey(preset)));assert.equal(result.hashes[cache.bundleKey(preset)],require('node:crypto').createHash('sha256').update(h.store.get(cache.bundleKey(preset))).digest('hex'));}
});
test('failed manifest readback still leaves prior published coverage accessible',async()=>{
 const h=harness(),now=new Date('2026-11-08T12:00:00Z');await h.run(now);
 const target=cache.bundleKey('last_30d');
 const broken=async(cmd,key,value,...args)=>{const result=await h.redis(cmd,key,value,...args);if(cmd==='SET'&&key===target)h.store.set(key,'broken');return result;};
 const result=await h.run(new Date('2026-11-09T12:00:00Z'),{redis:broken});assert.equal(result.verified,false);
 const prior=await cache.readPublished(async k=>{const bytes=h.store.get(k);return bytes?storage.decode(bytes):null;},'last_30d');
 assert.equal(prior.daily.range.until,'2026-11-07');
});
test('V2 malformed daily rows cannot publish over last-good or become reusable history',async()=>{
 const h=harness(),first=new Date('2026-11-08T12:00:00Z');await h.run(first);
 const key=cache.bundleKey('last_30d'),before=h.store.get(key);
 const result=await h.run(new Date('2026-11-09T12:00:00Z'),{build:async opts=>{
  const s=await h.build(opts);
  if(opts.type==='daily')s.accounts[0].rows=[{id:'1',name:'TUC_001_US_Sales',date_start:opts.range.since,date_stop:opts.range.since,amount_spent:1,'action_values:omni_purchase':0,reach:1,impressions:'bad'}];
  s.fx={[opts.range.since]:{date:opts.range.since,czk_per_usd:25}};return s;
 }});
 assert.equal(result.verified,false);assert.equal(h.store.get(key),before);
 assert.equal(storage.decode(h.store.get(cache.presetKey('daily','last_30d'))).range.until,'2026-11-07');
});
test('published piece tampering fails closed instead of returning wrong totals',async()=>{
 const h=harness();await h.run(new Date('2026-11-08T12:00:00Z'));
 const manifest=storage.decode(h.store.get(cache.bundleKey('last_30d'))),ref=manifest.refs.daily;
 const piece=storage.decode(h.store.get(ref.key));piece.range.until='2026-11-08';h.store.set(ref.key,storage.encode(piece));
 await assert.rejects(cache.readPublished(async k=>storage.decode(h.store.get(k)),'last_30d'),/digest/);
});
test('actual V2 API retains isolated immutable last-good after interrupted next-day publication',async()=>{
 const t=require('../qa/mad-shared-transport.cjs').create({clock:'2026-11-08T12:00:00Z'});
 const runtime=require('../lib/glv-mad-v2-isolated.cjs');
 const q=type=>new URLSearchParams({type,date_preset:'last_30d',account:'All',currency:'CZK'});
 try{
  const before=await t.payload(q('daily'),true),manifest=t.values.get(runtime.combinedKey('last_30d'));
  assert.ok(before.rows.length>0);
  t.setClock('2026-11-11T12:00:00Z');t.setFailure(true);
  await assert.rejects(t.payload(q('daily'),true),/Synthetic isolated publication failed/);
  assert.equal(t.values.get(runtime.combinedKey('last_30d')),manifest);
  t.hold(true);
  const responses=await Promise.all(cache.TYPES.map(type=>t.payload(q(type),true)));
  assert.ok(responses.every(p=>p.range.until==='2026-11-07'&&p.stale&&p.requested_range.until==='2026-11-10'));
  assert.equal(new Set(responses.map(p=>p.generation_id)).size,1);
  assert.deepEqual(responses[0].rows,before.rows);
  t.hold(false);t.setFailure(false);
  const recovered=await t.payload(q('daily'),true);
  assert.equal(recovered.range.until,'2026-11-10');assert.equal(recovered.coverage_complete,true);
  assert.notEqual(recovered.generation_id,before.generation_id);
 }finally{t.close();}
});
test('existing V2 coherent last-good is archived before FX failure or pending force work',async()=>{
 const h=harness(),now=new Date('2026-11-08T12:00:00Z');await h.run(now);
 for(const key of [...h.store.keys()])if(key.includes(':published:'))h.store.delete(key);
 const before=h.store.get(cache.presetKey('daily','last_30d'));
 const result=await h.run(new Date('2026-11-11T12:00:00Z'),{force:true,loadFx:async()=>{throw Error('FX offline');}});
 assert.equal(result.verified,false);
 assert.ok(h.store.has('glv:mad:v2:native:1:published:last_30d'));
 assert.equal(h.store.get(cache.presetKey('daily','last_30d')),before);
});
