const test=require('node:test');const assert=require('node:assert/strict');
const p=require('../public/glv/phases.js');const c=require('../public/glv/promo-comparison.js');
const snapshot=require('../public/glv/glv_dashboard.json');
const events=p.buildPromoEvents(snapshot.phases), cohorts=p.buildPromoCohorts(snapshot.phases);
test('lower daily comparison combines canonical June/August and remaps stage selections',()=>{
 const days=p.buildPhaseDays(snapshot.rows,snapshot.phases,snapshot.phase_contract.latest_date);
 const all=c.buildEvents(days,events,null);
 for(const label of ['June','August']) {
  const parent=cohorts.find(e=>e.label===label), members=events.filter(e=>parent.events.some(m=>m.id===e.id));
  const result=c.buildEvents(days,events,members.map(e=>e.id));
  assert.deepEqual(result.selected,[parent.id]);assert.equal(result.series.length,1);
  assert.ok(all.available.includes(parent.id));assert.ok(members.every(e=>!all.available.includes(e.id)));
  const series=result.series[0];
  for(const row of days.filter(d=>d.region==='czsk'&&members.some(e=>d.date>=e.start_date&&d.date<=e.end_date))) {
   const ordinal=(Date.parse(row.date)-Date.parse(parent.start_date))/86400000;
   assert.equal(series.dates[ordinal],row.date);assert.equal(series.values[ordinal],row.revenue);
  }
 }
 assert.deepEqual(c.buildEvents(days,events).selected,all.available.slice(-2));
 for(const e of events.filter(e=>!/^2026-(06|08)-/.test(e.start_date))) {
  assert.deepEqual(c.buildEvents(days,events,[e.id]).series,c.buildEvents(days,[e],[e.id]).series);
 }
});
test('sparse merged member ranges exclude nonmember rows and future years stay separate',()=>{
 const stage=(year,start,end,label)=>({id:`promo:${year}-06-${start}/${year}-06-${end}`,start_date:`${year}-06-${start}`,end_date:`${year}-06-${end}`,label,sources:[]});
 const stages=[stage('2026','01','02','June Private'),stage('2026','05','06','June Public')];
 const rows=['01','03','05'].map((day,i)=>({date:`2026-06-${day}`,region:'czsk',phase:'Promo',revenue:100+i}));
 const data=c.buildEvents(rows,stages,null);
 assert.deepEqual(data.labels,['Day 1','Day 2','Day 3','Day 4','Day 5']);
 assert.deepEqual(data.series[0].values,[100,null,null,null,102]);
 assert.deepEqual(data.series[0].dates,['2026-06-01',null,null,null,'2026-06-05']);
 assert.equal(p.groupPromoEvents([stage('2027','01','02','June 1'),stage('2027','05','06','June 2')]).length,2);
 assert.deepEqual(p.groupPromoEvents(cohorts),cohorts);
});
test('merged stages use daily ratios, missing values and true ordinals without gap or future fabrication',()=>{
 for(const label of ['June','August']) {
  const parent=cohorts.find(e=>e.label===label), [first,last]=parent.events;
  const row=(date,revenue,spend,unique_visitors)=>({date,region:'czsk',phase:'Promo',revenue,spend,unique_visitors});
  const rows=[row(first.start_date,100,10,2),row(last.start_date,300,90,18),row(last.end_date,null,'',null)];
  const gap=new Date(Date.parse(first.end_date)+86400000).toISOString().slice(0,10);
  if(gap<last.start_date) rows.push(row(gap,99999,1,1));
  const index=(date)=>(Date.parse(date)-Date.parse(first.start_date))/86400000;
  for(const [metric,expected] of [['revenue',[100,300]],['roas',[10,300/90]],['cpv',[5,5]]]) {
   const result=c.buildEvents(rows,events,[first.id,last.id],metric), series=result.series[0];
   assert.equal(result.series.length,1);assert.equal(series.values.length,index(last.end_date)+1);
   assert.equal(series.values[0],expected[0]);assert.equal(series.values[index(last.start_date)],expected[1]);
   assert.equal(series.values[index(last.end_date)],null);assert.equal(series.values[1],null);
   if(gap<last.start_date) {assert.equal(series.values[index(gap)],null);assert.equal(series.dates[index(gap)],null);}
  }
  assert.throws(()=>c.buildEvents([...rows,rows[0]],events,null),/Duplicate CZSK day/);
 }
});
