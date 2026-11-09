const test=require('node:test'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const cache=require('../lib/glv-mad-v2-cache.cjs');
const hash=s=>createHash('sha256').update(s).digest('hex');
const {gzipSync}=require('node:zlib');
test('codec rejects corrupt, oversized, bomb and invalid schema envelopes without leaking contents',()=>{
 const s=require('../lib/glv-mad-v2-storage.cjs');
 const bytes=s.encode({safe:'synthetic'}),env=JSON.parse(bytes);
 const rejects=value=>assert.throws(()=>s.decode(typeof value==='string'?value:JSON.stringify(value)),/^Error: V2 cache storage (invalid|size limit)$/);
 for(const patch of [{version:2},{encoding:'brotli'},{sha256:'0'.repeat(64)},{raw_bytes:1},{data:'!!!!'},{data:'AAAA'},{extra:'synthetic-secret'},{raw_bytes:s.MAX_RAW_BYTES+1}])rejects({...env,...patch});
 rejects('{synthetic-secret');rejects('null');rejects('[]');rejects('"synthetic-secret"');
 const bomb=Buffer.alloc(s.MAX_RAW_BYTES+1,32);
 rejects({...env,data:gzipSync(bomb).toString('base64'),raw_bytes:100});
 const invalid=Buffer.from('"synthetic-secret"');rejects({...env,data:gzipSync(invalid).toString('base64'),raw_bytes:invalid.length,sha256:hash(invalid)});
 rejects({...env,data:'A'.repeat(s.MAX_ENCODED_BYTES)});
 assert.throws(()=>s.encode({noise:require('node:crypto').randomBytes(s.MAX_ENCODED_BYTES).toString('base64')}),/size limit/);
 assert.throws(()=>s.encode({large:'x'.repeat(s.MAX_RAW_BYTES)}),/size limit/);
 assert.deepEqual(s.decode('{"legacy":true}'),{legacy:true});
});
// Generated in memory only: repetitive daily ad facts, not production samples.
function largeFixture(){
 const row={ad_id:'123456789',campaign_id:'987654321',ad_name:'Synthetic creator video prospecting',campaign_name:'Synthetic campaign',date_start:'2026-11-08',date_stop:'2026-11-08',spend:'12.34',impressions:'1234',actions:[{action_type:'purchase',value:'2'}],action_values:[{action_type:'purchase',value:'98.76'}],partnership:{status:'verified',evidence:['synthetic metadata']}};
 return {version:1,chunks:{synthetic:{rows:Array.from({length:40000},(_,i)=>({...row,ad_id:String(123456789+i)}))}},metadata:{}};
}
test('15MB+ synthetic checkpoint roundtrips through bounded compressed publish and exact byte receipt',async t=>{
 const payload=largeFixture(),raw=JSON.stringify(payload);assert.ok(Buffer.byteLength(raw)>15000000);
 const store=new Map(),calls=[];
 const redis=async(cmd,key,value)=>{calls.push(cmd);if(cmd==='SET'){assert.ok(Buffer.byteLength(value)<=4*1024*1024);store.set(key,value);return {result:'OK'};}return {result:cmd==='TTL'?-1:store.get(key)};};
 const receipt=await cache.publish(redis,'synthetic',payload);
 const storage=require('../lib/glv-mad-v2-storage.cjs'),bytes=store.get('synthetic');
 assert.ok(Buffer.byteLength(bytes)<Buffer.byteLength(raw)/5);assert.deepEqual(storage.decode(bytes),payload);
 assert.deepEqual(storage.decode(raw),payload,'legacy values above the new wire cap remain readable');
 assert.equal(receipt,hash(bytes));assert.notEqual(receipt,hash(raw));assert.deepEqual(calls,['SET','GET','TTL']);
 t.diagnostic(`Synthetic raw=${Buffer.byteLength(raw)} encoded=${Buffer.byteLength(bytes)} bytes`);
});
test('false SET acknowledgement, altered transport bytes and expiry cannot certify a publish',async()=>{
 const s=require('../lib/glv-mad-v2-storage.cjs'),old=s.encode({last_good:true});
 let bytes=old;
 await assert.rejects(cache.publish(async cmd=>({result:cmd==='SET'?'OK':cmd==='GET'?bytes:-1}),'test',{next:true}),/readback/);
 assert.equal(bytes,old);
 for(const ttl of [0,60,-2,null]){
  const redis=async(cmd,key,value)=>{if(cmd==='SET'){bytes=value;return {result:'OK'};}return {result:cmd==='GET'?bytes:ttl};};
  await assert.rejects(cache.publish(redis,'test',{next:true}),/retention/);
 }
 await assert.rejects(cache.publish(async(cmd,key,value)=>{if(cmd==='SET'){bytes=value;return {result:'OK'};}return {result:cmd==='GET'?bytes+' ':-1};},'test',{next:true}),/readback/);
 let calls=0;bytes=old;
 await assert.rejects(cache.publish(async()=>{calls++;},'test',{noise:require('node:crypto').randomBytes(s.MAX_ENCODED_BYTES).toString('base64')}),/size limit/);
 assert.equal(calls,0);assert.equal(bytes,old);
});
