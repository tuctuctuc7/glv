'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {memory,snapshot}=require('./fixtures/mad-v2-isolated.cjs');
test('cold custom builds isolated accounts and reuses exact period bundle',async()=>{
 const custom=require('../lib/glv-mad-v2-isolated-custom.cjs'),store=memory();let pulls=0;
 const scope={type:'aggregate',currency:'USD',account:'All',range:{since:'2026-10-02',until:'2026-10-05'},custom:true};
 const opts={redis:store.redis,scope,token:'x',now:new Date('2026-11-15T05:00:00Z'),build:async o=>{pulls++;return snapshot(o);},loadFx:async()=>({})};
 const a=await custom.get(opts);assert.deepEqual(a.range,scope.range);assert.equal(a.coverage_complete,true);assert.equal(pulls,6);
 assert.equal((await custom.get(opts)).generation_id,a.generation_id);assert.equal(pulls,6);assert.ok([...store.data.keys()].every(k=>k.startsWith('glv:mad:v2:isolated:1:')));
});
