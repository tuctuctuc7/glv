const test=require('node:test'),assert=require('node:assert/strict');
const cron=require('../api/glv-meta-ads/cron.js')._test;
const {creatorFactsComplete}=require('../lib/glv-wl-creators.cjs');
test('V1 repairs older missing daily facts with child-only query, retains valid prior on transient failure',async()=>{
 const env={...process.env};Object.assign(process.env,{KV_REST_API_URL:'https://redis.test',KV_REST_API_TOKEN:'synthetic'});delete process.env.UPSTASH_REDIS_REST_URL;delete process.env.UPSTASH_REDIS_REST_TOKEN;
 const cache=new Map(),calls=[];let failChildren=true;
 const fetcher=async(url,opts={})=>{const u=new URL(url);let data;
  if(u.hostname==='redis.test'){const [op,k,v]=JSON.parse(opts.body);if(op==='SET')cache.set(k,v);return {ok:true,json:async()=>({result:op==='SET'?'OK':op==='TTL'?(cache.has(k)?-1:-2):op==='PERSIST'?0:cache.get(k)||null})};}
  if(u.searchParams.has('ids'))data=Object.fromEntries(u.searchParams.get('ids').split(',').map(id=>[id,{effective_status:'ACTIVE',creative:{}}]));
  else {const range=JSON.parse(u.searchParams.get('time_range'));const daily=u.searchParams.has('time_increment'),child=u.searchParams.has('filtering');calls.push({level:u.searchParams.get('level'),range,child});
   if(child&&failChildren)throw Error('synthetic transient');
   const row={campaign_id:'35',campaign_name:'TUC_035_CZSK_WL',date_start:range.since,date_stop:daily?range.since:range.until,spend:'30',impressions:'300',reach:'150'};
   data={data:u.searchParams.get('level')==='campaign'?[row]:['Kristyna_PAC419_V1','ActionKate_PAC462_V2'].map((name,i)=>({...row,ad_id:String(i+1),ad_name:name,adset_id:'13',adset_name:'Mixed',spend:'15',impressions:'150'}))};
  }return {ok:true,json:async()=>data};
 };
 try{
  const first=await cron.fetchAndCache('synthetic','last_90d',false,fetcher);assert.ok(first.errors.length);assert.equal(first.stats.aggregate.creator_complete,true,'period ads recover aggregate but not daily');
  const before=JSON.parse(cache.get('glv:daily:last_90d')),old=before.rows[0];assert.equal(creatorFactsComplete([old]),false);
  failChildren=false;calls.length=0;const fixed=await cron.fetchAndCache('synthetic','last_90d',false,fetcher);assert.deepEqual(fixed.errors,[]);
  const after=JSON.parse(cache.get('glv:daily:last_90d'));assert.equal(creatorFactsComplete(after.rows),true);assert.equal(after.rows.find(r=>r.date_start===old.date_start).amount_spent,old.amount_spent);
  assert.ok(calls.some(c=>c.child&&c.range.since===old.date_start&&c.range.until===old.date_start));assert.ok(!calls.some(c=>c.level==='campaign'&&c.range.since===old.date_start&&c.range.until===old.date_start));
  const last=cache.get('glv:daily:last_90d');failChildren=true;const failed=await cron.fetchAndCache('synthetic','last_90d',false,fetcher);assert.ok(failed.errors.some(e=>e.includes('last-good retained')));assert.equal(cache.get('glv:daily:last_90d'),last,'prior timestamp and attribution unchanged');
 }finally{process.env=env;}
});
