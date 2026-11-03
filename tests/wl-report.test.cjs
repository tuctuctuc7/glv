const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const modulePath='../public/glv-meta-ads/wl-report.js';
const wl=require(modulePath);
const row=(overrides={})=>({id:'a',campaign_id:'c',campaign_name:'GLV_1_CZ_WL_ActionKate',name:'PAC 462 V2',amount_spent:'20','action_values:omni_purchase':'80','actions:omni_purchase':'2',...overrides});
test('last full month uses Prague rollover, leap years and year boundary',()=>{
 assert.deepEqual(wl.lastMonth(new Date('2026-10-31T23:30:00Z')),{since:'2026-10-01',until:'2026-10-31'});
 assert.deepEqual(wl.lastMonth(new Date('2026-01-15T00:00:00Z')),{since:'2025-12-01',until:'2025-12-31'});
 assert.deepEqual(wl.lastMonth(new Date('2024-03-01T00:00:00Z')),{since:'2024-02-01',until:'2024-02-29'});
});
test('exact PAC and creator tokens, variants and market-separated grouping',()=>{
 for(const name of ['PAC4620 V1','XPAC462 V1','PAC462x','PAC0462 V1'])assert.equal(wl.report(wl.normalize([row({name})])).total.excluded,0,name);
 assert.deepEqual(wl.asset('2026-10-10_V_PAC-462_v3_1080x1920'),{pac:'462',label:'PAC 462 V3'});
 const r=wl.report(wl.normalize([row(),row({id:'b',campaign_name:'GLV_2_US_WL_ActionKate'}),row({id:'z',amount_spent:'0'})]));
 assert.equal(r.creatives.ActionKate.length,2);assert.equal(r.total.revenue,240);assert.equal(r.total.purchases,6);
 assert.equal(wl.normalize([row({campaign_name:'X_WL_ActionKate2'})])[0].creator,null);
});
test('conflicting explicit markets stay unresolved and retain totals with a warning',()=>{
 for(const campaign_name of ['GLV_CZ_US_WL_ActionKate','GLV_US_CZSK_WL_ActionKate','WL_befit_over40_CZ_US']){
  const report=wl.report(wl.normalize([row({campaign_name})]));
  assert.equal(report.rows[0].market,null,campaign_name);
  assert.equal(report.total.actual,20);assert.equal(report.total.revenue,80);
  assert.deepEqual(report.issues,[campaign_name]);
 }
 for(const [campaign_name,market] of [['WL_befit_over40','CZSK'],['WL_befit_over40_US','US'],['GLV_CZ_CZSK_WL_ActionKate','CZSK']])assert.equal(wl.normalize([row({campaign_name})])[0].market,market);
});
test('every filter intersects all tables; explicit None never means All',()=>{
 const rows=wl.normalize([row(),row({id:'b',campaign_id:'u',campaign_name:'GLV_2_US_WL_ActionKate'}),row({campaign_id:'k',campaign_name:'WL_Kristyna_CZ'})]);
 for(const key of ['campaign','market','creator']){
  const r=wl.report(rows,{[key]:[]});assert.equal(r.rows.length,0);assert.equal(r.markets.length,0);assert.equal(r.overview.length,0);assert.equal(r.total.actual,0);assert.equal(r.creatives.ActionKate.length,0);
 }
 const r=wl.report(rows,{campaign:['u'],market:['US'],creator:['ActionKate']});assert.equal(r.total.actual,20);assert.equal(r.markets.length,1);assert.equal(r.creatives.ActionKate[0].market,'US');
});
test('missing inputs and zero denominators remain unavailable; unknown creators retained without invention',()=>{
 const r=wl.report(wl.normalize([row({campaign_name:'X_CZ_WL_Kristyna_ActionKate',amount_spent:null}),row({campaign_name:'X_CZ_WL_Unknown',amount_spent:'0'})]));
 assert.equal(r.total.actual,null);assert.equal(r.total.standard,null);assert.equal(r.total.revenue,160);assert.equal(r.issues.length,2);assert.equal(r.overview.length,0);assert.equal(r.creatives.null.length,2);
 assert.equal(wl.report(wl.normalize([row({amount_spent:'0'})])).total.adjusted,null);
});
test('unresolved creators retain separate source campaigns rather than inventing a merged creator',()=>{
 const report=wl.report(wl.normalize([row({campaign_id:'a',campaign_name:'X_CZ_WL_Unknown'}),row({campaign_id:'b',campaign_name:'X_CZ_WL_Kristyna_ActionKate'})]));
 assert.equal(report.markets.length,2);assert.equal(report.creatives.null.length,2);assert.equal(report.unresolvedOverview.length,2);
 assert.equal(report.total.actual,40);
});
test('no ad truncation and aggregate ratios not means',()=>{
 const r=wl.report(wl.normalize(Array.from({length:1200},(_,i)=>row({id:String(i),name:'asset '+i,amount_spent:String(i+1)}))));
 assert.equal(r.creatives.ActionKate.length,1200);assert.equal(r.total.standard,r.total.revenue/r.total.actual);
});
test('ActionKate PAC 462 only removes spend from reported denominator, never outcomes',()=>{
 assert.ok(fs.existsSync(require('node:path').join(__dirname,modulePath)),'WL report module exists');
 const wl=require(modulePath);
 const rows=wl.normalize([
  {id:'1',campaign_id:'c',campaign_name:'GLV_1_CZ_WL_ActionKate',name:'V_PAC462_v2',amount_spent:'20','action_values:omni_purchase':'80','actions:omni_purchase':'2'},
  {id:'2',campaign_id:'c',campaign_name:'GLV_1_CZ_WL_ActionKate',name:'PAC460 V1',amount_spent:'30','action_values:omni_purchase':'20','actions:omni_purchase':'1'}]);
 const report=wl.report(rows);
 assert.equal(report.total.actual,50);assert.equal(report.total.excluded,20);assert.equal(report.total.reported,30);
 assert.equal(report.total.revenue,100);assert.equal(report.total.purchases,3);
 assert.equal(report.total.standard,2);assert.equal(report.total.adjusted,100/30);
 assert.equal(report.creatives.ActionKate[1].actual,20);
});
