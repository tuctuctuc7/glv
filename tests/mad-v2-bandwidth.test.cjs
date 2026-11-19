'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const runtime=require('../lib/glv-mad-v2-isolated.cjs');
const {memory,snapshot}=require('./fixtures/mad-v2-isolated.cjs');
const storage=require('../lib/glv-mad-v2-storage.cjs');
const v2=require('../lib/glv-mad-v2.cjs');

test('warm V2 refresh bounds repeated immutable payload reads and bytes',async t=>{
 const store=memory(),now=new Date('2026-11-15T12:00:00Z');
 for(const a of v2.ACCOUNTS)store.data.set(`${runtime.PREFIX}intent:${a.id}:morning`,storage.encode({id:'fixed-'+a.label,through:'2026-11-14',status:'pending'}));
 const options={redis:store.redis,presets:['last_7d'],now,loadFx:async()=>({}),build:o=>({...snapshot(o),fixture_padding:'synthetic fixture '.repeat(5000)})};
 assert.equal((await runtime.refresh(options)).verified,true);
 let reads=0,bytes=0,totalReadBytes=0,writeBytes=0;const counts=new Map();
 const redis=async(...args)=>{const result=await store.redis(...args);if(args[0]==='GET')totalReadBytes+=Buffer.byteLength(result.result||'');if(args[0]==='SET')writeBytes+=Buffer.byteLength(args[2]||'');if(args[0]==='GET'&&args[1].includes(':piece:')){reads++;bytes+=Buffer.byteLength(result.result||'');counts.set(args[1],(counts.get(args[1])||0)+1);}return result;};
 const before=await runtime.readPreset(store.redis,'last_7d');
 assert.equal((await runtime.refresh({...options,redis})).verified,true);
 assert.deepEqual(await runtime.readPreset(store.redis,'last_7d'),before);
 t.diagnostic(JSON.stringify({immutableReads:reads,immutableBytes:bytes,totalReadBytes,writeBytes,perPiece:[...counts.values()]}));
 assert.ok(reads<=24,`immutable GET regression: ${reads} > 24`);
 // Fixed pre-optimization baseline: 48 GETs / 62,836 encoded value bytes.
 assert.ok(bytes<=62836/2,`immutable byte regression: ${bytes} > half of baseline`);
});
