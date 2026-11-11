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
 if(!b){
  if(version!=='v1')return null;
  const legacy=require('./glv-history-v1.cjs'),old=await legacy.readPublished(readValue,preset)||await legacy.readLegacy(readValue,preset);
  return old?{...shared.tucPayload(names.applyPayload(old[type],v2.ACCOUNTS[0].id,type,metadata)),shared_migration_pending:true}:null;
 }
 return shared.render(b,type,version,currency,account,metadata);
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
  return res.json({...result,...state,...(state.stale?{warning:'Last-good snapshot at its actual range; requested coverage is not verified.'}:{})});
 }catch{return res.status(503).json({complete:false,error:'Shared publication unavailable; incomplete source or currency coverage. Owner recovery required.'});}
}
module.exports={scope,consumer,handler};
