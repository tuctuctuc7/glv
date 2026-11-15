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
module.exports={validateCampaign,shift,formatRange};
