'use strict';
// Current labels are a dimension, not performance facts. Both readers use this
// account-scoped overlay; old immutable generations and extraction times stay intact.
const {createHash}=require('node:crypto');
const KEY='glv:campaign-metadata:1';
const SOURCE='Meta campaign objects';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function index(metadata){
 if(metadata?.schema_version!==1||metadata.source!==SOURCE||!Number.isFinite(Date.parse(metadata.generated_at))||!Array.isArray(metadata.accounts))throw Error('Invalid campaign metadata');
 const accounts=new Set(),map=new Map();
 for(const account of metadata.accounts){
  if(!/^\d+$/.test(account.id)||accounts.has(account.id)||!Array.isArray(account.campaigns))throw Error('Invalid campaign metadata account');
  accounts.add(account.id);
  for(const c of account.campaigns){
   const key=`${account.id}:${c.id}`;
   if(typeof c.id!=='string'||!/^\d+$/.test(c.id)||c.account_id!==account.id||typeof c.name!=='string'||!c.name.trim()||map.has(key))throw Error('Invalid campaign metadata identity');
   map.set(key,c);
  }
 }
 return map;
}
function applyRows(rows,accountId,type,metadata){
 let map;try{map=index(metadata);}catch{return {rows,campaign_metadata:{status:'unavailable',generated_at:null,covered_campaigns:0,missing_campaigns:null}};}
 const sha256=digest(metadata),covered=new Set(),missing=new Set(),renamed=new Map();
 function apply(row,parentId){
  const id=row.campaign_id||parentId||(type!=='ads'?row.id:null),key=`${accountId}:${id}`,current=map.get(key);
  let out={...row};
  if(id){
   if(current){
    covered.add(key);
    const oldName=row.campaign_name||(row.campaign_id?null:row.name);
    if(oldName&&oldName!==current.name)renamed.set(key,{account_id:accountId,campaign_id:id,previous_name:oldName,name:current.name});
    if(row.campaign_id||parentId)out.campaign_name=current.name;
    else {out.name=current.name;if('campaign_name' in row)out.campaign_name=current.name;}
    out.campaign_name_metadata={account_id:accountId,campaign_id:id,name:current.name,observed_at:metadata.generated_at,source:SOURCE,sha256};
   }else missing.add(key);
  }
  if(row.creator_rows)out.creator_rows=row.creator_rows.map(child=>apply(child,id));
  return out;
 }
 const output=rows.map(row=>apply(row));
 const stale=Date.now()-Date.parse(metadata.generated_at)>90000000;
 return {rows:output,campaign_metadata:{status:stale?'stale':missing.size?'partial':'current',generated_at:metadata.generated_at,sha256,covered_campaigns:covered.size,missing_campaigns:missing.size,stale_campaigns:stale?covered.size:0,renamed_campaigns:[...renamed.values()]}};
}
function applyPayload(payload,accountId,type,metadata){
 if(!payload||!Array.isArray(payload.rows))return payload;
 const applied=applyRows(payload.rows,accountId,type,metadata);
 return {...payload,...applied,...bindGeneration(payload,applied.campaign_metadata.sha256)};
}
function bindGeneration(payload,sha256){
 if(!payload.generation_id||!sha256)return {};
 const performance_generation_id=payload.performance_generation_id||payload.generation_id;
 return {performance_generation_id,generation_id:digest({performance_generation_id,campaign_metadata_sha256:sha256})};
}
function applySnapshot(snapshot,metadata){
 if(!metadata)return snapshot;
 const diagnostics=[];
 const accounts=snapshot.accounts.map(a=>{const result=applyRows(a.rows,a.id,snapshot.type,metadata);diagnostics.push({account_id:a.id,...result.campaign_metadata});return {...a,rows:result.rows};});
 const sha256=digest(metadata);
 return {...snapshot,accounts,...bindGeneration(snapshot,sha256),campaign_metadata:{generated_at:metadata.generated_at,sha256,accounts:diagnostics}};
}
async function read(readValue,now=new Date()){
 try{const metadata=await readValue(KEY);index(metadata);if(Date.parse(metadata.generated_at)>+now)throw Error();return metadata;}catch{return null;}
}
async function refresh({accounts,tokenFor,redis,fetcher=fetch,now=new Date(),deadline=Date.now()+30000}){
 const transport=require('./glv-mad-v2-cache.cjs').boundedTransport(fetcher,deadline,10000);
 const metadata={schema_version:1,source:SOURCE,generated_at:now.toISOString(),accounts:[]};
 for(const account of accounts){
  const token=tokenFor(account);if(!token)throw Error('Campaign metadata credential unavailable');
  const params=new URLSearchParams({fields:'id,name,account_id',limit:'500',effective_status:JSON.stringify(['ACTIVE','PAUSED','ARCHIVED','DELETED'])});
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
function auditMetrics(payload,type){
 const account=require('./glv-mad-v2.cjs').ACCOUNTS[0].id;
 const keys=['amount_spent','action_values:omni_purchase','actions:omni_purchase','impressions','actions:link_click','actions:outbound_click','actions:landing_page_view','actions:lead'];
 const rows=payload.rows.filter(r=>!r.account_id||r.account_id===account),totals=Object.fromEntries(keys.map(k=>[k,0]));
 for(const row of rows)for(const key of keys){const value=Number(row[key]??0);if(!Number.isFinite(value))throw Error('Invalid parity audit metric');totals[key]+=value;}
 return {account_id:account,currency:'CZK',type,rows:rows.length,totals};
}
async function auditPublished(readValue,metadata,{v2Enabled=false,campaignId,deadline=Infinity}={}){
 const v1=require('./glv-history-v1.cjs'),v2=require('./glv-mad-v2-cache.cjs'),source=require('./glv-mad-v2-source.cjs'),account=require('./glv-mad-v2.cjs').ACCOUNTS[0].id;
 const summaries=[];
 const exhausted=()=>Date.now()>=deadline;
 const incomplete=()=>[...summaries,{status:'audit_unavailable',reason:'budget_exhausted'}];
 const target=payload=>!campaignId?{}:{requested_campaign:{id:campaignId,present:payload.rows.some(r=>(r.source_campaign_id||r.campaign_id||r.source_id||r.id)===campaignId),names:[...new Set(payload.rows.filter(r=>(r.source_campaign_id||r.campaign_id||r.source_id||r.id)===campaignId).map(r=>r.campaign_name||r.name))]}};
 for(const preset of v2.PRESETS){
  for(const version of v2Enabled?['v1','v2']:['v1']){
   if(exhausted())return incomplete();
   try{
    const reader=version==='v1'?v1:v2;
    const pieces=await reader.readPublished(readValue,preset)||await reader.readLegacy(readValue,preset);
    if(!pieces){summaries.push({version,preset,status:'performance_unavailable'});continue;}
    for(const type of v2.TYPES){
     if(exhausted())return incomplete();
     const payload=version==='v1'?applyPayload(pieces[type],account,type,metadata):source.renderSnapshot(pieces[type],'CZK','All',metadata);
     summaries.push({version,preset,type,performance_generated_at:payload.generated_at,range:payload.range,...payload.campaign_metadata,...target(payload),tuc_metrics:auditMetrics(payload,type)});
    }
   }catch{summaries.push({version,preset,status:'readback_unavailable'});}
  }
 }
 for(const version of v2Enabled?['v1','v2']:['v1']){
  try{
   if(exhausted())return incomplete();
   const raw=await readValue(version==='v1'?require('./glv-promo-format.cjs').CACHE_KEY:require('./glv-mad-v2-promo.cjs').CACHE_KEY);
   const payload=version==='v1'?require('./glv-promo-format.cjs').sliceCachedFormats(raw,raw?.range,new Date(),{allowStale:true}):raw&&require('./glv-mad-v2-promo.cjs').renderPromo(raw,'CZK','All',new Date(),metadata);
   const named=version==='v1'?applyPayload(payload,account,'promo_formats',metadata):payload;
   summaries.push(named?{version,type:'promo_formats',performance_generated_at:named.generated_at,...named.campaign_metadata,...target(named)}:{version,type:'promo_formats',status:'performance_unavailable'});
  }catch{summaries.push({version,type:'promo_formats',status:'readback_unavailable'});}
 }
 return summaries;
}
module.exports={KEY,SOURCE,index,applyRows,applyPayload,applySnapshot,read,digest,refresh,auditMetrics,auditPublished};
