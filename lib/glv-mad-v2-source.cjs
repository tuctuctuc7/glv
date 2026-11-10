'use strict';
// Read-only Meta source. Never imports or invokes Ads Uploader or a Meta mutation.
const v2=require('./glv-mad-v2.cjs');
const {campaignFacts}=require('./glv-wl-creators.cjs');
const {fetchAdMetadata}=require('./glv-partnership.cjs');
const {normalizeCampaign,normalizeAd}=require('../api/glv-meta-ads/fb-data.js')._test;
const GRAPH='https://graph.facebook.com/v21.0';
const CACHE_PREFIX='glv:mad:v2:native:1:';
const cacheKey=(type,range)=>`${CACHE_PREFIX}${type}:${range.since}:${range.until}`;
function validAmount(value){return (typeof value==='number'||typeof value==='string')&&String(value).trim()!==''&&Number.isFinite(Number(value))&&Number(value)>=0;}
function validateCampaign(row,range,period=false){
 if(!row||typeof row.campaign_id!=='string'||!/^\d+$/.test(row.campaign_id)||typeof row.campaign_name!=='string'||!row.campaign_name.trim())throw Error('Invalid campaign source identity');
 if(!v2.validDate(row.date_start)||!v2.validDate(row.date_stop)||row.date_start<range.since||row.date_stop>range.until||row.date_start>row.date_stop||(period?(row.date_start!==range.since||row.date_stop!==range.until):row.date_start!==row.date_stop))throw Error('Invalid campaign source dates');
 for(const key of ['spend','impressions','reach'])if(!validAmount(row[key]))throw Error('Invalid campaign required metric');
 for(const key of ['actions','action_values'])if(row[key]!==undefined){
  if(!Array.isArray(row[key]))throw Error('Invalid campaign actions');
  const seen=new Set();for(const item of row[key]){
   if(!item||typeof item.action_type!=='string'||!item.action_type.trim()||seen.has(item.action_type)||!validAmount(item.value))throw Error('Invalid campaign action value');
   seen.add(item.action_type);
  }
 }
 return row;
}
async function buildSnapshot({range,type,token,fetcher=fetch,fx,now=new Date(),deadline=Date.now()+230000,reuse,progress}){
 if(!['daily','aggregate','ads'].includes(type))throw new Error('Invalid source type');
 if(!v2.validDate(range?.since)||!v2.validDate(range?.until)||range.since>range.until)throw new Error('Invalid source range');
 if(!token)throw new Error('Meta credential unavailable');
 if(Date.now()>=deadline)throw new Error('Meta request budget exhausted');
 fetcher=require('./glv-mad-v2-cache.cjs').boundedTransport(fetcher,deadline,type==='ads'?8000:15000);
 const source_extractions=[];
 let state=progress?await progress.load():null;
 state=require('./glv-mad-v2-chunks.cjs').rolloverState(state,now);
 // This context is allocated by one refresh invocation, never persisted or shared
 // with V1. Only complete validated daily source facts can be sliced; period
 // reach is always requested for the exact target range.
 if(reuse&&reuse.token!==token)throw Error('Invalid reuse context');
 const family=type==='aggregate'?'daily':type;
 const prior=reuse?.snapshots.find(s=>s.type===family&&s.range.since<=range.since&&s.range.until>=range.until);
 async function get(url){
  const u=new URL(url);
  if(u.origin!=='https://graph.facebook.com')throw new Error('Invalid Meta pagination origin');
  if(Date.now()>=deadline)throw new Error('Meta request budget exhausted');
  let response,data;
  for(let attempt=0;attempt<3;attempt++){
   if(Date.now()>=deadline)throw new Error('Meta request budget exhausted');
   response=null;data=null;
   try{response=await fetcher(url,{method:'GET',signal:AbortSignal.timeout(Math.max(0,Math.floor(Math.min(30000,deadline-Date.now()))))});data=await response.json();}
   catch{data=null;}
   if(response?.ok&&data&&!data.error)return data;
   const transient=!response||[429,500,502,503,504].includes(response.status)||data?.error?.is_transient===true;
   if(attempt===(type==='ads'?1:2)||!transient){const error=new Error(`Meta source unavailable (HTTP ${response?.status||0}; code ${Number(data?.error?.code)||0})`);error.transient=transient;throw error;}
   await new Promise(resolve=>setTimeout(resolve,250*(attempt+1)));
  }
 }
 async function paginate(url,checkpoint,resume){
  let next=resume?.next||url;const rows=[...(resume?.rows||[])],seen=new Set();
  while(next){
   if(seen.has(next))throw new Error('Meta pagination cycle');seen.add(next);
   const authenticated=new URL(next);authenticated.searchParams.set('access_token',token);
   const body=await get(authenticated.toString());if(!Array.isArray(body.data))throw new Error('Meta insights incomplete');
   rows.push(...body.data);next=body.paging?.next||null;
   if(next){const safe=new URL(next);if(safe.origin!=='https://graph.facebook.com')throw Error('Invalid Meta pagination origin');safe.searchParams.delete('access_token');safe.searchParams.delete('appsecret_proof');next=safe.toString();}
   if(checkpoint)await checkpoint({rows,next});
  }
  return rows;
 }
 const accounts=[];
 // Serial account pulls bound upstream concurrency and fail closed as a unit.
 for(const account of v2.ACCOUNTS){
  const info=reuse?.accounts.get(account.id)||await get(`${GRAPH}/act_${account.id}?fields=account_id,currency,timezone_name,account_status&access_token=${encodeURIComponent(token)}`);
  if(info.account_id!==account.id||info.currency!==account.currency||info.timezone_name!==account.timezone||info.account_status!==1)throw new Error('Account identity mismatch');
  reuse?.accounts.set(account.id,info);
  const reusedRows=prior?.accounts.find(a=>a.id===account.id)?.rows.filter(r=>r.date_start>=range.since&&r.date_stop<=range.until);
  const params=new URLSearchParams({level:type==='ads'?'ad':'campaign',fields:type==='ads'?'ad_id,ad_name,campaign_id,campaign_name,adset_id,adset_name,spend,impressions,actions,action_values,video_p100_watched_actions,video_thruplay_watched_actions':'campaign_id,campaign_name,spend,impressions,reach,actions,action_values',time_range:JSON.stringify(range),time_increment:'1',limit:'500',access_token:token});
  const url=`${GRAPH}/act_${account.id}/insights?${params}`;
  let rows,reach=[];
  if(type==='ads'&&reusedRows){rows=reusedRows;}else if(type==='ads'){
   const extracted=await require('./glv-mad-v2-chunks.cjs').extract({account,range,now,deadline,progress,state,paginate,urlFor:r=>{const p=new URLSearchParams(params);p.set('time_range',JSON.stringify(r));return `${GRAPH}/act_${account.id}/insights?${p}`;},fetchMetadata:ids=>fetchAdMetadata(ids,token,fetcher)});
   const {rows:raw,metadata}=extracted;source_extractions.push(...extracted.extractions);
   const statuses=Object.fromEntries(Object.entries(metadata).map(([id,m])=>[id,m.status]));
   rows=raw.map(r=>({...normalizeAd(r,statuses),date_start:r.date_start,date_stop:r.date_stop,partnership:metadata[r.ad_id]?.partnership||{status:'unverified',reason:'metadata_unavailable',evidence:[]}}));
  }else{
   rows=reusedRows||await campaignFacts(url,paginate,r=>normalizeCampaign(validateCampaign(r,range)));
   if(type==='aggregate'){
    params.delete('time_increment');
    const period=await paginate(`${GRAPH}/act_${account.id}/insights?${params}`),ids=new Set();
    reach=period.map(r=>{validateCampaign(r,range,true);if(ids.has(r.campaign_id))throw Error('Duplicate period campaign');ids.add(r.campaign_id);return [`${account.id}:${r.campaign_id}`,Number(r.reach)];});
    const dailyIds=new Set(rows.map(r=>r.id));
    if(ids.size!==dailyIds.size||[...dailyIds].some(id=>!ids.has(id)))throw Error('Meta period campaign coverage incomplete');
    if(reach.some(([,n])=>!Number.isFinite(n)||n<0))throw new Error('Meta period reach incomplete');
   }
  }
  const seen=new Set();
  for(const row of rows){const key=`${row.id}:${row.date_start}`;if(!row.id||!v2.validDate(row.date_start)||row.date_start<range.since||row.date_start>range.until||seen.has(key))throw new Error('Meta row identity or date invalid');seen.add(key);}
  accounts.push({...account,rows,reach});
 }
 if(prior)source_extractions.push(...(prior.source_extractions||[{type:family,range:prior.range,generated_at:prior.generated_at}]));
 if(!source_extractions.length||type==='aggregate')source_extractions.push({type,range,generated_at:now.toISOString()});
  // A rolling refresh assembles a new snapshot from retained historical facts
  // and freshly replaced recent facts; source_extractions retains their ages.
  const generated_at=type==='ads'&&state.history_retained?state.generated_at:source_extractions.map(s=>s.generated_at).sort()[0];
  const snapshot={schema_version:1,creator_ad_version:1,complete:true,type,range,generated_at,source_extractions,accounts,fx:fx||await v2.loadFixings(range,fetcher)};
 // Validate conversion before allowing a producer to publish any new snapshot.
 renderSnapshot(snapshot,'USD');renderSnapshot(snapshot,'CZK');
 if(reuse&&type!=='aggregate')reuse.snapshots.push(snapshot);
 return snapshot;
}
function renderSnapshot(snapshot,currency='USD',accountFilter='All'){
 if(!['USD','CZK'].includes(currency)||!['All','TUC','TGLV'].includes(accountFilter))throw new Error('Invalid display scope');
 if(!['daily','aggregate','ads'].includes(snapshot?.type)||!v2.validDate(snapshot?.range?.since)||!v2.validDate(snapshot?.range?.until)||snapshot.range.since>snapshot.range.until)throw new Error('Invalid snapshot scope');
 if(snapshot?.schema_version!==1||snapshot.complete!==true||snapshot.accounts?.length!==2||new Set(snapshot.accounts.map(a=>a.id)).size!==2)throw new Error('Incomplete account snapshot');
 if(snapshot.type!=='ads')for(const account of snapshot.accounts)for(const row of account.rows||[]){
  if(require('./glv-wl-creators.cjs').needsAdsets(row)&&(snapshot.creator_ad_version!==1||!require('../api/glv-meta-ads/fb-data.js')._test.cachedPayloadUsable(snapshot.type,{creator_version:2,creator_reconciliation_version:1,creator_ad_version:1,rows:[row]})))throw Error('Invalid creator ad facts; refresh required');
 }
 let rows=[],reach=new Map();
 for(const account of snapshot.accounts){v2.assertAccount(account);if(!Array.isArray(account.rows)||account.rows.some(r=>!v2.validDate(r.date_start)||r.date_start<snapshot.range.since||r.date_start>snapshot.range.until))throw new Error('Invalid cached rows');if(accountFilter!=='All'&&accountFilter!==account.label)continue;
  rows.push(...account.rows.map(row=>v2.convertRow(row,account,currency,snapshot.fx)));
  for(const [key,value] of account.reach||[])reach.set(key,value);
 }
 if(snapshot.type!=='daily')rows=v2.aggregateRows(rows,reach);
 return {rows,range:snapshot.range,generated_at:snapshot.generated_at,source_extractions:snapshot.source_extractions,...(snapshot.generation_id?{generation_id:snapshot.generation_id,generation_manifest:snapshot.generation_manifest}:{}),report_currency:currency,account_filter:accountFilter,accounts:v2.ACCOUNTS,complete:true,creator_version:2,creator_reconciliation_version:1,creator_ad_version:1,...(snapshot.type==='ads'?{wl_version:3}:{}),warnings:[...new Set(rows.filter(r=>r.naming_warning).map(r=>`${r.campaign_name||r.name}: ${r.naming_warning}`))],date_note:'Dates use each account’s local calendar (Prague / Los Angeles), combined by date label without rebucketing. Daily CNB rates; prior published fixing on non-business days.'};
}
module.exports={buildSnapshot,renderSnapshot,cacheKey,CACHE_PREFIX};
