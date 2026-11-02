const test=require('node:test');const assert=require('node:assert/strict');
const p=require('../public/glv/phases.js');const c=require('../public/glv/promo-comparison.js');const snapshot=require('../public/glv/glv_dashboard.json');
test('top aggregate cohorts combine June/August only; detail stages and October events stay separate',()=>{
 const events=p.buildPromoEvents(snapshot.phases), cohorts=p.buildPromoCohorts(snapshot.phases);
 for(const month of ['June','August']) {assert.equal(events.filter(e=>e.label.startsWith(month)).length,2);assert.equal(cohorts.filter(e=>e.label===month).length,1);}
 assert.equal(cohorts.filter(e=>['VB2','Menopause'].includes(e.label)).length,2);
 const days=p.buildPhaseDays(snapshot.rows,snapshot.phases,snapshot.phase_contract.latest_date);
 for(const cohort of cohorts){const grouped=p.promoEventRows(days,[cohort])[0];const ids=new Set(cohort.events.map(e=>e.id));const children=p.promoEventRows(days,events.filter(e=>ids.has(e.id)));assert.equal(grouped.metrics.revenue,children.reduce((s,e)=>s+(e.metrics.revenue||0),0)||null);}
});
test('top cohort aggregates use member dates, ratios of sums and distinct represented days',()=>{
 const row=(date,revenue,spend,visitors)=>({date,region:'czsk',phase:'Promo',revenue,spend,unique_visitors:visitors});
 const june=p.buildPromoCohorts(snapshot.phases).find(c=>c.label==='June');
 const rows=[row(june.events[0].start_date,100,10,2),row(june.events[1].start_date,300,90,18)];
 const gap=new Date(`${june.events[0].end_date}T00:00:00Z`);gap.setUTCDate(gap.getUTCDate()+1);
 if(gap.toISOString().slice(0,10)<june.events[1].start_date) rows.push(row(gap.toISOString().slice(0,10),99999,1,1));
 const aggregate=p.promoEventRows(rows,[june])[0].metrics;
 assert.equal(aggregate.revenue,400);assert.equal(aggregate.roas,4);assert.equal(aggregate.cpv,5);
 assert.equal(aggregate.day_count,2);assert.equal(aggregate.avg_daily_revenue,200);
 const vb=p.buildPromoCohorts(snapshot.phases).find(c=>c.label==='VB2');
 const cross=p.promoEventRows([row('2026-10-28',100,10,2),row('2026-11-01',0,30,8)],[vb])[0];
 assert.deepEqual(cross.rows.map(r=>r.date),['2026-10-28','2026-11-01']);
 assert.equal(cross.metrics.revenue,100);assert.equal(cross.metrics.roas,2.5);
 assert.equal(cross.metrics.day_count,2);assert.equal(cross.metrics.avg_daily_revenue,50);
});
test('cross-month VB2 individual daily comparison preserves calendar gaps',()=>{
 const events=p.buildPromoEvents(snapshot.phases);const vb=events.find(e=>e.label==='VB2');
 const days=['2026-10-28','2026-11-01','2026-11-04'].map((date,i)=>({date,region:'czsk',phase:'Promo',spend:10+i,unique_visitors:2,revenue:100+i}));
 const series=c.buildEvents(days,[vb],null,'cpv').series[0];assert.equal(series.values.length,8);assert.equal(series.values[4],5.5);assert.equal(series.values[7],6);assert.equal(series.values[1],null);
});
