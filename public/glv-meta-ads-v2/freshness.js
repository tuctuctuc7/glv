(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MadV2Freshness=api;})(globalThis,function(){
 'use strict';
 // Availability policy: a failed or partial refresh costs the missing days,
 // never the dashboard. Only data that would be actively wrong is rejected:
 // malformed/incomplete rows, a different account/currency, or a response to
 // a different request. Date-coverage gaps and refresh-generation differences
 // are shown with one short note instead of hiding everything.
 const same=(a,b)=>Boolean(a&&b&&a.since===b.since&&a.until===b.until);
 const full=r=>r?`${r.since} → ${r.until}`:'unknown';
 const stamp=value=>{const t=Date.parse(value);return Number.isFinite(t)?new Date(t).toISOString().slice(0,16).replace('T',' ')+' UTC':'unknown';};
 function coverageNote(actual,requested){
  if(!actual||!requested||same(actual,requested))return '';
  const overlaps=actual.since<=requested.until&&actual.until>=requested.since;
  if(!overlaps)return `Selected dates ${full(requested)} not refreshed yet; showing latest available ${full(actual)}.`;
  if(actual.since===requested.since||actual.until<requested.until)return `Showing ${full(actual)}; ${actual.until<requested.until?'later days':'some days'} not refreshed yet.`;
  return `Showing ${full(actual)} (latest available for this selection).`;
 }
 function validate(data,{range,currency,account,now=Date.now(),history=false,legacy=false,dataset='campaigns'}){
  if(!Array.isArray(data?.rows)||data.complete===false)throw new Error('Incomplete source facts');
  if((!legacy||data.report_currency!==undefined)&&data.report_currency!==currency||(!legacy||data.account_filter!==undefined)&&data.account_filter!==account)throw new Error('Incompatible account/currency scope');
  if(data.requested_range&&!same(data.requested_range,range))throw new Error('Incompatible requested range');
  if(data.cached_range&&!same(data.cached_range,data.range))throw new Error('Incompatible cached range');
  const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
  const validRange=r=>r&&validDate(r.since)&&validDate(r.until)&&r.since<=r.until;
  if(!validRange(range)||!validRange(data.range))throw new Error('Malformed source range');
  // History is one continuous series from a fixed start; a different start is a different dataset.
  if(history&&!(data.range.since===range.since&&data.range.until<=range.until))throw new Error(`Incompatible cached range ${full(data.range)}; requested ${full(range)}`);
  const age=now-Date.parse(data.generated_at);
  if(!Number.isFinite(age)||age<0)throw new Error('Source freshness unavailable');
  const accountNotes=[];
  let accountBehind=false;
  if(data.date_policy==='account-isolated'){
   if(typeof data.generation_id!=='string'||!data.generation_id.trim())throw new Error('Source generation unavailable');
   const accounts={'359758259164738':'TUC','1021777267558882':'TGLV'};
   // Only the Promo caller can select this single-account product contract.
   // A response cannot exempt ordinary All-account data from TGLV coverage.
   const promo=dataset==='tuc-promo';
   if(promo&&(data.promo_account_scope!=='TUC/CZSK only; TGLV is not part of the Promo dataset'||account==='TGLV'&&data.rows.length))throw new Error('Incompatible Promo account scope');
   const required=promo?['359758259164738']:Object.keys(accounts).filter(id=>account==='All'||accounts[id]===account);
   if(promo)accountNotes.push(data.promo_account_scope);
   const coverage=data.account_coverage;
   if(!required.length||!Array.isArray(coverage)||new Set(coverage.map(c=>c?.account_id)).size!==coverage.length||coverage.some(c=>!c||!Object.hasOwn(accounts,c.account_id))||required.some(id=>!coverage.some(c=>c.account_id===id)))throw new Error('Incompatible account coverage');
   // The API may return publication-wide metadata even for a selected account.
   for(const c of coverage.filter(c=>required.includes(c.account_id))){
    if(typeof c.partial!=='boolean')throw new Error('Incompatible account coverage');
    const missing=c.range===null;
    if(missing){
     if(!c.partial||c.complete_through!==null||c.generated_at!==null)throw new Error('Malformed missing account coverage');
     accountBehind=true;accountNotes.push(`${accounts[c.account_id]}: missing coverage for ${full(range)}; no zero days inferred.`);continue;
    }
    const age=now-Date.parse(c.generated_at);
    if(!validRange(c.range)||!Number.isFinite(age)||age<0||!(c.complete_through===null||validDate(c.complete_through)&&c.complete_through<=c.range.until)||(!c.partial&&c.complete_through!==c.range.until))throw new Error('Malformed account coverage');
    const behind=c.partial||c.range.since>range.since||c.range.until<range.until||c.complete_through===null||c.complete_through<range.until;
    accountBehind=accountBehind||behind||age>25*3600000;
    if(behind)accountNotes.push(`${accounts[c.account_id]}: ${c.partial?'partial':'missing days'} for ${full(range)}; available ${full(c.range)}, complete through ${c.complete_through||'none'}; source ${stamp(c.generated_at)}. Missing days are not zero.`);
    else if(age>25*3600000)accountNotes.push(`${accounts[c.account_id]}: last refreshed ${stamp(c.generated_at)}; newer data pending.`);
   }
  }
  const behind=!same(data.range,range)||data.coverage_complete===false||accountBehind;
  const stale=behind||data.stale===true||age>25*3600000||data.freshness?.status==='stale';
  const notes=[coverageNote(data.range,range),...accountNotes];
  if(stale&&!notes[0])notes.push(`Last refreshed ${stamp(data.generated_at)}; newer data pending.`);
  if(data.coverage_complete===false&&same(data.range,range))notes.push('Some days in this range are not refreshed yet.');
  if(data.warning)notes.push(data.warning);
  return {range:data.range,stale,warning:[...new Set(notes.filter(Boolean))].join(' ')};
 }
 function bundle(sources,expected){
  const states=sources.map(s=>validate(s,expected));
  const generations=new Set(sources.map(s=>s.generation_id||s.generated_at));
  const mixedRanges=sources.some(s=>!same(s.range,sources[0].range));
  const isolated=sources.some(s=>s.date_policy==='account-isolated');
  if(isolated&&sources.some(s=>s.date_policy!=='account-isolated'))throw new Error('Mixed source generations; incompatible date policies');
  const coverageKey=s=>JSON.stringify((s.account_coverage||[]).map(c=>[c.account_id,c.range?.since,c.range?.until,c.complete_through,c.partial]).sort((a,b)=>a[0].localeCompare(b[0])));
  if(isolated&&sources.some(s=>coverageKey(s)!==coverageKey(sources[0])))throw new Error('Mixed source ranges; incompatible account coverage');
  // Account-isolated publications must stay coherent after the retry too.
  if((isolated||expected.strict&&!expected.custom)&&generations.size!==1)throw new Error('Mixed source generations; awaiting a consistent shared refresh');
  if((isolated||expected.strict)&&mixedRanges)throw new Error('Mixed source ranges; awaiting a consistent shared refresh');
  const warning=[...new Set(states.map(s=>s.warning).filter(Boolean))];
  const mixed=generations.size!==1||mixedRanges;
  if(mixed)warning.push(expected.custom?'Sections were read independently and may differ slightly.':'Sections were refreshed at different times; totals may differ slightly until the next refresh.');
  return {range:sources[0].range,stale:states.some(s=>s.stale)||mixed,mixed,warning:warning.join(' ')};
 }
 return {validate,bundle,same,full};
});
