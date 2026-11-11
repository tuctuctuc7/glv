'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const v2=require('../lib/glv-mad-v2.cjs');
const handler=require('../api/glv-meta-ads/fb-data.js');

test('V2 prefix notices honor exactly the supported V1 legacy exception, only in TUC',()=>{
 const fx={'2026-10-07':{date:'2026-10-07',czk_per_usd:25}};
 const convert=(name,account=v2.ACCOUNTS[0])=>v2.convertRow({id:'42',name,date_start:'2026-10-07',amount_spent:'1','action_values:omni_purchase':'2'},account,'CZK',fx);
 for(const name of ['WL_befit_over40','WL_BeFiT_OvEr40_Launch','WL_befit_over40_Promo','TUC_402_CZ_WL_BEFIT_OVER40'])assert.equal(convert(name).naming_warning,null,name);
 for(const name of ['wl_befit_over40','WL_befit_over400','WL_Unknown','CZSK | GRAVEYARD | CBO'])assert.match(convert(name).naming_warning,/prefix mismatch/,name);
 assert.match(convert('WL_befit_over40',v2.ACCOUNTS[1]).naming_warning,/prefix mismatch/);
});

test('V1 custom campaign readers reject missing/invalid required facts before normalization, like V2',async()=>{
 const oldFetch=global.fetch,oldEnv={...process.env};
 process.env.KV_REST_API_URL='https://redis.test';process.env.KV_REST_API_TOKEN='test-only';process.env.GLV_META_FB_ACCESS_TOKEN='test-only';
 try{
  for(const type of ['aggregate','daily'])for(const metric of ['spend','impressions','reach'])for(const value of [undefined,null,'','not-a-number',-1,'0']){
   const raw={campaign_id:'42',campaign_name:'TUC_001_CZSK_BAU',spend:'1',impressions:'2',reach:'1',date_start:'2026-10-07',date_stop:'2026-10-07',[metric]:value};
   global.fetch=async url=>({ok:true,json:async()=>String(url).startsWith('https://redis.test/')?{result:null}:{data:[raw]}});
   const req={method:'GET',query:{type,time_range:JSON.stringify({since:'2026-10-07',until:'2026-10-07'})}};
   const res={code:200,setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
   await handler(req,res);
   assert.equal(res.code,value==='0'?200:500,`${type} ${metric}=${value}`);
   if(value!=='0')assert.equal(res.body.rows,undefined,'invalid facts must not become plausible zero rows');
  }
 }finally{global.fetch=oldFetch;for(const key of Object.keys(process.env))if(!(key in oldEnv))delete process.env[key];Object.assign(process.env,oldEnv);}
});
