const test=require('node:test'),assert=require('node:assert/strict');
const {scheduledRefresh,LOCK_KEY,STATE_KEY}=require('../lib/glv-refresh-owner.cjs');
function harness(){const store=new Map();let pulls=0,healthy=false;const redis=async(cmd,key,value,...rest)=>{
 if(cmd==='GET')return {result:store.get(key)||null};
 if(cmd==='SET'){if(rest.includes('NX')&&store.has(key))return {result:null};store.set(key,value);return {result:'OK'};}
 if(cmd==='EVAL'){const [lock,owner]=rest;if(store.get(lock)===owner){store.delete(lock);return {result:1}}return {result:0};}
 throw Error('unexpected '+cmd);
 };const refresh=async()=>{pulls++;if(!healthy)return {allErrors:['provider unavailable'],freshness:{all_tabs_verified:false}};store.set('cache','verified');return {allErrors:[],freshness:{all_tabs_verified:true},hashes:{cache:require('node:crypto').createHash('sha256').update('verified').digest('hex')}};};return {store,redis,refresh,get pulls(){return pulls},heal(){healthy=true}};}
test('same owner retries failed day, then skips only exact verified cache and recovers eviction',async()=>{
 const h=harness(),run=()=>scheduledRefresh({redis:h.redis,refresh:h.refresh,keys:['cache'],through:'2026-11-03'});
 assert.equal((await run()).allErrors.length,1);assert.equal(h.store.has(STATE_KEY),false);assert.equal(h.store.has(LOCK_KEY),false);
 h.heal();assert.equal((await run()).freshness.all_tabs_verified,true);assert.equal(h.pulls,2);
 assert.equal((await run()).skipped,'already_verified');assert.equal(h.pulls,2);
 h.store.delete('cache');await run();assert.equal(h.pulls,3);
});
test('overlapping invocations cannot pull twice; old owner never removes successor lease',async()=>{
 const h=harness();let finish;const first=scheduledRefresh({redis:h.redis,keys:['cache'],through:'2026-11-03',refresh:()=>new Promise(resolve=>{finish=resolve})});
 await new Promise(resolve=>setImmediate(resolve));
 const second=await scheduledRefresh({redis:h.redis,keys:['cache'],through:'2026-11-03',refresh:()=>assert.fail('duplicate pull')});assert.equal(second.skipped,'refresh_in_progress');
 h.store.set(LOCK_KEY,'successor');finish({allErrors:['failure'],freshness:{all_tabs_verified:false}});await first;assert.equal(h.store.get(LOCK_KEY),'successor');
});
test('new day and malformed receipt retry, failed completion readback never claims success',async()=>{
 const h=harness();h.heal();const args={redis:h.redis,refresh:h.refresh,keys:['cache'],through:'2026-11-03'};
 await scheduledRefresh(args);await scheduledRefresh({...args,through:'2026-11-04'});assert.equal(h.pulls,2);
 h.store.set(STATE_KEY,'{');await scheduledRefresh(args);assert.equal(h.pulls,3);
 h.store.delete(STATE_KEY);let written=false;const redis=async(...args)=>{if(args[0]==='SET'&&args[1]===STATE_KEY)written=true;if(written&&args[0]==='GET'&&args[1]===STATE_KEY)return {result:null};return h.redis(...args)};
 await assert.rejects(scheduledRefresh({...args,redis}),/completion readback/);assert.equal(h.store.has(LOCK_KEY),false);
});
test('missing digest or changed snapshot cannot establish completion; Redis lease errors fail closed',async()=>{
 const h=harness();h.heal();const args={redis:h.redis,keys:['cache'],through:'2026-11-03'};
 await assert.rejects(scheduledRefresh({...args,refresh:async()=>({allErrors:[],freshness:{all_tabs_verified:true},hashes:{cache:'wrong'}})}),/verification mismatch/);assert.equal(h.store.has(STATE_KEY),false);
 await assert.rejects(scheduledRefresh({...args,redis:async()=>{throw Error('Redis unavailable')},refresh:()=>assert.fail('must not pull')}),/Redis unavailable/);
});
test('manual full-history or partial-day runs share lease but do not bless the daily receipt',async()=>{
 const h=harness();h.heal();const args={redis:h.redis,refresh:h.refresh,keys:['cache'],through:'2026-11-03'};
 await scheduledRefresh({...args,force:true});assert.equal(h.store.has(STATE_KEY),false);
 await scheduledRefresh(args);await scheduledRefresh({...args,force:true});assert.equal(h.pulls,3);
});
