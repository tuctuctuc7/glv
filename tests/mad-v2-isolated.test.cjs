'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const v2=require('../lib/glv-mad-v2.cjs');
function memory(){const data=new Map();return {data,redis:async(cmd,key,value,...args)=>{if(cmd==='GET')return {result:data.get(key)||null};if(cmd==='TTL')return {result:data.has(key)?-1:-2};if(cmd==='SET'){if(args.includes('NX')&&data.has(key))return {result:null};data.set(key,value);return {result:'OK'};}if(cmd==='EVAL'){const lease=args[0],owner=args[1];if(data.get(lease)===owner)data.delete(lease);return {result:1};}throw Error(cmd);}};}
const snapshot=({account,range,type,now})=>({schema_version:1,creator_ad_version:1,complete:true,isolated_account_id:account.id,type,range,generated_at:now.toISOString(),accounts:[{...account,rows:[],reach:[]}],fx:{}});
test('morning publishes partial TGLV; late retains exact TUC and requests only TGLV',async()=>{
 const runtime=require('../lib/glv-mad-v2-isolated.cjs'),store=memory(),calls=[];
 const options={redis:store.redis,presets:['last_7d'],tokenFor:async a=>a.id,loadFx:async()=>({}),build:async o=>{calls.push({id:o.account.id,until:o.range.until});return snapshot(o);}};
 const morning=await runtime.refresh({...options,mode:'morning',now:new Date('2026-11-15T05:00:00Z')});
 assert.equal(morning.verified,true,JSON.stringify(morning));assert.equal(morning.through,'2026-11-14');
 const before=await runtime.readPreset(store.redis,'last_7d');
 assert.equal(before.daily.account_coverage.find(a=>a.account_id===v2.ACCOUNTS[1].id).partial,true);
 const tuc=JSON.stringify(before.daily.account_bundles[v2.ACCOUNTS[0].id]);calls.length=0;
 const late=await runtime.refresh({...options,mode:'late',now:new Date('2026-11-15T12:00:00Z')});
 assert.equal(late.verified,true,JSON.stringify(late));assert.ok(calls.length);assert.ok(calls.every(c=>c.id===v2.ACCOUNTS[1].id&&c.until==='2026-11-14'));
 const after=await runtime.readPreset(store.redis,'last_7d');assert.equal(JSON.stringify(after.daily.account_bundles[v2.ACCOUNTS[0].id]),tuc);
 assert.ok(after.daily.account_coverage.every(a=>a.partial===false));
 assert.ok([...store.data.keys()].every(k=>k.startsWith(runtime.PREFIX)));
 calls.length=0;assert.equal((await runtime.refresh({...options,mode:'late',now:new Date('2026-11-15T12:01:00Z')})).verified,true);assert.equal(calls.length,0);
 const generation=after.daily.generation_id;
 await runtime.refresh({...options,mode:'morning',now:new Date('2026-11-15T12:02:00Z')});assert.equal((await runtime.readPreset(store.redis,'last_7d')).daily.generation_id,generation);
 await runtime.refresh({...options,mode:'late',now:new Date('2026-11-15T05:00:00Z')});assert.equal((await runtime.readPreset(store.redis,'last_7d')).daily.generation_id,generation);
});
test('failed TGLV leaves TUC available with missing coverage and diagnostic bytes',async()=>{
 const runtime=require('../lib/glv-mad-v2-isolated.cjs'),store=memory();
 const r=await runtime.refresh({redis:store.redis,presets:['last_7d'],mode:'morning',token:'x',now:new Date('2026-11-15T05:00:00Z'),loadFx:async()=>({}),build:async o=>{if(o.account.label==='TGLV')throw Error('secret should not escape');return snapshot(o);}});
 assert.equal(r.verified,false);assert.ok(!JSON.stringify(r).includes('secret'));
 const readback=await runtime.readback({redis:store.redis,presets:['last_7d'],now:new Date('2026-11-15T05:00:00Z'),includePayload:true});
 assert.equal(readback.verified,false);assert.equal(readback.presets[0].account_coverage.find(c=>c.account_id===v2.ACCOUNTS[1].id).missing,true);
 assert.equal(readback.presets[0].payloads.USD.daily.date_policy,'account-isolated');
 assert.ok(readback.presets[0].digest);
});
test('bootstrap copies validated per-account history and reopens rolling ad correction without old writes',async()=>{
 const runtime=require('../lib/glv-mad-v2-isolated.cjs'),cache=require('../lib/glv-mad-v2-cache.cjs'),storage=require('../lib/glv-mad-v2-storage.cjs'),store=memory();
 const now=new Date('2026-11-15T05:00:00Z'),range={since:'2026-08-16',until:'2026-11-13'},before=new Map();
 for(const type of runtime.TYPES){const s={...snapshot({account:v2.ACCOUNTS[0],range,type,now:new Date('2026-11-14T12:00:00Z')}),accounts:v2.ACCOUNTS.map(a=>({...a,rows:[],reach:[]})),generation_id:'legacy'};delete s.isolated_account_id;const k=cache.presetKey(type,'last_90d');store.data.set(k,storage.encode(s));before.set(k,store.data.get(k));}
 const oldKey=require('../lib/glv-mad-v2-source.cjs').CACHE_PREFIX+'work:ads';store.data.set(oldKey,storage.encode({version:1,through:'2026-11-13',generated_at:'2026-11-14T12:00:00Z',chunks:Object.fromEntries(v2.ACCOUNTS.map(a=>[a.id,[{range,generated_at:'2026-11-14T12:00:00Z',rows:[]}]])),metadata:{},splits:{}}));before.set(oldKey,store.data.get(oldKey));
 const b=await runtime.bootstrap({redis:store.redis,account:v2.ACCOUNTS[1],presets:['last_90d'],now,through:'2026-11-14',mode:'late',intent:{id:'migration'}});
 assert.equal(b.history[0].accounts.length,1);assert.equal(b.history[0].generated_at,'2026-11-14T12:00:00.000Z');assert.equal(b.work.chunks[v2.ACCOUNTS[1].id][0].range.until,'2026-11-07');assert.equal(b.work.chunks[v2.ACCOUNTS[0].id],undefined);
 for(const [k,bytes]of before)assert.equal(store.data.get(k),bytes);
});
test('actual source Graph calls and authenticated handler follow isolated two-pass coverage',async()=>{
 const runtime=require('../lib/glv-mad-v2-isolated.cjs'),api=require('../api/glv-meta-ads-v2/fb-data.js'),store=memory(),calls=[];
 const options={redis:store.redis,presets:['last_7d'],token:'synthetic',loadFx:async()=>({}),fetcher:async url=>{calls.push(url);const u=new URL(url),account=v2.ACCOUNTS.find(a=>u.pathname.includes(a.id));assert.ok(account);return {ok:true,json:async()=>u.pathname.endsWith('/insights')?{data:[]}:{account_id:account.id,currency:account.currency,timezone_name:account.timezone,account_status:1}};}};
 assert.equal((await runtime.refresh({...options,mode:'morning',now:new Date('2026-11-15T05:00:00Z')})).verified,true);
 const originalRead=api._test.readCache,enabled=process.env.GLV_MAD_V2_ENABLED,auth=process.env.GLV_META_BETA_AUTH_TOKEN;
 process.env.GLV_MAD_V2_ENABLED='1';process.env.GLV_META_BETA_AUTH_TOKEN='synthetic-cookie';api._test.readCache=runtime.readValue(store.redis);
 try{const res={code:200,setHeader(){},status(n){this.code=n;return this;},json(body){this.body=body;return this;}};await api({method:'GET',headers:{cookie:'glv_meta_beta=synthetic-cookie'},query:{type:'daily',date_preset:'last_7d'}},res);assert.equal(res.code,200);assert.equal(res.body.date_policy,'account-isolated');assert.equal(res.body.account_coverage[1].partial,true);}finally{api._test.readCache=originalRead;if(enabled===undefined)delete process.env.GLV_MAD_V2_ENABLED;else process.env.GLV_MAD_V2_ENABLED=enabled;if(auth===undefined)delete process.env.GLV_META_BETA_AUTH_TOKEN;else process.env.GLV_META_BETA_AUTH_TOKEN=auth;}
 calls.length=0;assert.equal((await runtime.refresh({...options,mode:'late',now:new Date('2026-11-15T12:00:00Z')})).verified,true);assert.ok(calls.length);assert.ok(calls.every(u=>!u.includes(v2.ACCOUNTS[0].id)));
});
test('publication lease contention retains the exact prior bundle',async()=>{
 const runtime=require('../lib/glv-mad-v2-isolated.cjs'),store=memory();
 const opts={redis:store.redis,presets:['last_7d'],token:'x',loadFx:async()=>({}),build:snapshot,mode:'morning',now:new Date('2026-11-15T05:00:00Z')};
 await runtime.refresh(opts);const before=JSON.stringify(await runtime.readPreset(store.redis,'last_7d'));
 store.data.set(runtime.PREFIX+'publication-lease:last_7d','other');const result=await runtime.refresh(opts);
 assert.equal(result.verified,false);assert.equal(JSON.stringify(await runtime.readPreset(store.redis,'last_7d')),before);
});
test('total next-day outage serves prior actual range rather than an empty shifted bundle',async()=>{
 const runtime=require('../lib/glv-mad-v2-isolated.cjs'),reader=require('../lib/glv-mad-v2-isolated-reader.cjs'),store=memory();
 const opts={redis:store.redis,presets:['last_7d'],token:'x',loadFx:async()=>({}),build:snapshot,mode:'morning',now:new Date('2026-11-15T05:00:00Z')};
 await runtime.refresh(opts);const before=await runtime.readPreset(store.redis,'last_7d');
 assert.equal((await runtime.refresh({...opts,now:new Date('2026-11-16T05:00:00Z'),build:async()=>{throw Error('outage');}})).verified,false);
 const after=await runtime.readPreset(store.redis,'last_7d');assert.equal(after.daily.generation_id,before.daily.generation_id);
 const result=reader.render(after,{type:'aggregate',account:'All',currency:'USD',range:runtime.rangeFor('last_7d','2026-11-15')});assert.ok(result);assert.deepEqual(result.cached_range,before.daily.range);assert.equal(result.stale,true);
});
module.exports={memory,snapshot};
