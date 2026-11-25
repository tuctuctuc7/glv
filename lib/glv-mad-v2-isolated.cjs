'use strict';
// Dedicated V2 storage and ownership. No shared/V1 publication is read or written.
const {randomUUID}=require('node:crypto');
const v2=require('./glv-mad-v2.cjs'),source=require('./glv-mad-v2-source.cjs');
const cache=require('./glv-mad-v2-cache.cjs'),storage=require('./glv-mad-v2-storage.cjs'),publication=require('./glv-history-publication.cjs');
const PREFIX='glv:mad:v2:isolated:1:',TYPES=cache.TYPES,PRESETS=cache.PRESETS;
const day=(now,timezone)=>v2.shift(v2.localDate(now,timezone),-1);
function target(mode,now=new Date()){if(!['morning','late'].includes(mode))throw Error('Invalid V2 refresh mode');return day(now,mode==='morning'?'Europe/Prague':'America/Los_Angeles');}
function rangeFor(preset,through){
 const today=v2.shift(through,1),month=today.slice(0,7)+'-01';
 if(preset==='this_month')return {since:through<month?through.slice(0,7)+'-01':month,until:through};
 if(preset==='last_month'){const until=v2.shift(month,-1);return {since:until.slice(0,7)+'-01',until};}
 const n={last_7d:7,last_14d:14,last_30d:30,last_90d:90}[preset];if(!n)throw Error('Invalid preset');return {since:v2.shift(through,1-n),until:through};
}
const readValue=redis=>async key=>{const bytes=(await redis('GET',key)).result;return bytes?storage.decode(bytes):null;};
const accountKey=(id,preset)=>`${PREFIX}account:${id}:${preset}`;
const combinedKey=preset=>`${PREFIX}published:${preset}`;

function validateNative(pieces){
 const first=pieces.daily;
 for(const type of TYPES){const s=pieces[type];if(s?.type!==type||!s.isolated_account_id||s.isolated_account_id!==first.isolated_account_id||s.generation_id!==first.generation_id||!s.generation_id||JSON.stringify(s.range)!==JSON.stringify(first.range))throw Error('Invalid isolated account bundle');source.renderSnapshot(s,'USD');source.renderSnapshot(s,'CZK');}
 if(JSON.stringify(first.accounts.map(a=>a.rows))!==JSON.stringify(pieces.aggregate.accounts.map(a=>a.rows))||JSON.stringify(first.fx)!==JSON.stringify(pieces.aggregate.fx))throw Error('Incompatible campaign facts');
}
function validateCombined(pieces){
 const first=pieces.daily;if(!first?.generation_id)throw Error('Invalid isolated publication');
 for(const type of TYPES){const p=pieces[type];if(p?.type!==type||p.generation_id!==first.generation_id||JSON.stringify(p.range)!==JSON.stringify(first.range)||JSON.stringify(p.account_coverage)!==JSON.stringify(first.account_coverage))throw Error('Incoherent isolated publication');}
 for(const id of Object.keys(first.account_bundles)){if(!v2.ACCOUNTS.some(a=>a.id===id))throw Error('Unknown publication account');validateNative(Object.fromEntries(TYPES.map(t=>[t,pieces[t].account_bundles[id]])));}
 if(!Object.keys(first.account_bundles).length)throw Error('Empty isolated publication');
}
async function readBundle(redis,key,validate){return publication.readBundle({key,read:readValue(redis),validate});}
async function save(redis,key,pieces,validate){await publication.publishBundle({key,pieces,validate,read:readValue(redis),write:(k,p)=>cache.publish(redis,k,p),retire:publication.retireRedis(redis,storage.decode)});const saved=await readBundle(redis,key,validate);if(publication.digest(saved)!==publication.digest(pieces))throw Error('Isolated publication readback mismatch');return saved;}
const readPreset=(redis,preset)=>readBundle(redis,combinedKey(preset),validateCombined);
function coverage(account,bundle){
 if(!bundle)return {account_id:account.id,range:null,complete_through:null,partial:true,missing:true,generated_at:null};
 const s=bundle.daily;return {account_id:account.id,range:s.range,complete_through:s.complete_through,partial:s.partial,generated_at:s.generated_at};
}
async function compose(redis,preset,range,through){
 const lock=PREFIX+'publication-lease:'+preset,owner=randomUUID();
 if((await redis('SET',lock,owner,'NX','PX',300000)).result!=='OK')throw Error('Publication busy');
 try{return await composeLocked(redis,preset,range,through);}finally{try{await redis('EVAL',"if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0",1,lock,owner);}catch{}}
}
async function composeLocked(redis,preset,range,through){
 const prior=await readPreset(redis,preset);if(prior?.daily.through>through)return prior;
 const bundles={};for(const a of v2.ACCOUNTS){try{const b=await readBundle(redis,accountKey(a.id,preset),validateNative);if(b&&b.daily.range.until<=range.until)bundles[a.id]=b;}catch{/* Preserve independent usable accounts. */}}
 const accountRanges=Object.values(bundles).map(b=>b.daily.range);
 if(!accountRanges.some(r=>r.since===range.since&&r.until===range.until)){
  if(prior)return prior;
  if(accountRanges.length)range=accountRanges.sort((a,b)=>b.until.localeCompare(a.until))[0];
 }
 const account_coverage=v2.ACCOUNTS.map(a=>coverage(a,bundles[a.id]));
 const generation_id=publication.digest({range,account_coverage,bundles});
 const pieces=Object.fromEntries(TYPES.map(type=>[type,{type,range,through,date_policy:'account-isolated',generation_id,account_coverage,account_bundles:Object.fromEntries(Object.entries(bundles).map(([id,b])=>[id,b[type]]))}]));
 return save(redis,combinedKey(preset),pieces,validateCombined);
}
async function refresh({redis,fetcher=fetch,token,tokenFor,mode='morning',now=new Date(),deadline=Date.now()+270000,force=false,presets=PRESETS,build=source.buildSnapshot,loadFx=v2.loadFixings,ranges,includePromo=presets===PRESETS,fetchPromo}){
 redis=require('./glv-mad-v2-read-scope.cjs').createReadScope(redis);
 const through=target(mode,now),summaries=[],errors=[];
 const getRange=p=>ranges?.[p]||rangeFor(p,through);
 const selected=v2.ACCOUNTS.filter(a=>mode==='morning'||a.label==='TGLV');
 // Custom requests publish one bounded slot, not the full scheduled matrix.
 const publicationReserve=ranges?5000:20000,accountReserve=ranges?1000:5000;
 for(const [accountIndex,account] of selected.entries()){
 // Reserve publication time and a fair share for every remaining account.
 // Bound FX, Graph and Promo with this account's deadline, not the whole run.
 const accountDeadline=Date.now()+Math.max(0,Math.floor((deadline-Date.now()-publicationReserve)/(selected.length-accountIndex)));
 const accountFetcher=cache.boundedTransport(fetcher,accountDeadline-accountReserve);
 const lease=`${PREFIX}lease:${account.id}`,owner=randomUUID();let acquired=false;
 try{
  if(Date.now()>=accountDeadline-accountReserve)throw Error('budget');
  acquired=(await redis('SET',lease,owner,'NX','PX',Math.max(1000,Math.floor(deadline-Date.now()+5000)))).result==='OK';if(!acquired)throw Error('account_busy');
  const credential=tokenFor?await tokenFor(account):token;
  const reuse={token:credential,accounts:new Map(),snapshots:[],history:[]};
  for(const p of presets){try{const b=await readBundle(redis,accountKey(account.id,p),validateNative);if(b)reuse.history.push(b.daily);}catch{}}
  reuse.history.sort((a,b)=>a.range.since.localeCompare(b.range.since));
  // A custom selection is a read of already extracted history, not a scheduled
  // rolling correction pass. Reuse only validated account-local daily facts;
  // buildSnapshot still fetches the exact period observations/unique reach.
  if(ranges){
   for(const preset of PRESETS){try{
    const b=await readBundle(redis,accountKey(account.id,preset),validateNative);
    if(!b)continue;
    const s=b.daily,age=+now-Date.parse(s.generated_at);
    const needed=Object.values(ranges).filter(r=>s.range.since<=r.since&&s.range.until>=r.until);
    if(age<0||age>90000000||!needed.length||needed.some(r=>s.complete_through<(day(now,account.timezone)<r.until?day(now,account.timezone):r.until)))continue;
    reuse.snapshots.push(b.daily,b.ads);
    if(needed.length===Object.keys(ranges).length)break;
   }catch{/* Corrupt/foreign publications never become source facts. */}}
   reuse.snapshots.sort((a,b)=>b.generated_at.localeCompare(a.generated_at));
  }
  const intentKey=`${PREFIX}intent:${account.id}:${mode}`;let intent=await readValue(redis)(intentKey);
  if(!intent||intent.through!==through||(force&&intent.status==='complete')){intent={id:randomUUID(),through,status:'pending'};await cache.publish(redis,intentKey,intent);}
  const workKey=`${PREFIX}checkpoint:${account.id}:${mode}`;
  const migrated=await bootstrap({redis,account,presets,now,through,mode,intent});
  if(!reuse.history.length)reuse.history.push(...migrated.history);
  let work=await readValue(redis)(workKey)||migrated.work;
  if(work?.intent_id!==intent.id){work=require('./glv-mad-v2-chunks.cjs').reopenCorrection(work,now,intent.id,through);work={...work,intent_id:intent.id};await cache.publish(redis,workKey,work);}
  const progress={load:async()=>work,save:async state=>{work={...state,intent_id:intent.id};await cache.publish(redis,workKey,work);}};
  let fx;
  for(const preset of [...presets].sort((a,b)=>getRange(a).since.localeCompare(getRange(b).since))){
   const range=getRange(preset),pieces={};let activeType='bundle';
   try{
    const existing=await readBundle(redis,accountKey(account.id,preset),validateNative);
    if(!ranges&&existing?.daily.range.until>range.until)throw Error('Target would regress publication');
    if(mode==='morning'&&existing?.daily.refresh_mode==='late'&&!existing.daily.partial&&JSON.stringify(existing.daily.range)===JSON.stringify(range)){
     summaries.push({account_id:account.id,preset,mode,range,generation_id:existing.daily.generation_id,reused:true,readback_verified:true});continue;
    }
    for(const type of TYPES){
     activeType=type;
     if(Date.now()>=accountDeadline-accountReserve)throw Error('budget');
     const key=`${PREFIX}work:${account.id}:${mode}:${preset}:${type}`;
     let s;try{s=await readValue(redis)(key);if(s?.intent_id!==intent.id||JSON.stringify(s.range)!==JSON.stringify(range)||(build===source.buildSnapshot&&!source.hasDirectObservations(s)))s=null;else {source.renderSnapshot(s,'USD');source.renderSnapshot(s,'CZK');}}catch{s=null;}
     // Only a validated cached aggregate can repair a stale daily piece: its
     // native daily rows have also passed exact-period population validation.
     // Never reconstruct daily facts from direct period observations.
     if(type==='aggregate'&&s&&(JSON.stringify(s.accounts.map(a=>a.rows))!==JSON.stringify(pieces.daily.accounts.map(a=>a.rows))||JSON.stringify(s.fx)!==JSON.stringify(pieces.daily.fx))){
      if(s.type!=='aggregate'||s.isolated_account_id!==account.id)throw Error('Invalid recovery scope');
      const daily={...s,type:'daily',accounts:s.accounts.map(a=>{const {direct_observation,reach,...native}=a;return native;})};
      source.renderSnapshot(daily,'USD');source.renderSnapshot(daily,'CZK');
      await cache.publish(redis,`${PREFIX}work:${account.id}:${mode}:${preset}:daily`,daily);
      reuse.snapshots=reuse.snapshots.filter(prior=>prior!==pieces.daily);
      reuse.snapshots.unshift(daily);pieces.daily=daily;
     }
     if(!s){
      if(!fx)fx=await loadFx({since:presets.map(p=>getRange(p).since).sort()[0],until:through},accountFetcher);
      const completeThrough=day(now,account.timezone),partial=range.until>completeThrough;
      const scopedReuse=type==='aggregate'?{...reuse,snapshots:[pieces.daily,...reuse.snapshots]}:reuse;
      s={...await build({account,through,range,type,token:credential,fetcher:accountFetcher,fx,now,deadline:accountDeadline-accountReserve,reuse:scopedReuse,progress:type==='ads'?progress:undefined}),intent_id:intent.id,refresh_mode:mode,refresh_through:through,complete_through:partial?completeThrough:range.until,partial};
      source.renderSnapshot(s,'USD');source.renderSnapshot(s,'CZK');await cache.publish(redis,key,s);
     }
     if(type!=='aggregate'&&!reuse.snapshots.includes(s))reuse.snapshots.push(s);
     pieces[type]=s;
    }
    activeType='bundle';
    // Resumed pieces can carry different CNB response hashes or table bounds.
    // Native facts remain unchanged; every view uses the daily piece's observed
    // FX table, and normal rendering validation still rejects missing fixings.
    for(const t of TYPES)pieces[t]={...pieces[t],fx:pieces.daily.fx};
    const generation_id=publication.digest(pieces);for(const t of TYPES)pieces[t]={...pieces[t],generation_id};
    await save(redis,accountKey(account.id,preset),pieces,validateNative);
    summaries.push({account_id:account.id,preset,mode,range,generation_id,partial:pieces.daily.partial,readback_verified:true});
   }catch(error){const message=String(error?.message||''),meta=message.match(/^Meta source unavailable \(HTTP (\d+); code (\d+)\)$/);errors.push({account_id:account.id,preset,type:activeType,reason:/budget/i.test(message)?'budget':meta?'meta_source':/regress/.test(message)?'older_target_rejected':message==='Incompatible campaign facts'?'campaign_bundle_mismatch':message.startsWith('Unsupported currency coverage:')?'observation_population_mismatch':'source_or_publication_failed',...(meta?{http:Number(meta[1]),code:Number(meta[2])}:{}),last_good_retained:true});}
  }
  if(includePromo&&account.label==='TUC')try{if(Date.now()>=accountDeadline-accountReserve)throw Error('budget');const p=await require('./glv-mad-v2-isolated-promo.cjs').refresh({redis,token:credential,through,now,deadline:accountDeadline-accountReserve,fetcher:accountFetcher,loadFx,fetchPromo});summaries.push({type:'promo_formats/promo_concepts',account_id:account.id,range:p.payload.range,readback_verified:true});}catch{errors.push({account_id:account.id,reason:'promo_failed',last_good_retained:true});}
  if(!errors.some(e=>e.account_id===account.id))await cache.publish(redis,intentKey,{...intent,status:'complete'});
 }catch{errors.push({account_id:account.id,reason:acquired?'account_refresh_failed':'account_busy_or_budget',last_good_retained:true});}
 finally{if(acquired)try{await redis('EVAL',"if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0",1,lease,owner);}catch{}}
 }
 const readbacks=[];
 for(const preset of presets){try{const b=await compose(redis,preset,getRange(preset),through);const observation_complete=TYPES.every(t=>Object.values(b[t].account_bundles).every(source.hasDirectObservations));if(build===source.buildSnapshot&&!observation_complete)errors.push({preset,reason:'consumed_direct_observations_incomplete',last_good_retained:true});readbacks.push({preset,observation_complete,generation_id:b.daily.generation_id,account_coverage:b.daily.account_coverage,digest:publication.digest(b),readback_verified:true});}catch{errors.push({preset,reason:'composition_failed',last_good_retained:true});}}
 if(includePromo&&mode==='late')try{const p=await require('./glv-mad-v2-isolated-promo.cjs').read(readValue(redis));if(!p||p.daily.range.until!==through)throw Error('missing');summaries.push({type:'promo_formats/promo_concepts',reused:true,range:p.daily.range,readback_verified:true});}catch{errors.push({reason:'promo_retained_coverage_incomplete'});}
 for(const receipt of readbacks){const expected=getRange(receipt.preset);if(receipt.account_coverage.some(c=>c.missing||c.range?.since!==expected.since||c.range?.until!==expected.until||c.complete_through<(day(now,v2.ACCOUNTS.find(a=>a.id===c.account_id).timezone)<expected.until?day(now,v2.ACCOUNTS.find(a=>a.id===c.account_id).timezone):expected.until)))errors.push({preset:receipt.preset,reason:'consumed_account_coverage_incomplete'});}
 return {verified:errors.length===0,mode,through,summaries,errors,readbacks,date_policy:'account-isolated'};
}
async function readback({redis,now=new Date(),presets=PRESETS,includePayload=false,includePromo=presets===PRESETS}){
 const reader=require('./glv-mad-v2-isolated-reader.cjs'),through=target('morning',now),results=[];
 for(const preset of presets){try{
  const b=await readPreset(redis,preset);if(!b)throw Error('missing');
  const range=rangeFor(preset,through),payloads={};
  for(const currency of ['USD','CZK'])payloads[currency]=Object.fromEntries(TYPES.map(type=>[type,reader.render(b,{type,range,currency,account:'All'})]));
  const covered=b.daily.account_coverage.every(c=>!c.missing&&c.range?.since===range.since&&c.range?.until===range.until&&c.complete_through>=(day(now,v2.ACCOUNTS.find(a=>a.id===c.account_id).timezone)<range.until?day(now,v2.ACCOUNTS.find(a=>a.id===c.account_id).timezone):range.until));
  const observation_complete=TYPES.every(t=>Object.values(b[t].account_bundles).every(source.hasDirectObservations));
  results.push({preset,observation_complete,generation_id:b.daily.generation_id,digest:publication.digest(b),account_coverage:b.daily.account_coverage,verified:covered&&observation_complete,stats:Object.fromEntries(TYPES.map(t=>[t,{rows:payloads.USD[t]?.rows.length,digest:publication.digest(payloads.USD[t])}])),...(includePayload?{payloads}:{})});
 }catch{results.push({preset,verified:false,error:'publication_unavailable'});}}
 let promo;
 if(includePromo)try{const payloads={};for(const currency of ['USD','CZK']){payloads[currency]={};for(const type of ['promo_formats','promo_concepts'])payloads[currency][type]=await require('./glv-mad-v2-isolated-promo.cjs').readRender(readValue(redis),{type,currency,account:'All',range:{since:'2026-03-01',until:through}},now);}
 promo={verified:Boolean(payloads.USD.promo_formats?.coverage_complete&&payloads.USD.promo_concepts?.coverage_complete),digest:publication.digest(payloads),...(includePayload?{payloads}:{})};}catch{promo={verified:false,error:'promo_unavailable'};}
 return {verified:results.every(p=>p.verified)&&(!includePromo||promo.verified),through,date_policy:'account-isolated',presets:results,...(includePromo?{promo}:{})};
}
async function bootstrap({redis,account,presets=PRESETS,now=new Date(),through,mode,intent}){
 const read=readValue(redis),history=[];
 const oldForce=await read(source.CACHE_PREFIX+'force');
 const compatible=s=>oldForce?.status!=='pending'||s?.force_generation===oldForce.id;
 for(const preset of presets){
  if(await read(accountKey(account.id,preset)))continue;
  try{
   const old=await cache.readPublished(read,preset)||await cache.readLegacy(read,preset);if(!old||!TYPES.every(t=>compatible(old[t])))continue;
   const pieces={};
   for(const type of TYPES){const s=old[type];if(!Number.isFinite(Date.parse(s.generated_at))||Date.parse(s.generated_at)>+now||s.range.until>through)throw Error('Invalid migration scope');
    const a=s.accounts.find(a=>a.id===account.id);if(!a)throw Error('Missing migration account');
    pieces[type]={...s,isolated_account_id:account.id,accounts:[a],source_extractions:(s.source_extractions||[]).filter(e=>!e.account_id||e.account_id===account.id),complete_through:s.range.until,partial:false,migrated_from:'native_v2'};
   }
   const generation_id=publication.digest(pieces);for(const t of TYPES)pieces[t].generation_id=generation_id;
   await save(redis,accountKey(account.id,preset),pieces,validateNative);history.push(pieces.daily);
  }catch{/* Invalid old data is never promoted. */}
 }
 let work;
 if(!await read(`${PREFIX}checkpoint:${account.id}:${mode}`))try{
  const prior=await read(source.CACHE_PREFIX+'work:ads');if(prior&&compatible(prior)){
   work=require('./glv-mad-v2-chunks.cjs').reopenCorrection(prior,now,intent.id,through);
   work={...work,chunks:{[account.id]:work.chunks[account.id]||[]},metadata:{},pending:{},splits:{},intent_id:intent.id};
   await cache.publish(redis,`${PREFIX}checkpoint:${account.id}:${mode}`,work);
  }
 }catch{/* Checkpoint migration is optional; native history remains readable. */}
 return {history,work};
}
module.exports={PREFIX,TYPES,PRESETS,target,rangeFor,readValue,accountKey,combinedKey,readPreset,validateNative,validateCombined,refresh,readback,bootstrap};
