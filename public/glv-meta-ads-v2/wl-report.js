/* Shared WL report calculations. No report snapshots or client data. */
(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;else root.GlvWlReport=api;})(typeof globalThis==='object'?globalThis:this,()=>{
 'use strict';
 const creators=['ActionKate','Kristyna','befit_over40'];
 const text=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const token=(s,t)=>new RegExp('(?:^|[^a-z0-9])'+t+'(?=$|[^a-z0-9])','i').test(s);
 const number=v=>v===null||v===undefined||String(v).trim()===''||!Number.isFinite(Number(v))?null:Number(v);
 function asset(name){
  const s=String(name||'');const p=s.match(/(?:^|[^a-z0-9])PAC[ _-]*(\d+)(?=$|[^a-z0-9])/i);
  if(!p)return {pac:null,label:s||'(unnamed asset)'};
  const v=s.slice(p.index+p[0].length).match(/(?:^|[^a-z0-9])V[ _-]*(\d+)(?=$|[^a-z0-9])/i);
  return {pac:p[1],label:`PAC ${p[1]}${v?' V'+v[1]:''}`};
 }
 // Migration: a supported explicit ad prefix wins; legacy parents remain fallback.
 // PAC numbers identify assets, never creators. Conflicting explicit ad labels fail closed.
 function resolveCreator(campaign,adset,ad){
  const adText=text(ad),adMatches=creators.filter(c=>token(adText,text(c)));
  if(adMatches.length>1)return {creator:null,source:'ad',status:'ambiguous'};
  const prefix=adText.match(/^(kristyna|actionkate|befit_over40)_pac[0-9]+_(\S.*)$/);
  if(prefix)return {creator:creators.find(c=>text(c)===prefix[1]),source:'ad',status:'resolved'};
  const campaignMatches=creators.filter(c=>token(text(campaign),text(c)));
  const matches=campaignMatches.length?campaignMatches:creators.filter(c=>token(text(adset),text(c)));
  return {creator:matches.length===1?matches[0]:null,source:campaignMatches.length?'campaign':'adset',status:matches.length===1?'resolved':matches.length?'ambiguous':'missing'};
 }
 const evidenceFields=['facebook_branded_content.sponsor_page_id','instagram_branded_content.sponsor_id'];
 function validPartnership(p){
  return Boolean(p&&Array.isArray(p.evidence)&&(p.status==='verified_positive'&&p.reason==='sponsor_metadata'&&p.evidence.length&&p.evidence.every(e=>evidenceFields.includes(e))||p.status==='unverified'&&['no_positive_metadata','metadata_unavailable'].includes(p.reason)&&p.evidence.length===0));
 }
 function verification(raw){
  const d={verified:0,noPositive:0,unavailable:0,naming:[]};
  for(const r of raw){
   const p=r.partnership,positive=validPartnership(p)&&p.status==='verified_positive';
   if(positive)d.verified++;else if(validPartnership(p)&&p.reason==='no_positive_metadata')d.noPositive++;else d.unavailable++;
   const named=token(text(r.campaign_name),'wl')||token(text(r.adset_name),'wl');
   const label=`${r.campaign_name||'(unnamed campaign)'} / ${r.adset_name||'(unnamed ad set)'} / ${r.id}`;
   if(named&&!positive)d.naming.push(`WL-named but unverified; excluded: ${label}`);
   if(!named&&positive)d.naming.push(`Verified partnership without WL naming; included: ${label}`);
  }
  return d;
 }
 function normalize(raw){
  return raw.filter(r=>validPartnership(r.partnership)&&r.partnership.status==='verified_positive').map(r=>{
   const name=String(r.campaign_name||''),resolution=resolveCreator(name,r.adset_name,r.name),a=asset(r.name);
   const us=token(text(name),'us'),cz=token(text(name),'cz')||token(text(name),'czsk');
   const market=r.account_id==='1021777267558882'?'US':us&&cz?null:us?'US':cz?'CZSK':/^wl_befit_over40(?:_|$)/i.test(name)?'CZSK':null;
   return {accountId:r.account_id,id:r.id,campaignId:r.campaign_id,campaign:name,creator:resolution.creator,adset:String(r.adset_name||''),adName:String(r.name||''),creatorStatus:resolution.status,
    market,
    label:a.label,pac:a.pac,actual:number(r.amount_spent),revenue:number(r['action_values:omni_purchase']),purchases:number(r['actions:omni_purchase'])};
  });
 }
 function sum(rows){
  const add=key=>rows.every(r=>r[key]!==null)?rows.reduce((n,r)=>n+r[key],0):null;
  const actual=add('actual'),revenue=add('revenue'),purchases=add('purchases');
  const excludedRows=rows.filter(r=>r.creator==='ActionKate'&&r.pac==='462');
  const excluded=excludedRows.every(r=>r.actual!==null)?excludedRows.reduce((n,r)=>n+r.actual,0):null;
  const reported=actual===null||excluded===null?null:actual-excluded;
  return {actual,excluded,reported,revenue,purchases,standard:actual>0&&revenue!==null?revenue/actual:null,adjusted:reported>0&&revenue!==null?revenue/reported:null};
 }
 function report(rows,filters={}){
  const selected=(key,value)=>filters[key]==null||filters[key].includes(value);
  rows=rows.filter(r=>selected('campaign',r.campaignId)&&selected('market',r.market)&&selected('creator',r.creator));
  const group=(key)=>{const groups=new Map();for(const r of rows){const k=key(r);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);}return [...groups.values()].map(g=>({...g[0],...sum(g)}));};
  const overview=creators.filter(c=>rows.some(r=>r.creator===c)).map(creator=>({creator,...sum(rows.filter(r=>r.creator===creator))}));
  const identity=r=>r.creator||JSON.stringify([r.campaignId,r.campaign]);
  const unresolvedOverview=group(r=>identity(r)).filter(r=>!r.creator);
  const markets=group(r=>JSON.stringify([identity(r),r.market])).sort((a,b)=>creators.indexOf(a.creator)-creators.indexOf(b.creator)||String(a.market).localeCompare(String(b.market)));
  const creativeRows=group(r=>JSON.stringify([r.accountId,identity(r),r.market,r.label]));
  const creatives=Object.fromEntries([...creators,null].map(c=>[c,creativeRows.filter(r=>r.creator===c).sort((a,b)=>(b.actual??-Infinity)-(a.actual??-Infinity)||a.label.localeCompare(b.label))]));
  return {rows,overview,unresolvedOverview,markets,creatives,total:sum(rows),issues:[...new Set(rows.filter(r=>!r.creator||!r.market).map(r=>`${r.campaign}${r.adset?' / '+r.adset:''}${!r.creator?' / '+r.adName+' — '+r.creatorStatus:''}`))]};
 }
 function lastMonth(now=new Date()){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Prague',year:'numeric',month:'numeric'}).formatToParts(now).map(p=>[p.type,p.value]));
  const year=Number(parts.year),month=Number(parts.month)-1;
  return {since:new Date(Date.UTC(year,month-1,1)).toISOString().slice(0,10),until:new Date(Date.UTC(year,month,0)).toISOString().slice(0,10)};
 }
 return {normalize,report,asset,creators,lastMonth,resolveCreator,validPartnership,verification};
});
