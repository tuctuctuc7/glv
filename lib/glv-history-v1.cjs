'use strict';
const publication=require('./glv-history-publication.cjs');
const {validDate}=require('../public/glv-meta-ads/promo-format.js');
const key=preset=>`glv:published:${preset}`;
const number=v=>(typeof v==='number'||typeof v==='string')&&String(v).trim()!==''&&Number.isFinite(Number(v))&&Number(v)>=0;
function validateAd(row){
 if(!row||!number(row.spend)||!number(row.impressions))throw Error('Invalid ad required metric');
 for(const key of ['actions','action_values','video_p100_watched_actions','video_thruplay_watched_actions'])if(row[key]!==undefined&&(!Array.isArray(row[key])||row[key].some(a=>typeof a.action_type!=='string'||!number(a.value))))throw Error('Invalid ad action metric');
 return row;
}
function valid(type,payload,now=new Date()){
 try{return validPayload(type,payload,now);}catch{return false;}
}
function validPayload(type,payload,now){
 if(!require('../api/glv-meta-ads/fb-data.js')._test.cachedPayloadUsable(type,payload))return false;
 if(!validDate(payload.range?.since)||!validDate(payload.range?.until)||payload.range.since>payload.range.until||!Number.isFinite(Date.parse(payload.generated_at))||Date.parse(payload.generated_at)>+now)return false;
 const seen=new Set();
 return payload.rows.every(row=>{
  const identity=`${row.id}:${type==='daily'?row.date_start:''}`;
  if(!row.id||typeof row.name!=='string'||seen.has(identity)||!number(row.amount_spent)||!number(row.impressions))return false;
  seen.add(identity);
  for(const [k,v] of Object.entries(row))if((k.startsWith('actions:')||k.startsWith('action_values:'))&&!number(v))return false;
  if(type==='ads')return typeof row.campaign_name==='string'&&Boolean(row.campaign_id);
  return validDate(row.date_start)&&validDate(row.date_stop)&&row.date_start>=payload.range.since&&row.date_stop<=payload.range.until&&row.date_start<=row.date_stop&&(type!=='daily'||row.date_start===row.date_stop);
 });
}
function validate(pieces){
 const first=pieces.daily;
 if(!first)throw Error('Missing published daily source');
 for(const type of publication.TYPES){
  const p=pieces[type];
  if(!valid(type,p)||JSON.stringify(p.range)!==JSON.stringify(first.range))throw Error('Invalid V1 bundle');
  if(first.generation_id&&p.generation_id!==first.generation_id)throw Error('Incoherent V1 generation');
 }
 // Before migration V1 had no bundle ID. Only co-temporal same-scope legacy
 // pieces may be grouped, never a previous-day ad piece plus today's campaigns.
 if(!first.generation_id&&Math.max(...Object.values(pieces).map(p=>Date.parse(p.generated_at)))-Math.min(...Object.values(pieces).map(p=>Date.parse(p.generated_at)))>300000)throw Error('Incoherent V1 legacy times');
}
async function readLegacy(read,preset){
 const pieces=Object.fromEntries(await Promise.all(publication.TYPES.map(async type=>[type,await read(`glv:${type}:${preset}`)])));
 try{validate(pieces);}catch{return null;}
 const generation_id=publication.digest(pieces);
 return Object.fromEntries(publication.TYPES.map(type=>[type,{...pieces[type],generation_id}]));
}
const readPublished=(read,preset)=>publication.readBundle({key:key(preset),read,validate});
async function savePublished(write,preset,pieces,read,redis){
 validate(pieces);
 const generation_id=publication.digest(pieces);
 const bundle=Object.fromEntries(publication.TYPES.map(t=>[t,{...pieces[t],generation_id}]));
 return publication.publishBundle({key:key(preset),pieces:bundle,validate,write,read,retire:redis?publication.retireRedis(redis):undefined});
}
async function retain(redis,write,preset){
 const pieces={};
 for(const type of publication.TYPES){
  const k=`glv:${type}:${preset}`,bytes=(await redis('GET',k)).result;let p;
  try{p=JSON.parse(bytes);}catch{}
  if(!valid(type,p))continue;
  await redis('PERSIST',k);
  if((await redis('TTL',k)).result!==-1)throw Error('V1 last-good retention not verified');
  pieces[type]=p;
 }
 if((await redis('GET',key(preset))).result)return;
 try{validate(pieces);}catch{return;}
 await savePublished(write,preset,pieces,async k=>JSON.parse((await redis('GET',k)).result),redis);
}
function state(payload,range,now=new Date()){
 const coverage_complete=payload.range.since===range.since&&payload.range.until===range.until;
 return {stale:!coverage_complete||now-Date.parse(payload.generated_at)>90000000,coverage_complete,requested_range:range,cached_range:payload.range};
}
module.exports={readLegacy,valid,validateAd,validate,key,readPublished,savePublished,retain,state};
