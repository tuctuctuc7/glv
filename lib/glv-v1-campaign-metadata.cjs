'use strict';
// Optional V1-only TUC labels. Pure overlay helpers remain shared; V2 runtime,
// storage and metadata publication do not participate in this path.
const shared=require('./glv-campaign-metadata.cjs');
const {SOURCE,index,digest,applyPayload}=shared;
const KEY='glv:v1:campaign-metadata:1',ACCOUNT='359758259164738';
const PRESETS=['last_7d','last_14d','last_30d','last_90d','this_month','last_month'];
const read=(readValue,now)=>shared.read(key=>readValue(key===shared.KEY?KEY:key),now);
async function refresh({accounts,tokenFor,redis,fetcher=fetch,now=new Date(),deadline=Date.now()+30000}){
 const transport=(url,options)=>{
  const remaining=Math.floor(Math.min(10000,deadline-Date.now()));
  if(remaining<=0)throw Error('Metadata refresh budget exhausted');
  return fetcher(url,{...options,signal:AbortSignal.timeout(remaining)});
 };
 const metadata={schema_version:1,source:SOURCE,generated_at:now.toISOString(),accounts:[]};
 for(const account of accounts){
  const token=tokenFor(account);if(!token)throw Error('Campaign metadata credential unavailable');
  const params=new URLSearchParams({fields:'id,name,account_id',limit:'500',effective_status:JSON.stringify(['ACTIVE','PAUSED','ARCHIVED'])});
  let next=`https://graph.facebook.com/v21.0/act_${account.id}/campaigns?${params}`;
  const campaigns=[],seen=new Set();
  while(next){
   const url=new URL(next);
   if(url.origin!=='https://graph.facebook.com'||url.pathname!==`/v21.0/act_${account.id}/campaigns`)throw Error('Invalid campaign metadata pagination');
   url.searchParams.delete('access_token');url.searchParams.delete('appsecret_proof');
   const safe=url.toString();if(seen.has(safe))throw Error('Campaign metadata pagination cycle');seen.add(safe);
   let data;
   try{const response=await transport(safe,{method:'GET',headers:{Authorization:`Bearer ${token}`}});data=await response.json();if(!response.ok||data.error||!Array.isArray(data.data))throw Error();}catch{throw Error('Campaign metadata source unavailable');}
   campaigns.push(...data.data.map(c=>({id:c.id,account_id:c.account_id,name:c.name})));
   next=data.paging?.next||null;
  }
  metadata.accounts.push({id:account.id,campaigns});
 }
 index(metadata);
 const bytes=JSON.stringify(metadata);
 if((await redis('SET',KEY,bytes)).result!=='OK'||(await redis('GET',KEY)).result!==bytes||(await redis('TTL',KEY)).result!==-1)throw Error('Campaign metadata readback failed');
 return {metadata,readback_verified:true,generated_at:metadata.generated_at,sha256:digest(metadata),accounts:metadata.accounts.map(a=>({account_id:a.id,campaign_count:a.campaigns.length}))};
}
async function auditPublished(readValue,metadata,{campaignId,deadline=Date.now()+30000}={}){
 const history=require('./glv-history-v1.cjs'),summaries=[];
 function record(payload,type,preset){
  if(!payload){summaries.push({version:'v1',type,preset,status:'performance_unavailable'});return;}
  const named=applyPayload(payload,ACCOUNT,type,metadata);
  const rows=named.rows.filter(r=>(r.campaign_id||r.id)===campaignId);
  summaries.push({version:'v1',type,preset,performance_generated_at:named.generated_at,range:named.range,...named.campaign_metadata,...(campaignId?{requested_campaign:{id:campaignId,present:rows.length>0,names:[...new Set(rows.map(r=>r.campaign_name||r.name))]}}:{})});
 }
 for(const preset of PRESETS){
  if(Date.now()>=deadline)return [...summaries,{status:'audit_unavailable',reason:'budget_exhausted'}];
  const pieces=await history.readPublished(readValue,preset)||await history.readLegacy(readValue,preset);
  for(const type of ['aggregate','daily','ads'])record(pieces?.[type],type,preset);
 }
 const promo=require('./glv-promo-format.cjs'),raw=await readValue(promo.CACHE_KEY);
 record(raw&&promo.sliceCachedFormats(raw,raw.range,new Date(),{allowStale:true}),'promo_formats');
 return summaries;
}
module.exports={KEY,read,refresh,auditPublished,applyPayload};
