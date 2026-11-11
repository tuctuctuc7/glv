'use strict';
const v2=require('./glv-mad-v2.cjs');
// Complete raw chunks are checkpoints, not published reports. One fixed work
// key per owner/cutoff bounds retention; no tokens or pagination URLs persist.
function windows(range){
 const out=[];for(let since=range.since;since<=range.until;){
  let until=since;for(let i=0;i<6;i++){const next=v2.shift(until,1);if(next>range.until||next.slice(0,7)!==since.slice(0,7))break;until=next;}
  out.push({since,until});since=v2.shift(until,1);
 }return out;
}
function validateRaw(rows,range){
 const seen=new Set();for(const r of rows){
  const key=`${r.ad_id}:${r.date_start}`;
  if(!/^\d+$/.test(r.ad_id)||!/^\d+$/.test(r.campaign_id)||!/^\d+$/.test(r.adset_id)||typeof r.ad_name!=='string'||typeof r.campaign_name!=='string'||!v2.validDate(r.date_start)||r.date_start!==r.date_stop||r.date_start<range.since||r.date_stop>range.until||seen.has(key))throw Error('Invalid ad chunk identity');
  for(const k of ['spend','impressions'])if(r[k]===undefined||r[k]===null||String(r[k]).trim()===''||!Number.isFinite(Number(r[k]))||Number(r[k])<0)throw Error('Invalid ad chunk metric');
  for(const k of ['actions','action_values','video_p100_watched_actions','video_thruplay_watched_actions'])if(r[k]!==undefined&&(!Array.isArray(r[k])||r[k].some(a=>typeof a.action_type!=='string'||!Number.isFinite(Number(a.value))||Number(a.value)<0)))throw Error('Invalid ad chunk action');
  seen.add(key);
 }return rows;
}
async function extract({account,range,now,deadline,progress,paginate,urlFor,fetchMetadata,state}){
 const checkpoint=async()=>{if(progress)await progress.save(state);};
 state.pending ||= {};
 const chunks=state.chunks[account.id]||(state.chunks[account.id]=[]);
 const metadata=state.metadata[account.id]||(state.metadata[account.id]={});
 // Reuse only fully validated, disjoint covered days. Empty chunks prove
 // successful empty coverage too; an unavailable day is never an empty fact.
 for(const c of chunks)validateRaw(c.rows,c.range);
 const covered=d=>chunks.some(c=>c.range.since<=d&&c.range.until>=d);
 const missing=[];
 for(const w of windows(range)){
  let start=null;for(let d=w.since;d<=v2.shift(w.until,1);d=v2.shift(d,1)){
   if(d<=w.until&&!covered(d)){if(!start)start=d;}else if(start){missing.push({since:start,until:v2.shift(d,-1)});start=null;}
  }
 }
 async function pull(r){
  if(Date.now()>=deadline)throw Error('Ad chunk budget exhausted');
  const splitKey=`${account.id}:${r.since}:${r.until}`;
  if(state.splits[splitKey])return split(r);
  let raw;const pending=state.pending[splitKey];
  try{raw=pending?.next===null?pending.rows:await paginate(urlFor(r),async page=>{validateRaw(page.rows,r);state.pending[splitKey]={...page,generated_at:pending?.generated_at||now.toISOString()};await checkpoint();},pending);}
  catch(e){
   // Persistent bisection prevents repeating an expensive failed wide request
   // on every owner invocation. Permanent/schema errors do not become zeros.
   if(r.since!==r.until&&e.transient){state.splits[splitKey]=true;delete state.pending[splitKey];await checkpoint();return split(r);}throw e;
  }
  validateRaw(raw,r);
  chunks.push({range:r,generated_at:state.pending[splitKey]?.generated_at||now.toISOString(),completed_at:now.toISOString(),rows:raw});delete state.pending[splitKey];await checkpoint();
 }
 async function split(r){
  const days=Math.round((Date.parse(r.until)-Date.parse(r.since))/86400000),middle=v2.shift(r.since,Math.floor(days/2));
  for(const part of [{since:r.since,until:middle},{since:v2.shift(middle,1),until:r.until}])if(!covered(part.since)||!covered(part.until))await pull(part);
 }
 for(const r of missing)await pull(r);
 const selected=chunks.filter(c=>c.range.since<=range.until&&c.range.until>=range.since);
 const rows=selected.flatMap(c=>c.rows.filter(r=>r.date_start>=range.since&&r.date_stop<=range.until));validateRaw(rows,range);
 const ids=[...new Set(rows.map(r=>r.ad_id))];
 for(let i=0;i<ids.length;i+=50){
  const batch=ids.slice(i,i+50).filter(id=>!metadata[id]);if(!batch.length)continue;
  if(Date.now()>=deadline)throw Error('Ad metadata budget exhausted');
  Object.assign(metadata,await fetchMetadata(batch));await checkpoint();
 }
 // Deduplication is bounded by the actual validated ad domain (never ad-days).
 // Evicting unrelated IDs cannot discard metrics and only costs a later lookup.
 const keep=new Set(ids);for(const id of Object.keys(metadata))if(!keep.has(id)&&Object.keys(metadata).length>5000)delete metadata[id];
 return {rows,metadata,extractions:selected.map(c=>({account_id:account.id,range:c.range,generated_at:c.generated_at}))};
}
function rolloverState(state,now){
 const through=v2.commonCutoff(now);
 const fresh=()=>({version:1,through,generated_at:now.toISOString(),chunks:{},metadata:{},splits:{}});
 if(!state||state.version!==1||!v2.validDate(state.through)||!Number.isFinite(Date.parse(state.generated_at))||now<Date.parse(state.generated_at)||state.through>through)return fresh();
 if(state.through===through)return now-Date.parse(state.generated_at)>90000000?fresh():state;
 // Keep completed history, not unfinished pages or yesterday's metadata.
 // The seven-day attribution correction window is always pulled again.
 const next={...fresh(),history_retained:true};
 const since=v2.rangeFor('last_90d',now).since,until=v2.shift(through,-7);
 for(const account of v2.ACCOUNTS){
  next.chunks[account.id]=[];
  for(const c of state.chunks?.[account.id]||[]){
   if(!v2.validDate(c?.range?.since)||!v2.validDate(c?.range?.until)||c.range.since>c.range.until||c.range.until>state.through||!Number.isFinite(Date.parse(c.generated_at))||now<Date.parse(c.generated_at))throw Error('Invalid historical chunk');
   validateRaw(c.rows,c.range);
   const range={since:c.range.since<since?since:c.range.since,until:c.range.until>until?until:c.range.until};
   if(range.since<=range.until)next.chunks[account.id].push({...c,range,rows:c.rows.filter(r=>r.date_start>=range.since&&r.date_start<=range.until)});
  }
 }
 return next;
}
function reopenCorrection(state,now,correctionId){
 if(typeof correctionId!=='string'||!correctionId)throw Error('Invalid correction identity');
 const prior=rolloverState(state,now);
 if(prior.correction_id===correctionId)return prior;
 const next={...prior,correction_id:correctionId,history_retained:true,chunks:{},metadata:{},pending:{},splits:{}};
 const until=v2.shift(v2.commonCutoff(now),-7);
 for(const account of v2.ACCOUNTS){
  next.chunks[account.id]=[];
  for(const c of prior.chunks?.[account.id]||[]){
   validateRaw(c.rows,c.range);
   const range={since:c.range.since,until:c.range.until<until?c.range.until:until};
   if(range.since<=range.until)next.chunks[account.id].push({...c,range,rows:c.rows.filter(r=>r.date_stop<=range.until)});
  }
 }
 return next;
}
module.exports={windows,validateRaw,extract,rolloverState,reopenCorrection};
