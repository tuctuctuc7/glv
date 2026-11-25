'use strict';
// Native V1 validation; keep strict metrics without importing V2 producers.
const {validDate}=require('../public/glv-meta-ads/promo-format.js');
const shift=(date,days)=>new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
function validAmount(value){return (typeof value==='number'||typeof value==='string')&&String(value).trim()!==''&&Number.isFinite(Number(value))&&Number(value)>=0;}
function validateCampaign(row,range,period=false){
 if(!row||typeof row.campaign_id!=='string'||!/^\d+$/.test(row.campaign_id)||typeof row.campaign_name!=='string'||!row.campaign_name.trim())throw Error('Invalid campaign source identity');
 if(!validDate(row.date_start)||!validDate(row.date_stop)||row.date_start<range.since||row.date_stop>range.until||row.date_start>row.date_stop||(period?(row.date_start!==range.since||row.date_stop!==range.until):row.date_start!==row.date_stop))throw Error('Invalid campaign source dates');
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
// The shared Promo parser accepts UTC calendar dates. Supply Prague's local
// calendar day without changing the extraction timestamp or shared V2 helper.
function formatRange(query={},now=new Date()){
 const {day}=require('../public/glv-meta-ads/v1-dates.js');
 return require('./glv-promo-format.cjs').formatRange(query,new Date(day(now)+'T12:00:00Z'));
}
// Native V1 additive rollup. Creator identities and signed reconciliation facts
// are retained; period-unique reach is deliberately unavailable.
function aggregateDaily(rows,range){
 const groups=new Map();
 for(const row of rows){
  const key=JSON.stringify([row.account_id||null,row.is_ghost?'ghost':row.ad_id||row.adset_id||row.id]);
  if(!groups.has(key))groups.set(key,{...row,...Object.fromEntries(Object.keys(row).filter(k=>k.startsWith('actions:')||k.startsWith('action_values:')).map(k=>[k,0])),amount_spent:0,impressions:0,reach:null,frequency:null,date_start:range.since,date_stop:range.until,creator_rows:[]});
  const out=groups.get(key);
  for(const k of Object.keys(row).filter(k=>k==='amount_spent'||k==='impressions'||k.startsWith('actions:')||k.startsWith('action_values:'))){
   if(!Number.isFinite(Number(row[k])))throw Error('Invalid additive fact');
   out[k]=(out[k]||0)+Number(row[k]);
  }
  out.creator_rows.push(...(row.creator_rows||[]));
  if(row.creator_issue)out.creator_issue=row.creator_issue;
 }
 return [...groups.values()].map(row=>({...row,creator_rows:aggregateDaily(row.creator_rows,range)}));
}
module.exports={validateCampaign,shift,formatRange,aggregateDaily};
