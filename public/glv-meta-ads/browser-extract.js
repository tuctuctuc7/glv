(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MadBrowserExtract=api;})(globalThis,function(){
 'use strict';
 const same=(a,b)=>a.since===b.since&&a.until===b.until;
 const contains=(a,b)=>a.since<=b.since&&a.until>=b.until;
 const copy=x=>JSON.parse(JSON.stringify(x));
 function freeze(x){if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;}
 // Same native additive contract as V1, with V2 native-money provenance retained.
 function aggregateDaily(rows,range){
  const groups=new Map();
  for(const row of rows){
   const key=JSON.stringify([row.account_id||null,row.is_ghost?'ghost:'+row.id:row.ad_id||row.adset_id||row.id]);
   const keys=Object.keys(row).filter(k=>k==='amount_spent'||k==='impressions'||k.startsWith('actions:')||k.startsWith('action_values:')||k.startsWith('video_'));
   if(!groups.has(key))groups.set(key,{...row,...Object.fromEntries(keys.map(k=>[k,0])),amount_spent:0,impressions:0,reach:null,frequency:null,date_start:range.since,date_stop:range.until,creator_rows:[],...(row.native?{native:Object.fromEntries(Object.keys(row.native).map(k=>[k,0])),daily_provenance:[]}: {})});
   const out=groups.get(key);
   for(const k of keys){if(!Number.isFinite(Number(row[k])))throw Error('Invalid additive fact');out[k]=(out[k]||0)+Number(row[k]);}
   if(row.native){for(const k of Object.keys(row.native))out.native[k]+=Number(row.native[k]);out.daily_provenance.push({date:row.date_start,native:row.native,fx:row.fx});delete out.fx;}
   out.creator_rows.push(...(row.creator_rows||[]));if(row.creator_issue)out.creator_issue=row.creator_issue;
  }
  return [...groups.values()].map(row=>({...row,creator_rows:aggregateDaily(row.creator_rows,range)}));
 }
 function project(s,range,rows){
  const coverage=s.account_coverage?.map(c=>{if(!c.range)return c;const until=c.complete_through===null?null:c.complete_through<range.until?c.complete_through:range.until;return {...c,range:{...range},complete_through:until,partial:!until||until<range.until||c.range.since>range.since};});
  const required=coverage?.filter(c=>s.account_filter==='All'||(s.accounts||[]).some(a=>a.id===c.account_id&&a.label===s.account_filter));
  return {...s,rows,range:{...range},requested_range:{...range},cached_range:{...range},observation_contract:'cached-daily-v1',observation_complete:false,projection:{contract:'cached-daily-v1',source_range:s.range,source_generated_at:s.generated_at,source_generation_id:s.generation_id},...(coverage?{account_coverage:coverage,coverage_complete:required.length>0&&required.every(c=>!c.partial&&!c.missing),stale:required.some(c=>c.partial||c.missing)}:{}),warning:'Daily-derived totals from cached observations; period unique reach and frequency are unavailable. Missing days are not zero.'};
 }
 function create({maxWindows=4,maxBytes=64*1024*1024}={}){
  let windows=[],bytes=0;
  return {
   clear(){windows=[];bytes=0;},
   attach(scope,sources){
    const d=sources[1];
    if(!windows.some(w=>w.scope===scope&&same(w.sources[1].range,d.range)&&w.sources[1].generation_id===d.generation_id))return false;
    return this.put(scope,sources);
   },
   put(scope,sources,{replace=false}={}){
    const [a,d,ads]=sources;if(!a||!d||!same(a.range,d.range))throw Error('Incompatible extract range');
    const present=sources.filter(Boolean);if(present.some(s=>typeof s.generation_id!=='string'||!s.generation_id)||new Set(present.map(s=>s.generation_id)).size!==1)throw Error('Incompatible extract generation');
    if(d.rows.some(r=>!r.date_start||r.date_start<d.range.since||r.date_start>d.range.until||r.date_stop&&r.date_stop!==r.date_start))throw Error('Invalid daily facts');
    const text=JSON.stringify(sources),size=text.length*2;
    if(replace){windows=[];bytes=0;}
    if(size>maxBytes)return false;
    windows=windows.filter(w=>!(w.scope===scope&&same(w.sources[1].range,d.range)));
    windows.push({scope,sources:freeze(JSON.parse(text)),size});bytes=windows.reduce((n,w)=>n+w.size,0);
    while(windows.length>maxWindows||bytes>maxBytes){bytes-=windows.shift().size;}return true;
   },
   get(scope,range){
    const candidates=windows.filter(w=>w.scope===scope&&contains(w.sources[1].range,range));
    const w=candidates.find(w=>same(w.sources[1].range,range))||candidates.at(-1);if(!w)return null;
    if(same(w.sources[1].range,range))return copy(w.sources);
    const [a,d,ads]=w.sources,rows=d.rows.filter(r=>r.date_start>=range.since&&r.date_start<=range.until);
    const creativeRows=ads?.daily_rows?.filter(r=>r.date_start>=range.since&&r.date_start<=range.until);
    return [project(d,range,aggregateDaily(rows,range)),project(d,range,copy(rows)),creativeRows?project(ads,range,aggregateDaily(creativeRows,range)):null];
   },
   stats(){return {windows:windows.length,bytes};}
  };
 }
 return {create,aggregateDaily};
});
