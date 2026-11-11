(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MadV2Freshness=api;})(globalThis,function(){
 'use strict';
 const same=(a,b)=>Boolean(a&&b&&a.since===b.since&&a.until===b.until);
 const full=r=>r?`${r.since} → ${r.until}`:'unknown';
 function validate(data,{range,currency,account,now=Date.now(),history=false,available=false,legacy=false}){
  if(!Array.isArray(data?.rows)||data.complete===false)throw new Error('Incomplete source facts');
  if((!legacy||data.report_currency!==undefined)&&data.report_currency!==currency||(!legacy||data.account_filter!==undefined)&&data.account_filter!==account)throw new Error('Incompatible account/currency scope');
  if(data.requested_range&&!same(data.requested_range,range))throw new Error('Incompatible requested range');
  if(data.cached_range&&!same(data.cached_range,data.range))throw new Error('Incompatible cached range');
  // Available-history display keeps the entire snapshot, including unique reach.
  const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
  const validRange=r=>r&&validDate(r.since)&&validDate(r.until)&&r.since<=r.until;
  if(!validRange(range)||!validRange(data.range))throw new Error('Malformed source range');
  const compatible=history?data.range.since===range.since&&data.range.until<=range.until:available?data.range.since<=range.until&&data.range.until>=range.since&&data.range.until<=range.until:same(data.range,range);
  if(!compatible)throw new Error(`Incompatible cached range ${full(data.range)}; requested ${full(range)}`);
  if(!history&&!available&&data.coverage_complete===false)throw new Error('Incomplete requested coverage');
  const age=now-Date.parse(data.generated_at);
  if(!Number.isFinite(age)||age<0)throw new Error('Source freshness unavailable');
  const stale=data.stale===true||data.coverage_complete===false||age>25*3600000||!same(data.range,range)||data.freshness?.status==='stale';
  return {range:data.range,stale,warning:[stale?`Stale last-good · actual range ${full(data.range)} · source ${data.generated_at}. Scheduled refresh pending.`:'',!same(data.range,range)?`Requested ${full(range)} is unavailable. Showing whole available range ${full(data.range)}, not selected-range totals; missing dates are not zero.`:'',data.warning||''].filter(Boolean).join(' ')};
 }
 function bundle(sources,expected){
  const states=sources.map(s=>validate(s,expected));
  const generations=new Set(sources.map(s=>s.generation_id||s.generated_at));
  if(generations.size!==1&&!expected.custom)throw new Error('Mixed source generations; awaiting a consistent shared refresh');
  // Custom ranges are independent live reads, not an atomic scheduled generation.
  const warning=[...new Set(states.map(s=>s.warning).filter(Boolean))];
  if(generations.size!==1)warning.push('Independent custom-range source generations: '+sources.map(s=>s.generated_at).join(' / '));
  if(sources.some(s=>!same(s.range,sources[0].range)))throw new Error('Mixed source ranges; awaiting a consistent shared refresh');
  return {range:sources[0].range,stale:states.some(s=>s.stale),warning:warning.join(' ')};
 }
 return {validate,bundle,same,full};
});
