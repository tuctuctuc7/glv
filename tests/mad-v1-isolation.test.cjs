'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Module=require('node:module');
const cron=require('../api/glv-meta-ads/cron.js'),api=require('../api/glv-meta-ads/fb-data.js');
function harness(){
 const store=new Map(),calls=[];
 const fetcher=async(url,options={})=>{
  const u=new URL(url);
  if(u.hostname==='redis.test'){
   const [cmd,key,value,...args]=options.body?JSON.parse(options.body):['GET',decodeURIComponent(u.pathname.slice(5))];calls.push([cmd,key]);
   let result=null;
   if(cmd==='SET'){if(args.includes('NX')&&store.has(key))result=null;else{store.set(key,value);result='OK';}}
   else if(cmd==='GET')result=store.get(key)||null;
   else if(cmd==='TTL')result=store.has(key)?-1:-2;
   else if(cmd==='PERSIST')result=store.has(key)?1:0;
   else if(cmd==='EVAL'){if(store.get(args[0])===args[1])store.delete(args[0]);result=1;}
   return {ok:true,status:200,json:async()=>({result})};
  }
  assert.equal(u.hostname,'graph.facebook.com');assert.ok(!u.pathname.includes('act_')||u.pathname.includes('act_359758259164738'),'only native TUC may be extracted');calls.push(['GRAPH',u.pathname,u.searchParams.get('time_range')]);
  return {ok:true,status:200,json:async()=>({data:[]})};
 };
 return {store,calls,fetcher};
}
async function isolated(fn){
 const oldLoad=Module._load,oldFetch=global.fetch,saved={...process.env};
 Object.assign(process.env,{GLV_MAD_V2_ENABLED:'1',KV_REST_API_URL:'https://redis.test',KV_REST_API_TOKEN:'synthetic',GLV_META_FB_ACCESS_TOKEN:'synthetic',CRON_SECRET:'synthetic'});
 delete process.env.UPSTASH_REDIS_REST_URL;delete process.env.UPSTASH_REDIS_REST_TOKEN;
 Module._load=function(name,...args){if(/glv-mad-(v2|shared)/.test(name))throw Error('V2 is unavailable');return oldLoad.call(this,name,...args);};
 try{await fn();}finally{Module._load=oldLoad;global.fetch=oldFetch;for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
}
function response(){return {code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(body){this.body=body;return this;}};}
test('native V1 refresh and durable readers succeed with enabled but unavailable V2',()=>isolated(async()=>{
 const h=harness();global.fetch=h.fetcher;
 const result=await cron._test.runRefresh('synthetic',false,{timeoutMs:10000});
 assert.deepEqual(result.allErrors,[]);assert.equal(result.freshness.all_tabs_verified,true);assert.equal(result.freshness.v2,undefined);
 assert.ok(Object.keys(result.hashes).every(k=>!k.includes('mad:')));
 for(const type of ['aggregate','daily','ads','promo_formats','promo_concepts']){
  const res=response();await api({method:'GET',query:{type,date_preset:type.startsWith('promo')?'promo_history':'last_30d'}},res);
  assert.equal(res.code,200);assert.ok(Array.isArray(res.body.rows));assert.equal(res.body.shared_generation_id,undefined);
 }
 assert.ok(h.calls.some(c=>c[1]==='glv:published:last_30d'));
}));
test('V1 owner records only native receipts and skips independently of V2 metadata and FX',()=>isolated(async()=>{
 const h=harness();global.fetch=h.fetcher;
 const req={headers:{authorization:'Bearer synthetic'},query:{}};
 const first=response();await cron(req,first);assert.equal(first.code,200);assert.equal(first.body.ok,true);
 const receipt=JSON.parse(h.store.get('glv:refresh:complete:v1'));
 assert.ok(receipt.freshness.all_tabs_verified);assert.ok(Object.keys(receipt.hashes).every(k=>!k.includes('mad:')));
 const count=h.calls.filter(c=>c[0]==='GRAPH').length;
 const again=response();await cron(req,again);assert.equal(again.body.skipped,'already_verified');
 assert.equal(h.calls.filter(c=>c[0]==='GRAPH').length,count);
}));
test('V1 completed-day dates follow Prague at UTC rollover and DST, not Los Angeles',()=>{
 for(const [now,until] of [['2026-11-14T23:30:00Z','2026-11-14'],['2026-03-29T22:30:00Z','2026-03-29'],['2026-10-25T23:30:00Z','2026-10-25']]){
  assert.equal(cron._test.monthRange('last_7d',false,new Date(now)).until,until);
  assert.equal(cron._test.cutoffDate(false,new Date(now)),until);
 }
 assert.deepEqual(cron._test.monthRange('last_month',false,new Date('2026-10-31T23:30:00Z')),{since:'2026-10-01',until:'2026-10-31'});
});
test('Prague-midnight refresh publishes presets and Promo through the same completed day',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-11-14T23:30:00Z')});
 await isolated(async()=>{
  const h=harness();global.fetch=h.fetcher;
  const result=await cron._test.runRefresh('synthetic',false,{timeoutMs:10000});
  assert.deepEqual(result.allErrors,[]);assert.equal(result.freshness.through,'2026-11-14');
  const res=response();await api({method:'GET',query:{type:'promo_formats',date_preset:'promo_history'}},res);
  assert.equal(res.code,200);assert.equal(res.body.range.until,'2026-11-14');
 });
});
test('independent owners cannot block or satisfy each other’s lease and receipt',async()=>{
 const {scheduledRefresh}=require('../lib/glv-refresh-owner.cjs');
 const h=harness(),redis=async(...args)=>(await h.fetcher('https://redis.test',{body:JSON.stringify(args)})).json();
 h.store.set('glv:refresh:lease:v1','busy-v1');
 let ran=false;
 const result=await scheduledRefresh({redis,keys:[],through:'2026-11-14',lockKey:'glv:refresh:lease:v2',stateKey:'glv:refresh:complete:v2',refresh:async()=>{ran=true;return {allErrors:[],hashes:{},freshness:{all_tabs_verified:true}};}});
 assert.equal(ran,true);assert.equal(result.skipped,undefined);assert.ok(h.store.has('glv:refresh:complete:v2'));assert.equal(h.store.has('glv:refresh:complete:v1'),false);assert.equal(h.store.get('glv:refresh:lease:v1'),'busy-v1');
});
test('optional TUC metadata refresh and readback work with V2 unavailable without changing performance receipt',()=>isolated(async()=>{
 const h=harness();global.fetch=h.fetcher;
 h.store.set('glv:refresh:complete:v1','performance-marker');
 const res=response();await cron({headers:{authorization:'Bearer synthetic'},query:{names_only:'1'}},res);
 assert.equal(res.code,200);assert.equal(res.body.campaign_metadata.readback_verified,true);
 assert.equal(h.store.get('glv:refresh:complete:v1'),'performance-marker');
 assert.ok(h.store.has('glv:v1:campaign-metadata:1'));assert.equal(h.store.has('glv:campaign-metadata:1'),false);
 assert.ok(h.calls.filter(c=>c[0]==='GRAPH').every(c=>c[1]==='/v21.0/act_359758259164738/campaigns'));
}));
test('V2 rollout disabled versus enabled produces identical native V1 bytes and requests',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-11-14T23:30:00Z')});
 await isolated(async()=>{
  const outputs=[];
  for(const flag of ['0','1']){
   process.env.GLV_MAD_V2_ENABLED=flag;
   const h=harness();global.fetch=h.fetcher;
   outputs.push({result:await cron._test.runRefresh('synthetic',false,{timeoutMs:10000}),calls:h.calls,store:[...h.store]});
  }
  assert.deepEqual(outputs[0],outputs[1]);
 });
});
test('exported native helpers retain explicit ranges and migrated ad-name-first creator attribution',()=>isolated(async()=>{
 const h=harness(),range={since:'2026-10-01',until:'2026-10-31'};
 const result=await cron._test.fetchAndCache('synthetic','last_month',false,h.fetcher,{rangeOverride:range});
 assert.deepEqual(result.errors,[]);assert.deepEqual(result.stats.ads.range,range);
 const wl=require('../public/glv-meta-ads/wl-report.js');
 for(const producer of [cron._test,api._test]){
  const row=producer.normalizeAd({account_id:'359758259164738',ad_id:'1',ad_name:'ActionKate_PAC462_V2',campaign_id:'35',campaign_name:'TUC_035_CZSK_WL_Kristyna',adset_id:'2',adset_name:'Set_Kristyna',spend:'10',impressions:'100'},{});
  assert.equal(wl.resolveCreator(row.campaign_name,row.adset_name,row.name).creator,'ActionKate');
  assert.equal(wl.resolveCreator(row.campaign_name,row.adset_name,row.name).source,'ad');
 }
 assert.equal(api._test.normalizeAd({account_id:'1021777267558882'},{}).account_id,'1021777267558882');
 assert.equal(api._test.normalizeCampaign({account_id:'1021777267558882'}).account_id,'1021777267558882');
}));
test('authenticated read-only audit uses native readers, exposes optional replay payload, and never writes or calls Graph',()=>isolated(async()=>{
 const h=harness();global.fetch=h.fetcher;
 await cron._test.runRefresh('synthetic',false,{timeoutMs:10000});h.calls.length=0;
 const res=response();await cron({headers:{authorization:'Bearer synthetic'},query:{read_only:'1',include_payload:'1',date_preset:'last_30d',type:'aggregate'}},res);
 assert.equal(res.code,200);assert.equal(res.body.read_only,true);assert.equal(res.body.datasets.length,1);
 assert.ok(h.calls.every(c=>c[0]==='GET'));
 for(const entry of res.body.datasets){assert.equal(entry.status,'readable');assert.ok(entry.sha256);assert.ok(Array.isArray(entry.payload.rows));assert.ok(entry.range);}
 const direct=response();await api({method:'GET',query:{type:'aggregate',date_preset:'last_30d'}},direct);
 assert.deepEqual(res.body.datasets.find(d=>d.type==='aggregate'&&d.preset==='last_30d').payload,direct.body);
 assert.equal(JSON.stringify(res.body).includes('synthetic'),false);
 const noPayload=response();await cron({headers:{authorization:'Bearer synthetic'},query:{read_only:'1'}},noPayload);
 assert.equal(noPayload.body.datasets.length,20);assert.ok(noPayload.body.datasets.every(d=>d.payload===undefined));
}));
test('read-only audit fails closed on missing native publications and rejects anonymous access without writes or Graph',()=>isolated(async()=>{
 const h=harness();global.fetch=h.fetcher;
 const denied=response();await cron({headers:{},query:{read_only:'1',include_payload:'1'}},denied);assert.equal(denied.code,401);assert.equal(h.calls.length,0);
 const res=response();await cron({headers:{authorization:'Bearer synthetic'},query:{read_only:'1',full_history:'1'}},res);
 assert.equal(res.code,503);assert.equal(res.body.read_only,true);assert.ok(res.body.datasets.every(d=>d.status==='unavailable'));
 assert.ok(h.calls.every(c=>c[0]==='GET'));
}));
test('native custom reader validates nonempty campaign facts without V2 runtime and keeps strict missing metrics',()=>isolated(async()=>{
 const h=harness(),range={since:'2026-10-01',until:'2026-10-31'};let malformed=false;
 global.fetch=async(url,options)=>{
  if(new URL(url).hostname==='redis.test')return h.fetcher(url,options);
  return {ok:true,status:200,json:async()=>({data:[{campaign_id:'1',campaign_name:'TUC_001_US_Sales',date_start:range.since,date_stop:range.until,...(!malformed?{spend:'10'}:{}),impressions:'100',reach:'50'}]})};
 };
 const req={method:'GET',query:{type:'aggregate',time_range:JSON.stringify(range)}};
 const good=response();await api(req,good);assert.equal(good.code,200);assert.equal(good.body.rows[0].amount_spent,'10');assert.equal(good.body.rows[0].reach,'50');
 h.store.delete(require('../lib/glv-history-v1.cjs').customKey('aggregate',range));
 malformed=true;const bad=response();await api(req,bad);assert.equal(bad.code,500);assert.equal(bad.body.rows,undefined);
}));
test('audit separates old extraction age from exact Promo coverage',()=>isolated(async()=>{
 const h=harness();global.fetch=h.fetcher;
 await cron._test.runRefresh('synthetic',false,{timeoutMs:10000});
 const key='glv:promo_formats:history:v1',payload=JSON.parse(h.store.get(key));payload.generated_at=new Date(Date.now()-3*86400000).toISOString();h.store.set(key,JSON.stringify(payload));h.calls.length=0;
 const res=response();await cron({headers:{authorization:'Bearer synthetic'},query:{read_only:'1'}},res);
 const entry=res.body.datasets.find(d=>d.type==='promo_formats');assert.equal(entry.stale,true);assert.equal(entry.coverage_complete,true);assert.ok(h.calls.every(c=>c[0]==='GET'));
}));
test('payload audit requires one explicit native preset/type before reading storage',()=>isolated(async()=>{
 const h=harness();global.fetch=h.fetcher;
 for(const scope of [{},{type:'ads'},{type:'ads',date_preset:'promo_history'},{type:'promo_formats',date_preset:'last_30d'}]){
  const res=response();await cron({headers:{authorization:'Bearer synthetic'},query:{read_only:'1',include_payload:'1',...scope}},res);
  assert.equal(res.code,400);assert.equal(h.calls.length,0);
 }
}));
test('audit reports migrated creator names for partnership-positive ads rather than empty campaign-child counts',()=>isolated(async()=>{
 const h=harness();global.fetch=h.fetcher;
 await cron._test.runRefresh('synthetic',false,{timeoutMs:10000});
 const key='glv:ads:last_30d',payload=JSON.parse(h.store.get(key));
 payload.rows=[{id:'1',name:'ActionKate_PAC462_V2',campaign_id:'35',campaign_name:'TUC_035_CZSK_WL_Kristyna',adset_id:'2',adset_name:'Set_Kristyna',amount_spent:'10',impressions:'100',partnership:{status:'verified_positive',reason:'sponsor_metadata',evidence:['facebook_branded_content.sponsor_page_id']}}];
 h.store.set(key,JSON.stringify(payload));h.store.delete('glv:published:last_30d');h.store.delete('glv:published:last_30d:previous');
 const res=response();await cron({headers:{authorization:'Bearer synthetic'},query:{read_only:'1',include_payload:'1',type:'ads',date_preset:'last_30d'}},res);
 assert.equal(res.code,200);assert.equal(res.body.datasets[0].creator_attribution.ad_name_facts,1);assert.deepEqual(res.body.datasets[0].creator_attribution.creators,['ActionKate']);
}));
module.exports={harness,isolated,response};
