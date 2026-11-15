'use strict';
// Pure V2-owned observation composition. Ported from the canonical shared
// composer, without loading its V1/cache/owner dependencies. No I/O occurs here.
const TUC=require('./glv-mad-v2.cjs').ACCOUNTS.find(a=>a.label==='TUC');
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
function namespace(row){
 const name=row.campaign_name||row.name;
 const out={...row,source_id:row.id,id:`${TUC.id}:${row.id}`,account_id:TUC.id,account_label:TUC.label,account_timezone:TUC.timezone,native_currency:'CZK',report_currency:'CZK',market:name.includes('_US_')?'US':'CZSK',native:Object.fromEntries(['amount_spent','action_values:omni_purchase'].map(k=>[k,row[k]]))};
 for(const k of ['campaign_id','adset_id','ad_id'])if(row[k]){out['source_'+k]=row[k];out[k]=`${TUC.id}:${row[k]}`;}
 if(row.creator_rows)out.creator_rows=row.creator_rows.map(namespace);
 return out;
}

function composeObservation(original,observed,type,inputs){
 const native=structuredClone(original),daily=structuredClone(observed);
 checkCreatorGhosts(native);checkCreatorGhosts(daily);checkCreatorGhosts(inputs);
 const usd=canonicalUsd(native,daily,type,'rows',undefined,inputs);
 return {native:native.map(namespace),usd};
}
module.exports={composeObservation};
