const test=require('node:test'),assert=require('node:assert/strict');
const {createSessionCache}=require('../public/glv-meta-ads/session-cache.js');
test('failures retry; TTL, UTC rollover and bounded LRU evict; invalidation fences pending writes',async()=>{
 let now=Date.parse('2026-09-21T23:59:00Z'),calls=0;
 const cache=createSessionCache({now:()=>now,ttl:1000,maxEntries:2});
 const load=async()=>++calls;
 await assert.rejects(cache.get('bad',async()=>{throw Error('offline');}),/offline/);
 assert.equal(await cache.get('bad',load),1);
 assert.equal(await cache.get('bad',load),1);now+=1001;
 assert.equal(await cache.get('bad',load),2);
 await cache.get('b',load);await cache.get('c',load);
 assert.equal(await cache.get('bad',load),5);
 now=Date.parse('2026-09-21T23:59:59.900Z');await cache.get('roll',load);
 now+=200;assert.equal(await cache.get('roll',load),7);
 let resolve;const old=cache.get('race',()=>new Promise(r=>resolve=r));await Promise.resolve();
 cache.invalidate('race');assert.equal(await cache.get('race',load),8);resolve(-1);await old;
 assert.equal(await cache.get('race',load),8,'invalidated old request must not repopulate cache');
 cache.clear();assert.equal(await cache.get('race',load),9);
});
test('fresh successful requests reuse exact keys and coalesce in flight',async()=>{
 const cache=createSessionCache();let calls=0,resolve;
 const loader=()=>{calls++;return new Promise(r=>resolve=r);};
 const a=cache.get('daily|last_30d',loader),b=cache.get('daily|last_30d',loader);
 await Promise.resolve();assert.equal(calls,1);resolve({rows:[1]});assert.deepEqual(await a,await b);
 assert.deepEqual(await cache.get('daily|last_30d',loader),{rows:[1]});assert.equal(calls,1);
 assert.deepEqual(await cache.get('daily|last_7d',async()=>({rows:[2]})),{rows:[2]});
});
