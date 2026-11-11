const test=require('node:test'),assert=require('node:assert/strict');
const cache=require('../lib/glv-mad-v2-cache.cjs'),source=require('../lib/glv-mad-v2-source.cjs'),v2=require('../lib/glv-mad-v2.cjs'),storage=require('../lib/glv-mad-v2-storage.cjs');
const {createHash}=require('node:crypto');const hash=b=>createHash('sha256').update(b).digest('hex');
test('real refresh, compressed work resume, mixed legacy generations and HTTP readers compose',async()=>{
 const now=new Date(Date.now()-60000),store=new Map();let adsPulls=0,ignoreWrites=false;
 const redis=async(cmd,key,value)=>{if(cmd==='SET'){if(!ignoreWrites)store.set(key,value);return {result:'OK'};}return {result:cmd==='TTL'?-1:store.get(key)||null};};
 const fetcher=async url=>{const u=new URL(url),a=v2.ACCOUNTS.find(a=>u.pathname.includes(a.id));let body;
  if(u.pathname.endsWith('/insights')){if(u.searchParams.get('level')==='ad')adsPulls++;body={data:[]};}
  else body={account_id:a.id,currency:a.currency,timezone_name:a.timezone,account_status:1};
  return {ok:true,status:200,json:async()=>body};
 };
 const options={token:'synthetic',now,clock:()=>+now,redis,fetcher,loadFx:async()=>({}),promoPayload:async()=>({schema_version:1,classification_version:2,reconciled:true,generated_at:now.toISOString(),range:{since:'2026-03-01',until:v2.commonCutoff(now)},rows:[]})};
 const first=await cache.refreshV2(options);assert.equal(first.verified,true);assert.ok(adsPulls>0);
 const workKey=source.CACHE_PREFIX+'work:ads';assert.equal(JSON.parse(store.get(workKey)).encoding,'gzip+base64');assert.ok(Object.keys(storage.decode(store.get(workKey)).chunks).length>0);
 const ids=new Map();
 for(const key of cache.requiredKeys()){
  const bytes=store.get(key),native=storage.decode(bytes);assert.equal(first.hashes[key],hash(bytes));
  if(native.generation_id){ids.set(key,native.generation_id);const {generation_id,generation_manifest,...payload}=native;assert.equal(generation_id,hash(JSON.stringify(generation_manifest)));assert.equal(generation_manifest.sources.find(s=>s.type===native.type).digest,hash(JSON.stringify(payload)));}
 }
 // Force a new refresh invocation to load durable compressed checkpoints.
 for(const preset of cache.PRESETS)store.delete(cache.presetKey('ads',preset));
 adsPulls=0;assert.equal((await cache.refreshV2(options)).verified,true);assert.equal(adsPulls,0);
 // Legacy plain JSON and compressed pieces must retain the same logical ID.
 for(const preset of cache.PRESETS){const key=cache.presetKey('daily',preset);store.set(key,JSON.stringify(storage.decode(store.get(key))));}
 const mixed=await cache.refreshV2({...options,build:async()=>{throw Error('must reuse');}});assert.equal(mixed.verified,true);
 for(const [key,id] of ids){assert.equal(storage.decode(store.get(key)).generation_id,id);assert.equal(mixed.hashes[key],hash(store.get(key)));}
 const saved={...process.env},original=global.fetch,handler=require('../api/glv-meta-ads-v2/fb-data.js');
 try{
  process.env.GLV_MAD_V2_ENABLED='1';process.env.GLV_META_BETA_AUTH_TOKEN='synthetic';process.env.KV_REST_API_URL='https://redis.test';process.env.KV_REST_API_TOKEN='synthetic';delete process.env.UPSTASH_REDIS_REST_URL;delete process.env.UPSTASH_REDIS_REST_TOKEN;
  global.fetch=async url=>{assert.ok(String(url).startsWith('https://redis.test/get/'));return {ok:true,json:async()=>({result:store.get(decodeURIComponent(String(url).split('/get/')[1]))})};};
  const read=async type=>{const res={code:200,setHeader(){},status(c){this.code=c;return this;},json(b){this.body=b;}};await handler({method:'GET',headers:{cookie:'glv_meta_beta=synthetic'},query:{type,date_preset:'last_30d'}},res);return res;};
  for(const type of [...cache.TYPES,'promo_formats','promo_concepts']){const res=await read(type);assert.equal(res.code,200);assert.equal(res.body.complete,true);}
  const key=cache.presetKey('ads','last_30d'),bytes=store.get(key),published=(await read('ads')).body;
  // Corrupt staging cannot replace the independent validated last-good bundle.
  for(const corrupt of [JSON.stringify({...JSON.parse(bytes),sha256:'0'.repeat(64)}),storage.encode({schema_version:99})]){
   store.set(key,corrupt);const retained=await read('ads');assert.equal(retained.code,200);assert.deepEqual(retained.body,published);
   const publicationKey=cache.bundleKey('last_30d'),manifestBytes=store.get(publicationKey),previous=store.get(publicationKey+':previous');
   store.delete(publicationKey);store.delete(publicationKey+':previous');
   assert.equal((await read('ads')).code,503,'without a publication, malformed legacy staging still fails closed');
   store.set(publicationKey,manifestBytes);if(previous)store.set(publicationKey+':previous',previous);
  }
  store.set(key,bytes);
  // Corruption of the actual published piece still fails closed.
  const manifest=storage.decode(store.get(cache.bundleKey('last_30d'))),pieceKey=manifest.refs.ads.key,piece=store.get(pieceKey);
  for(const corrupt of [JSON.stringify({...JSON.parse(piece),sha256:'0'.repeat(64)}),storage.encode({schema_version:99})]){
   store.set(pieceKey,corrupt);const failedRead=await read('ads');assert.equal(failedRead.code,502);assert.equal(failedRead.body.complete,false);assert.equal(failedRead.body.rows,undefined);
  }
  store.set(pieceKey,piece);assert.equal((await read('ads')).code,200);
 }finally{global.fetch=original;for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
 // An acknowledged no-op SET cannot replace last-good or earn a new receipt.
 const before=[...store];ignoreWrites=true;
 const failed=await cache.refreshV2({...options,force:true,now:new Date(+now+1000),clock:()=>+now+1000});
 assert.equal(failed.verified,false);assert.ok(failed.errors.length>0);assert.deepEqual([...store],before);
 for(const key of ids.keys())assert.equal(failed.hashes[key],undefined);
});
