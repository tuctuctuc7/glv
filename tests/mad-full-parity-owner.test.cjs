'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const handler=require('../api/glv-meta-ads/cron.js');
test('authenticated names_only refresh bypasses performance work and reads back metadata even at a completed cutoff',async()=>{
 const saved={...process.env},original=global.fetch,store=new Map(),requests=[];
 try{
  process.env.GLV_META_CRON_SECRET='synthetic';delete process.env.CRON_SECRET;process.env.GLV_META_FB_ACCESS_TOKEN='synthetic';process.env.GLV_MAD_V2_ENABLED='0';process.env.KV_REST_API_URL='https://redis.test';process.env.KV_REST_API_TOKEN='synthetic';delete process.env.UPSTASH_REDIS_REST_URL;delete process.env.UPSTASH_REDIS_REST_TOKEN;
  global.fetch=async(url,options={})=>{
   requests.push(String(url));assert.ok(!String(url).includes('/insights'),'names_only must not refetch performance');
   if(String(url).includes('graph.facebook.com'))return {ok:true,status:200,json:async()=>({data:[{id:'120250188581670687',account_id:'359758259164738',name:'TUC_037_CZSK_CBO_GRAVEYARD'}]})};
   const [cmd,key,value,...rest]=JSON.parse(options.body);if(cmd==='SET')store.set(key,value);if(cmd==='EVAL')store.delete(rest[0]);
   return {ok:true,status:200,json:async()=>({result:cmd==='SET'?'OK':cmd==='TTL'?-1:store.get(key)||null})};
  };
  const res={code:200,setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
  await handler({headers:{authorization:'Bearer synthetic'},query:{names_only:'1',campaign_id:'120250188581670687'}},res);
  assert.equal(res.code,200,JSON.stringify(res.body));assert.equal(res.body.metadata_only,true);
  assert.equal(res.body.campaign_metadata.readback_verified,true);assert.equal(res.body.campaign_metadata.accounts[0].campaign_count,1);
  assert.equal(res.body.campaign_metadata.requested_campaign[0].name,'TUC_037_CZSK_CBO_GRAVEYARD');
  assert.equal(requests.filter(u=>u.includes('graph.facebook.com')).length,1);
  assert.ok([...store.keys()].every(k=>k==='glv:campaign-metadata:1'),'no performance/force/checkpoint mutation');
 }finally{global.fetch=original;for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
});
