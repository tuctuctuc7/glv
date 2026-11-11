const test=require('node:test'),assert=require('node:assert/strict');
const cron=require('../api/glv-meta-ads/cron.js')._test,api=require('../api/glv-meta-ads/fb-data.js');
const {monthRange}=require('../lib/glv-meta-dates.cjs');
function harness(){
 const store=new Map(),ttl=new Map(),commands=[];
 const fetcher=async(url,opts)=>{
  if(String(url).startsWith('https://redis.test')){
   const [cmd,key,value,...args]=opts?.body?JSON.parse(opts.body):['GET',decodeURIComponent(String(url).split('/get/')[1])];commands.push([cmd,key,...args]);
   let result;if(cmd==='SET'){store.set(key,value);ttl.set(key,args.includes('EX')?90000:-1);result='OK';}else if(cmd==='PERSIST'){ttl.set(key,-1);result=1;}else if(cmd==='TTL')result=ttl.get(key)??-2;else result=store.get(key)||null;
   return {ok:true,status:200,json:async()=>({result})};
  }
  throw Error('Meta offline');
 };
 const range={since:'2026-10-09',until:'2026-11-07'},generated_at='2026-11-08T12:00:00Z';
 for(const type of ['daily','aggregate','ads']){const payload={rows:[],creator_version:2,creator_ad_version:1,creator_reconciliation_version:1,wl_version:3,range,generated_at};store.set(`glv:${type}:last_30d`,JSON.stringify(payload));ttl.set(`glv:${type}:last_30d`,90000);}
 return {store,ttl,commands,fetcher,range};
}
async function environment(fn){const saved={...process.env},fetch=global.fetch;Object.assign(process.env,{KV_REST_API_URL:'https://redis.test',KV_REST_API_TOKEN:'test',FB_ACCESS_TOKEN:'test'});delete process.env.UPSTASH_REDIS_REST_URL;delete process.env.UPSTASH_REDIS_REST_TOKEN;try{await fn();}finally{global.fetch=fetch;for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}}
test('V1 migrates all three last-good preset keys to durable storage before failed source work',()=>environment(async()=>{
 const h=harness(),before=new Map(h.store);
 const result=await cron.fetchAndCache('synthetic','last_30d',false,h.fetcher);
 assert.equal(result.errors.length,3);
 for(const [key,bytes] of before){assert.equal(h.store.get(key),bytes);assert.equal(h.ttl.get(key),-1,'valid historical caches must not expire after failed refresh');}
 assert.ok(h.store.has('glv:published:last_30d'));
}));
test('V1 serves explicit prior coverage after two missed days, even without a Meta token',()=>environment(async()=>{
 const h=harness();global.fetch=h.fetcher;delete process.env.FB_ACCESS_TOKEN;delete process.env.GLV_META_FB_ACCESS_TOKEN;
 for(const type of ['daily','aggregate','ads']){
  const res={code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(body){this.body=body;}};
  await api({method:'GET',query:{type,date_preset:'last_30d'}},res);
  assert.equal(res.code,200);assert.equal(res.body.stale,true);assert.equal(res.body.coverage_complete,false);assert.deepEqual(res.body.range,h.range);assert.deepEqual(res.body.requested_range,monthRange('last_30d',false));assert.equal(res.headers['X-Cache'],'STALE');
 }
}));
module.exports={harness,environment};
test('malformed legacy rows are rejected without blocking retention of other valid pieces',()=>environment(async()=>{
 const h=harness(),p=JSON.parse(h.store.get('glv:daily:last_30d'));p.rows=[null];h.store.set('glv:daily:last_30d',JSON.stringify(p));
 const result=await cron.fetchAndCache('synthetic','last_30d',false,h.fetcher);
 assert.equal(h.ttl.get('glv:ads:last_30d'),-1);assert.equal(h.ttl.get('glv:aggregate:last_30d'),-1);
 assert.ok(result.errors.every(e=>!e.startsWith('retention/')));
}));
test('V1 malformed ad metrics never overwrite the previous ads snapshot',()=>environment(async()=>{
 const h=harness(),before=h.store.get('glv:ads:last_30d');
 const fetcher=async(url,opts)=>{
  if(String(url).startsWith('https://redis.test'))return h.fetcher(url,opts);
  const u=new URL(url);const rows=u.searchParams.get('level')==='ad'?[{ad_id:'1',ad_name:'Creative',campaign_id:'2',campaign_name:'TUC_002_US_Sales',adset_id:'3',adset_name:'AS',spend:'1'}]:[];
  return {ok:true,status:200,json:async()=>({data:rows})};
 };
 const result=await cron.fetchAndCache('synthetic','last_30d',false,fetcher);
 assert.ok(result.errors.some(e=>e.startsWith('ads/')));assert.equal(h.store.get('glv:ads:last_30d'),before);
}));
test('V1 failed one-piece replacement serves unchanged bundle, then same-day recovery publishes all three together',()=>environment(async()=>{
 const h=harness();let failAds=true;
 const fetcher=async(url,opts)=>{
  if(String(url).startsWith('https://redis.test'))return h.fetcher(url,opts);
  const u=new URL(url);return {ok:true,status:200,json:async()=>failAds&&u.searchParams.get('level')==='ad'?{}:{data:[]}};
 };
 const failed=await cron.fetchAndCache('synthetic','last_30d',false,fetcher);
 assert.ok(failed.errors.some(e=>e.startsWith('ads/')));
 const key='glv:published:last_30d',before=h.store.get(key);assert.ok(before);
 global.fetch=h.fetcher;
 for(const type of ['daily','aggregate','ads']){const res={code:200,setHeader(){},status(n){this.code=n;return this;},json(body){this.body=body;}};await api({method:'GET',query:{type,date_preset:'last_30d'}},res);assert.equal(res.code,200);assert.deepEqual(res.body.range,h.range);assert.ok(res.body.generation_id);}
 assert.equal(h.store.get(key),before);
 failAds=false;const recovered=await cron.fetchAndCache('synthetic','last_30d',false,fetcher);assert.deepEqual(recovered.errors,[]);assert.equal(recovered.stats.bundle_readback_verified,true);
 assert.notEqual(h.store.get(key),before);assert.equal(h.store.get(`${key}:previous`),before);
 const pieces=await require('../lib/glv-history-v1.cjs').readPublished(async k=>JSON.parse(h.store.get(k)||'null'),'last_30d');
 assert.equal(new Set(Object.values(pieces).map(p=>p.generation_id)).size,1);
 assert.deepEqual(pieces.daily.range,monthRange('last_30d',false));
}));
test('V1 malformed campaign required fields never replace last-good with invented zeros',()=>environment(async()=>{
 const h=harness(),before=h.store.get('glv:daily:last_30d'),range=monthRange('last_30d',false);
 const fetcher=async(url,opts)=>{
  if(String(url).startsWith('https://redis.test'))return h.fetcher(url,opts);
  const u=new URL(url),daily=u.searchParams.has('time_increment'),ad=u.searchParams.get('level')==='ad';
  return {ok:true,status:200,json:async()=>({data:ad?[]:[{campaign_id:'1',campaign_name:'TUC_001_US_Sales',date_start:daily?range.until:range.since,date_stop:range.until,impressions:'10',reach:'2'}]})};
 };
 const result=await cron.fetchAndCache('synthetic','last_30d',false,fetcher);
 assert.ok(result.errors.some(e=>e.startsWith('daily/')));
 assert.equal(h.store.get('glv:daily:last_30d'),before);
}));
test('V1 shared force intent remains pending after failure and disables rolling reuse on normal recovery',()=>environment(async()=>{
 const h=harness();global.fetch=h.fetcher;delete process.env.GLV_MAD_V2_ENABLED;
 const prior=JSON.parse(h.store.get('glv:daily:last_30d'));prior.range=monthRange('last_90d',false);h.store.set('glv:daily:last_90d',JSON.stringify(prior));h.ttl.set('glv:daily:last_90d',90000);
 await cron.runRefresh('synthetic',false,{fullHistory:true,timeoutMs:3000});
 const marker=h.store.get('glv:history:force');assert.ok(marker,'force intent must survive failure before source completion');assert.equal(JSON.parse(marker).status,'pending');
 let calls=0;const ranges=[];
 global.fetch=async(url,opts)=>{
  if(String(url).startsWith('https://redis.test'))return h.fetcher(url,opts);
  const u=new URL(url);if(u.searchParams.has('time_increment')&&u.searchParams.get('level')==='campaign'){calls++;ranges.push(JSON.parse(u.searchParams.get('time_range')));}
  return {ok:false,status:400,json:async()=>({error:{code:100}})};
 };
 await cron.runRefresh('synthetic',false,{timeoutMs:3000});
 assert.ok(calls);assert.ok(ranges.some(r=>r.since===prior.range.since&&r.until===prior.range.until));assert.equal(h.store.get('glv:history:force'),marker);
}));
test('V1 daily rolling replacement retains old days and recovers missed days without reloading 90-day source',()=>environment(async()=>{
 const h=harness(),{shift}=require('../lib/glv-mad-v2.cjs'),range=monthRange('last_90d',false),until=shift(range.until,-3),oldRange={since:shift(range.since,-3),until};
 const prior=JSON.parse(h.store.get('glv:daily:last_30d'));
 prior.range=oldRange;prior.generated_at=new Date(Date.now()-3*86400000).toISOString();prior.rows=[];
 for(let day=oldRange.since;day<=until;day=shift(day,1))prior.rows.push({id:'1',name:'TUC_001_US_Sales',date_start:day,date_stop:day,amount_spent:'1',impressions:'10',reach:'3'});
 h.store.set('glv:daily:last_90d',JSON.stringify(prior));h.ttl.set('glv:daily:last_90d',90000);
 const requests=[];
 const fetcher=async(url,opts)=>{
  if(String(url).startsWith('https://redis.test'))return h.fetcher(url,opts);
  const u=new URL(url),r=JSON.parse(u.searchParams.get('time_range')),daily=u.searchParams.has('time_increment'),ad=u.searchParams.get('level')==='ad';if(daily)requests.push(r);
  const rows=[];if(!ad)for(let day=r.since;day<=r.until;day=shift(day,1)){rows.push({campaign_id:'1',campaign_name:'TUC_001_US_Sales',date_start:day,date_stop:daily?day:r.until,spend:'2',impressions:'10',reach:daily?'3':'11'});if(!daily)break;}
  return {ok:true,status:200,json:async()=>({data:rows})};
 };
 const result=await cron.fetchAndCache('synthetic','last_90d',false,fetcher);assert.deepEqual(result.errors,[]);
 assert.deepEqual(requests,[{since:shift(range.until,-6),until:range.until}]);
 const actual=JSON.parse(h.store.get('glv:daily:last_90d'));
 assert.equal(actual.rows.find(r=>r.date_start===shift(range.until,-7)).amount_spent,'1');
 assert.equal(actual.rows.find(r=>r.date_start===shift(range.until,-6)).amount_spent,'2');
 assert.equal(actual.rows.length,new Set(actual.rows.map(r=>r.date_start)).size);
 assert.equal(JSON.parse(h.store.get('glv:aggregate:last_90d')).rows[0].reach,'11');
 assert.ok(actual.source_extractions.some(s=>s.generated_at===prior.generated_at));
}));
test('shared owner retains every standard preset before any network extraction can exhaust the budget',()=>environment(async()=>{
 const h=harness(),presets=['last_7d','last_14d','last_30d','last_90d','this_month','last_month'];
 for(const p of presets)for(const t of ['daily','aggregate','ads']){const k=`glv:${t}:${p}`;h.store.set(k,h.store.get(`glv:${t}:last_30d`));h.ttl.set(k,90000);}
 let sourceCalls=0,retainedBeforeSource=true;
 global.fetch=async(url,opts)=>{
  if(String(url).startsWith('https://redis.test'))return h.fetcher(url,opts);
  sourceCalls++;
  retainedBeforeSource&&=[...h.ttl].filter(([k])=>/^glv:(daily|aggregate|ads):/.test(k)).every(([,ttl])=>ttl===-1);
  return {ok:false,status:400,json:async()=>({error:{code:100}})};
 };
 delete process.env.GLV_MAD_V2_ENABLED;
 const result=await cron.runRefresh('synthetic',false,{timeoutMs:2000});
 assert.ok(result.allErrors.length);assert.ok(sourceCalls);assert.equal(retainedBeforeSource,true);
}));
