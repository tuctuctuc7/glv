'use strict';
const {createHash}=require('node:crypto');
const v2=require('./glv-mad-v2.cjs');
const storage=require('./glv-mad-v2-storage.cjs');
const source=require('./glv-mad-v2-source.cjs');
const promo=require('./glv-mad-v2-promo.cjs');
const PRESETS=['last_7d','last_14d','last_30d','last_90d','this_month','last_month'];
const TYPES=['daily','aggregate','ads'];
const presetKey=(type,preset)=>`${source.CACHE_PREFIX}preset:${type}:${preset}`;
const requiredKeys=()=>[...PRESETS.flatMap(p=>TYPES.map(t=>presetKey(t,p))),promo.CACHE_KEY];
const hash=s=>createHash('sha256').update(s).digest('hex');
// Includes body consumption even when a transport ignores AbortSignal.
function boundedTransport(fetcher,deadline,requestMs=30000){return async (url,options={})=>{
 const remaining=deadline-Date.now();if(remaining<=0)throw new Error('V2 refresh budget exhausted');
 const controller=new AbortController();let timer;
 try{return await Promise.race([new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('V2 request budget exhausted'));},Math.min(requestMs,remaining));}), (async()=>{
  const r=await fetcher(url,{...options,signal:options.signal?AbortSignal.any([options.signal,controller.signal]):controller.signal});
  let text,data,error;
  try{if(typeof r.text==='function'){text=await r.text();}else data=await r.json();}catch(e){error=e;}
  return {ok:r.ok,status:r.status,json:async()=>{if(error)throw error;return text===undefined?data:JSON.parse(text);},text:async()=>{if(error)throw error;return text===undefined?JSON.stringify(data):text;}};
 })()]);}finally{clearTimeout(timer);}
};}
async function publish(redis,key,payload){
 const bytes=storage.encode(payload),result=await redis('SET',key,bytes);
 if(result?.result!=='OK')throw new Error('V2 durable SET not acknowledged');
 if((await redis('GET',key))?.result!==bytes)throw new Error('V2 cache readback mismatch');
 if((await redis('TTL',key))?.result!==-1)throw new Error('V2 cache retention not verified');
 return hash(bytes);
}
function cacheState(snapshot,{type,range,now=new Date(),promoPayload=false}={}){
 const payload=promoPayload?snapshot?.payload:snapshot;
 const age=now-Date.parse(payload?.generated_at);
 if(!Number.isFinite(age)||age<0)throw new Error('Invalid V2 cache timestamp');
 if(type&&snapshot.type!==type)throw new Error('Invalid V2 cache type');
 const covered=payload?.range?.since===range.since&&payload?.range?.until===range.until;
 return {stale:age>90000000||!covered,coverage_complete:covered,requested_range:range,cached_range:payload.range};
}
async function refreshV2({token,redis,fetcher=fetch,deadline=Date.now()+230000,now=new Date(),build=source.buildSnapshot,loadFx=v2.loadFixings,promoPayload,clock=Date.now,force=false}){
 const hashes={},summaries=[],errors=[],failures=[],reuse={token,accounts:new Map(),snapshots:[]};
 const transport=boundedTransport(fetcher,deadline);
 const workKey=`${source.CACHE_PREFIX}work:ads`;let workState,workLoaded=false;
 const progress={
  load:async()=>{if(!workLoaded){workLoaded=true;if(!force)try{workState=storage.decode((await redis('GET',workKey)).result);}catch{}}return workState;},
  save:async state=>{await publish(redis,workKey,state);workState=state;workLoaded=true;}
 };
 // One annual CNB load is shared across all presets and Promo conversion.
 let fx;
 try{fx=await loadFx({since:'2026-03-01'<v2.rangeFor('last_90d',now).since?'2026-03-01':v2.rangeFor('last_90d',now).since,until:v2.commonCutoff(now)},transport);}catch{ return {hashes,summaries,errors:['v2: official FX unavailable'],verified:false}; }
 // Widest daily window first enables safe date-row slicing across presets.
 const ordered=[...PRESETS].sort((a,b)=>v2.rangeFor(a,now).since.localeCompare(v2.rangeFor(b,now).since));
 const pendingAds=new Set();
 for(const p of ordered){try{const s=storage.decode((await redis('GET',presetKey('ads',p))).result);if(force||s.refresh_through!==v2.commonCutoff(now)||cacheState(s,{type:'ads',range:v2.rangeFor(p,now),now:new Date(clock())}).stale)throw Error();source.renderSnapshot(s,'USD');}catch{pendingAds.add(p);}}
 for(const [preset,type] of [...ordered.flatMap(p=>['daily','aggregate'].map(t=>[p,t])),...ordered.map(p=>[p,'ads'])]){
  const range=v2.rangeFor(preset,now),key=presetKey(type,preset);
  try{
   if(Date.now()>=deadline-5000)throw new Error('budget');
   // Resume verified pieces of a partial run; do not perpetually starve later presets.
   if(!force){
    let prior,bytes;try{bytes=(await redis('GET',key)).result;prior=storage.decode(bytes);}catch{}
    try{
     if(prior?.refresh_through===v2.commonCutoff(now)&&!cacheState(prior,{type,range,now:new Date(clock())}).stale){
      source.renderSnapshot(prior,'USD');source.renderSnapshot(prior,'CZK');
      if((await redis('TTL',key)).result===-1){if(type!=='aggregate')reuse.snapshots.unshift(prior);hashes[key]=hash(bytes);summaries.push({type,preset,range,generated_at:prior.generated_at,readback_verified:true,reused:true});continue;}
     }
    }catch{/* Invalid or expired pieces are rebuilt, never accepted. */}
   }
   const pieceBudget=type==='ads'?Math.min(180000,Math.max(0,(deadline-Date.now()-10000)/Math.max(1,pendingAds.size))):25000;
   pendingAds.delete(type==='ads'?preset:'');
   const snapshot={...await build({range,type,token,fetcher:transport,fx,now,reuse,progress:type==='ads'?progress:undefined,deadline:Math.min(deadline-10000,Date.now()+pieceBudget)}),refresh_through:v2.commonCutoff(now)};
   source.renderSnapshot(snapshot,'USD');source.renderSnapshot(snapshot,'CZK');
   hashes[key]=await publish(redis,key,snapshot);
   summaries.push({type,preset,range,generated_at:snapshot.generated_at,readback_verified:true});
  }catch(error){
   const message=String(error?.message||'');
   const meta=message.match(/^Meta source unavailable \(HTTP (\d+); code (\d+)\)$/);
   const known=['Account identity mismatch','Invalid campaign source identity','Invalid campaign source dates','Invalid campaign required metric','Invalid campaign actions','Invalid campaign action value','Meta period campaign coverage incomplete','Invalid ad chunk identity','Invalid ad chunk metric','Invalid ad chunk action','Incompatible campaign facts'];
   failures.push({type,preset,reason:meta?'meta_source':known.includes(message)?message:/budget/.test(message)?'budget':error?.code==='MODULE_NOT_FOUND'?'module_missing':/^Redis/.test(message)?'redis':/^V2 (cache|durable)/.test(message)?'cache_publish':'source_validation',size_limit:/size|too large|limit exceeded/i.test(message),...(meta?{http:Number(meta[1]),code:Number(meta[2])}:{}),...(/^Redis HTTP \d+$/.test(message)?{http:Number(message.split(' ').pop())}:{})});
   errors.push(`v2:${type}/${preset}: refresh failed; last-good retained`);
  }
 }
 // A generation is a validated exact-range bundle, not an extraction time.
 // Its content-addressed manifest preserves every source time and survives a
 // crash between key writes: the next owner recomputes the same identity.
 for(const preset of PRESETS){
  const range=v2.rangeFor(preset,now),keys=TYPES.map(t=>presetKey(t,preset));
  if(keys.some(k=>!hashes[k]))continue;
  try{
   const pieces=await Promise.all(keys.map(async key=>storage.decode((await redis('GET',key)).result)));
   for(let i=0;i<pieces.length;i++){
    if(cacheState(pieces[i],{type:TYPES[i],range,now:new Date(clock())}).stale)throw Error('stale bundle');
    source.renderSnapshot(pieces[i],'USD');source.renderSnapshot(pieces[i],'CZK');
   }
   const facts=s=>JSON.stringify(s.accounts.map(a=>({id:a.id,rows:a.rows})));
   if(facts(pieces[0])!==facts(pieces[1])||JSON.stringify(pieces[0].fx)!==JSON.stringify(pieces[1].fx))throw Error('Incompatible campaign facts');
   const sources=pieces.map(s=>{const {generation_id,generation_manifest,...native}=s;return {type:s.type,generated_at:s.generated_at,digest:hash(JSON.stringify(native))};});
   const manifest={version:1,preset,range,through:v2.commonCutoff(now),sources};
   const generation_id=hash(JSON.stringify(manifest));
   for(let i=0;i<pieces.length;i++){
    const payload={...pieces[i],generation_id,generation_manifest:manifest};
    if(pieces[i].generation_id!==generation_id)hashes[keys[i]]=await publish(redis,keys[i],payload);
   }
   // Never certify a partially written manifest, including acknowledged SETs.
   for(const key of keys){const bytes=(await redis('GET',key)).result;if(hash(bytes)!==hashes[key]||storage.decode(bytes).generation_id!==generation_id)throw Error('Bundle readback mismatch');}
  }catch{for(const key of keys)delete hashes[key];errors.push(`v2:bundle/${preset}: coherence validation failed`);}
 }
 try{
  const payload=await promoPayload();
  const until=v2.commonCutoff(now);
  const checkedAt=clock();
  if(payload.range.until<until||!Number.isFinite(Date.parse(payload.generated_at))||checkedAt-Date.parse(payload.generated_at)>90000000||checkedAt<Date.parse(payload.generated_at))throw new Error('stale');
  const sliced=require('./glv-promo-format.cjs').sliceCachedFormats(payload,{since:'2026-03-01',until},new Date(checkedAt));
  if(!sliced)throw new Error('Invalid Promo history');
  const snapshot={payload:sliced,fx};
  promo.renderPromo(snapshot,'USD','All',new Date(checkedAt));promo.renderPromo(snapshot,'CZK','All',new Date(checkedAt));
  hashes[promo.CACHE_KEY]=await publish(redis,promo.CACHE_KEY,snapshot);
  summaries.push({type:'promo_formats',range:snapshot.payload.range,generated_at:payload.generated_at,readback_verified:true});
 }catch{errors.push('v2:promo: refresh failed; last-good retained');}
 return {hashes,summaries,errors,failures,verified:errors.length===0};
}
module.exports={PRESETS,TYPES,presetKey,requiredKeys,publish,cacheState,refreshV2,boundedTransport};
