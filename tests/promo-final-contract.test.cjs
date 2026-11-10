const test=require('node:test'),assert=require('node:assert/strict');
const F=require('../public/glv-meta-ads/promo-format.js'),C=require('../public/glv-meta-ads/promo-concepts.js');
const row=(date,id,spend=1,extra={})=>({date,campaign_id:id,campaign_name:'TUC_001_CZSK_Promo',ad_id:id,format:'Video',spend,revenue:0,purchases:0,impressions:0,link_clicks:0,landing_page_views:0,checkouts:0,...extra});
test('daily positive campaign spend joins starts only, account scoped, carryover retained',()=>{
 const rows=[row('2026-10-28','a'),row('2026-11-02','a'),row('2026-11-02','b'),row('2026-11-06','a'),row('2026-11-20','c'),row('2026-11-20','b',0,{revenue:12}),row('2026-11-02','x',1,{account_id:'other'})];
 const before=JSON.stringify(rows),groups=F.promoMix(rows);
 assert.equal(groups.length,3);assert.equal(groups[0].label,'Oct/Nov VB2');assert.equal(groups[0].total.spend,4);assert.equal(groups[0].total.revenue,12);
 assert.deepEqual(F.promoMix(rows.slice().reverse()),groups);assert.equal(JSON.stringify(rows),before);
 // A negative campaign residual cancels ad spend: no inferred delivery overlap.
 const cancelled=[row('2026-10-28','a'),row('2026-11-02','a'),row('2026-11-02','a',-1,{is_ghost:true,format:'Ghost'}),row('2026-11-02','b')];
 assert.equal(F.promoMix(cancelled).length,2);
});
test('historical spend starts produce nine logical promos without invented Private deliveries',()=>{
 const episodes=[['march','2026-03-25',6],['april','2026-04-21',9],['may','2026-05-14',8],['june','2026-06-18',6],['july','2026-07-21',10],['july-fomo','2026-07-28',3],['august','2026-08-20',7],['september','2026-09-13',10],['september-fomo','2026-09-21',2],['menopause','2026-10-07',8],['vb2','2026-10-28',10],['vb2-winners','2026-11-02',3]];
 const rows=episodes.flatMap(([id,start,days])=>Array.from({length:days},(_,i)=>row(new Date(Date.parse(start)+i*86400000).toISOString().slice(0,10),id)));
 const groups=F.promoMix(rows);
 assert.equal(groups.length,9);assert.deepEqual(groups.map(g=>g.label),['Mar 2026','Apr 2026','May 2026','Jun Public','Jul 2026','Aug Public','Sep 2026','Oct Menopause','Oct/Nov VB2']);
 assert.equal(groups.reduce((s,g)=>s+g.total.spend,0),rows.length);
 assert.equal(groups[4].total.spend,13);assert.equal(groups[6].total.spend,12);assert.equal(groups[8].total.spend,13);
});
test('outcome-only unknown campaign never invents a Private stage',()=>{
 const groups=F.promoMix([row('2026-06-15','unknown',0,{revenue:10,purchases:1})]);
 assert.equal(groups[0].label,'Unassigned · Jun 2026');assert.equal(groups[0].delivery_observed,false);assert.equal(groups[0].total.revenue,10);
});
test('final Ghost paired outcomes or strictly absolute CZK spend, after cancellation and FX',()=>{
 for(const [spend,revenue,purchases,expected] of [[0,.06,0,false],[0,0,1,false],[0,-.06,-1,true],[0,.06,-1,true],...[-10.01,-10,-9.99,9.99,10,10.01].map(n=>[n,0,0,Math.abs(n)>10])]){
  for(const rate of [1,25]){
   const r=row('2026-11-01','a',spend/rate,{format:'Ghost',is_ghost:true,revenue:revenue/rate,purchases,native:{spend,revenue},native_currency:'CZK'});
   for(const g of [F.promoMix([r])[0].formats.Ghost,C.aggregate([r],['a'])[0]])assert.equal(F.hasFinancialContribution(g),expected,JSON.stringify({spend,revenue,purchases,rate}));
  }
 }
 const rows=[row('2026-11-01','a',11,{is_ghost:true,format:'Ghost'}),row('2026-11-02','a',-11,{is_ghost:true,format:'Ghost'})];
 assert.equal(F.hasFinancialContribution(C.aggregate(rows,['a'])[0]),false);
});
