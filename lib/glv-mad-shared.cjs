'use strict';
// Native direct-period facts and daily facts are distinct source observations.
// Do not allocate period rounding differences to invented days.
const publication=require('./glv-history-publication.cjs');
const v1=require('./glv-history-v1.cjs');
const v2=require('./glv-mad-v2.cjs');
const source=require('./glv-mad-v2-source.cjs');
const storage=require('./glv-mad-v2-storage.cjs');
const TYPES=publication.TYPES,KEY='glv:mad:shared:1:';
const key=p=>KEY+p;
const TUC=v2.ACCOUNTS.find(a=>a.label==='TUC');
// These publications originate from the verified single-account V1 source.
// Retained rows can lack identity; an explicit contradictory identity is invalid.
function tucPayload(payload){
 const row=r=>{
  if(r.account_id!==undefined&&r.account_id!==TUC.id)throw Error('Invalid TUC account ownership');
  return {...r,account_id:TUC.id,...(r.creator_rows?{creator_rows:r.creator_rows.map(row)}:{})};
 };
 if(payload.account_id!==undefined&&payload.account_id!==TUC.id)throw Error('Invalid TUC account ownership');
 return {...payload,rows:payload.rows.map(row)};
}
const metrics=['amount_spent','action_values:omni_purchase','impressions','reach','actions:link_click','actions:landing_page_view','actions:omni_purchase','actions:initiate_checkout','actions:outbound_click','actions:lead','video_thruplay_watched_actions','video_3_sec_watched_actions','video_p100_watched_actions'];
function facts(payload){
 const project=r=>({id:r.source_id||r.id,date_start:r.date_start??null,date_stop:r.date_stop??null,name:r.name,campaign_name:r.campaign_name??null,adset_name:r.adset_name??null,ad_name:r.ad_name??null,status:r.status??null,partnership:r.partnership??null,is_ghost:r.is_ghost??false,creator_issue:r.creator_issue??null,campaign_id:r.source_campaign_id||r.campaign_id||null,adset_id:r.source_adset_id||r.adset_id||null,ad_id:r.source_ad_id||r.ad_id||null,reason:r.reason??null,creator:r.creator??null,...Object.fromEntries(metrics.filter(k=>r[k]!==undefined).map(k=>[k,r[k]===null?null:Number(r[k])])),...(r.creator_rows?{creator_rows:r.creator_rows.map(project).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))}:{})});
 return payload.rows.filter(r=>!r.account_id||r.account_id===TUC.id).map(project).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
function correctionCovered(snapshot,correction){
 if(!correction||snapshot.shared_correction_id!==correction.id)return false;
 const since=snapshot.range.since>v2.shift(correction.through,-6)?snapshot.range.since:v2.shift(correction.through,-6);
 for(const a of v2.ACCOUNTS)for(let d=since;d<=snapshot.range.until;d=v2.shift(d,1)){
  if(!(snapshot.source_extractions||[]).some(e=>e.account_id===a.id&&e.range.since<=d&&e.range.until>=d&&Date.parse(e.generated_at)>=Date.parse(correction.requested_at)&&Date.parse(e.generated_at)<=Date.now()))return false;
 }
 return true;
}
const MONEY=['amount_spent','action_values:omni_purchase'];
// Only creator reconciliation rows may be unioned. Real entities must match
// first; a missing ad is never a zero-valued source observation.
const RECONCILIATION=['amount_spent','impressions','actions:link_click','actions:landing_page_view','actions:omni_purchase','actions:initiate_checkout','actions:outbound_click','actions:lead','action_values:omni_purchase'];
const rowId=r=>r.source_id||r.id;
const creatorId=r=>r.source_ad_id||r.ad_id||r.source_adset_id||r.adset_id;
function checkCreatorGhosts(rows,parent){
 if(parent){
  const ghosts=rows.filter(r=>r.is_ghost);
  if(ghosts.length>1||ghosts.some(r=>!require('./glv-wl-creators.cjs').validCreatorGhost(r)||rowId(r)!==rowId(parent)||r.ad_id!==undefined||r.source_ad_id!==undefined||r.source_adset_id!==undefined||r.campaign_id!==undefined||r.creator_rows?.length))throw Error('Invalid creator reconciliation Ghost');
 }
 for(const row of rows)if(row.creator_rows)checkCreatorGhosts(row.creator_rows,row);
}
function reconciliationNumber(value){
 if(!['number','string'].includes(typeof value)||String(value).trim()===''||!Number.isFinite(Number(value)))throw Error('Unsupported currency coverage: unavailable reconciliation metric');
 return Number(value);
}
function reconciliationOperands(parent,children){
 if(parent.creator_issue||!children.length||children.some(r=>r.is_ghost||!r.ad_id||!r.adset_id||typeof r.ad_name!=='string'||typeof r.adset_name!=='string')||new Set(children.map(creatorId)).size!==children.length)throw Error('Unsupported currency coverage: incomplete reconciliation children');
 const number=reconciliationNumber;
 const parentMetrics=Object.fromEntries(RECONCILIATION.map(k=>[k,number(parent[k])]));
 const childTotals=Object.fromEntries(RECONCILIATION.map(k=>[k,number(children.reduce((sum,r)=>sum+number(r[k]),0))]));
 const residual=Object.fromEntries(RECONCILIATION.map(k=>[k,number(parentMetrics[k]-childTotals[k])]));
 return {parentMetrics,childTotals,residual};
}
function deriveReconciliation(parent,children,basis){
 const {parentMetrics,childTotals,residual}=reconciliationOperands(parent,children),number=reconciliationNumber;
 const derived_reconciliation={version:1,basis,operation:'authoritative_parent_minus_complete_real_children',parent_id:rowId(parent),real_child_ids:children.map(creatorId),parent_metrics:parentMetrics,child_totals:childTotals};
 const out={id:parent.id,name:parent.name,date_start:parent.date_start??null,date_stop:parent.date_stop??null,...(parent.account_id!==undefined?{account_id:parent.account_id}:{}),is_ghost:true,creator:null,label:'Ghost / unattributed creator — pending Meta reconciliation',reason:'campaign_adset_residual',reach:null,...residual,derived_reconciliation};
 if(basis==='converted_daily_observation'){
  // Aggregate operands are actual converted daily inputs. Do not manufacture
  // a per-day residual series, fixing, reach, or extraction timestamp.
  out.source_id=rowId(parent);
  const nativeParent=Object.fromEntries(MONEY.map(k=>[k,number(parent.native?.[k])]));
  const nativeChildren=Object.fromEntries(MONEY.map(k=>[k,children.reduce((sum,r)=>sum+number(r.native?.[k]),0)]));
  out.native=Object.fromEntries(MONEY.map(k=>[k,nativeParent[k]-nativeChildren[k]]));
  Object.assign(derived_reconciliation,{native_parent_metrics:nativeParent,native_child_totals:nativeChildren,parent_daily_inputs:parent.daily_provenance,child_daily_inputs:children.map(r=>({id:creatorId(r),daily_provenance:r.daily_provenance,fx:r.fx,native:r.native})),parent_fx:parent.fx});
 }
 return out;
}
function canonicalUsd(original,observed,type,path='rows',parents,inputs=[]){
 const identity=r=>`${!r.is_ghost&&!r.campaign_id&&(r.source_ad_id||r.ad_id)?r.source_ad_id||r.ad_id:r.source_id||r.id}:${Boolean(r.is_ghost)}${type==='daily'?':'+r.date_start:''}`;
 if(parents){
  checkCreatorGhosts(original,parents.original);checkCreatorGhosts(observed,parents.observed);
  const realOriginal=original.filter(r=>!r.is_ghost),realObserved=observed.filter(r=>!r.is_ghost);
  const keys=new Set(realOriginal.map(identity)),other=new Set(realObserved.map(identity));
  // Validate the complete real-child population before deriving either side.
  if(keys.size===realOriginal.length&&other.size===realObserved.length&&keys.size===other.size&&[...keys].every(k=>other.has(k))){
   const a=original.find(r=>r.is_ghost),b=observed.find(r=>r.is_ghost);
   if(Boolean(a)!==Boolean(b)&&(parents.original.creator_issue||parents.observed.creator_issue))throw Error('Unsupported currency coverage: incomplete reconciliation observations');
   if(!a&&b)original.push(deriveReconciliation(parents.original,realOriginal,'native_direct_observation'));
   if(a&&!b){
    if(!parents.inputs?.length)throw Error('Unsupported currency coverage: unavailable reconciliation inputs');
    // aggregateRows defaults absent counts to zero. That is not evidence for
    // this derivation: require actual operands in every contributing source.
    for(const input of parents.inputs)reconciliationOperands(input,(input.creator_rows||[]).filter(r=>!r.is_ghost));
    observed.push(deriveReconciliation(parents.observed,realObserved,'converted_daily_observation'));
   }
  }
 }
 const lookup=new Map(observed.map(r=>[identity(r),r]));
 const coverageError=reason=>{
  const expected=new Set(original.map(identity)),actual=new Set(lookup.keys());
  const sample=keys=>keys.slice(0,3).map(k=>String(k).replace(/[^a-zA-Z0-9:_-]/g,'?').slice(0,100)).join(',');
  return Error(`Unsupported currency coverage: ${reason}; type=${type} path=${path.slice(0,120)} canonical=${original.length} observed=${observed.length} unique=${lookup.size} missing=${sample([...expected].filter(k=>!actual.has(k)))} extra=${sample([...actual].filter(k=>!expected.has(k)))}`);
 };
 if(new Set(original.map(identity)).size!==original.length||lookup.size!==observed.length||lookup.size!==original.length)throw coverageError('entity population');
 return original.map(row=>{
  const daily=lookup.get(identity(row));if(!daily)throw coverageError('missing entity');
  const out={...namespace(row),report_currency:'USD',...Object.fromEntries(MONEY.map(k=>[k,daily[k]])),daily_provenance:daily.daily_provenance,fx:daily.fx,
   monetary_provenance:{basis:'daily_CNB',native_daily:daily.native,direct_period:Object.fromEntries(MONEY.map(k=>[k,row[k]])),nonmonetary_basis:'canonical_direct_observation'}};
  if(row.is_ghost&&parents){
   // Ghosts are derived observations, not real-entity counts. Retain each
   // observation's residual while exposing both bases. Native threshold money
   // remains the same canonical CZK equivalent in either display currency.
   // Keep canonical nonmonetary presentation, as for real rows. Both residual
   // observations (including differing counts) are retained explicitly below.
   out.derived_reconciliation=daily.derived_reconciliation;
   out.reconciliation_observations={native_direct:{metrics:Object.fromEntries(RECONCILIATION.map(k=>[k,row[k]])),derived_reconciliation:row.derived_reconciliation},converted_daily:{metrics:Object.fromEntries(RECONCILIATION.map(k=>[k,daily[k]])),derived_reconciliation:daily.derived_reconciliation}};
   out.monetary_provenance.nonmonetary_basis='canonical_reconciliation_observation';
  }
  if(row.creator_rows?.length||daily.creator_rows?.length){
   const parentInputs=inputs.filter(r=>identity(r)===identity(row));
   out.creator_rows=canonicalUsd(row.creator_rows||[],daily.creator_rows||[],type,path+'.creator_rows',{original:row,observed:daily,inputs:parentInputs},parentInputs.flatMap(r=>r.creator_rows||[]));
  }
  return out;
 });
}
function compose({legacy,native,correction}){
 v1.validate(legacy);
 for(const type of TYPES){tucPayload(legacy[type]);checkCreatorGhosts(legacy[type].rows);for(const account of native[type]?.accounts||[])checkCreatorGhosts(account.rows);}
 if(correction?!correctionCovered(native.ads,correction):Date.parse(native?.ads?.generated_at)<Date.parse(legacy.ads.generated_at))throw Error('Native ad correction required before shared migration');
 for(const type of TYPES){if(!Number.isFinite(Date.parse(native[type]?.generated_at))||Date.parse(native[type].generated_at)>Date.now())throw Error('Invalid native extraction time');source.renderSnapshot(native[type],'USD');if(JSON.stringify(native[type].range)!==JSON.stringify(legacy[type].range))throw Error('Shared range mismatch');}
 const canonical={};
 for(const type of TYPES){
  let n=structuredClone(native[type]);
  if(type!=='ads')n.accounts=n.accounts.map(a=>a.id===TUC.id?{...a,rows:structuredClone(legacy.daily.rows),reach:type==='aggregate'?legacy.aggregate.rows.map(r=>[`${TUC.id}:${r.id}`,Number(r.reach)]):[]}:a);
  const canonical_v1=structuredClone(legacy[type]);
  const usd=canonicalUsd(canonical_v1.rows,source.renderSnapshot(n,'USD','TUC').rows,type,'rows',undefined,n.accounts.find(a=>a.id===TUC.id).rows);
  canonical[type]={v1:structuredClone(legacy[type]),canonical_v1,native:n,usd};
 }
 const provenance={aggregate_basis:'direct_period',usd_basis:'daily_CNB',population_basis:'canonical_V1_real_entities_plus_derived_creator_reconciliation_union_for_TUC; native_daily_for_TGLV',reconciliation_union:{version:1,scope:'nested_creator_Ghost_only',derivation:'observation_parent_minus_complete_real_children',nonmonetary_presentation:'canonical_native; both residual observations retained',native_threshold_basis:'canonical_native_CZK'},period_rounding:'Direct-period native amounts retained; USD uses observed daily amounts only. No allocation of period/daily differences.',sources:Object.fromEntries(TYPES.map(t=>[t,{tuc:legacy[t].generated_at,daily_fx:t==='ads'?native.ads.generated_at:legacy.daily.generated_at,tuc_monetary_extractions:t==='ads'?(native.ads.source_extractions||[]).filter(e=>!e.account_id||e.account_id===TUC.id):(legacy.daily.source_extractions||[{range:legacy.daily.range,generated_at:legacy.daily.generated_at}]),tglv:native[t].generated_at}]))};
 const generation_id=publication.digest({canonical,provenance});
 return {generation_id,range:legacy.daily.range,provenance,...(correction?{correction}:{}),pieces:canonical};
}
function namespace(row){
 const name=row.campaign_name||row.name;
 const out={...row,source_id:row.id,id:`${TUC.id}:${row.id}`,account_id:TUC.id,account_label:TUC.label,account_timezone:TUC.timezone,native_currency:'CZK',report_currency:'CZK',market:name.includes('_US_')?'US':'CZSK',native:Object.fromEntries(['amount_spent','action_values:omni_purchase'].map(k=>[k,row[k]]))};
 for(const k of ['campaign_id','adset_id','ad_id'])if(row[k]){out['source_'+k]=row[k];out[k]=`${TUC.id}:${row[k]}`;}
 if(row.creator_rows)out.creator_rows=row.creator_rows.map(namespace);
 return out;
}
function render(bundle,type,version,currency='CZK',account='All',metadata){
 const piece=bundle.pieces[type];if(!piece)throw Error('Invalid shared type');
 const names=require('./glv-campaign-metadata.cjs');
 const original=tucPayload(names.applyPayload(piece.canonical_v1||piece.v1,TUC.id,type,metadata));
 const identity={generation_id:bundle.generation_id,...names.bindGeneration({generation_id:bundle.generation_id},metadata?names.digest(metadata):undefined),shared_generation_id:bundle.generation_id,shared_provenance:bundle.provenance,range:bundle.range};
 if(version==='v1')return {...original,...identity};
 const converted=source.renderSnapshot(piece.native,currency,account,metadata);
 if(account!=='TGLV'){
  // USD money was reconciled and coverage-validated at publication. Apply only
  // the independently verified label dimension here, never swap populations.
  const label=(row,named)=>({...row,market:(named.campaign_name||named.name).includes('_US_')?'US':'CZSK',name:named.name,...(named.campaign_name?{campaign_name:named.campaign_name}:{}),campaign_name_metadata:named.campaign_name_metadata,...(row.creator_rows?{creator_rows:row.creator_rows.map((child,i)=>label(child,named.creator_rows[i]))}:{})});
  const namedUsd=piece.usd.map((row,i)=>label(row,original.rows[i]));
  converted.rows=[...(currency==='CZK'?original.rows.map(namespace):namedUsd),...converted.rows.filter(r=>r.account_id!==TUC.id)];
  converted.generated_at=original.generated_at;
 }
 return {...converted,...identity};
}
function unpack(pieces){
 if(pieces.daily?.bundle)return pieces.daily.bundle;
 const {generation_id,range,provenance,correction}=pieces.daily;
 return {generation_id,range,provenance,...(correction?{correction}:{}),pieces:Object.fromEntries(TYPES.map(t=>[t,pieces[t].piece]))};
}
function validate(pieces){
 const b=unpack(pieces);
 if(!b?.generation_id)throw Error('Invalid shared bundle');
 for(const t of TYPES)if((pieces[t]?.generation_id||pieces[t]?.bundle?.generation_id)!==b.generation_id)throw Error('Invalid shared generation');
 const rebuilt=compose({legacy:Object.fromEntries(TYPES.map(t=>[t,b.pieces[t].v1])),native:Object.fromEntries(TYPES.map(t=>[t,b.pieces[t].native])),correction:b.correction});
 if(rebuilt.generation_id!==b.generation_id||publication.digest(b.pieces)!==publication.digest(rebuilt.pieces)||publication.digest(b.provenance)!==publication.digest(rebuilt.provenance))throw Error('Invalid shared content identity');
 for(const t of TYPES)if(JSON.stringify(facts(render(b,t,'v1')))!==JSON.stringify(facts(render(b,t,'v2','CZK','TUC'))))throw Error('Shared fact parity failed');
}
async function read(readValue,preset){const p=await publication.readBundle({key:key(preset),read:readValue,validate});return p?unpack(p):null;}
async function save(redis,preset,bundle){
 const readValue=async k=>{const raw=(await redis('GET',k)).result;return raw?storage.decode(raw):null;};
 const cache=require('./glv-mad-v2-cache.cjs');
 const pieces=Object.fromEntries(TYPES.map(t=>[t,{range:bundle.range,generation_id:bundle.generation_id,provenance:bundle.provenance,...(bundle.correction?{correction:bundle.correction}:{}),piece:bundle.pieces[t]}]));
 await publication.publishBundle({key:key(preset),pieces,validate,read:readValue,write:(k,p)=>cache.publish(redis,k,p),retire:publication.retireRedis(redis,storage.decode)});
 const actual=await read(readValue,preset);if(actual?.generation_id!==bundle.generation_id)throw Error('Shared readback mismatch');
 const manifest=await readValue(key(preset)),storage_hashes={};
 for(const k of [key(preset),...Object.values(manifest.refs).map(r=>r.key)])storage_hashes[k]=require('./glv-refresh-owner.cjs').hash((await redis('GET',k)).result);
 return {storage_hashes,key:key(preset),sha256:require('./glv-refresh-owner.cjs').hash((await redis('GET',key(preset))).result),generation_id:bundle.generation_id,range:bundle.range,facts:Object.fromEntries(TYPES.map(t=>[t,{v1:publication.digest(facts(render(actual,t,'v1'))),v2:publication.digest(facts(render(actual,t,'v2','CZK','TUC'))),rows:render(actual,t,'v1').rows.length}]))};
}
async function migrate(redis,presets,correction){
 const readValue=async k=>{const raw=(await redis('GET',k)).result;return raw?storage.decode(raw):null;};
 const receipts=[];
 for(const p of presets){
  const legacy=await v1.readPublished(readValue,p)||await v1.readLegacy(readValue,p);
  const native=await require('./glv-mad-v2-cache.cjs').readPublished(readValue,p);
  if(!legacy||!native)throw Error('Shared migration source unavailable');
  receipts.push(await save(redis,p,compose({legacy,native,correction})));
 }
 return receipts;
}
const INTENT_KEY=KEY+'correction';
async function ensureCorrection(redis,{now=new Date(),force=false}={}){
 const cache=require('./glv-mad-v2-cache.cjs'),through=v2.commonCutoff(now);
 const raw=(await redis('GET',INTENT_KEY)).result;let intent=raw?storage.decode(raw):null;
 if(intent&&(intent.version!==1||!['pending','complete'].includes(intent.status)||!intent.id||!Number.isFinite(Date.parse(intent.requested_at))))throw Error('Invalid shared correction intent');
 if(!intent||intent.through!==through||(force&&intent.status==='complete')){
  intent={version:1,id:require('node:crypto').randomUUID(),through,requested_at:now.toISOString(),status:'pending'};
  await cache.publish(redis,INTENT_KEY,intent);
 }
 if(intent.status==='pending'){
  const invalid=JSON.stringify({through,shared_correction_id:intent.id,freshness:{all_tabs_verified:false}}),state=require('./glv-refresh-owner.cjs').STATE_KEY;
  if((await redis('SET',state,invalid)).result!=='OK'||(await redis('GET',state)).result!==invalid)throw Error('Shared receipt invalidation failed');
 }
 return intent;
}
async function completeCorrection(redis,intent,receipts){
 const current=storage.decode((await redis('GET',INTENT_KEY)).result);
 if(current.id!==intent.id)throw Error('Shared correction changed');
 return require('./glv-mad-v2-cache.cjs').publish(redis,INTENT_KEY,{...current,status:'complete',receipts});
}
const requiredKeys=()=>[...require('./glv-mad-v2-cache.cjs').PRESETS.map(key),require('./glv-mad-shared-promo.cjs').KEY,INTENT_KEY];
module.exports={KEY,key,facts,compose,render,validate,read,save,migrate,correctionCovered,INTENT_KEY,ensureCorrection,completeCorrection,requiredKeys,tucPayload};
