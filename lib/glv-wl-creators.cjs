// Nested ad-set facts preserve campaign totals and campaign-level unique reach.
const {resolveCreator}=require('../public/glv-meta-ads/wl-report.js');
const isWl=name=>/(?:^|_)WL(?:_|$)/.test(String(name||''));
const needsAdsets=row=>isWl(row.name)&&resolveCreator(row.name).status==='missing';
const additive=['amount_spent','impressions','actions:link_click','actions:landing_page_view','actions:omni_purchase','actions:initiate_checkout','actions:outbound_click','actions:lead','action_values:omni_purchase'];
function attachCreatorFacts(rows,adsets){
 const key=r=>JSON.stringify([r.id,r.date_start||null,r.date_stop||null]);
 const groups=new Map();
 for(const row of adsets){const k=key(row);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(row);}
 return rows.map(row=>{
  if(!needsAdsets(row))return {...row,creator_rows:[]};
  const children=groups.get(key(row))||[];
  const unique=new Set(children.map(r=>r.adset_id));
  const reconciled=children.length>0&&unique.size===children.length&&children.every(r=>r.adset_id&&typeof r.adset_name==='string')&&additive.every(k=>{
   const expected=Number(row[k]||0),sum=children.reduce((n,r)=>n+Number(r[k]||0),0);
   return Number.isFinite(expected)&&Number.isFinite(sum)&&Math.abs(expected-sum)<=0.02;
  });
  return {...row,creator_rows:reconciled?children:[],...(!reconciled?{creator_issue:'Ad-set facts do not reconcile with campaign totals; refresh and check source naming.'}:{})};
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
module.exports={attachCreatorFacts,campaignFacts,needsAdsets};
