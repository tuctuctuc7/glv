const test=require('node:test'), assert=require('node:assert/strict');
const C=require('../public/glv-meta-ads/promo-concepts.js');
test('strict identities, null denominators, stable descending/ascending sort and delivery default',()=>{
 assert.equal(C.identity('CC1').label,'CC1');assert.equal(C.identity('CC10').label,'CC10');assert.equal(C.identity('PAC _ 433').label,'PAC433');assert.ok(C.identity('CC1x').warning);assert.ok(C.identity('CC1 PAC2').warning);
 const rows=[fact({campaign_id:'z',date:'2026-03-02'}),fact({campaign_id:'a',date:'2026-03-03'}),fact({campaign_id:'z',date:'2026-03-04',spend:0,impressions:0})];
 assert.deepEqual(C.selection(rows,null),['a']);assert.deepEqual(C.selection(rows,[]),[]);assert.deepEqual(C.selection(rows,['missing']),['missing']);
 const data=[{spend:2},{spend:null},{spend:1},{spend:2}];assert.deepEqual(C.sort(data,'spend','desc'),[data[0],data[3],data[2],data[1]]);assert.deepEqual(C.sort(data,'spend','asc'),[data[2],data[0],data[3],data[1]]);
 const r=C.aggregate([fact({spend:0,purchases:1,impressions:0,landing_page_views:0,checkouts:0})],['c1'])[0];for(const k of ['roas','ctr','costLP','lpCheckout','checkoutPurchase','cvr'])assert.equal(r[k],null);
});
test('funnel schema fails closed for missing, malformed and future inputs while legacy format remains usable',()=>{
 const F=require('../public/glv-meta-ads/promo-format.js');
 const payload={schema_version:1,classification_version:2,reconciled:true,range:{since:'2026-03-01',until:'2026-03-02'},generated_at:new Date().toISOString(),rows:[{...fact(),adset_name:'Banner',format:'Banner',reason:'current_adset_label'}]};
 assert.equal(F.validPayload(payload),true);assert.equal(F.validConceptPayload(payload),false);
 payload.funnel_version=1;assert.equal(F.validConceptPayload(payload),true);
 for(const v of [undefined,null,'0',-1,NaN])assert.equal(F.validConceptPayload({...payload,rows:[{...payload.rows[0],checkouts:v}]}),false);
 assert.equal(F.validPayload({...payload,funnel_version:2}),false);
 assert.equal(require('../api/glv-meta-ads/fb-data.js')._test.cachedPayloadUsable('promo_concepts',{rows:[]}),false);
});
test('all ten columns sort both directions with unavailable values last',()=>{
 for(const key of ['spend','purchases','roas','revenue','ctr','landing_page_views','costLP','lpCheckout','checkoutPurchase','cvr']){
  const rows=[{[key]:null},{[key]:1},{[key]:3},{[key]:0}];
  assert.deepEqual(C.sort(rows,key,'desc').map(r=>r[key]),[3,1,0,null]);
  assert.deepEqual(C.sort(rows,key,'asc').map(r=>r[key]),[0,1,3,null]);
 }
});
test('canonical case, boundaries, full-name fallback and all-selected share denominators',()=>{
 for(const name of ['cc1','V_CC_1','pac 433'])assert.equal(C.identity(name).warning,'');
 for(const name of ['XCC1','CC1x','PAC4330x','CC1 PAC2','unknown'])assert.ok(C.identity(name).warning);
 assert.notEqual(C.identity('CC1').key,C.identity('CC10').key);
 assert.equal(C.identity('CC1 cc_1').label,'CC1');
 const rows=C.aggregate([fact(),fact({ad_name:'unknown',spend:0,purchases:1}),fact({campaign_id:'c2',spend:300}),fact({campaign_name:'tuc_1_CZSK_Promo',spend:999})],['c1','c2']);
 assert.equal(rows.length,3);assert.equal(rows[0].spendShare,25);assert.equal(rows[0].purchaseShare,40);
 assert.equal(rows.reduce((s,r)=>s+r.spendShare,0),100);assert.equal(rows.reduce((s,r)=>s+r.purchaseShare,0),100);
 assert.equal(C.selection([fact({spend:0,impressions:0})],null),null);
});
test('concept campaigns reuse the dashboard filter component and shared handlers',()=>{
 const fs=require('node:fs'),html=fs.readFileSync('public/glv-meta-ads/index.html','utf8'),ui=fs.readFileSync('public/glv-meta-ads/promo-concepts-ui.js','utf8');
 assert.doesNotMatch(html,/<details id="promo-concept-campaigns"/);
 assert.match(ui,/tabFilterMarkup\('promo-concept','Campaign name'\)/);
 assert.match(html,/key==='promo-concept'/);
});
test('concept rows have no secondary label and the table has no capped vertical viewport',()=>{
 const fs=require('node:fs'),css=fs.readFileSync('public/glv-meta-ads/promo-concepts.css','utf8'),ui=fs.readFileSync('public/glv-meta-ads/promo-concepts-ui.js','utf8');
 assert.doesNotMatch(css,/max-height:(520px|62vh)/);
 assert.doesNotMatch(ui,/<small>\$\{escapeHtml\(row.campaign_name\)/);
});
// Synthetic test facts only, never observed client performance.
const fact=(extra={})=>({campaign_id:'c1',campaign_name:'TUC_1_CZSK_Promo',ad_name:'B_CC01',ad_id:'a',adset_id:'s1',date:'2026-03-01',spend:100,purchases:2,revenue:300,impressions:1000,link_clicks:50,landing_page_views:40,checkouts:10,...extra});
test('concept aggregates across ad sets, preserves campaign identity and all ratios',()=>{
 const rows=C.aggregate([fact(),fact({ad_id:'b',adset_id:'s2',ad_name:'V_cc_01',spend:300}),fact({campaign_id:'c2'})],['c1','c2']);
 assert.equal(rows.length,2);const r=rows[0];
 assert.equal(r.spend,400);assert.equal(r.purchases,4);assert.equal(r.roas,1.5);assert.equal(r.revenue,600);assert.equal(r.ctr,5);assert.equal(r.landing_page_views,80);assert.equal(r.costLP,5);assert.equal(r.lpCheckout,25);assert.equal(r.checkoutPurchase,20);assert.equal(r.cvr,5);assert.equal(r.spendShare,80);assert.equal(r.purchaseShare,4/6*100);
});
