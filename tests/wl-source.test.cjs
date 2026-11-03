const test=require('node:test');const assert=require('node:assert/strict');
const api=require('../api/glv-meta-ads/fb-data.js');const cron=require('../api/glv-meta-ads/cron.js');
test('live and cron paginate every ad, retain zero spend and reject malformed upstream responses',async()=>{
 const oldFetch=global.fetch,oldEnv={...process.env};
 Object.assign(process.env,{GLV_META_FB_ACCESS_TOKEN:'synthetic',KV_REST_API_URL:'https://redis.test',KV_REST_API_TOKEN:'synthetic'});delete process.env.UPSTASH_REDIS_REST_URL;delete process.env.UPSTASH_REDIS_REST_TOKEN;
 const raw=i=>({ad_id:String(i),ad_name:'PAC462 V1',campaign_id:'c',campaign_name:'X_US_WL_ActionKate',spend:'0',actions:[{action_type:'omni_purchase',value:'1'}]});
 let stored,mode='valid';const requests=[],cache=new Map();
 const fetcher=async(url,opts={})=>{
  const u=new URL(url);requests.push(u);
  if(u.hostname==='redis.test'){
   if(opts.body){const args=JSON.parse(opts.body);if(args[0]==='SET'){cache.set(args[1],args[2]);if(args[1]==='glv:ads:last_month')stored=JSON.parse(args[2]);}return {ok:true,json:async()=>({result:args[0]==='GET'?cache.get(args[1]):'OK'})};}
   return {ok:true,json:async()=>({result:null})};
  }
  if(u.searchParams.has('ids'))return {ok:true,json:async()=>({})};
  if(u.searchParams.get('level')!=='ad')return {ok:true,json:async()=>({data:[]})};
  if(mode==='malformed')return {ok:true,json:async()=>({})};
  const next=u.searchParams.has('after');return {ok:true,json:async()=>({data:Array.from({length:next?75:50},(_,i)=>raw(i+(next?50:0))),...(!next?{paging:{next:url+'&after=next'}}:{})})};
 };
 const run=async()=>{let status=200,body;await api({method:'GET',query:{type:'ads',wl:'1',date_preset:'last_month'}},{setHeader(){},status(n){status=n;return this},json(v){body=v}});return {status,body};};
 try{
  global.fetch=fetcher;let result=await run();assert.equal(result.status,200);assert.equal(result.body.rows.length,125);assert.equal(result.body.wl_version,2);assert.ok(requests.find(u=>u.searchParams.get('fields')?.includes('campaign_name')));
  const cached=await cron._test.fetchAndCache('synthetic','last_month',false,fetcher);assert.deepEqual(cached.errors,[]);assert.equal(stored.rows.length,125);assert.equal(stored.wl_version,2);assert.ok(stored.generated_at);assert.equal(stored.range.since.endsWith('-01'),true);
  mode='malformed';result=await run();assert.equal(result.status,500,'malformed upstream must not become success-shaped empty data');
 }finally{global.fetch=oldFetch;process.env=oldEnv;}
});
test('live and daily-cache producers retain campaign names, zero-spend outcomes and range provenance',async()=>{
 for(const producer of [api,cron]){
  assert.equal(typeof producer._test.normalizeAd,'function');
  const row=producer._test.normalizeAd({ad_id:'a',ad_name:'PAC462 V1',campaign_id:'c',campaign_name:'X_US_WL_ActionKate',spend:'0',actions:[{action_type:'omni_purchase',value:'2'}],action_values:[{action_type:'omni_purchase',value:'80'}]},{});
  assert.equal(row.campaign_name,'X_US_WL_ActionKate');assert.equal(row.amount_spent,'0');assert.equal(row['actions:omni_purchase'],'2');
  assert.equal(producer._test.normalizeAd({ad_id:'missing'},{}).amount_spent,null,'missing spend must not become zero');
 }
});
test('WL cache accepts only fresh exact-range complete ad data, rejecting old schema and month rollover',()=>{
 const range={since:'2026-10-01',until:'2026-10-31'},now=new Date('2026-11-02T01:00:00Z');
 const payload={rows:[{campaign_name:'X_CZ_WL_ActionKate'}],range,generated_at:'2026-11-02T00:00:00Z',wl_version:2};
 assert.equal(typeof api._test.wlCacheUsable,'function');
 assert.equal(api._test.wlCacheUsable(payload,range,now),true);
 for(const bad of [{...payload,wl_version:undefined},{...payload,range:{since:'2026-09-01',until:'2026-09-30'}},{...payload,generated_at:'2026-10-30T00:00:00Z'},{...payload,rows:[{}]}])assert.equal(api._test.wlCacheUsable(bad,range,now),false);
});
