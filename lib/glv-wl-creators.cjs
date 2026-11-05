// Nested ad-set facts preserve campaign totals and campaign-level unique reach.
const {resolveCreator}=require('../public/glv-meta-ads/wl-report.js');
const isWl=name=>/(?:^|_)WL(?:_|$)/.test(String(name||''));
const needsAdsets=row=>isWl(row.name)&&resolveCreator(row.name).status==='missing';
const additive=['amount_spent','impressions','actions:link_click','actions:landing_page_view','actions:omni_purchase','actions:initiate_checkout','actions:outbound_click','actions:lead','action_values:omni_purchase'];
function validCreatorGhost(r){return Boolean(r&&r.is_ghost===true&&r.reason==='campaign_adset_residual'&&r.creator===null&&r.reach===null&&r.adset_id===undefined&&r.adset_name===undefined&&additive.every(k=>typeof r[k]==='number'&&Number.isFinite(r[k])));}
function attachCreatorFacts(rows,adsets){
 const key=r=>JSON.stringify([r.id,r.date_start||null,r.date_stop||null]);
 const groups=new Map();
 for(const row of adsets){const k=key(row);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(row);}
 return rows.map(row=>{
  if(!needsAdsets(row))return {...row,creator_rows:[]};
  const children=groups.get(key(row))||[];
  const unique=new Set(children.map(r=>r.adset_id));
  const valid=children.length>0&&unique.size===children.length&&children.every(r=>r.adset_id&&typeof r.adset_name==='string')&&[row,...children].every(r=>additive.every(k=>r[k]===undefined||((typeof r[k]==='number'||typeof r[k]==='string')&&String(r[k]).trim()!==''&&Number.isFinite(Number(r[k]))&&Number(r[k])>=0)));
  if(!valid)return {...row,creator_rows:[],creator_issue:'Ad-set facts invalid or missing; check source availability, identities and metrics.'};
  const residual=Object.fromEntries(additive.map(k=>[k,Number(row[k]||0)-children.reduce((n,r)=>n+Number(r[k]||0),0)]));
  // Preserve source child facts. Never allocate the signed discrepancy to a creator
  // or subtract unique reach: Meta reach is not additive across ad sets.
  const ghost=Object.values(residual).some(n=>Math.abs(n)>1e-9)?{id:row.id,name:row.name,date_start:row.date_start||null,date_stop:row.date_stop||null,is_ghost:true,creator:null,label:'Ghost / unattributed creator — pending Meta reconciliation',reason:'campaign_adset_residual',reach:null,...residual}:null;
  return {...row,creator_rows:ghost?[...children,ghost]:children};
 });
}
async function campaignFacts(url,paginate,normalize){
 const raw=await paginate(url),rows=raw.map(normalize);
 const ids=[...new Set(rows.filter(needsAdsets).map(r=>r.id))];
 if(!ids.length)return attachCreatorFacts(rows,[]);
 const childUrl=new URL(url);
 childUrl.searchParams.set('level','adset');
 childUrl.searchParams.set('fields',childUrl.searchParams.get('fields')+',adset_id,adset_name');
 childUrl.searchParams.set('filtering',JSON.stringify([{field:'campaign.id',operator:'IN',value:ids}]));
 let children;
 try { children=await paginate(childUrl.toString()); }
 catch {
  // Optional attribution must not erase successfully fetched campaign facts.
  // Never forward upstream errors: URLs may contain access tokens.
  return rows.map(row=>({...row,creator_rows:[],...(needsAdsets(row)?{creator_issue:'Ad-set facts unavailable; refresh to resolve creator attribution.'}:{})}));
 }
 return attachCreatorFacts(rows,children.map(r=>({...normalize(r),adset_id:r.adset_id||'',adset_name:r.adset_name||''})));
}
module.exports={attachCreatorFacts,campaignFacts,needsAdsets,validCreatorGhost};
