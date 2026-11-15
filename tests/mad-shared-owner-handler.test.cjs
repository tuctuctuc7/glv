'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const handler=require('../api/glv-meta-ads/cron.js'),owner=require('../lib/glv-refresh-owner.cjs');
const {environment,request}=require('./helpers/mad-independent-fixture.cjs');
test('active native owner ignores retired shared receipts, fails closed, recovers and verifies its own immutable bytes',()=>environment(async h=>{
 const legacyKeys=['glv:mad:shared:1:correction','glv:mad:shared:1:sources','glv:refresh:complete:v2','glv:refresh:lease:v2'];
 for(const key of legacyKeys)h.store.set(key,'foreign-state-must-not-change');
 const invoke=(auth='test')=>request(handler,{}, {authorization:'Bearer '+auth});
 assert.equal((await invoke('wrong')).code,401);assert.equal(h.calls.length,0);
 h.failSource=true;
 const failed=await invoke();assert.equal(failed.code,500);assert.equal(failed.body.freshness.all_tabs_verified,false);
 assert.equal(h.store.has(owner.STATE_KEY),false);
 h.failSource=false;
 const recovered=await invoke();assert.equal(recovered.code,200);assert.equal(recovered.body.freshness.all_tabs_verified,true);
 const count=h.calls.filter(c=>c[0]==='GRAPH').length;
 const verified=await invoke();assert.equal(verified.code,200);assert.equal(verified.body.skipped,'already_verified');assert.equal(h.calls.filter(c=>c[0]==='GRAPH').length,count);
 const receipt=JSON.parse(h.store.get(owner.STATE_KEY));assert.ok(Object.keys(receipt.hashes).every(k=>!k.includes('mad:')));
 assert.equal(receipt.contract,'v1-native-published-v2','retired receipts must not certify the standalone publication contract');
 const legacyReceipt={...receipt};delete legacyReceipt.contract;h.store.set(owner.STATE_KEY,JSON.stringify(legacyReceipt));
 assert.notEqual((await invoke()).body.skipped,'already_verified','matching dates alone cannot reuse an older owner contract');
 const manifest=JSON.parse(h.store.get('glv:published:last_7d')),piece=manifest.refs.ads.key;
 assert.equal(JSON.parse(h.store.get(owner.STATE_KEY)).hashes[piece],owner.hash(h.store.get(piece)),'native completion receipt must verify the immutable ads piece, not only its manifest');h.store.set(piece,'corrupt');
 const repaired=await invoke();assert.equal(repaired.code,200);assert.notEqual(repaired.body.skipped,'already_verified');assert.equal((await invoke()).body.skipped,'already_verified');
 for(const key of legacyKeys){assert.equal(h.store.get(key),'foreign-state-must-not-change');assert.ok(!h.calls.some(c=>c[1]===key));}
}));
