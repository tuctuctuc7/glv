'use strict';
const v2=require('./glv-mad-v2.cjs');
const {sliceCachedFormats}=require('./glv-promo-format.cjs');
const CACHE_KEY='glv:mad:v2:promo:1';
function renderPromo(snapshot,currency='USD',account='All',now=new Date(),campaignMetadata){
 if(!['USD','CZK'].includes(currency)||!['All','TUC','TGLV'].includes(account))throw new Error('Invalid V2 Promo scope');
 let payload=snapshot?.payload?.range&&sliceCachedFormats(snapshot.payload,snapshot.payload.range,now,{allowStale:true});
 if(!payload)throw new Error('Invalid V2 Promo snapshot');
 const source=v2.ACCOUNTS[0];
 if(campaignMetadata)payload=require('./glv-campaign-metadata.cjs').applyPayload(payload,source.id,'promo_formats',campaignMetadata);
 const rows=payload.rows.map(row=>{
  const fx=v2.fixingFor(row.date,snapshot.fx);
  const out={...row,account_id:source.id,account_label:source.label,native_currency:source.currency,account_timezone:source.timezone,report_currency:currency,market:'CZSK',native:{spend:row.spend,revenue:row.revenue},fx:{...fx,reporting_date:row.date,fallback:fx.date!==row.date}};
  for(const key of ['campaign_id','adset_id','ad_id'])if(row[key]){out['source_'+key]=row[key];out[key]=`${source.id}:${row[key]}`;}
  for(const key of ['spend','revenue'])out[key]=v2.convertMoney(row[key],source.currency,currency,fx);
  return out;
 });
 return {...payload,rows:account==='TGLV'?[]:rows,report_currency:currency,account_filter:account,accounts:v2.ACCOUNTS,complete:true};
}
module.exports={renderPromo,CACHE_KEY};
