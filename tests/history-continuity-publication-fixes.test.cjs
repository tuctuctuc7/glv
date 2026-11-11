const test=require('node:test'),assert=require('node:assert/strict');
const v1=require('../lib/glv-history-v1.cjs'),publication=require('../lib/glv-history-publication.cjs');
function storeHarness(){
 const data=new Map(),expires=new Map();let now=0,failCleanup=false;
 const read=async key=>data.get(key)||null;
 const write=async(key,value)=>{data.set(key,structuredClone(value));expires.delete(key);};
 const retire=async({key,refs})=>{
  if(failCleanup)throw Error('cleanup offline');
  const protectedKeys=new Set([data.get(key),data.get(`${key}:previous`)].flatMap(m=>Object.values(m?.refs||{}).map(r=>r.key)));
  for(const ref of refs)if(!protectedKeys.has(ref.key)&&data.has(ref.key))expires.set(ref.key,now+publication.GRACE_SECONDS*1000);
 };
 const publish=(n,extra={})=>publication.publishBundle({key:'test:published',pieces:Object.fromEntries(publication.TYPES.map(t=>[t,{range:{since:'2026-10-01',until:'2026-10-31'},n,t}])),validate:()=>{},read,write,retire,...extra});
 return {data,expires,read,write,publish,failCleanup:()=>{failCleanup=true;},advance(ms){now+=ms;for(const [key,at]of expires)if(at<=now){data.delete(key);expires.delete(key);}}};}
test('retired pieces have grace while current and previous bytes survive bounded repeated publications',async()=>{
 const h=storeHarness();await h.publish(1);const old=structuredClone(h.data.get('test:published'));
 await h.publish(2);await h.publish(3);
 assert.equal(h.expires.size,3);
 for(const ref of Object.values(old.refs))assert.ok(h.data.has(ref.key),'in-flight reader retains original bytes');
 for(let n=4;n<50;n++){h.advance(publication.GRACE_SECONDS*1000+1);await h.publish(n);assert.ok(h.data.size<=11);}
 for(const m of [h.data.get('test:published'),h.data.get('test:published:previous')])for(const ref of Object.values(m.refs)){assert.ok(h.data.has(ref.key));assert.ok(!h.expires.has(ref.key));}
});
test('Redis retirement filters exact refs and atomically guards both manifest bytes',async()=>{
 const h=storeHarness();await h.publish(1);const old=h.data.get('test:published');await h.publish(2);await h.publish(3);
 const calls=[];const redis=async(...args)=>{calls.push(args);if(args[0]==='GET')return {result:JSON.stringify(await h.read(args[1]))};return {result:1};};
 await publication.retireRedis(redis,JSON.parse)({key:'test:published',refs:[...Object.values(old.refs),{key:'unrelated',sha256:'bad'}]});
 const call=calls.find(c=>c[0]==='EVAL');assert.ok(call);assert.equal(call[2],5);
 assert.deepEqual(call.slice(3,8),['test:published','test:published:previous',...Object.values(old.refs).map(r=>r.key)]);
 assert.equal(call.at(-1),publication.GRACE_SECONDS);assert.match(call[1],/redis.call\('GET',KEYS\[1\]\)/);assert.match(call[1],/EXPIRE/);assert.doesNotMatch(call[1],/DEL|SCAN/);
});
test('cleanup errors do not fail publication or lose retained generations',async()=>{
 const h=storeHarness();await h.publish(1);await h.publish(2);h.failCleanup();await h.publish(3);
 const result=await publication.readBundle({key:'test:published',read:h.read,validate:()=>{}});assert.equal(result.daily.n,3);
 assert.equal(h.data.get('test:published:previous').refs.daily.sha256,publication.digest({range:{since:'2026-10-01',until:'2026-10-31'},n:2,t:'daily'}));
});
test('failed writes retire only orphan bytes and readers see the old bundle during publication',async()=>{
 const h=storeHarness();await h.publish(1);const before=structuredClone(h.data.get('test:published'));
 await assert.rejects(h.publish(2,{write:async(key,value)=>{
  const visible=await publication.readBundle({key:'test:published',read:h.read,validate:()=>{}});assert.equal(visible.daily.n,1);
  await h.write(key,value);if(key.includes(':piece:aggregate:'))throw Error('uncertain write');
 }}),/uncertain write/);
 assert.deepEqual(h.data.get('test:published'),before);assert.equal(h.expires.size,2);
 h.advance(publication.GRACE_SECONDS*1000+1);assert.equal(h.data.size,4);
 assert.equal((await publication.readBundle({key:'test:published',read:h.read,validate:()=>{}})).daily.n,1);
});
test('republishing a retired content hash clears its scheduled expiry',async()=>{
 const h=storeHarness();await h.publish(1);await h.publish(2);await h.publish(3);assert.equal(h.expires.size,3);
 await h.publish(1);h.advance(publication.GRACE_SECONDS*1000+1);
 const result=await publication.readBundle({key:'test:published',read:h.read,validate:()=>{}});assert.equal(result.daily.n,1);
 for(const ref of Object.values(h.data.get('test:published').refs))assert.ok(!h.expires.has(ref.key));
});
test('eight runs per day retain only the grace window plus current and previous',async()=>{
 const h=storeHarness();for(let n=0;n<160;n++){await h.publish(n);h.advance(3*60*60*1000);assert.ok(h.data.size<=80);}
 assert.equal(h.expires.size,69);assert.equal(h.data.size,77);
});
test('V1 route never serves individually valid but incoherent legacy pieces',async()=>{
 const api=require('../api/glv-meta-ads/fb-data.js'),saved={...process.env},oldFetch=global.fetch,pieces=legacy();
 try{
  for(const k of ['FB_ACCESS_TOKEN','GLV_META_FB_ACCESS_TOKEN','AGENTHIC_META_ACCESS_TOKEN','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN'])delete process.env[k];
  Object.assign(process.env,{KV_REST_API_URL:'https://redis.test',KV_REST_API_TOKEN:'synthetic'});
  pieces.aggregate.generated_at='2026-11-10T12:00:00Z';
  global.fetch=async url=>{const key=decodeURIComponent(String(url).split('/get/')[1]);return {ok:true,json:async()=>({result:key.startsWith('glv:published:')?null:JSON.stringify(pieces[key.split(':')[1]])})};};
  for(const type of publication.TYPES){const res={code:200,setHeader(){},status(n){this.code=n;return this;},json(body){this.body=body;}};await api({method:'GET',query:{type,date_preset:'last_month'}},res);assert.equal(res.code,503);assert.ok(!res.body.rows);}
 }finally{global.fetch=oldFetch;for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
});
test('retirement candidate work is bounded even with extra stored manifest fields',async()=>{
 const h=storeHarness();await h.publish(1);await h.publish(2);
 const previous=h.data.get('test:published:previous');for(let n=0;n<100;n++)previous.refs[`extra${n}`]={key:`extra${n}`};
 let count=0;await h.publish(3,{retire:async({refs})=>{count=refs.length;}});assert.ok(count<=6);
});
test('a reader paused after manifest lookup completes across retirement within grace',async()=>{
 const h=storeHarness();await h.publish(1);let resume,seen;const started=new Promise(r=>{seen=r;}),gate=new Promise(r=>{resume=r;});
 const reading=publication.readBundle({key:'test:published',validate:()=>{},read:async key=>{const value=await h.read(key);if(key==='test:published'){seen();await gate;}return value;}});
 await started;await h.publish(2);await h.publish(3);h.advance(publication.GRACE_SECONDS*1000-1);resume();
 assert.equal((await reading).daily.n,1);
});
function legacy(){return Object.fromEntries(publication.TYPES.map(type=>[type,{rows:[],creator_version:2,creator_ad_version:1,creator_reconciliation_version:1,wl_version:3,range:{since:'2026-10-01',until:'2026-10-31'},generated_at:'2026-11-08T12:00:00Z'}]));}
test('legacy V1 reads require a complete coherent triplet and assign one deterministic generation',async()=>{
 const pieces=legacy(),read=async key=>pieces[key.split(':')[1]]||null;
 const first=await v1.readLegacy(read,'last_month');
 assert.ok(first.daily.generation_id);assert.equal(new Set(Object.values(first).map(p=>p.generation_id)).size,1);
 assert.deepEqual(await v1.readLegacy(read,'last_month'),first);
 pieces.aggregate.generated_at='2026-11-10T12:00:00Z';
 assert.equal(await v1.readLegacy(read,'last_month'),null);
 pieces.aggregate.generated_at=pieces.daily.generated_at;delete pieces.ads;
 assert.equal(await v1.readLegacy(read,'last_month'),null);
});
test('V2 legacy reader rejects mixed generations and incomplete triplets',async()=>{
 const cache=require('../lib/glv-mad-v2-cache.cjs'),v2=require('../lib/glv-mad-v2.cjs');
 const pieces=Object.fromEntries(publication.TYPES.map(type=>[type,{schema_version:1,creator_ad_version:1,complete:true,type,range:{since:'2026-10-01',until:'2026-10-31'},generated_at:'2026-11-08T12:00:00Z',generation_id:'same',accounts:v2.ACCOUNTS.map(a=>({...a,rows:[],reach:[]})),fx:{}}]));
 const read=async key=>pieces[key.split(':').at(-2)]||null;
 assert.ok(await cache.readLegacy(read,'last_month'));
 pieces.ads.generation_id='different';assert.equal(await cache.readLegacy(read,'last_month'),null);
 pieces.ads.generation_id='same';delete pieces.daily;assert.equal(await cache.readLegacy(read,'last_month'),null);
});
