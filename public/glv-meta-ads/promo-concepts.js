(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.PromoConcepts=factory();})(globalThis,()=>{
  'use strict';
  const inputs=['spend','purchases','revenue','impressions','link_clicks','landing_page_views','checkouts'];
  const eligible=r=>/^(TUC|GLV)_\d+_/.test(r.campaign_name)&&r.campaign_name.includes('_CZSK_')&&!r.campaign_name.includes('_US_')&&r.campaign_name.includes('_Promo');
  function identity(name){
    const codes=[...new Set((name.match(/(?<![A-Za-z0-9])(?:CC|PAC)[ _]*\d+(?![A-Za-z0-9])/gi)||[]).map(s=>s.replace(/[ _]/g,'').toUpperCase()))];
    return codes.length===1?{label:codes[0],key:'code:'+codes[0],warning:''}:{label:name,key:'name:'+name,warning:codes.length?'Conflicting codes — full ad name':'Unmapped — full ad name'};
  }
  const ratio=(a,b,scale=1)=>b>0?a/b*scale:null;
  function aggregate(rows,selected){
    const groups=new Map(), totals={spend:0,purchases:0};
    for(const r of rows.filter(r=>eligible(r)&&selected.includes(r.campaign_id))){
      const id=identity(r.ad_name),key=JSON.stringify([r.campaign_id,id.key]);
      if(!groups.has(key))groups.set(key,{key,...id,campaign_id:r.campaign_id,campaign_name:r.campaign_name,...Object.fromEntries(inputs.map(k=>[k,0]))});
      const g=groups.get(key);for(const k of inputs)g[k]+=r[k];totals.spend+=r.spend;totals.purchases+=r.purchases;
    }
    return [...groups.values()].map(g=>({...g,spendShare:ratio(g.spend,totals.spend,100),purchaseShare:ratio(g.purchases,totals.purchases,100),roas:ratio(g.revenue,g.spend),ctr:ratio(g.link_clicks,g.impressions,100),costLP:ratio(g.spend,g.landing_page_views),lpCheckout:ratio(g.checkouts,g.landing_page_views,100),checkoutPurchase:ratio(g.purchases,g.checkouts,100),cvr:ratio(g.purchases,g.landing_page_views,100)}));
  }
  function campaigns(rows){
    const map=new Map();for(const r of rows.filter(eligible)){
      const g=map.get(r.campaign_id)||{id:r.campaign_id,name:r.campaign_name,last:''};
      if((r.spend>0||r.impressions>0)&&r.date>g.last)g.last=r.date;map.set(g.id,g);
    }return [...map.values()].sort((a,b)=>b.last.localeCompare(a.last)||a.id.localeCompare(b.id));
  }
  function selection(rows,current){if(current!==null)return current;const delivered=campaigns(rows).filter(c=>c.last);return delivered.length?[delivered[0].id]:null;}
  function sort(rows,key,direction){return rows.map((r,i)=>({r,i})).sort((a,b)=>a.r[key]===null?(b.r[key]===null?a.i-b.i:1):b.r[key]===null?-1:(direction==='asc'?1:-1)*(a.r[key]-b.r[key])||a.i-b.i).map(x=>x.r);}
  return {inputs,eligible,identity,aggregate,campaigns,selection,sort};
});
