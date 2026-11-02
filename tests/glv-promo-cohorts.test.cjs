const test=require('node:test');const assert=require('node:assert/strict');
const p=require('../public/glv/phases.js');const c=require('../public/glv/promo-comparison.js');const snapshot=require('../public/glv/glv_dashboard.json');
test('comparison combines June/August only; detail stages and October events stay separate',()=>{
 const events=p.buildPromoEvents(snapshot.phases), cohorts=p.buildPromoCohorts(snapshot.phases);
 for(const month of ['June','August']) {assert.equal(events.filter(e=>e.label.startsWith(month)).length,2);assert.equal(cohorts.filter(e=>e.label===month).length,1);}
 assert.equal(cohorts.filter(e=>['VB2','Menopause'].includes(e.label)).length,2);
 const days=p.buildPhaseDays(snapshot.rows,snapshot.phases,snapshot.phase_contract.latest_date);
 for(const cohort of cohorts){const grouped=p.promoEventRows(days,[cohort])[0];const ids=new Set(cohort.events.map(e=>e.id));const children=p.promoEventRows(days,events.filter(e=>ids.has(e.id)));assert.equal(grouped.metrics.revenue,children.reduce((s,e)=>s+(e.metrics.revenue||0),0)||null);}
});
test('cross-month VB2 and combined-stage calendar gaps are daily, not cumulative',()=>{
 const cohorts=p.buildPromoCohorts(snapshot.phases);const vb=cohorts.find(e=>e.label==='VB2');
 const days=['2026-10-28','2026-11-01','2026-11-04'].map((date,i)=>({date,region:'czsk',phase:'Promo',spend:10+i,unique_visitors:2,revenue:100+i}));
 const series=c.buildEvents(days,[vb],null,'cpv').series[0];assert.equal(series.values.length,8);assert.equal(series.values[4],5.5);assert.equal(series.values[7],6);assert.equal(series.values[1],null);
});
