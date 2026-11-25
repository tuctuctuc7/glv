'use strict';
// Read-only zoom adapter. Validate ORIGINAL native publications before selecting
// daily facts; never relax the producer's direct-period observation contract.
const v2=require('./glv-mad-v2.cjs'),source=require('./glv-mad-v2-source.cjs');
const runtime=require('./glv-mad-v2-isolated.cjs'),publication=require('./glv-history-publication.cjs');
const CONTRACT='cached-daily-v1';
const same=(a,b)=>a.since===b.since&&a.until===b.until;
function validateScope(s){
 if(!runtime.TYPES.includes(s?.type)||!['USD','CZK'].includes(s.currency)||!['All','TUC','TGLV'].includes(s.account)||!v2.validDate(s.range?.since)||!v2.validDate(s.range?.until)||s.range.since>s.range.until)throw Error('Invalid projection scope');
}
function validateAccount(bundle,id,now){
 runtime.validateNative(bundle);
 for(const type of runtime.TYPES){
  const s=bundle[type],age=+now-Date.parse(s.generated_at);
  if(s.isolated_account_id!==id||!Number.isFinite(age)||age<0||!v2.validDate(s.complete_through)||s.complete_through>s.range.until||typeof s.partial!=='boolean'||(!s.partial&&s.complete_through!==s.range.until))throw Error('Invalid cached coverage');
  for(const a of s.accounts)for(const row of a.rows){
   if(row.date_stop!==row.date_start)throw Error('Not a native daily fact');
  }
 }
}
function project(bundle,type,range,currency,account){
 const native=bundle[type==='aggregate'?'daily':type];
 // Exact observations stay exact, including their unique period reach.
 if(same(bundle.daily.range,range))return source.renderSnapshot(bundle[type],currency,account);
 const original=source.renderSnapshot(native,currency,account);
 const rows=native.accounts.flatMap(a=>a.rows.filter(r=>r.date_start>=range.since&&r.date_start<=range.until).map(r=>v2.convertRow(r,a,currency,native.fx)));
 const unavailable=row=>({...row,reach:null,frequency:null,creator_rows:(row.creator_rows||[]).map(unavailable)});
 return {...original,rows:type==='daily'?rows:v2.aggregateRows(rows,new Map()).map(unavailable),range:{...range},observation_complete:false,observation_contract:CONTRACT,
  projection:{contract:CONTRACT,source_range:native.range,source_generated_at:native.generated_at,source_generation_id:native.generation_id},
  observation_provenance:native.accounts.map(a=>({account_id:a.id,population_basis:'cached_native_daily',nonmonetary_basis:'observed_daily_additive_only',monetary_basis:'observed_daily_CNB',direct_period:null,daily_extractions:(native.source_extractions||[]).filter(e=>e.basis!=='native_direct_period')}))};
}
async function read(readCache,s,now=new Date()){
 validateScope(s);
 const candidates=[];
 const slot=require('./glv-mad-v2-isolated-custom.cjs').slot(s.range);
 for(const preset of [slot,...runtime.PRESETS]){
  try{
   const b=await publication.readBundle({key:runtime.combinedKey(preset),read:readCache,validate:runtime.validateCombined});
   if(!b)continue;
   for(const a of v2.ACCOUNTS){
    if(!b.daily.account_bundles[a.id])continue;
    const native=Object.fromEntries(runtime.TYPES.map(t=>[t,b[t].account_bundles[a.id]]));
    validateAccount(native,a.id,now);
    const r=native.daily.range;
    if(r.since>s.range.since||r.until<s.range.until)continue;
    candidates.push({id:a.id,native,exact:same(r,s.range)});
   }
  }catch{/* Invalid or foreign publications never become projection inputs. */}
  // Once both account periods are exact and complete, wider scheduled reads
  // cannot improve coverage. Keep the source choice independent of row type.
  if(v2.ACCOUNTS.every(a=>candidates.some(c=>c.id===a.id&&c.exact&&c.native.daily.complete_through>=s.range.until)))break;
 }
 const coveredThrough=c=>c.native.daily.complete_through<s.range.until?c.native.daily.complete_through:s.range.until;
 const selected=v2.ACCOUNTS.map(a=>candidates.filter(c=>c.id===a.id).sort((a,b)=>coveredThrough(b).localeCompare(coveredThrough(a))||Number(b.exact)-Number(a.exact)||b.native.daily.generated_at.localeCompare(a.native.daily.generated_at))[0]).filter(Boolean);
 if(!selected.length)return null;
 const generation_id=publication.digest({contract:CONTRACT,range:s.range,sources:selected.map(c=>({id:c.id,generation:c.native.daily.generation_id,exact:c.exact}))});
 const account_coverage=v2.ACCOUNTS.map(a=>{
  const d=selected.find(c=>c.id===a.id)?.native.daily;
  if(!d)return {account_id:a.id,range:null,complete_through:null,partial:true,missing:true,generated_at:null};
  const complete_through=d.complete_through<s.range.until?d.complete_through:s.range.until;
  return {account_id:a.id,range:{...s.range},complete_through,partial:complete_through<s.range.until,generated_at:d.generated_at};
 });
 const chosen=selected.filter(c=>s.account==='All'||v2.ACCOUNTS.find(a=>a.id===c.id).label===s.account);
 if(!chosen.length)return null;
 const rendered=chosen.map(c=>project(c.native,s.type,s.range,s.currency,s.account));
 const derived=chosen.some(c=>!c.exact),required=account_coverage.filter(c=>s.account==='All'||v2.ACCOUNTS.find(a=>a.id===c.account_id).label===s.account);
 const coverage_complete=required.every(c=>!c.partial&&!c.missing);
 const base={...rendered[0]};delete base.daily_rows;delete base.daily_rows_unavailable;
 return {...base,rows:rendered.flatMap(r=>r.rows),...(s.type==='ads'?source.browserDailyAds(rendered.flatMap(r=>(r.daily_rows||[]).filter(row=>row.date_start>=s.range.since&&row.date_start<=s.range.until))):{}),range:s.range,requested_range:s.range,cached_range:s.range,generation_id,date_policy:'account-isolated',account_coverage,complete:true,coverage_complete,stale:!coverage_complete,
  observation_contract:derived?CONTRACT:rendered[0].observation_contract,observation_complete:!derived&&rendered.every(r=>r.observation_complete),
  observation_provenance:rendered.flatMap(r=>r.observation_provenance||[]),source_extractions:rendered.flatMap(r=>r.source_extractions||[]),
  generated_at:rendered.map(r=>r.generated_at).sort()[0],warnings:[...new Set(rendered.flatMap(r=>r.warnings||[]))],
  ...(derived?{warning:'Daily-derived totals from cached observations; period unique reach and frequency are unavailable for projected accounts. Missing days are not zero.'}:{})};
}
module.exports={read,project,validateAccount,validateScope,CONTRACT};
