'use strict';
const {boundedTransport}=require('../../lib/glv-mad-v2-cache.cjs');
const {resolveRedisConfig}=require('../glv-meta-ads/fb-data.js')._test;
function createHandler({env=process.env,refresh=options=>require('../../lib/glv-mad-v2-isolated.cjs').refresh(options),audit=options=>require('../../lib/glv-mad-v2-isolated.cjs').readback(options),fetcher=(...args)=>fetch(...args)}={}){
 return async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');
  const secret=env.CRON_SECRET||env.GLV_META_CRON_SECRET;
  if(!secret||req.headers?.authorization!==`Bearer ${secret}`)return res.status(401).json({error:'Unauthorized'});
  if(req.method&&req.method!=='GET')return res.status(405).json({error:'Scheduled GET only'});
  const query=req.query||{},mode=query.mode;
  const readOnly=mode==='audit';
  const presets=['last_7d','last_14d','last_30d','last_90d','this_month','last_month'];
  const invalidAudit=query.include_payload==='1'&&(!presets.includes(query.preset)||!['daily','aggregate','ads'].includes(query.type)||!['USD','CZK'].includes(query.currency))||query.preset!==undefined&&!presets.includes(query.preset);
  if(!['morning','late','audit'].includes(mode)||Object.keys(query).some(k=>!(readOnly?['mode','include_payload','preset','type','currency']:['mode']).includes(k))||(query.include_payload!==undefined&&query.include_payload!=='1')||invalidAudit)return res.status(400).json({error:'An explicit morning, late or read-only audit is required; payload audits require one preset/type/currency'});
  if(env.GLV_MAD_V2_ENABLED!=='1')return res.status(503).json({ok:false,error:'V2 rollout is disabled'});
  const config=resolveRedisConfig(env),token=env.GLV_META_FB_ACCESS_TOKEN||env.FB_ACCESS_TOKEN;
  const tokenFor=account=>{if(account.id==='359758259164738')return token;if(account.id==='1021777267558882')return env.GLV_MAD_V2_FB_ACCESS_TOKEN||token;throw Error('Unknown account');};
  if(!config||!readOnly&&!tokenFor({id:mode==='late'?'1021777267558882':'359758259164738'}))return res.status(500).json({ok:false,error:'V2 refresh configuration is incomplete'});
  const deadline=Date.now()+270000,transport=boundedTransport(fetcher,deadline);
  const redis=async(...args)=>{
   const response=await transport(config.url,{method:'POST',headers:{Authorization:`Bearer ${config.token}`,'Content-Type':'application/json'},body:JSON.stringify(args)});
   if(!response.ok)throw Error('Redis transport failed');
   const result=await response.json();if(!result||result.error||!Object.prototype.hasOwnProperty.call(result,'result'))throw Error('Redis command failed');return result;
  };
  try{
   if(readOnly){
    const result=await audit({redis,now:new Date(),includePayload:query.include_payload==='1',...(query.preset?{presets:[query.preset]}:{})});
    if(query.include_payload==='1')result.presets=result.presets.map(({payloads,...summary})=>({...summary,payload:payloads?.[query.currency]?.[query.type]}));
    return res.status(result.verified?200:503).json({ok:result.verified===true,read_only:true,...result});
   }
   const result=await refresh({mode,token,tokenFor,redis,fetcher:transport,now:new Date(),deadline,force:false});
   return res.status(result.verified?200:503).json({ok:result.verified===true,...result});
  }catch{return res.status(500).json({ok:false,mode,error:'V2 refresh failed; validated published account data retained'});}
 };
}
module.exports=createHandler();
module.exports._test={createHandler};
