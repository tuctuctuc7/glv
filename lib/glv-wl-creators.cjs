// Nested ad facts preserve campaign totals and campaign-level unique reach.
// attachCreatorFacts also accepts legacy ad-set fixtures; production/cache requires ads.
const isWl=name=>/(?:^|_)WL(?:_|$)/.test(String(name||''));
// All WL parents need ad facts: even a creator-named parent can contain migrated ads.
const needsAdsets=row=>isWl(row.name);
const additive=['amount_spent','impressions','actions:link_click','actions:landing_page_view','actions:omni_purchase','actions:initiate_checkout','actions:outbound_click','actions:lead','action_values:omni_purchase'];
function validCreatorGhost(r){return Boolean(r&&r.is_ghost===true&&r.reason==='campaign_adset_residual'&&r.creator===null&&r.reach===null&&r.adset_id===undefined&&r.adset_name===undefined&&additive.every(k=>typeof r[k]==='number'&&Number.isFinite(r[k])));}
function attachCreatorFacts(rows,adsets){
 const key=r=>JSON.stringify([r.id,r.date_start||null,r.date_stop||null]);
 const groups=new Map();
 for(const row of adsets){const k=key(row);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(row);}
 return rows.map(row=>{
  if(!needsAdsets(row))return {...row,creator_rows:[]};
  const children=groups.get(key(row))||[];
  const unique=new Set(children.map(r=>r.ad_id||r.adset_id));
  const valid=children.length>0&&unique.size===children.length&&children.every(r=>r.adset_id&&typeof r.adset_name==='string'&&(r.ad_id===undefined||Boolean(r.ad_id&&typeof r.ad_name==='string')))&&[row,...children].every(r=>additive.every(k=>r[k]===undefined||((typeof r[k]==='number'||typeof r[k]==='string')&&String(r[k]).trim()!==''&&Number.isFinite(Number(r[k]))&&Number(r[k])>=0)));
  if(!valid)return {...row,creator_rows:[],creator_issue:'Ad-level creator facts invalid or missing; check source availability, identities and metrics.'};
  const residual=Object.fromEntries(additive.map(k=>[k,Number(row[k]||0)-children.reduce((n,r)=>n+Number(r[k]||0),0)]));
  // Preserve source child facts. Never allocate the signed discrepancy to a creator
  // or subtract unique reach: Meta reach is not additive across ad sets.
  const ghost=Object.values(residual).some(n=>Math.abs(n)>1e-9)?{id:row.id,name:row.name,date_start:row.date_start||null,date_stop:row.date_stop||null,is_ghost:true,creator:null,label:'Ghost / unattributed creator — pending Meta reconciliation',reason:'campaign_adset_residual',reach:null,...residual}:null;
  const {creator_issue,...clean}=row;
  return {...clean,creator_rows:ghost?[...children,ghost]:children};
 });
}
async function campaignFacts(url,paginate,normalize){
 const raw=await paginate(url),rows=raw.map(normalize);
 return refillCreatorFacts(rows,url,paginate,normalize);
}
async function refillCreatorFacts(rows,url,paginate,normalize){
 const ids=[...new Set(rows.filter(needsAdsets).map(r=>r.id))];
 if(!ids.length)return attachCreatorFacts(rows,[]);
 const childUrl=new URL(url);
 childUrl.searchParams.set('level','ad');
 childUrl.searchParams.set('fields',childUrl.searchParams.get('fields')+',adset_id,adset_name,ad_id,ad_name');
 childUrl.searchParams.set('filtering',JSON.stringify([{field:'campaign.id',operator:'IN',value:ids}]));
 let children;
 try { children=await paginate(childUrl.toString()); }
 catch {
  // Optional attribution must not erase successfully fetched campaign facts.
  // Never forward upstream errors: URLs may contain access tokens.
  return rows.map(row=>({...row,creator_rows:[],...(needsAdsets(row)?{creator_issue:'Ad-level creator facts unavailable; refresh to resolve creator attribution.'}:{})}));
 }
 return attachCreatorFacts(rows,children.map(r=>({...normalize(r),adset_id:r.adset_id||'',adset_name:r.adset_name||'',ad_id:r.ad_id||'',ad_name:r.ad_name||''})));
}
// Availability is independent of successful creator extraction. Readers may
// retain incomplete campaigns, but refresh owners must keep recovering them.
function creatorFactsComplete(rows){return Array.isArray(rows)&&rows.every(r=>!needsAdsets(r)||(!r.creator_issue&&r.creator_rows?.some(c=>!c.is_ghost)&&r.creator_rows.every(c=>c.is_ghost?validCreatorGhost(c):Boolean(c.ad_id&&typeof c.ad_name==='string'&&c.ad_name&&c.adset_id&&typeof c.adset_name==='string'))));}
function recoverCreatorFacts(rows,source,range,type){
 if(!source||!Array.isArray(source.rows)||source.range?.since!==range.since||source.range?.until!==range.until||!Number.isFinite(Date.parse(source.generated_at)))return rows;
 // Called within one validated native account only. Never combine accounts or
 // distribute aggregate totals into daily rows. Ads eligibility remains intact:
 // these facts explain campaign totals; WL report still requires partnership.
 const children=source.rows.map(r=>{const {campaign_id,campaign_name,...ad}=r;return {...ad,id:campaign_id,name:campaign_name,ad_id:r.id,ad_name:r.name,date_start:type==='aggregate'?range.since:r.date_start,date_stop:type==='aggregate'?range.until:r.date_stop};});
 if(type!=='aggregate'&&children.some(r=>!r.date_start||r.date_start!==r.date_stop))return rows;
 return rows.map(row=>{
  if(creatorFactsComplete([row]))return row;
  const repaired=attachCreatorFacts([row],children)[0];
  if(!repaired.creator_rows?.length)return row;
  delete repaired.creator_issue;
  return {...repaired,creator_source_generated_at:source.generated_at};
 });
}
function creatorAttributionDiagnostics(rows){
 const {resolveCreator}=require('../public/glv-meta-ads/wl-report.js');
 const counts={ad_name_facts:0,legacy_fallback_facts:0,unresolved_facts:0},creators=new Set();
 for(const parent of rows.filter(needsAdsets))for(const ad of parent.creator_rows||[]){
  if(ad.is_ghost)continue;
  const result=resolveCreator(parent.name,ad.adset_name,ad.ad_name);
  if(!result.creator)counts.unresolved_facts++;
  else{counts[result.source==='ad'?'ad_name_facts':'legacy_fallback_facts']++;creators.add(result.creator);}
 }
 return {...counts,creators:[...creators].sort()};
}
module.exports={attachCreatorFacts,campaignFacts,refillCreatorFacts,needsAdsets,validCreatorGhost,creatorFactsComplete,recoverCreatorFacts,creatorAttributionDiagnostics};
