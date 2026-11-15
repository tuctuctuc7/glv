'use strict';
// Both routes use this reader. No independently aged V2 fallback is permitted.
const v2=require('./glv-mad-v2.cjs'),shared=require('./glv-mad-shared.cjs'),names=require('./glv-campaign-metadata.cjs');
const cache=require('./glv-mad-v2-cache.cjs');
function scope(query,now=new Date()){
 const {type,date_preset='last_30d',time_range,currency='USD',account='All'}=query;
 if(![...cache.TYPES,'promo_formats','promo_concepts'].includes(type)||!['USD','CZK'].includes(currency)||!['All','TUC','TGLV'].includes(account))throw Error('Invalid scope');
 const promo=type.startsWith('promo_');
 const range=time_range?JSON.parse(time_range):promo?{since:'2026-03-01',until:v2.commonCutoff(now)}:v2.rangeFor(date_preset,now);
 if(!v2.validDate(range.since)||!v2.validDate(range.until)||range.since>range.until||range.until>v2.commonCutoff(now)||(!promo&&Date.parse(range.until)-Date.parse(range.since)>89*86400000))throw Error('Select at most 90 completed days');
 if(!promo&&!time_range&&!cache.PRESETS.includes(date_preset))throw Error('Invalid preset');
 return {type,preset:date_preset,range,promo,custom:Boolean(time_range)&&!promo,currency,account};
}
async function consumer(readValue,{version,type,preset,currency='CZK',account='All',range,promo=false},metadata){
 if(promo)return require('./glv-mad-shared-promo.cjs').readRender(readValue,{version,type,currency,account,range},metadata);
 const b=await shared.read(readValue,preset);
 if(version==='v1'){
  // V1 is TUC-only and must never wait on V2/TGLV work. Serve V1's own
  // verified publication whenever it is newer than the shared bundle.
  const legacy=require('./glv-history-v1.cjs'),own=await legacy.readPublished(readValue,preset)||await legacy.readLegacy(readValue,preset);
  if(own&&(!b||own[type]?.range?.until>b.range.until))return {...shared.tucPayload(names.applyPayload(own[type],v2.ACCOUNTS[0].id,type,metadata)),...(b?{v1_ahead_of_shared:true}:{shared_migration_pending:true})};
 }
 if(!b)return null;
 return shared.render(b,type,version,currency,account,metadata);
}
// LA wall-clock time of a UTC instant, e.g. "17:05 PST".
const laTime=iso=>new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZoneName:'short'}).format(new Date(iso));
// Scheduled TGLV completion instant: 01:00 Los Angeles on the day after `day`.
function tglvCompletionAt(day){
 const next=v2.shift(day,1);
 for(const h of [8,9]){const t=new Date(`${next}T0${h}:00:00Z`);if(new Intl.DateTimeFormat('en-GB',{timeZone:'America/Los_Angeles',hour:'2-digit',hour12:false}).format(t)==='01')return t;}
 return new Date(`${next}T09:00:00Z`);
}
const ictTime=t=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit',hour12:false}).format(t)+' GMT+7';
function refreshNotes(result,version,account){
 if(version!=='v2'||account==='TUC')return {};
 const tglv=(result.account_coverage||[]).find(a=>a.label==='TGLV');
 if(!tglv)return {};
 if(tglv.partial_day)return {tglv_partial:true,partial_note:`TGLV (US) ${tglv.partial_day} is partial: Meta data pulled at ${laTime(tglv.extracted_at)} Los Angeles time, so it covers that day only until then. The full day is pulled after LA midnight (TGLV refresh ~${ictTime(tglvCompletionAt(tglv.partial_day))}).`};
 return {tglv_partial:false,refresh_note:`Both accounts have full data through ${result.range.until}.`};
}
async function handler(req,res,version){
 res.setHeader('Cache-Control','private, no-store');
 const api=require('../api/glv-meta-ads-v2/fb-data.js')._test;
 if(!api.authorized(req))return res.status(401).json({error:'Unauthorized'});
 if(req.method!=='GET')return res.status(405).json({error:'Read-only API'});
 let s;try{s=scope(req.query||{});}catch{return res.status(400).json({error:'Invalid shared scope; select at most 90 completed days, USD/CZK and All/TUC/TGLV'});}
 if(version==='v1'){s.currency='CZK';s.account='TUC';}
 try{
  const metadata=await names.read(api.readCache);
  let result;
  if(s.custom)result=await require('./glv-mad-shared-custom.cjs').get({scope:s,version,metadata});
  else result=await consumer(api.readCache,{...s,version},metadata);
  if(!result)return res.status(503).json({complete:false,error:'Shared publication unavailable; last-good retained and owner recovery required.'});
  const state=require('./glv-history-v1.cjs').state(result,s.range);
  res.setHeader('X-Cache',state.stale?'STALE':'HIT');
  const notes=refreshNotes(result,version,s.account);
  const warning=[notes.partial_note,state.stale?'Last-good snapshot at its actual range; requested coverage is not verified.':''].filter(Boolean).join(' ');
  return res.json({...result,...state,...(notes.refresh_note?{refresh_note:notes.refresh_note}:{}),...(notes.tglv_partial!==undefined?{tglv_partial:notes.tglv_partial}:{}),...(warning?{warning}:{})});
 }catch{return res.status(503).json({complete:false,error:'Shared publication unavailable; incomplete source or currency coverage. Owner recovery required.'});}
}
module.exports={scope,consumer,handler,refreshNotes,tglvCompletionAt};
