const test=require('node:test'),assert=require('node:assert/strict');
const {rolloverState}=require('../lib/glv-mad-v2-chunks.cjs'),v2=require('../lib/glv-mad-v2.cjs');
test('rollover preserves completed bounded history, not partial pages or stale metadata',()=>{
 const id=v2.ACCOUNTS[0].id;
 const old={version:1,through:'2026-11-08',generated_at:'2026-11-09T08:00:00Z',chunks:{[id]:[{range:{since:'2026-08-01',until:'2026-11-08'},generated_at:'2026-11-09T08:00:00Z',rows:[]}]},metadata:{[id]:{item:'synthetic'}},pending:{x:{rows:[],next:'synthetic'}},splits:{x:true}};
 const original=JSON.stringify(old),now=new Date('2026-11-10T09:00:00Z'),next=rolloverState(old,now);
 assert.equal(JSON.stringify(old),original);
 assert.deepEqual(next.chunks[id][0].range,{since:'2026-08-12',until:'2026-11-02'});
 assert.deepEqual(next.metadata,{});assert.deepEqual(next.splits,{});assert.equal(next.pending,undefined);
 assert.equal(next.through,'2026-11-09');
 assert.deepEqual(rolloverState({...old,through:'2026-11-11'},now).chunks,{});
 assert.deepEqual(rolloverState({...old,generated_at:'invalid'},now).chunks,{});
 const corrupt=structuredClone(old);corrupt.chunks[id][0].range.since='invalid';
 assert.throws(()=>rolloverState(corrupt,now),/Invalid historical chunk/);
});
