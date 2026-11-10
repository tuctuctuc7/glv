// Synthetic amounts; approved identities only, no captured client performance.
const ids=['120250608228580687','120250692949130687'];
function history(){
 const fact=(date,i,spend,purchases,revenue)=>({date,ad_id:'synthetic-'+i,ad_name:'SYNTHETIC CC001',adset_id:'set-'+i,adset_name:'Video',campaign_id:ids[i],campaign_name:i?'TUC_037_CZSK_CBO_Sales_Promo_Winners':'TUC_036_CZSK_ABO_Sales_Promo_Oct28-Nov04',format:'Video',reason:'current_adset_label',spend,purchases,revenue,impressions:spend*10,link_clicks:0,landing_page_views:0,checkouts:0});
 return {schema_version:1,classification_version:2,funnel_version:1,reconciled:true,generated_at:'2026-11-10T00:00:00Z',range:{since:'2026-03-01',until:'2026-11-09'},rows:[fact('2026-10-28',0,100,2,200),fact('2026-11-02',0,20,1,40),fact('2026-11-02',1,10,1,20),fact('2026-11-05',0,30,1,60),fact('2026-11-06',0,10,1,20),fact('2026-11-07',0,0,1,10),fact('2026-11-08',0,0,1,10)]};
}
module.exports={history};
