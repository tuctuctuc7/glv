const {test}=require('node:test');
const assert=require('node:assert/strict');
const phases=require('../public/glv/phases.js');
const comparison=require('../public/glv/promo-comparison.js');
test('By promo UI has accessible mode and separate selection, planned BFCM is not performance',()=>{
 const fs=require('node:fs'); const html=fs.readFileSync('public/glv/index.html','utf8');
 assert.match(html,/id="phaseMode"/); assert.match(html,/By month/); assert.match(html,/By promo/);
 assert.doesNotMatch(html,/BFCM|promoPlanned/);
 assert.doesNotMatch(fs.readFileSync('public/glv/section-info.js','utf8'),/BFCM/);
 assert.notEqual(comparison.color('promo:2026-10-07/2026-10-14'),comparison.color('promo:2026-10-28/2026-11-04'));
 assert.match(fs.readFileSync('public/glv/app.js','utf8'),/promoEventRows/);
});
test('event names are compact and repeated historical stages stay distinct',()=>{
 const source=require('../public/glv/glv_dashboard.json');
 const events=phases.buildPromoEvents(source.phases);
 assert.deepEqual(events.filter(e=>e.start_date.startsWith('2026-06')).map(e=>e.label),['June Private','June Public']);
 assert.deepEqual(events.filter(e=>e.start_date.startsWith('2026-08')).map(e=>e.label),['August Private','August Public']);
 assert.ok(events.every(e=>!/[()–]|2026/.test(e.label)));
 const app=require('node:fs').readFileSync('public/glv/app.js','utf8');
 assert.match(app,/kind:'event', phase:'Promo', label:e.label/);
});
test('selected event palette separates arbitrary pairs/triples and stays aligned through focus',()=>{
 const ids=['promo:2026-01-06/2026-01-14','promo:2026-10-07/2026-10-14','promo:2026-10-28/2026-11-04'];
 for(const theme of ['light','dark']) {
  const colors=comparison.eventColors(ids,theme);
  assert.equal(new Set(Object.values(colors)).size,3);
  assert.deepEqual(Object.values(comparison.eventColors(ids.slice(1),theme)),Object.values(colors).slice(0,2));
  for(const id of ids) {
   const normal=comparison.focusStyle(id,null,theme,colors[id]);
   const focused=comparison.focusStyle(id,ids[1],theme,colors[id]);
   assert.equal(normal.borderColor,colors[id]);
   assert.equal(focused.borderColor,colors[id]+(id===ids[1]?'':'33'));
   assert.equal(focused.pointBackgroundColor,colors[id]+(id===ids[1]?'':'80'));
  }
  const all=phases.buildPromoEvents(require('../public/glv/glv_dashboard.json').phases).map(e=>e.id);
  assert.equal(new Set(Object.values(comparison.eventColors(all,theme))).size,all.length);
 }
 assert.notDeepEqual(comparison.eventColors(ids,'light'),comparison.eventColors(ids,'dark'));
});
test('event comparison keeps sparse calendar ordinals without future padding',()=>{
 assert.equal(typeof comparison.buildEvents,'function');
 const events=phases.buildPromoEvents(schedule);
 const data=comparison.buildEvents([actual('2026-10-28'),actual('2026-11-01'),actual('2026-11-04')],events,undefined,'revenue');
 assert.equal(data.labels.length,8);
 assert.deepEqual(data.series[0].values,[100,null,null,null,100,null,null,100]);
 assert.equal(comparison.buildEvents([actual('2026-10-28')],events).labels.length,1);
 assert.equal(comparison.buildEvents([],events).selected.length,0);
});
const actual=(date,revenue=100,spend=20)=>({date,region:'czsk',phase:'Promo',month:date.slice(0,7),revenue,spend,new_customer_revenue:60,new_customers:2,returning_customers:3,purchases:5,unique_visitors:50});
const schedule=[{phase:'Promo',label:'promo gummies',start_date:'2026-10-28',end_date:'2026-11-04',source_row:53}];
test('promo event identity ignores source row and display label, deduplicates full cross-month range',()=>{
 assert.equal(typeof phases.buildPromoEvents,'function');
 const events=phases.buildPromoEvents([...schedule,{...schedule[0],source_row:60}]);
 assert.equal(events.length,1); assert.equal(events[0].label,'VB2');
 assert.equal(events[0].sources.length,2);
 assert.equal(events[0].id,phases.buildPromoEvents([{...schedule[0],label:'renamed',source_row:1}])[0].id);
});
test('event aggregation spans months, counts only unique actual dates and rejects ambiguous overlap',()=>{
 assert.equal(typeof phases.promoEventRows,'function');
 const events=phases.buildPromoEvents(schedule);
 const rows=[actual('2026-10-28'),actual('2026-11-01',300,100)];
 const result=phases.promoEventRows(rows,events)[0];
 assert.equal(result.metrics.revenue,400); assert.equal(result.metrics.day_count,2);
 assert.equal(result.metrics.avg_daily_revenue,200); assert.equal(result.metrics.roas,400/120);
 assert.equal(result.metrics.nc_roas,1); assert.equal(result.metrics.returning_customer_revenue,280);
 assert.throws(()=>phases.promoEventRows([...rows,rows[0]],events),/Duplicate/);
 assert.throws(()=>phases.buildPromoEvents([...schedule,{...schedule[0],start_date:'2026-11-01'}]),/overlap/i);
});
