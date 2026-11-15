'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {runRefresh}=require('../api/glv-meta-ads/cron.js')._test;
const {environment,request}=require('./helpers/mad-independent-fixture.cjs');
const api=require('../api/glv-meta-ads/fb-data.js');
// The cross-version source checkpoint was retired. Native publication must
// recover without consulting it, even if its bytes claim a completed refresh.
test('active native publication interruption retains last-good and recovers independently of obsolete shared checkpoints',()=>environment(async h=>{
 const key='glv:mad:shared:1:sources';h.store.set(key,JSON.stringify({version:1,hashes:{},freshness:{all_tabs_verified:true}}));
 const checkpoint=h.store.get(key);
 const run=()=>runRefresh('test',false,{timeoutMs:30000});
 const first=await run();assert.deepEqual(first.allErrors,[]);
 const read=()=>request(api,{type:'aggregate',date_preset:'last_7d'});
 const good=await read();assert.equal(good.code,200);assert.ok(good.body.generation_id);
 h.failWrite=true;
 const failed=await run();assert.ok(failed.allErrors.length);assert.equal(failed.freshness.all_tabs_verified,false);
 const retained=await read();assert.equal(retained.code,200);assert.equal(retained.body.generation_id,good.body.generation_id);assert.deepEqual(retained.body.rows,good.body.rows);
 h.failWrite=false;
 const recovered=await run();assert.deepEqual(recovered.allErrors,[]);assert.equal(recovered.freshness.all_tabs_verified,true);
 assert.equal((await read()).code,200);assert.equal(h.store.get(key),checkpoint);assert.ok(!h.calls.some(c=>c[1]===key));
 const before=h.calls.filter(c=>c[0]==='GRAPH').length;
 await runRefresh('test',false,{timeoutMs:30000,fullHistory:true});assert.ok(h.calls.filter(c=>c[0]==='GRAPH').length>before);
}));
