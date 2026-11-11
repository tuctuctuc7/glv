'use strict';
const {buildSnapshot,renderSnapshot,cacheKey}=require('../../lib/glv-mad-v2-source.cjs');
const {rangeFor,validDate,commonCutoff}=require('../../lib/glv-mad-v2.cjs');
const {presetKey,cacheState,boundedTransport}=require('../../lib/glv-mad-v2-cache.cjs');
const {renderPromo,CACHE_KEY:PROMO_KEY}=require('../../lib/glv-mad-v2-promo.cjs');
const {resolveRedisConfig}=require('../glv-meta-ads/fb-data.js')._test;
function authorized(req){const expected=process.env.GLV_META_BETA_AUTH_TOKEN;return Boolean(expected&&String(req.headers?.cookie||'').split(';').some(part=>{const [k,...v]=part.trim().split('=');return k==='glv_meta_beta'&&v.join('=')===expected;}));}
async function readCache(key){
 const config=resolveRedisConfig();if(!config)return null;
 try{const response=await boundedTransport(fetch,Date.now()+5000)(`${config.url}/get/${encodeURIComponent(key)}`,{headers:{Authorization:`Bearer ${config.token}`},signal:AbortSignal.timeout(5000)});if(!response.ok)return null;const body=await response.json();return body.result?require('../../lib/glv-mad-v2-storage.cjs').decode(body.result):null;}catch{return null;}
}
async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(!authorized(req))return res.status(401).json({error:'Unauthorized'});
 if(req.method!=='GET')return res.status(405).json({error:'Read-only API'});
 const {type,currency='USD',account='All',date_preset='last_30d',time_range}=req.query||{};
 const promo=['promo_formats','promo_concepts'].includes(type);
 let range;
 try{
  if(!['aggregate','daily','ads','promo_formats','promo_concepts'].includes(type)||!['USD','CZK'].includes(currency)||!['All','TUC','TGLV'].includes(account))throw new Error();
  range=promo?{since:'2026-03-01',until:commonCutoff()}:time_range?JSON.parse(time_range):rangeFor(date_preset);
  if(!validDate(range.since)||!validDate(range.until)||range.since>range.until||range.until>commonCutoff()||Date.parse(range.until)-Date.parse(range.since)>366*86400000)throw new Error();
 }catch{return res.status(400).json({error:'Invalid V2 scope; select completed dates, USD/CZK and All/TUC/TGLV'});}
 try{
  if(!require('../../lib/glv-mad-v2.cjs').rolloutEnabled())return res.status(503).json({complete:false,error:'V2 rollout is disabled'});
  const names=require('../../lib/glv-campaign-metadata.cjs');
  let bundleHasFacts=false;
  const readNames=async snapshot=>(bundleHasFacts||snapshot?.accounts?.some(a=>a.rows?.length)||snapshot?.payload?.rows?.length)?names.read(readCache):null;
  let cached;
  if(!promo&&!time_range){
   const {readPublished,readLegacy}=require('../../lib/glv-mad-v2-cache.cjs');
   const bundle=await readPublished(readCache,date_preset)||await readLegacy(readCache,date_preset);
   cached=bundle?.[type];
   bundleHasFacts=Object.values(bundle||{}).some(s=>s.accounts?.some(a=>a.rows?.length));
  }else cached=await readCache(promo?PROMO_KEY:cacheKey(type,range));
  if(cached){
   try{
    const campaignMetadata=await readNames(cached);
    const result=promo?renderPromo(cached,currency,account,new Date(),campaignMetadata):renderSnapshot(cached,currency,account,campaignMetadata);
    const state=cacheState(cached,{type:promo?null:type,range,promoPayload:promo});
    res.setHeader('X-Cache',state.stale?'STALE':'HIT');
    return res.json({...result,...state,...(state.stale?{warning:'Last-good snapshot; shared refresh has not verified requested coverage.'}:{})});
   }catch{/* Invalid cache must not masquerade as complete facts. */}
  }
  // Presets/history are owned only by the shared cron; custom reads remain live.
  if(promo||!time_range)return res.status(503).json({complete:false,error:'V2 cache unavailable; awaiting shared refresh owner.'});
  const token=process.env.GLV_MAD_V2_FB_ACCESS_TOKEN||process.env.GLV_META_FB_ACCESS_TOKEN||process.env.AGENTHIC_META_ACCESS_TOKEN||process.env.FB_ACCESS_TOKEN;
  if(!token)return res.status(503).json({error:'V2 Meta source is not configured'});
  const snapshot=await buildSnapshot({range,type,token});
  const campaignMetadata=await readNames(snapshot);
  res.setHeader('X-Cache','MISS');return res.json(renderSnapshot(snapshot,currency,account,campaignMetadata));
 }catch{return res.status(502).json({complete:false,error:'Both account sources and official daily FX must be available. No partial account totals are shown.'});}
}
module.exports=handler;
module.exports._test={authorized,readCache};
