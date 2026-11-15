'use strict';
const v2=require('./glv-mad-v2.cjs'),runtime=require('./glv-mad-v2-isolated.cjs'),source=require('./glv-mad-v2-source.cjs'),publication=require('./glv-history-publication.cjs');
function scope(query,now=new Date()){
 const {type,date_preset='last_30d',time_range,currency='USD',account='All'}=query;
 if(![...runtime.TYPES,'promo_formats','promo_concepts'].includes(type)||!['USD','CZK'].includes(currency)||!['All','TUC','TGLV'].includes(account))throw Error('Invalid scope');
 const promo=type.startsWith('promo_'),through=runtime.target('morning',now),range=time_range?JSON.parse(time_range):promo?{since:'2026-03-01',until:through}:runtime.rangeFor(date_preset,through);
 if(!v2.validDate(range?.since)||!v2.validDate(range?.until)||range.since>range.until||range.until>through||(!promo&&Date.parse(range.until)-Date.parse(range.since)>89*86400000))throw Error('Invalid range');
 return {type,preset:date_preset,range,currency,account,promo,custom:Boolean(time_range)&&!promo};
}
function render(pieces,s){
 const p=pieces[s.type];if(!p)throw Error('Missing isolated piece');
 const selected=v2.ACCOUNTS.filter(a=>s.account==='All'||s.account===a.label);
 const selectedCoverage=p.account_coverage.filter(c=>selected.some(a=>a.id===c.account_id));
 const natives=selected.map(a=>p.account_bundles[a.id]).filter(Boolean);
 const omitted_accounts=natives.filter(n=>s.type!=='daily'&&(n.range.since!==p.range.since||n.range.until>p.range.until)).map(n=>n.isolated_account_id);
 const rendered=natives.filter(n=>!omitted_accounts.includes(n.isolated_account_id)).map(n=>source.renderSnapshot(n,s.currency,s.account));
 if(s.type==='daily')for(const r of rendered)r.rows=r.rows.filter(row=>row.date_start>=p.range.since&&row.date_start<=p.range.until);
 if(!rendered.length)return null;
 const exact=c=>c.range?.since===s.range.since&&c.range?.until===s.range.until&&!c.partial&&!c.missing;
 const coverage_complete=selectedCoverage.length===selected.length&&selectedCoverage.every(exact);
 const stale=!coverage_complete;
 return {...rendered[0],observation_complete:rendered.every(r=>r.observation_complete),observation_provenance:rendered.flatMap(r=>r.observation_provenance||[]),rows:rendered.flatMap(r=>r.rows),range:p.range,requested_range:s.range,cached_range:p.range,generation_id:p.generation_id,date_policy:'account-isolated',account_coverage:p.account_coverage,omitted_accounts,complete:true,coverage_complete,stale,report_currency:s.currency,account_filter:s.account,source_extractions:rendered.flatMap(r=>r.source_extractions||[]),generated_at:rendered.map(r=>r.generated_at).sort()[0],warnings:[...new Set(rendered.flatMap(r=>r.warnings||[]))],...(stale?{warning:'Account coverage is partial, missing or retained at its actual range; no missing days have been zero-filled.'}:{})};
}
async function consumer(read,s){
 if(s.promo)return require('./glv-mad-v2-isolated-promo.cjs').readRender(read,s);
 if(s.custom){
  // Reuse only an EXACT native period: daily slicing cannot establish reach.
  for(const preset of runtime.PRESETS){const p=await publication.readBundle({key:runtime.combinedKey(preset),read,validate:runtime.validateCombined});if(p&&p.daily.range.since===s.range.since&&p.daily.range.until===s.range.until&&p.daily.account_coverage.every(c=>c.range?.since===s.range.since&&c.range?.until===s.range.until))return render(p,s);}
  return null;
 }
 const p=await publication.readBundle({key:runtime.combinedKey(s.preset),read,validate:runtime.validateCombined});return p?render(p,s):null;
}
async function handler(req,res){
 const api=require('../api/glv-meta-ads-v2/fb-data.js')._test;
 res.setHeader('Cache-Control','private, no-store');
 if(!api.authorized(req))return res.status(401).json({error:'Unauthorized'});
 if(req.method!=='GET')return res.status(405).json({error:'Read-only API'});
 let s;try{s=scope(req.query||{});}catch{return res.status(400).json({error:'Invalid V2 scope; select at most 90 days through Prague yesterday.'});}
 try{let result=await consumer(api.readCache,s);if(!result&&s.custom)result=await require('./glv-mad-v2-isolated-custom.cjs').get({scope:s});if(!result)return res.status(503).json({complete:false,date_policy:'account-isolated',error:s.custom?'Exact custom range not published; no shared/V1 fallback is permitted.':'Isolated V2 publication unavailable; scheduled account recovery required.'});res.setHeader('X-Cache',result.stale?'STALE':'HIT');return res.json(result);}catch{return res.status(503).json({complete:false,error:'Isolated V2 publication validation failed; last-good retained.'});}
}
module.exports={scope,render,consumer,handler};
