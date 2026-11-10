const test=require('node:test');
const assert=require('node:assert/strict');
const api=require('../api/glv-meta-ads/fb-data.js');
const cron=require('../api/glv-meta-ads/cron.js');

test('live and cron preserve campaign totals when optional adset pagination fails',async()=>{
 const oldFetch=global.fetch,oldEnv={...process.env};
 Object.assign(process.env,{GLV_META_FB_ACCESS_TOKEN:'synthetic',KV_REST_API_URL:'https://redis.test',KV_REST_API_TOKEN:'synthetic'});
 delete process.env.UPSTASH_REDIS_REST_URL;delete process.env.UPSTASH_REDIS_REST_TOKEN;
 const cache=new Map();let primaryFailure=false;
 const fetcher=async(url,opts={})=>{
  const u=new URL(url);
  if(u.hostname==='redis.test'){
   const [op,key,value]=opts.body?JSON.parse(opts.body):[];
   if(op==='SET')cache.set(key,value);
   return {ok:true,json:async()=>({result:op==='SET'?'OK':cache.get(key)||null})};
  }
  const level=u.searchParams.get('level');
  if(level==='campaign'){
   if(primaryFailure)throw new Error('primary source failed');
   return {ok:true,json:async()=>({data:[{campaign_id:'35',campaign_name:'GLV_035_CZ_WL',spend:'30',reach:'150',impressions:'300'}]})};
  }
  if(level==='ad'&&u.searchParams.has('filtering')){
   if(u.searchParams.has('after'))throw new Error('secret-bearing-upstream-detail');
   return {ok:true,json:async()=>({data:[{campaign_id:'35',campaign_name:'GLV_035_CZ_WL',adset_id:'k',adset_name:'Set_Kristyna',spend:'10'}],paging:{next:url+'&after=next'}})};
  }
  return {ok:true,json:async()=>({data:[]})};
 };
 const run=async(type)=>{let status=200,body;await api({method:'GET',query:{type,date_preset:'last_7d'}},{setHeader(){},status(n){status=n;return this},json(v){body=v}});return {status,body};};
 const check=payload=>{assert.equal(payload.rows.length,1);const row=payload.rows[0];assert.equal(row.amount_spent,'30');assert.equal(row.reach,'150');assert.deepEqual(row.creator_rows,[]);assert.match(row.creator_issue,/unavailable.*refresh/i);assert.doesNotMatch(JSON.stringify(payload),/secret-bearing/);};
 try{
  global.fetch=fetcher;
  for(const type of ['aggregate','daily']){const result=await run(type);assert.equal(result.status,200);check(result.body);}
  const refreshed=await cron._test.fetchAndCache('synthetic','last_month',false,fetcher);
  assert.deepEqual(refreshed.errors,[]);
  for(const type of ['aggregate','daily']){check(JSON.parse(cache.get(`glv:${type}:last_month`)));assert.equal(refreshed.stats[type].readback_verified,true);assert.match(refreshed.stats[type].creatorIssues.join(' '),/GLV_035_CZ_WL.*unavailable/i);}
  primaryFailure=true;
  assert.equal((await run('aggregate')).status,500,'primary source failure must not be hidden');
 }finally{global.fetch=oldFetch;process.env=oldEnv;}
});
