const test=require('node:test'),assert=require('node:assert/strict');
const {renderPromo}=require('../lib/glv-mad-v2-promo.cjs');
const fixture=require('./helpers/promo-ghost-fixture.cjs');
test('real Promo extractor output preserves classification, inventory, source identities and signed ghost through both currencies',async()=>{
 const {fetchPromoFormats}=require('../lib/glv-promo-format.cjs');
 const payload=await fetchPromoFormats('synthetic',fixture.range,fixture.fixture({ad:15,campaign:10}));
 const fx=Object.fromEntries(['2026-10-28','2026-10-29','2026-10-30','2026-10-31','2026-11-01','2026-11-02'].map(date=>[date,{date,czk_per_usd:25,source:'test'}]));
 const before=JSON.stringify(payload),usd=renderPromo({payload,fx},'USD'),czk=renderPromo({payload,fx},'CZK');
 assert.equal(JSON.stringify(payload),before);assert.equal(usd.classification_version,payload.classification_version);assert.equal(usd.funnel_version,payload.funnel_version);
 assert.ok(Math.abs(usd.rows.reduce((sum,r)=>sum+r.spend,0)-0.4)<1e-12);assert.equal(czk.rows.reduce((sum,r)=>sum+r.spend,0),10);
 const ghost=usd.rows.find(r=>r.is_ghost);assert.ok(ghost.spend<0);assert.equal(ghost.ad_id,undefined);assert.equal(ghost.asset_inventory,undefined);
 const real=usd.rows.find(r=>!r.is_ghost);assert.equal(real.source_ad_id,'a');assert.equal(real.ad_id,'359758259164738:a');assert.equal(real.format,payload.rows.find(r=>!r.is_ghost).format);
});
test('historical cached revision 2 labels reclassify before namespacing without retimestamping or changing Ghost/inventory',async()=>{
 const {fetchPromoFormats,sliceCachedFormats}=require('../lib/glv-promo-format.cjs');
 const payload=await fetchPromoFormats('synthetic',fixture.range,fixture.fixture({ad:15,campaign:10}));
 payload.generated_at='2026-11-03T12:00:00Z';
 for(const r of payload.rows)if(!r.is_ghost){r.format='Unknown';r.reason='no_approved_mapping';r.adset_name='Video';}
 const expected=sliceCachedFormats(payload,payload.range,new Date('2026-11-09T12:00:00Z'),{allowStale:true});
 const fx=Object.fromEntries(payload.rows.map(r=>[r.date,{date:r.date,czk_per_usd:25}]));
 const out=renderPromo({payload,fx},'CZK');
 assert.equal(out.generated_at,payload.generated_at);assert.deepEqual(out.range,payload.range);
 for(let i=0;i<out.rows.length;i++){
  assert.equal(out.rows[i].format,expected.rows[i].format);assert.equal(out.rows[i].reason,expected.rows[i].reason);
  for(const key of ['spend','revenue','purchases','impressions','link_clicks','landing_page_views','checkouts','asset_inventory'])assert.deepEqual(out.rows[i][key],expected.rows[i][key]);
 }
});
test('V2 Promo uses daily historical conversion including signed ghost and excludes TGLV account',()=>{
 const payload={schema_version:1,classification_version:2,reconciled:true,generated_at:new Date().toISOString(),range:{since:'2025-01-03',until:'2025-01-05'},rows:[{campaign_id:'1',campaign_name:'TUC_001_CZSK_Promo',date:'2025-01-05',format:'Ghost',is_ghost:true,reason:'campaign_day_residual',label:'Ghost creative — pending Meta reconciliation',spend:-25,revenue:50,purchases:1,impressions:0}]};
 const snapshot={payload,fx:{'2025-01-03':{date:'2025-01-03',czk_per_usd:25,source:'test'}}};
 const out=renderPromo(snapshot,'USD','All');
 assert.equal(out.rows[0].spend,-1);assert.equal(out.rows[0].revenue,2);assert.equal(out.rows[0].native.spend,-25);assert.equal(out.rows[0].fx.date,'2025-01-03');
 assert.equal(out.rows[0].campaign_id,'359758259164738:1');assert.equal(out.rows[0].purchases,1);
 assert.equal(renderPromo(snapshot,'CZK','TGLV').rows.length,0);
});
