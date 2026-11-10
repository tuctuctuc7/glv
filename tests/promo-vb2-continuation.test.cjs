const test=require('node:test'),assert=require('node:assert/strict');
const {promoMix,monthlyMix}=require('../public/glv-meta-ads/promo-format.js');
const {sliceCachedFormats}=require('../lib/glv-promo-format.cjs');
const {renderPromo}=require('../lib/glv-mad-v2-promo.cjs');
const {history}=require('./helpers/promo-vb2-fixture.cjs');

test('existing cached history groups verified VB2 continuation and carryover in both version readers without rewriting facts',()=>{
 const cached=history(),before=JSON.stringify(cached),now=new Date('2026-11-10T12:00:00Z');
 const v1=sliceCachedFormats(cached,cached.range,now,{allowStale:true});
 const fx=Object.fromEntries(cached.rows.map(r=>[r.date,{date:r.date,czk_per_usd:25}]));
 for(const data of [v1,renderPromo({payload:cached,fx},'CZK','All',now),renderPromo({payload:cached,fx},'USD','TUC',now)]){
  const groups=promoMix(data.rows);
  assert.deepEqual(groups.map(g=>g.label),['Oct/Nov VB2']);
  for(const k of ['spend','revenue','purchases','impressions'])assert.equal(groups[0].total[k],data.rows.reduce((n,r)=>n+r[k],0));
  assert.equal(data.generated_at,cached.generated_at);
  assert.equal(groups[0].total.ads,2);
 }
 assert.equal(renderPromo({payload:cached,fx},'CZK','TGLV',now).rows.length,0);
 assert.equal(JSON.stringify(cached),before);
 assert.equal(monthlyMix(cached.rows).length,2);
 assert.deepEqual(promoMix(cached.rows.slice().reverse()),promoMix(cached.rows));
});

test('V2 paired outcome visibility survives conversion and aggregate cancellation',()=>{
 const {hasFinancialContribution}=require('../public/glv-meta-ads/promo-format.js');
 const {aggregate}=require('../public/glv-meta-ads/promo-concepts.js');
 for(const values of [[0.06,0.01,-0.01],[0.3,0.3],[1,-1],[0.5],[-0.5],[12.5],[-12.5]]){
  const cached=history();
  values.forEach((revenue,i)=>cached.rows.push({is_ghost:true,label:'Ghost creative — pending Meta reconciliation',campaign_id:cached.rows[0].campaign_id,campaign_name:cached.rows[0].campaign_name,date:`2026-11-0${i+5}`,format:'Ghost',reason:'campaign_day_residual',spend:0,revenue,purchases:1,impressions:0,link_clicks:0,landing_page_views:0,checkouts:0}));
  const before=JSON.stringify(cached),fx=Object.fromEntries(cached.rows.map(r=>[r.date,{date:r.date,czk_per_usd:25}]));
  for(const currency of ['CZK','USD']){
   const data=renderPromo({payload:cached,fx},currency,'All',new Date('2026-11-10T20:00:00Z'));
   const group=promoMix(data.rows)[0],residual=values.reduce((a,b)=>a+b,0)/(currency==='USD'?25:1);
   assert.ok(Math.abs(group.formats.Ghost.revenue-residual)<1e-10);
   assert.equal(hasFinancialContribution(group.formats.Ghost),Math.abs(residual)>1e-8);
   assert.equal(hasFinancialContribution(aggregate(data.rows,[data.rows[0].campaign_id]).find(r=>r.is_ghost)),Math.abs(residual)>1e-8);
   assert.ok(Math.abs(group.total.revenue-data.rows.reduce((n,r)=>n+r.revenue,0))<1e-10);
  }
  assert.equal(JSON.stringify(cached),before);
 }
});
test('new November campaign without same-day spend starts a separate event; old campaign carryover remains',()=>{
 const original=history().rows,template=original[0];
 const rows=[...original,{...template,campaign_id:'new',ad_id:'new',date:'2026-11-20'},{...template,date:'2026-11-20',spend:0,revenue:12}];
 const groups=promoMix(rows);assert.deepEqual(groups.map(g=>g.label),['Oct/Nov VB2','Nov 2026']);
 assert.equal(groups[0].total.spend,170);assert.equal(groups[1].total.spend,100);
});
