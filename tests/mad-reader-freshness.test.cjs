const test=require('node:test'),assert=require('node:assert/strict');
const api=require('../api/glv-meta-ads/fb-data.js');
const {monthRange}=require('../api/glv-meta-ads/cron.js')._test;
test('ordinary readers explicitly serve valid stale history but reject unversioned caches; live uses completed UTC bounds and provenance',async()=>{
 const env={...process.env},oldFetch=global.fetch;
 Object.assign(process.env,{GLV_META_FB_ACCESS_TOKEN:'synthetic',KV_REST_API_URL:'https://redis.test',KV_REST_API_TOKEN:'synthetic'});delete process.env.UPSTASH_REDIS_REST_URL;delete process.env.UPSTASH_REDIS_REST_TOKEN;
 try{for(const type of ['aggregate','daily','ads'])for(const state of ['fresh','stale','wrong','legacy']){
  const range=monthRange('last_7d',false),cached={creator_version:2,wl_version:3,rows:[{id:'1',name:'BAU',campaign_id:'c',campaign_name:'BAU',amount_spent:'1',impressions:'10',date_start:range.since,date_stop:range.since,partnership:{status:'unverified',reason:'no_positive_metadata',evidence:[]},reach:'10',adset_id:'s',adset_name:'Banner'}],range,generated_at:new Date().toISOString()};
  if(state==='stale')cached.generated_at=new Date(Date.now()-26*3600000).toISOString();
  if(state==='wrong'){cached.range={since:'2020-01-01',until:'2020-01-07'};cached.rows[0].date_start=cached.rows[0].date_stop='2020-01-01';}
  if(state==='legacy')delete cached.range;
  const upstream=[];
  global.fetch=async url=>{const u=new URL(url);if(u.hostname==='redis.test')return {ok:true,json:async()=>({result:/glv:(aggregate|daily|ads):last_7d$/.test(decodeURIComponent(u.pathname))?JSON.stringify(cached):null})};upstream.push(u);return {ok:true,json:async()=>({data:[]})};};
  let body,status=200;const headers={};await api({method:'GET',query:{type,date_preset:'last_7d'}},{setHeader(k,v){headers[k]=v},status(n){status=n;return this},json(v){body=v}});
  assert.equal(status,200);assert.equal(headers['X-Cache'],state==='fresh'?'HIT':state==='legacy'?'MISS':'STALE',type+' '+state);
  assert.equal(headers['Cache-Control'],'private, no-store');
  if(state==='legacy'){
   assert.deepEqual(body.range,range);assert.ok(Date.now()-Date.parse(body.generated_at)<10000);
   assert.equal(upstream.length,1);assert.deepEqual(JSON.parse(upstream[0].searchParams.get('time_range')),range);assert.equal(upstream[0].searchParams.has('date_preset'),false);
  }else{
   assert.equal(upstream.length,0,'read retained history without a Meta pull');
   assert.match(body.generation_id,/^[a-f0-9]{64}$/,'validated legacy triplet receives one deterministic generation');
   assert.deepEqual(body.rows,cached.rows);assert.deepEqual(body.range,cached.range);assert.equal(body.generated_at,cached.generated_at);
   assert.deepEqual(body.requested_range,range);assert.deepEqual(body.cached_range,cached.range);
   assert.equal(body.stale,state!=='fresh');assert.equal(body.coverage_complete,state!=='wrong');
   if(state!=='fresh')assert.match(body.warning,/Last-good/);
  }
 }}finally{process.env=env;global.fetch=oldFetch;}
});
