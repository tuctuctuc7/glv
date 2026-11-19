'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createReadScope}=require('../lib/glv-mad-v2-read-scope.cjs');
const publication=require('../lib/glv-history-publication.cjs'),storage=require('../lib/glv-mad-v2-storage.cjs');
const runtime=require('../lib/glv-mad-v2-isolated.cjs');
const {memory}=require('./fixtures/mad-v2-isolated.cjs');
function fixture(){
 const store=memory(),counts=new Map();
 const redis=async(...args)=>{if(args[0]==='GET')counts.set(args[1],(counts.get(args[1])||0)+1);return store.redis(...args);};
 const scoped=createReadScope(redis);
 const payload={range:{since:'2026-11-01',until:'2026-11-07'},value:'synthetic'};
 const key=runtime.PREFIX+'account:one:last_7d:piece:daily:'+publication.digest(payload);
 store.data.set(key,storage.encode(payload));return {...store,redis,scoped,counts,key,payload};
}
test('coalesces concurrent immutable reads without sharing mutable decoded objects or invocation state',async()=>{
 const f=fixture();await Promise.all(Array.from({length:8},()=>f.scoped('GET',f.key)));
 assert.equal(f.counts.get(f.key),1);
 const read=runtime.readValue(f.scoped),p=await read(f.key);p.value='mutated';
 assert.equal((await read(f.key)).value,'synthetic');
 await createReadScope(f.redis)('GET',f.key);assert.equal(f.counts.get(f.key),2);
});
test('mutable work, manifests, previous pointers, foreign namespaces and missing pieces never cache',async()=>{
 const f=fixture();
 for(const key of [runtime.PREFIX+'work:one:daily',runtime.combinedKey('last_7d'),runtime.combinedKey('last_7d')+':previous','foreign:'+f.key,f.key.replace(/.$/,'0')]){
  f.data.delete(key);assert.equal((await f.scoped('GET',key)).result,null);
  f.data.set(key,'changed');assert.equal((await f.scoped('GET',key)).result,'changed');
  assert.equal(f.counts.get(key),2);
 }
});
test('invalid digests and failed transport are not memoized; bounded capacity bypasses large entries',async()=>{
 const f=fixture();f.data.set(f.key,storage.encode({...f.payload,value:'corrupt'}));
 await f.scoped('GET',f.key);f.data.set(f.key,storage.encode(f.payload));
 await f.scoped('GET',f.key);await f.scoped('GET',f.key);assert.equal(f.counts.get(f.key),2);
 const limited=createReadScope(f.redis,{maxBytes:1});await limited('GET',f.key);await limited('GET',f.key);assert.equal(f.counts.get(f.key),4);
 let fail=true;const retry=createReadScope(async(...args)=>{if(fail){fail=false;throw Error('transport');}return f.redis(...args);});
 await assert.rejects(retry('GET',f.key),/transport/);assert.ok((await retry('GET',f.key)).result);
});
test('writes and scripts invalidate; delayed pre-write read cannot repopulate scope',async()=>{
 const f=fixture();let release,first=true;
 const scoped=createReadScope(async(...args)=>{const result=await f.redis(...args);if(first&&args[0]==='GET'){first=false;await new Promise(r=>{release=r;});}return result;});
 const pending=scoped('GET',f.key);while(!release)await new Promise(r=>setImmediate(r));
 await scoped('SET',f.key,storage.encode(f.payload));release();await pending;
 await scoped('GET',f.key);assert.equal(f.counts.get(f.key),2);
 await scoped('EVAL','return 1',0);await scoped('GET',f.key);assert.equal(f.counts.get(f.key),3);
});
test('GET during an outstanding SET cannot satisfy the mandatory post-write readback',async()=>{
 const f=fixture();let release;
 const scoped=createReadScope(async(...args)=>{if(args[0]==='SET')await new Promise(r=>{release=r;});return f.redis(...args);});
 const write=scoped('SET',f.key,storage.encode({...f.payload,value:'corrupt write'}));
 while(!release)await new Promise(r=>setImmediate(r));
 await scoped('GET',f.key);release();await write;
 assert.equal(storage.decode((await scoped('GET',f.key)).result).value,'corrupt write');
 assert.equal(f.counts.get(f.key),2);
});
test('real publication validates every reuse, follows switched pointers and retains hash-verified previous generation',async()=>{
 const f=fixture(),key=runtime.combinedKey('last_7d');let validations=0;
 const validate=pieces=>{validations++;assert.ok(publication.TYPES.every(t=>pieces[t].generation===pieces.daily.generation));};
 const seed=g=>{
  const pieces=Object.fromEntries(publication.TYPES.map(type=>[type,{...f.payload,type,generation:g}]));
  const refs=Object.fromEntries(publication.TYPES.map(type=>{const sha256=publication.digest(pieces[type]),k=`${key}:piece:${type}:${sha256}`;f.data.set(k,storage.encode(pieces[type]));return [type,{key:k,sha256}];}));
  const manifest={version:1,range:f.payload.range,refs};return {manifest,raw:storage.encode(manifest)};
 };
 const old=seed('old'),next=seed('new');f.data.set(key,old.raw);
 const read=()=>publication.readBundle({key,read:runtime.readValue(f.scoped),validate});
 assert.equal((await read()).daily.generation,'old');assert.equal((await read()).daily.generation,'old');assert.equal(validations,2);
 f.data.set(key,next.raw);assert.equal((await read()).daily.generation,'new');
 f.data.set(key+':previous',old.raw);
 // A new scope detects storage corruption rather than reusing prior invocation bytes.
 f.data.set(next.manifest.refs.ads.key,storage.encode({...f.payload,type:'ads',generation:'tampered'}));
 const fallback=await publication.readBundle({key,read:runtime.readValue(createReadScope(f.redis)),validate});assert.equal(fallback.daily.generation,'old');
 // Foreign-account reference cannot be satisfied by an already cached piece.
 const foreign=structuredClone(next.manifest);foreign.refs.daily.key=foreign.refs.daily.key.replace('published:','account:other:');
 f.data.set(key,storage.encode(foreign));f.data.delete(key+':previous');
 await assert.rejects(read(),/Invalid published reference/);
});
