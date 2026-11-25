'use strict';
// Read-only Meta source. Never imports or invokes Ads Uploader or a Meta mutation.
const v2=require('./glv-mad-v2.cjs');
const {campaignFacts,refillCreatorFacts,creatorFactsComplete}=require('./glv-wl-creators.cjs');
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
async function buildSnapshot({range,type,token,fetcher=fetch,fx,now=new Date(),deadline=Date.now()+230000,reuse,progress,account:onlyAccount,through}){
 if(onlyAccount)v2.assertAccount(onlyAccount);
 if(!['daily','aggregate','ads'].includes(type))throw new Error('Invalid source type');
 if(!v2.validDate(range?.since)||!v2.validDate(range?.until)||range.since>range.until)throw new Error('Invalid source range');
 if(!token)throw new Error('Meta credential unavailable');
 if(Date.now()>=deadline)throw new Error('Meta request budget exhausted');
 fetcher=require('./glv-mad-v2-cache.cjs').boundedTransport(fetcher,deadline,type==='ads'?8000:15000);
 const source_extractions=[];
 let state=progress?await progress.load():null;
 state=require('./glv-mad-v2-chunks.cjs').rolloverState(state,now,through);
 // This context is allocated by one refresh invocation, never persisted or shared
 // with V1. Only complete validated daily source facts can be sliced; period
 // reach is always requested for the exact target range.
 if(reuse&&reuse.token!==token)throw Error('Invalid reuse context');
 const family=type==='aggregate'?'daily':type;
 const prior=reuse?.snapshots.find(s=>s.type===family&&s.range.since===range.since&&s.range.until===range.until)||reuse?.snapshots.find(s=>s.type===family&&s.range.since<=range.since&&s.range.until>=range.until);
 const history=!prior&&type!=='ads'?reuse?.history?.find(s=>s.range.since<=range.since&&s.range.until>=range.since&&s.range.until<=range.until):null;
 let pullRange=range;
 if(history){
  const correction=v2.shift(range.until,-6),gap=v2.shift(history.range.until,1);
  const since=correction<gap?correction:gap;
  pullRange={since:since<range.since?range.since:since,until:range.until};
  source_extractions.push(...(history.source_extractions||[{type:'daily',range:history.range,generated_at:history.generated_at}]));
  source_extractions.push({type:'daily',range:pullRange,generated_at:now.toISOString()});
 }
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
   const authenticated=new URL(next);
   // Meta can upgrade the API version in its own paging links. Account and
   // resource identity remain exact; get() separately enforces the Graph origin.
   const pagingScope=authenticated.pathname.match(/^\/v\d+\.\d+\/act_(\d+)\/insights$/);
   if(onlyAccount&&pagingScope?.[1]!==onlyAccount.id)throw Error('Invalid pagination account scope');
   authenticated.searchParams.set('access_token',token);
   const body=await get(authenticated.toString());if(!Array.isArray(body.data))throw new Error('Meta insights incomplete');
   rows.push(...body.data);next=body.paging?.next||null;
   if(next){const safe=new URL(next);if(safe.origin!=='https://graph.facebook.com')throw Error('Invalid Meta pagination origin');safe.searchParams.delete('access_token');safe.searchParams.delete('appsecret_proof');next=safe.toString();}
   if(checkpoint)await checkpoint({rows,next});
  }
  return rows;
 }
 const accounts=[];
 // Serial account pulls bound upstream concurrency and fail closed as a unit.
 for(const account of onlyAccount?[onlyAccount]:v2.ACCOUNTS){
  const info=reuse?.accounts.get(account.id)||await get(`${GRAPH}/act_${account.id}?fields=account_id,currency,timezone_name,account_status&access_token=${encodeURIComponent(token)}`);
  if(info.account_id!==account.id||info.currency!==account.currency||info.timezone_name!==account.timezone||info.account_status!==1)throw new Error('Account identity mismatch');
  reuse?.accounts.set(account.id,info);
  const reusedRows=prior?.accounts.find(a=>a.id===account.id)?.rows.filter(r=>r.date_start>=range.since&&r.date_stop<=range.until);
  const params=new URLSearchParams({level:type==='ads'?'ad':'campaign',fields:type==='ads'?'ad_id,ad_name,campaign_id,campaign_name,adset_id,adset_name,spend,impressions,actions,action_values,video_p100_watched_actions,video_thruplay_watched_actions':'campaign_id,campaign_name,spend,impressions,reach,actions,action_values',time_range:JSON.stringify(range),time_increment:'1',limit:'500',access_token:token});
  const url=`${GRAPH}/act_${account.id}/insights?${params}`;
  // Two-account legacy fixtures retain their historical contract. The isolated
  // TUC producer additionally owns exact-range direct observations; never read V1.
  const direct=Boolean(onlyAccount&&account.label==='TUC');
  let rows,reach=[],direct_observation;
  if(type==='ads'&&reusedRows){rows=reusedRows;}else if(type==='ads'){
   const extracted=await require('./glv-mad-v2-chunks.cjs').extract({account,range,now,deadline,progress,state,paginate,urlFor:r=>{const p=new URLSearchParams(params);p.set('time_range',JSON.stringify(r));return `${GRAPH}/act_${account.id}/insights?${p}`;},fetchMetadata:ids=>fetchAdMetadata(ids,token,fetcher)});
   const {rows:raw,metadata}=extracted;source_extractions.push(...extracted.extractions);
   const statuses=Object.fromEntries(Object.entries(metadata).map(([id,m])=>[id,m.status]));
   rows=raw.map(r=>({...normalizeAd(r,statuses),date_start:r.date_start,date_stop:r.date_stop,partnership:metadata[r.ad_id]?.partnership||{status:'unverified',reason:'metadata_unavailable',evidence:[]}}));
  }else{
   if(reusedRows)rows=reusedRows;
   else{
    const freshUrl=new URL(url);freshUrl.searchParams.set('time_range',JSON.stringify(pullRange));
    const fresh=await campaignFacts(freshUrl.toString(),paginate,r=>normalizeCampaign(validateCampaign(r,pullRange)));
    if(direct)source_extractions.push({account_id:account.id,type:'daily',range:{...pullRange},generated_at:now.toISOString(),basis:'native_daily'});
    let retained=history?.accounts.find(a=>a.id===account.id)?.rows.filter(r=>r.date_start>=range.since&&r.date_stop<pullRange.since)||[];
    const missing=retained.filter(r=>!creatorFactsComplete([r]));
    if(missing.length){
     const dates=missing.map(r=>r.date_start).sort(),repairRange={since:dates[0],until:dates[dates.length-1]};
     const repairUrl=new URL(url);repairUrl.searchParams.set('time_range',JSON.stringify(repairRange));
     const repaired=await refillCreatorFacts(missing,repairUrl.toString(),paginate,r=>normalizeCampaign(validateCampaign(r,repairRange)));
     const byKey=new Map(repaired.map(r=>[`${r.id}:${r.date_start}`,creatorFactsComplete([r])?{...r,creator_source_generated_at:now.toISOString()}:r]));
     retained=retained.map(r=>byKey.get(`${r.id}:${r.date_start}`)||r);
    }
    rows=[...retained,...fresh];
   }
   if(type==='aggregate'){
    params.delete('time_increment');
    const periodUrl=`${GRAPH}/act_${account.id}/insights?${params}`;
    const period=direct?await campaignFacts(periodUrl,paginate,r=>normalizeCampaign(validateCampaign(r,range,true))):await paginate(periodUrl),ids=new Set();
    reach=period.map(r=>{if(!direct)validateCampaign(r,range,true);const id=direct?r.id:r.campaign_id;if(ids.has(id))throw Error('Duplicate period campaign');ids.add(id);return [`${account.id}:${id}`,Number(r.reach)];});
    if(direct)direct_observation={version:1,account_id:account.id,type,range:{...range},generated_at:now.toISOString(),basis:'native_direct_period',rows:period};
    const dailyIds=new Set(rows.map(r=>r.id));
    if(ids.size!==dailyIds.size||[...dailyIds].some(id=>!ids.has(id)))throw Error('Meta period campaign coverage incomplete');
    if(reach.some(([,n])=>!Number.isFinite(n)||n<0))throw new Error('Meta period reach incomplete');
   }
  }
  if(direct&&type==='ads'){
   const periodParams=new URLSearchParams(params);periodParams.delete('time_increment');
   periodParams.set('sort','spend_descending');periodParams.set('limit','50');
   const raw=await paginate(`${GRAPH}/act_${account.id}/insights?${periodParams}`);
   // Validate exact dates before normalizeAd intentionally removes period dates,
   // as V1 does. The envelope retains the independently observed range.
   for(const row of raw)if(row.date_start!==range.since||row.date_stop!==range.until)throw Error('Invalid direct ad dates');
   require('./glv-mad-v2-chunks.cjs').validateRaw(raw.map(r=>({...r,date_stop:r.date_start})),range);
   const metadata=await fetchAdMetadata(raw.map(r=>r.ad_id),token,fetcher);
   const statuses=Object.fromEntries(Object.entries(metadata).map(([id,m])=>[id,m.status]));
   const observed=raw.map(r=>({...normalizeAd(r,statuses),partnership:metadata[r.ad_id]?.partnership||{status:'unverified',reason:'metadata_unavailable',evidence:[]}}));
   direct_observation={version:1,account_id:account.id,type,range:{...range},generated_at:now.toISOString(),basis:'native_direct_period',rows:observed};
  }
  if(direct_observation)source_extractions.push({account_id:account.id,type,range:{...range},generated_at:direct_observation.generated_at,basis:'native_direct_period'});
  const seen=new Set();
  for(const row of rows){const key=`${row.id}:${row.date_start}`;if(!row.id||!v2.validDate(row.date_start)||row.date_start<range.since||row.date_start>range.until||seen.has(key))throw new Error('Meta row identity or date invalid');seen.add(key);}
  accounts.push({...account,rows,reach,...(direct_observation?{direct_observation}:{})});
 }
 if(prior)source_extractions.push(...(prior.source_extractions||[{type:family,range:prior.range,generated_at:prior.generated_at}]));
 if(!source_extractions.length||(type==='aggregate'&&onlyAccount?.label!=='TUC'))source_extractions.push({type,range,generated_at:now.toISOString()});
  // A rolling refresh assembles a new snapshot from retained historical facts
  // and freshly replaced recent facts; source_extractions retains their ages.
  const generated_at=history?now.toISOString():prior?prior.generated_at:type==='ads'&&state.history_retained?state.generated_at:source_extractions.map(s=>s.generated_at).sort()[0];
  const snapshot={schema_version:1,creator_ad_version:1,complete:true,...(onlyAccount?{isolated_account_id:onlyAccount.id,observation_contract:'account-local-direct-v1'}:{}),type,range,generated_at,source_extractions,accounts,fx:fx||await v2.loadFixings(range,fetcher)};
 // Validate conversion before allowing a producer to publish any new snapshot.
 renderSnapshot(snapshot,'USD');renderSnapshot(snapshot,'CZK');
 if(reuse&&type!=='aggregate')reuse.snapshots.push(snapshot);
 return snapshot;
}
function renderSnapshot(snapshot,currency='USD',accountFilter='All',campaignMetadata){
 if(!['USD','CZK'].includes(currency)||!['All','TUC','TGLV'].includes(accountFilter))throw new Error('Invalid display scope');
 if(!['daily','aggregate','ads'].includes(snapshot?.type)||!v2.validDate(snapshot?.range?.since)||!v2.validDate(snapshot?.range?.until)||snapshot.range.since>snapshot.range.until)throw new Error('Invalid snapshot scope');
 const count=snapshot?.isolated_account_id?1:2;
 if(snapshot?.schema_version!==1||snapshot.complete!==true||snapshot.accounts?.length!==count||new Set(snapshot.accounts.map(a=>a.id)).size!==count||(count===1&&snapshot.accounts[0].id!==snapshot.isolated_account_id))throw new Error('Incomplete account snapshot');
 if(snapshot.observation_contract!==undefined&&snapshot.observation_contract!=='account-local-direct-v1')throw Error('Invalid observation contract');
 if(snapshot.observation_contract&&!hasDirectObservations(snapshot))throw Error('Missing direct observation');
 for(const account of snapshot.accounts){v2.assertAccount(account);for(const row of account.rows||[])v2.assertRowOwnership(row,account);}
 if(snapshot.type!=='ads')for(const account of snapshot.accounts)for(const row of account.rows||[]){
  if(require('./glv-wl-creators.cjs').needsAdsets(row)&&(snapshot.creator_ad_version!==1||!require('../api/glv-meta-ads/fb-data.js')._test.cachedPayloadUsable(snapshot.type,{creator_version:2,creator_reconciliation_version:1,creator_ad_version:1,rows:[row]})))throw Error('Invalid creator ad facts; refresh required');
 }
 // Validate original facts before a label-only overlay: a campaign rename must
 // not retroactively invalidate otherwise usable historical creator coverage.
 snapshot=require('./glv-campaign-metadata.cjs').applySnapshot(snapshot,campaignMetadata);
 let rows=[],reach=new Map();
 for(const account of snapshot.accounts){v2.assertAccount(account);if(!Array.isArray(account.rows)||account.rows.some(r=>!v2.validDate(r.date_start)||r.date_start<snapshot.range.since||r.date_start>snapshot.range.until))throw new Error('Invalid cached rows');
  const seen=new Set();
  for(const row of account.rows){
   const identity=`${row.id}:${row.date_start}`;
   if(seen.has(identity)||!validAmount(row.impressions)||!validAmount(row.amount_spent)||(snapshot.type!=='ads'&&!validAmount(row.reach)))throw Error('Invalid cached metrics or identity');
   seen.add(identity);
  }
  if(accountFilter!=='All'&&accountFilter!==account.label)continue;
  rows.push(...account.rows.map(row=>v2.convertRow(row,account,currency,snapshot.fx)));
  for(const [key,value] of account.reach||[])reach.set(key,value);
 }
 const daily_rows=snapshot.type==='ads'?rows:undefined;
 if(snapshot.type!=='daily')rows=v2.aggregateRows(rows,reach);
 // Validate both observations even when rendering native money. Population and
 // nonmoney are canonical; only actual daily money is converted, never allocated.
 for(const account of snapshot.accounts){
  if(!account.direct_observation)continue;
  const observation=account.direct_observation;
  if(!snapshot.isolated_account_id||account.label!=='TUC'||observation.version!==1||observation.account_id!==account.id||observation.type!==snapshot.type||observation.basis!=='native_direct_period'||observation.range?.since!==snapshot.range.since||observation.range?.until!==snapshot.range.until||!Number.isFinite(Date.parse(observation.generated_at))||!Array.isArray(observation.rows))throw Error('Invalid direct observation scope');
  const validateObservationRow=row=>{
   v2.assertRowOwnership(row,account);
   if(snapshot.type==='aggregate'&&(row.date_start!==snapshot.range.since||row.date_stop!==snapshot.range.until||(!row.is_ghost&&!validAmount(row.reach))))throw Error('Invalid direct observation dates or reach');
   const metrics=['amount_spent','impressions','actions:link_click','actions:landing_page_view','actions:omni_purchase','actions:initiate_checkout','actions:outbound_click','actions:lead','action_values:omni_purchase',...(snapshot.type==='ads'?['video_thruplay_watched_actions','video_3_sec_watched_actions','video_p100_watched_actions']:[])];
   if(!row.id||metrics.some(k=>!['number','string'].includes(typeof row[k])||String(row[k]).trim()===''||!Number.isFinite(Number(row[k]))||(!row.is_ghost&&Number(row[k])<0)))throw Error('Invalid direct observation metrics');
   for(const child of row.creator_rows||[])validateObservationRow(child);
  };
  observation.rows.forEach(validateObservationRow);
  if(snapshot.type==='aggregate'&&!require('../api/glv-meta-ads/fb-data.js')._test.cachedPayloadUsable('aggregate',{creator_version:2,creator_reconciliation_version:1,creator_ad_version:1,rows:observation.rows}))throw Error('Invalid direct observation creator facts');
  if(accountFilter!=='All'&&accountFilter!==account.label)continue;
  const original=require('./glv-campaign-metadata.cjs').applyRows(observation.rows,account.id,snapshot.type,campaignMetadata).rows;
  const converted=v2.aggregateRows(account.rows.map(r=>v2.convertRow(r,account,'USD',snapshot.fx)),new Map(account.reach));
  const composed=require('./glv-mad-v2-observations.cjs').composeObservation(original,converted,snapshot.type,account.rows);
  rows=[...rows.filter(r=>r.account_id!==account.id),...(currency==='CZK'?composed.native:composed.usd)];
 }
 return {rows,...(daily_rows?{daily_rows}:{}),observation_complete:hasDirectObservations(snapshot),observation_contract:snapshot.observation_contract||'legacy-native-daily',observation_provenance:snapshot.accounts.filter(a=>accountFilter==='All'||accountFilter===a.label).map(a=>({account_id:a.id,population_basis:a.direct_observation?'canonical_direct_observation_plus_creator_reconciliation_union':'native_daily',nonmonetary_basis:a.direct_observation?'native_direct_period':'native_daily',monetary_basis:a.direct_observation&&currency==='CZK'?'native_direct_period':'observed_daily_CNB',direct_period:a.direct_observation?{range:a.direct_observation.range,generated_at:a.direct_observation.generated_at}:null,daily_extractions:(snapshot.source_extractions||[]).filter(e=>e.basis!=='native_direct_period'&&(!e.account_id||e.account_id===a.id))})),campaign_metadata:snapshot.campaign_metadata,performance_generation_id:snapshot.performance_generation_id,range:snapshot.range,generated_at:snapshot.generated_at,source_extractions:snapshot.source_extractions,...(snapshot.generation_id?{generation_id:snapshot.generation_id,generation_manifest:snapshot.generation_manifest}:{}),report_currency:currency,account_filter:accountFilter,accounts:v2.ACCOUNTS,complete:true,creator_version:2,creator_reconciliation_version:1,creator_ad_version:1,...(snapshot.type==='ads'?{wl_version:3}:{}),warnings:[...new Set(rows.filter(r=>r.naming_warning).map(r=>`${r.campaign_name||r.name}: ${r.naming_warning}`))],date_note:'Dates use each account’s local calendar (Prague / Los Angeles), combined by date label without rebucketing. Daily CNB rates; prior published fixing on non-business days.'};
}
function hasDirectObservations(snapshot){
 // Legacy native data remains readable for retention, never certified as the new
 // producer contract. Daily rows already have the native V1 observation basis.
 return snapshot?.type==='daily'||snapshot?.accounts?.every(a=>a.label!=='TUC'||Boolean(a.direct_observation));
}
function browserDailyAds(rows){return Buffer.byteLength(JSON.stringify(rows))<=2*1024*1024?{daily_rows:rows}:{daily_rows_unavailable:"Optional daily creative extract exceeds size budget"};}
module.exports={browserDailyAds,buildSnapshot,renderSnapshot,validateCampaign,hasDirectObservations,cacheKey,CACHE_PREFIX};
