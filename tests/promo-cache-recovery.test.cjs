const test=require('node:test');
const assert=require('node:assert/strict');
const {sliceCachedFormats}=require('../lib/glv-promo-format.cjs');
const fixture=()=>({schema_version:1,classification_version:2,funnel_version:1,reconciled:true,generated_at:'2026-10-20T00:00:00Z',range:{since:'2026-03-01',until:'2026-10-19'},rows:[{ad_id:'a',ad_name:'PAC403',adset_id:'s',adset_name:'Video',campaign_id:'120241268747040687',campaign_name:'TUC_008_CZSK_Promo',date:'2026-09-02',format:'Video',reason:'current_adset_label',spend:100,purchases:2,revenue:400,impressions:50,link_clicks:10,landing_page_views:8,checkouts:3}]});
test('valid last-good history survives freshness expiry without claiming missing days',()=>{
 const cached=fixture(),requested={since:'2026-03-01',until:'2026-10-28'};
 const result=sliceCachedFormats(cached,requested,new Date('2026-10-29'),{allowStale:true});
 assert.ok(result,'last-good facts must remain available');
 assert.deepEqual(result.range,cached.range);assert.deepEqual(result.rows,cached.rows);
 assert.equal(result.generated_at,cached.generated_at);assert.equal(result.freshness.status,'stale');
 assert.deepEqual(result.freshness.requested_range,requested);
 assert.equal(sliceCachedFormats({...cached,rows:[{...cached.rows[0],spend:null}]},requested,new Date('2026-10-29'),{allowStale:true}),null);
});
test('cron preserves history without TTL and leaves it untouched when Meta fails',async()=>{
 const {refreshPromoFormatCache}=require('../api/glv-meta-ads/cron.js')._test;
 const oldEnv={...process.env};Object.assign(process.env,{KV_REST_API_URL:'https://redis.test',KV_REST_API_TOKEN:'test'});delete process.env.UPSTASH_REDIS_REST_URL;delete process.env.UPSTASH_REDIS_REST_TOKEN;
 let stored,commands=[];
 const fetcher=async(url,options={})=>{if(new URL(url).hostname==='redis.test'){const args=JSON.parse(options.body);commands.push(args);if(args[0]==='SET')stored=args[2];return {ok:true,json:async()=>({result:args[0]==='GET'?stored:'OK'})};}return {ok:true,json:async()=>({data:[]})};};
 try{
  await refreshPromoFormatCache('test',false,fetcher);assert.equal(commands.find(c=>c[0]==='SET').length,3,'last-good history cannot expire on one missed cron');assert.equal(commands.at(-1)[0],'GET');
  stored=JSON.stringify(fixture());const before=stored;commands=[];
  const failing=async(url,options)=>{
   if(new URL(url).hostname!=='redis.test')return {ok:false,status:500,json:async()=>({error:{code:1}})};
   const args=JSON.parse(options.body);
   if(args[0]==='TTL'||args[0]==='PERSIST'){commands.push(args);return {ok:true,json:async()=>({result:args[0]==='TTL'?-1:1})};}
   return fetcher(url,options);
  };
  await assert.rejects(()=>refreshPromoFormatCache('test',false,failing),/code 1/);assert.equal(stored,before);assert.deepEqual(commands.map(c=>c[0]),['GET','PERSIST','TTL']);
 }finally{process.env=oldEnv;}
});
test('parallel and repeated page requests never rebuild missing history or fabricate empty success',async()=>{
 const handler=require('../api/glv-meta-ads/fb-data.js'),oldFetch=global.fetch,oldEnv={...process.env};let meta=0;
 Object.assign(process.env,{GLV_META_FB_ACCESS_TOKEN:'test',KV_REST_API_URL:'https://redis.test',KV_REST_API_TOKEN:'test'});delete process.env.UPSTASH_REDIS_REST_URL;delete process.env.UPSTASH_REDIS_REST_TOKEN;
 global.fetch=async url=>{if(new URL(url).hostname!=='redis.test')meta++;return {ok:true,json:async()=>new URL(url).hostname==='redis.test'?{result:null}:{data:[]}}};
 const run=async type=>{let status=200,body;await handler({method:'GET',query:{type,date_preset:'promo_history'}},{setHeader(){},status(n){status=n;return this},json(v){body=v}});return {status,body}};
 try{const replies=await Promise.all([run('promo_formats'),run('promo_concepts'),run('promo_formats')]);assert.equal(meta,0,'page views must not start expensive full-history pulls');for(const r of replies){assert.equal(r.status,503);assert.equal(r.body.status,'unavailable');assert.equal(r.body.rows,undefined);}}finally{global.fetch=oldFetch;process.env=oldEnv;}
});
