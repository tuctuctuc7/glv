const test=require('node:test'),assert=require('node:assert/strict');
const handler=require('../api/glv-meta-ads-v2/fb-data.js'),v2=require('../lib/glv-mad-v2.cjs');
function response(){return {code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(body){this.body=body;}};}
test('preset/history misses make zero Meta pulls; stale coverage is explicit; future data fails closed',async()=>{
 const saved={...process.env},originalFetch=global.fetch;
 process.env.GLV_MAD_V2_ENABLED='1';process.env.GLV_META_BETA_AUTH_TOKEN='synthetic-auth';process.env.KV_REST_API_URL='https://redis.test';process.env.KV_REST_API_TOKEN='synthetic';
 delete process.env.UPSTASH_REDIS_REST_URL;delete process.env.UPSTASH_REDIS_REST_TOKEN;
 let payload=null,calls=0;const store=new Map();
 global.fetch=async url=>{assert.ok(String(url).startsWith('https://redis.test/'));calls++;const key=decodeURIComponent(String(url).split('/get/')[1]);return {ok:true,json:async()=>({result:store.get(key)||null})};};
 const read=async type=>{const res=response();await handler({method:'GET',headers:{cookie:'glv_meta_beta=synthetic-auth'},query:{type}},res);return res;};
 try{
  for(const type of ['daily','aggregate','ads','promo_formats','promo_concepts'])assert.equal((await read(type)).code,503);
  assert.ok(calls>0); // All calls above are Redis; no Meta fallback.
  payload={schema_version:1,complete:true,type:'daily',generation_id:'synthetic-coherent-generation',generated_at:new Date(Date.now()-100000000).toISOString(),range:{since:'2026-01-01',until:'2026-01-02'},fx:{},accounts:v2.ACCOUNTS.map(a=>({...a,rows:[]}))};
  const publish=()=>require('./helpers/mad-shared-fixture.cjs').publishSyntheticShared(store,'last_30d',Object.fromEntries(['daily','aggregate','ads'].map(type=>[type,{...payload,type}])));
  await publish();
  const res=await read('daily');assert.equal(res.code,200);assert.equal(res.body.stale,true);assert.equal(res.body.coverage_complete,false);assert.equal(res.headers['X-Cache'],'STALE');
  payload.generated_at='2099-01-01T00:00:00Z';await assert.rejects(publish());assert.equal((await read('daily')).code,200,'invalid future publication preserves last-good');
 }finally{global.fetch=originalFetch;for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);}
});
const {buildSnapshot}=require('../lib/glv-mad-v2-source.cjs');
const range={since:'2026-11-08',until:'2026-11-08'},fx={};
const base=async url=>{const u=new URL(url),account=v2.ACCOUNTS.find(a=>u.pathname.includes(a.id));return {ok:true,json:async()=>u.pathname.endsWith('/insights')?{data:[]}:{account_id:account.id,currency:account.currency,timezone_name:account.timezone,account_status:1}};};
test('non-JSON 503 retries; malformed 200 and auth errors fail closed without retry',async()=>{
 for(const status of [503,200,403]){
  let calls=0;
  const fetcher=async url=>{calls++;if(calls===1)return {ok:status===200,status,json:async()=>{throw Error('not JSON');}};return base(url);};
  if(status===503){assert.equal((await buildSnapshot({range,type:'daily',token:'synthetic',fetcher,fx})).complete,true);assert.ok(calls>1);}
  else {await assert.rejects(buildSnapshot({range,type:'daily',token:'synthetic',fetcher,fx}));assert.equal(calls,1);}
 }
});
test('malformed ad facts never publish fabricated zero spend',async()=>{
 const fetcher=async url=>new URL(url).pathname.endsWith('/insights')?{ok:true,json:async()=>({data:[{}]})}:base(url);
 await assert.rejects(buildSnapshot({range,type:'ads',token:'synthetic',fetcher,fx}),/Invalid ad/);
});
