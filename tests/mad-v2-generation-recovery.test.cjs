const test=require('node:test'),assert=require('node:assert/strict');
const cache=require('../lib/glv-mad-v2-cache.cjs'),source=require('../lib/glv-mad-v2-source.cjs'),v2=require('../lib/glv-mad-v2.cjs'),ui=require('../public/glv-meta-ads-v2/freshness.js');
test('partial retry certifies a displayable generation without changing extraction timestamps',async()=>{
 const store=new Map(),first=new Date(Date.now()-300000),second=new Date(Date.now()-60000);
 const redis=async(cmd,key,value)=>{if(cmd==='SET'){store.set(key,value);return {result:'OK'};}return {result:cmd==='TTL'?-1:store.get(key)||null};};
 const fetcher=async url=>{const u=new URL(url),a=v2.ACCOUNTS.find(a=>u.pathname.includes(a.id));return {ok:true,status:200,json:async()=>u.pathname.endsWith('/insights')?{data:[]}:{account_id:a.id,currency:a.currency,timezone_name:a.timezone,account_status:1}};};
 const run=(now,fail=false)=>cache.refreshV2({token:'synthetic',now,clock:()=>+now,redis,fetcher,loadFx:async()=>({}),build:async opts=>{if(fail&&opts.type==='ads'&&opts.range.since===v2.rangeFor('last_30d',now).since)throw Error('synthetic failure');return source.buildSnapshot(opts);},promoPayload:async()=>({schema_version:1,classification_version:2,reconciled:true,generated_at:now.toISOString(),range:{since:'2026-03-01',until:v2.commonCutoff(now)},rows:[]})});
 assert.equal((await run(first,true)).verified,false);
 assert.equal((await run(second)).verified,true);
 const range=v2.rangeFor('last_30d',second),payloads=cache.TYPES.map(type=>{const s=require('../lib/glv-mad-v2-storage.cjs').decode(store.get(cache.presetKey(type,'last_30d')));return {...source.renderSnapshot(s,'USD'),...cache.cacheState(s,{type,range,now:second})};});
 assert.equal(payloads[0].generated_at,first.toISOString());
 assert.doesNotThrow(()=>ui.bundle(payloads,{range,currency:'USD',account:'All',now:+second}));
 assert.ok(payloads.every(p=>p.generation_id));
 assert.equal((await run(new Date(+second+30000))).verified,true);
 const handler=require('../api/glv-meta-ads-v2/fb-data.js'),saved={...process.env},originalFetch=global.fetch;
 try{
  process.env.GLV_MAD_V2_ENABLED='1';process.env.GLV_META_BETA_AUTH_TOKEN='synthetic';process.env.KV_REST_API_URL='https://redis.test';process.env.KV_REST_API_TOKEN='synthetic';delete process.env.UPSTASH_REDIS_REST_URL;delete process.env.UPSTASH_REDIS_REST_TOKEN;
  global.fetch=async url=>{assert.ok(String(url).startsWith('https://redis.test/get/'));const key=decodeURIComponent(String(url).split('/get/')[1]);return {ok:true,json:async()=>({result:store.get(key)||null})};};
  const responses=[];
  for(const type of cache.TYPES){const res={code:200,setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;}};await handler({method:'GET',headers:{cookie:'glv_meta_beta=synthetic'},query:{type,date_preset:'last_30d'}},res);assert.equal(res.code,200);responses.push(res.body);}
  assert.doesNotThrow(()=>ui.bundle(responses,{range,currency:'USD',account:'All'}));
 }finally{global.fetch=originalFetch;for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
});
