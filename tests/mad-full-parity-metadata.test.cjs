'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const names=require('../lib/glv-campaign-metadata.cjs'),v2=require('../lib/glv-mad-v2.cjs'),cache=require('../lib/glv-mad-v2-cache.cjs');
const account=v2.ACCOUNTS[0].id,id='120250188581670687',name='TUC_037_CZSK_CBO_GRAVEYARD',old='CZSK | GRAVEYARD | CBO';
const stamp=new Date(Date.now()-1000).toISOString(),range={since:'2026-11-09',until:'2026-11-09'};
const metadata={schema_version:1,source:names.SOURCE,generated_at:stamp,accounts:[{id:account,campaigns:[{id,account_id:account,name}]}]};
function fixtures(){
 const store=new Map(),base={id,name:old,date_start:range.since,date_stop:range.until,amount_spent:'25','action_values:omni_purchase':'50',impressions:'10',reach:'7'};
 for(const preset of cache.PRESETS)for(const type of cache.TYPES){
  const row=type==='ads'?{...base,id:'444',name:'Creative unchanged',campaign_id:id,campaign_name:old,adset_id:'555',adset_name:'Set unchanged',partnership:{status:'unverified',reason:'metadata_unavailable',evidence:[]}}:{...base};
  const common={rows:[row],range,generated_at:stamp,creator_version:2,creator_reconciliation_version:1,creator_ad_version:1,...(type==='ads'?{wl_version:3}:{})};
  store.set(`glv:${type}:${preset}`,common);
  store.set(cache.presetKey(type,preset),{schema_version:1,creator_ad_version:1,complete:true,type,range,generated_at:stamp,generation_id:'synthetic',accounts:v2.ACCOUNTS.map(a=>({...a,rows:a.id===account?[row]:[],reach:[[`${a.id}:${id}`,7]]})),fx:{[range.since]:{date:range.since,czk_per_usd:25}}});
 }
 store.set(names.KEY,metadata);return store;
}
test('protected owner audit proves target name by ID in all 36 preset/type/version consumers without changing stored facts',async()=>{
 const store=fixtures(),before=JSON.stringify([...store]);
 const summaries=await names.auditPublished(async key=>store.get(key)||null,metadata,{v2Enabled:true,campaignId:id});
 const presets=summaries.filter(s=>s.preset);assert.equal(presets.length,36);
 for(const s of presets){assert.equal(s.requested_campaign.present,true);assert.deepEqual(s.requested_campaign.names,[name]);assert.equal(s.performance_generated_at,stamp);}
 assert.equal(JSON.stringify([...store]),before);
});
test('V1 cached API uses the identical account+ID metadata as V2 without a Meta query',async()=>{
 const handler=require('../api/glv-meta-ads/fb-data.js'),store=fixtures(),saved={...process.env},original=global.fetch;
 try{
  process.env.KV_REST_API_URL='https://redis.test';process.env.KV_REST_API_TOKEN='synthetic';delete process.env.UPSTASH_REDIS_REST_URL;delete process.env.UPSTASH_REDIS_REST_TOKEN;
  global.fetch=async url=>{assert.ok(String(url).startsWith('https://redis.test/get/'));const key=decodeURIComponent(String(url).split('/get/')[1]);return {ok:true,json:async()=>({result:store.has(key)?JSON.stringify(store.get(key)):null})};};
  for(const type of cache.TYPES){const res={code:200,setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;}};
   await handler({method:'GET',query:{type,date_preset:'last_30d'}},res);assert.equal(res.code,200);assert.equal(res.body.rows[0].campaign_name||res.body.rows[0].name,name);assert.equal(res.body.generated_at,stamp);
  }
 }finally{global.fetch=original;for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
});
