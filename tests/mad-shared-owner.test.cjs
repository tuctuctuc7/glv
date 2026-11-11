'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {memory}=require('./mad-shared-handlers.test.cjs');
const owner=require('../lib/glv-refresh-owner.cjs');
test('completion receipt verifies immutable shared piece bytes, not just manifest pointers',async()=>{
 const shared=require('../lib/glv-mad-shared.cjs'),m=memory(),b=shared.compose(require('./mad-shared-publication.test.cjs').fixture());
 const receipt=await shared.save(m.redis,'last_7d',b);assert.ok(Object.keys(receipt.storage_hashes||{}).length===4);
 let refreshes=0;
 const run=()=>owner.scheduledRefresh({redis:m.redis,keys:[receipt.key],through:'test',refresh:async()=>{refreshes++;return {allErrors:[],freshness:{all_tabs_verified:true},hashes:receipt.storage_hashes};}});
 await run();assert.equal((await run()).skipped,'already_verified');
 const piece=Object.keys(receipt.storage_hashes).find(k=>k.includes(':piece:ads:'));m.values.set(piece,'corrupt');
 await assert.rejects(run(),/verification mismatch/);assert.equal(refreshes,2);
});
test('normal owner invalidates old receipts before failed migration and resumes correction identity',async()=>{
 const shared=require('../lib/glv-mad-shared.cjs'),m=memory(),now=new Date('2026-11-03T14:00:00Z');
 m.values.set(owner.STATE_KEY,JSON.stringify({creator_completeness_version:1,through:'old',freshness:{all_tabs_verified:true},hashes:{}}));
 let first;
 const run=()=>owner.scheduledRefresh({redis:m.redis,through:'old',keys:[shared.INTENT_KEY],beforeVerify:async()=>{first=await shared.ensureCorrection(m.redis,{now});},refresh:async()=>({allErrors:['source unavailable'],freshness:{all_tabs_verified:false}})});
 await run();const id=first.id;assert.equal(JSON.parse(m.values.get(owner.STATE_KEY)).freshness.all_tabs_verified,false);
 await run();assert.equal(first.id,id);
 const next=await shared.ensureCorrection(m.redis,{now:new Date('2026-11-04T14:00:00Z')});assert.notEqual(next.id,id);
});
test('operator audit uses actual shared adapters for all presets and both Promo consumers',async()=>{
 const shared=require('../lib/glv-mad-shared.cjs'),names=require('../lib/glv-campaign-metadata.cjs'),m=memory(),b=shared.compose(require('./mad-shared-publication.test.cjs').fixture());
 for(const preset of require('../lib/glv-mad-v2-cache.cjs').PRESETS)await shared.save(m.redis,preset,b);
 const read=async k=>{const v=m.values.get(k);return v?require('../lib/glv-mad-v2-storage.cjs').decode(v):null;};
 const rows=await names.auditPublished(read,null,{v2Enabled:true,deadline:Date.now()+10000});
 const presets=rows.filter(r=>r.preset);assert.equal(presets.length,36);assert.ok(presets.every(r=>r.shared_generation_id===b.generation_id&&r.semantic_sha256));
 assert.deepEqual([...new Set(rows.filter(r=>!r.preset).map(r=>r.type))].sort(),['promo_concepts','promo_formats']);
});
test('Promo format/concept readers share generation and complete semantic hashes',async()=>{
 const p=require('../lib/glv-mad-shared-promo.cjs'),m=memory();
 const fixture=require('./helpers/promo-ghost-fixture.cjs');
 const payload=await require('../lib/glv-promo-format.cjs').fetchPromoFormats('synthetic',fixture.range,fixture.fixture({ad:15,campaign:10}));
 const fx=Object.fromEntries(payload.rows.map(r=>[r.date,{date:r.date,czk_per_usd:25}]));
 await p.save(m.redis,{payload,fx});
 const read=async k=>{const v=m.values.get(k);return v?require('../lib/glv-mad-v2-storage.cjs').decode(v):null;};
 const a=await p.readRender(read,{version:'v1',type:'promo_formats',currency:'CZK',account:'TUC',range:payload.range});
 const b=await p.readRender(read,{version:'v2',type:'promo_concepts',currency:'CZK',account:'TUC',range:payload.range});
 assert.equal(a.generation_id,b.generation_id);assert.equal(p.semantic(a),p.semantic(b));
});
