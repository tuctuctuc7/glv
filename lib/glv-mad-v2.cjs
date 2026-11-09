'use strict';
const dates=require('../public/glv-meta-ads-v2/dates.js');
const {createHash}=require('node:crypto');
function parseCnb(text,source){
 const lines=text.trim().split(/\r?\n/),header=lines.shift().split('|'),column=header.indexOf('1 USD');
 if(header[0]!=='Date'||column<1)throw new Error('Invalid CNB header');
 const sha256=createHash('sha256').update(text).digest('hex'),out={};
 for(const line of lines){
  const parts=line.split('|'),match=/^(\d{2})\.(\d{2})\.(\d{4})$/.exec(parts[0]);
  const date=match&&`${match[3]}-${match[2]}-${match[1]}`,rate=Number(parts[column]);
  if(!dates.validDate(date)||parts.length!==header.length||!Number.isFinite(rate)||rate<=0||out[date])throw new Error('Invalid CNB fixing');
  out[date]={date,czk_per_usd:rate,source,sha256,provider:'Czech National Bank'};
 }
 if(!Object.keys(out).length)throw new Error('Empty CNB response');
 return out;
}
function fixingFor(day,table){
 if(!dates.validDate(day))throw new Error('Invalid FX date');
 for(let n=0;n<=10;n++){const date=dates.shift(day,-n);if(table[date])return table[date];}
 throw new Error('Official daily FX unavailable');
}
function convertMoney(value,from,to,fixing){
 if(value===null||value===undefined||String(value).trim()===''||!Number.isFinite(Number(value)))throw new Error('Invalid monetary input');
 if(!['USD','CZK'].includes(from)||!['USD','CZK'].includes(to))throw new Error('Unsupported currency');
 if(from===to)return Number(value);
 if(!Number.isFinite(fixing?.czk_per_usd)||fixing.czk_per_usd<=0)throw new Error('Invalid FX fixing');
 return from==='USD'?Number(value)*fixing.czk_per_usd:Number(value)/fixing.czk_per_usd;
}
async function loadFixings(range,fetcher=fetch){
 const out={};
 const first=Number(dates.shift(range.since,-10).slice(0,4)),last=Number(range.until.slice(0,4));
 for(let year=first;year<=last;year++){
  const url=`https://www.cnb.cz/en/financial_markets/foreign_exchange_market/exchange_rate_fixing/year.txt?year=${year}`;
  const response=await fetcher(url,{signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error('Official FX source unavailable');
  Object.assign(out,parseCnb(await response.text(),url));
 }
 const selected={};
 for(let day=range.since;day<=range.until;day=dates.shift(day,1)){const fixing=fixingFor(day,out);selected[fixing.date]=fixing;}
 return selected;
}
const MONEY=['amount_spent','action_values:omni_purchase'];
const ADDITIVE=[...MONEY,'impressions','actions:link_click','actions:landing_page_view','actions:omni_purchase','actions:initiate_checkout','actions:outbound_click','actions:lead','video_thruplay_watched_actions','video_3_sec_watched_actions','video_p100_watched_actions'];
function assertAccount(account){
 const expected=dates.ACCOUNTS.find(a=>a.id===account.id);
 if(!expected||expected.currency!==account.currency||expected.timezone!==account.timezone||(account.label!==undefined&&expected.label!==account.label))throw new Error('Account identity mismatch');
 return expected;
}
function convertRow(row,account,currency,table){
 const expected=assertAccount(account),day=row.date_start,fixing=fixingFor(day,table);
 if(!row.id||row.native)throw new Error('Invalid native row identity');
 const name=row.campaign_name||row.name||'',prefix=expected.label==='TGLV'?/^TGLV_\d+_/:/^(TUC|GLV)_\d+_/;
 const out={...row,source_id:row.id,id:`${account.id}:${row.id}`,account_id:account.id,account_label:expected.label,native_currency:account.currency,account_timezone:account.timezone,report_currency:currency,
  market:expected.label==='TGLV'?'US':name.includes('_US_')?'US':'CZSK',
  naming_warning:prefix.test(name)?null:`${expected.label}: campaign prefix mismatch; retained under account ${account.id}`,
  native:Object.fromEntries(MONEY.map(k=>[k,row[k]])),fx:{...fixing,reporting_date:day,fallback:fixing.date!==day}};
 for(const k of MONEY)out[k]=convertMoney(row[k],account.currency,currency,fixing);
 for(const key of ['campaign_id','adset_id'])if(row[key]){out['source_'+key]=row[key];out[key]=`${account.id}:${row[key]}`;}
 if(row.creator_rows)out.creator_rows=row.creator_rows.map(child=>convertRow({...child,date_start:day},account,currency,table));
 return out;
}
function aggregateRows(rows,reach=new Map()){
 const groups=new Map();
 for(const row of rows){
  const key=row.is_ghost?`${row.id}:ghost`:row.adset_id&&!row.campaign_id?row.adset_id:row.id;
  if(!groups.has(key))groups.set(key,{...row,...Object.fromEntries(ADDITIVE.map(k=>[k,0])),native:Object.fromEntries(MONEY.map(k=>[k,0])),reach:reach.get(row.id)??null,daily_provenance:[],creator_rows:[]});
  const out=groups.get(key);
  for(const k of ADDITIVE){const n=row[k]??0;if(!Number.isFinite(Number(n)))throw new Error('Invalid additive metric');out[k]+=Number(n);}
  for(const k of MONEY)out.native[k]+=Number(row.native[k]);
  out.daily_provenance.push({date:row.date_start,native:row.native,fx:row.fx});
  out.creator_rows.push(...(row.creator_rows||[]));
 }
 return [...groups.values()].map(row=>({...row,date_start:null,date_stop:null,fx:undefined,creator_rows:aggregateRows(row.creator_rows)}));
}
// Independent release switch: beta credentials never imply V2 activation.
const rolloutEnabled=(env=process.env)=>env.GLV_MAD_V2_ENABLED==='1';
module.exports={rolloutEnabled,...dates,parseCnb,fixingFor,convertMoney,loadFixings,assertAccount,convertRow,aggregateRows};
