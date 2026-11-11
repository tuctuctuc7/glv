'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const chunks=require('../lib/glv-mad-v2-chunks.cjs'),v2=require('../lib/glv-mad-v2.cjs');
test('same-cutoff correction reopens seven days once and preserves history provenance',()=>{
 const now=new Date('2026-11-11T16:00:00Z'),id=v2.ACCOUNTS[0].id;
 const state={version:1,through:v2.commonCutoff(now),generated_at:'2026-11-11T08:00:00Z',chunks:{[id]:[{range:{since:'2026-11-01',until:'2026-11-10'},generated_at:'2026-11-11T08:00:00Z',rows:[]}]},metadata:{[id]:{old:{}}},splits:{old:true},pending:{old:{rows:[]}}};
 const repaired=chunks.reopenCorrection(state,now,'migration-1');
 assert.equal(repaired.chunks[id][0].range.until,'2026-11-03');
 assert.equal(repaired.chunks[id][0].generated_at,'2026-11-11T08:00:00Z');
 assert.deepEqual(repaired.metadata,{});assert.deepEqual(repaired.pending,{});
 assert.equal(repaired.correction_id,'migration-1');
 assert.deepEqual(chunks.reopenCorrection(repaired,now,'migration-1'),repaired);
 assert.equal(state.chunks[id][0].range.until,'2026-11-10');
});
