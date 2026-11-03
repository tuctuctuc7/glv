const range={since:'2026-10-28',until:'2026-11-02'};
function fixture({ad=10,campaign=12,empty=false,malformed=false}={}) {
 const row=n=>({campaign_id:'c',date_start:'2026-11-01',spend:String(n),impressions:String(n),actions:['omni_purchase','link_click','landing_page_view','initiate_checkout'].map(action_type=>({action_type,value:String(n)})),action_values:[{action_type:'omni_purchase',value:String(n)}]});
 return async url=>{const u=new URL(url),p=u.searchParams;let data;
 if(u.pathname.endsWith('/insights')){const r=JSON.parse(p.get('time_range'));data={data:r.since<='2026-11-01'&&r.until>='2026-11-01'?(p.get('level')==='campaign'?[row(campaign)]:empty?[]:[{...row(ad),ad_id:'a',adset_id:'s'}]):[]};if(malformed&&p.get('level')==='ad')data={};}
 else if(p.get('fields').includes('creative'))data={a:{id:'a'}};
 else if(p.get('fields').includes('adset_id'))data={a:{id:'a',name:'CC10',campaign_id:'c',adset_id:'s'}};
 else if(p.get('fields').includes('campaign_id'))data={s:{id:'s',name:'Banner',campaign_id:'c'}};
 else data={c:{id:'c',name:'TUC_008_CZSK_Promo'}};
 return {ok:true,json:async()=>data};};
}
module.exports={fixture,range};
