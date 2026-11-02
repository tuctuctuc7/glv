const {chromium}=require('playwright-core');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const root=path.resolve(__dirname,'../public');
const out=process.env.GLV_PROMO_EVIDENCE || '/tmp/glv-promo-events-qa';
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const server=http.createServer((req,res)=>{
  let file=path.join(root,new URL(req.url,'http://localhost').pathname);
  if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
  if(!file.startsWith(root)||!fs.existsSync(file)){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'})[path.extname(file)]||'application/octet-stream');
  fs.createReadStream(file).pipe(res);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const libs='/home/tom/.cache/hermes-browser-libs/root';
 const browser=await chromium.launch({executablePath:'/home/tom/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',headless:true,args:['--no-sandbox'],env:{...process.env,LD_LIBRARY_PATH:`${libs}/usr/lib/x86_64-linux-gnu:${libs}/usr/lib`,FONTCONFIG_PATH:`${libs}/etc/fonts`,XDG_DATA_DIRS:`${libs}/usr/share`}});
 try {
 for(const width of (process.env.GLV_QA_WIDTH ? [Number(process.env.GLV_QA_WIDTH)] : [1440,430,390,375,320])) for(const theme of ['dark','light']) {
  const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.GLV_QA_URL || `http://127.0.0.1:${server.address().port}/glv/`,{waitUntil:'networkidle'});
  await page.click('#phasesViewTab');
  if(await page.locator('html').getAttribute('data-theme')!==theme) await page.click('#themeToggle');
  await page.selectOption('#phaseHierarchy','phase-month');
  await page.click('label[for="phaseInfluSplit"]');
  await page.selectOption('#phaseMetric','cpv');
  const phaseCpv = await page.evaluate(() => {
    const days=GlvPhases.buildPhaseDays(state.data.rows,state.data.phases,state.data.phase_contract.latest_date);
    const chart=Chart.getChart('phaseChart');
    return chart.data.datasets.every(d=>d.data.every((v,i)=>{
      const rows=days.filter(r=>r.month===GlvPhases.monthlySeries(days,'cpv').months[i] && r.phase===d.label);
      const spend=rows.reduce((s,r)=>s+r.spend,0), visitors=rows.reduce((s,r)=>s+r.unique_visitors,0);
      return v===(visitors>0?spend/visitors:null);
    }));
  });
  assert.equal(phaseCpv,true);
  await page.selectOption('#promoMetric','cpv');
  assert.equal(await page.evaluate(()=>Chart.getChart('promoChart').data.datasets.every(d=>d.data.every((v,i)=>{
    const row=state.data.rows.find(r=>r.region==='czsk' && r.date===d.dates[i]);return v===(row&&row.unique_visitors>0?row.spend/row.unique_visitors:null);
  }))),true);
  await page.selectOption('#promoMetric','revenue');
  await page.selectOption('#phaseMetric','revenue');
  const before=await page.locator('#phaseTableBody').innerText();
  const monthlyBefore=await page.evaluate(()=>{const c=Chart.getChart('phaseChart');return {labels:c.data.labels,datasets:c.data.datasets};});
  await page.locator('#phasesTitle').scrollIntoViewIfNeeded();
  await page.screenshot({path:`${out}/${width}-${theme}-month.png`,fullPage:true});
  await page.click('[data-phase-mode="promo"]');
  assert.equal(await page.locator('[data-phase-mode="promo"]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('#phaseChart').isVisible(),true,'top aggregate chart is visible in By promo');
  assert.equal(await page.locator('#phaseMetric').isEnabled(),true);
  assert.equal(await page.locator('#phaseMonths').isVisible(),true);
  assert.equal(await page.locator('#phaseFilter').isVisible(),true);
  assert.equal(await page.locator('#phaseMonths > button').isDisabled(),true);
  assert.equal(await page.locator('#phaseFilter > button').isDisabled(),true);
  assert.equal(await page.locator('#promoPlanned').count(),0);
  assert.doesNotMatch(await page.locator('body').innerText(),/BFCM/);
  assert.equal(await page.locator('#phaseTable th').first().textContent(),'Promo');
  for(const metric of ['revenue','roas','avg_daily_revenue','cpv']) {
   await page.selectOption('#phaseMetric',metric);
   const top=await page.evaluate(metric=>{
    const chart=Chart.getChart('phaseChart');
    const groups=GlvPhases.buildPromoCohorts(state.data.phases).map(c=>{
     const rows=state.data.rows.filter(r=>r.region==='czsk' && c.events.some(e=>r.date>=e.start_date && r.date<=e.end_date));
     const sum=key=>rows.reduce((s,r)=>s+r[key],0);
     return {label:c.label,days:rows.length,value:metric==='revenue'?sum('revenue'):metric==='roas'?sum('revenue')/sum('spend'):metric==='cpv'?sum('spend')/sum('unique_visitors'):sum('revenue')/new Set(rows.map(r=>r.date)).size};
    }).filter(c=>c.days);
    return {labels:chart.data.labels,series:chart.data.datasets.map(d=>d.label),values:chart.data.datasets[0].data,expected:groups.map(c=>c.value),color:chart.getDatasetMeta(0).dataset.options.borderColor,promoColor:getComputedStyle(document.documentElement).getPropertyValue('--phase-promo').trim(),accessible:[...document.querySelectorAll('#phaseChartDataBody tr')].map(r=>r.cells[0].textContent)};
   },metric);
   assert.deepEqual(top.labels,['January','February','March','April','May','June','July','August','September','Menopause','VB2']);
   assert.deepEqual(top.series,['Promo']);assert.deepEqual(top.values,top.expected);
   assert.deepEqual(top.accessible,top.labels);assert.equal(top.color,top.promoColor);
   assert.equal(await page.evaluate(metric=>[...document.querySelectorAll('#phaseChartDataBody tr')].every((r,i)=>r.cells[1].textContent===phaseMetricCell(metric,Chart.getChart('phaseChart').data.datasets[0].data[i])),metric),true);
   fs.writeFileSync(`${out}/${width}-${theme}-top-${metric}.json`,JSON.stringify(top,null,2));
  }
  await page.selectOption('#phaseMetric','revenue');
  await page.locator('.phase-chart-panel').first().screenshot({path:`${out}/${width}-${theme}-top-cohorts.png`});
  const labels=await page.locator('#phaseTableBody td:first-child').allTextContents();
  assert.ok(labels.includes('VB2') && labels.includes('Menopause') && labels.includes('June') && labels.includes('August'),'table has grouped June/August parents');
  assert.ok(labels.every(t=>!/[()–]|2026/.test(t)));
  const future='promo:2026-11-25/2026-11-30';
  assert.equal(await page.locator(`tr[data-phase-node="${future}"]`).count(),0,'unrepresented November must not appear in the detail table');
  assert.equal(await page.evaluate(id=>GlvPhases.buildPromoEvents(state.data.phases).some(e=>e.id===id),future),true,'future event stays in the source calendar');
  const density=await page.evaluate(()=>{const c=document.querySelector('#phaseTable th').getBoundingClientRect().width;const w=document.querySelector('#phaseTable').parentElement.clientWidth;return {column:c,scrollport:w,metricSpace:w-c,font:getComputedStyle(document.querySelector('.phase-disclosure')).fontSize};});
  assert.ok(density.column<=140,JSON.stringify(density)); // Private/Public labels retain intrinsic width.
  assert.equal(density.font,'11px');
  console.log(JSON.stringify({width,theme,density}));
  const actual=await page.evaluate(()=>{
   const days=GlvPhases.buildPhaseDays(state.data.rows,state.data.phases,state.data.phase_contract.latest_date);
   const events=GlvPhases.promoEventRows(days,GlvPhases.buildPromoCohorts(state.data.phases));
   const chart=Chart.getChart(document.getElementById('promoChart'));
   return {events:events.map(e=>({id:e.id,revenue:e.metrics.revenue,spend:e.metrics.spend,days:e.metrics.day_count})),selected:chart.data.datasets.map(d=>d.month),touch:[...document.querySelectorAll('#phaseMode button')].map(b=>b.getBoundingClientRect().height),overflow:document.documentElement.scrollWidth>innerWidth};
  });
  assert.equal(actual.selected.length,2); assert.ok(actual.selected[1].includes('2026-10-28')); assert.ok(actual.touch.every(h=>h>=44)); assert.equal(actual.overflow,false);
  for(const e of actual.events){
   const cells=await page.locator(`tr[data-phase-node="${e.id}"] td`).allTextContents();
   if(e.days===0){assert.deepEqual(cells,[]);continue;}
   const number=s=>Number(s.replace(/[^0-9.-]/g,''));
   assert.equal(number(cells[2]),Math.round(e.revenue));assert.equal(number(cells[1]),Math.round(e.spend));assert.equal(number(cells[17]),e.days);
  }
  const groups=await page.evaluate(()=>GlvPhases.buildPromoCohorts(state.data.phases).filter(e=>e.events.length>1));
  for(const group of groups) {
   const parent=page.locator(`button[data-phase-toggle="${group.id}"]`);
   assert.equal(await parent.getAttribute('aria-expanded'),'false');
   await parent.click();
   assert.equal(await parent.getAttribute('aria-expanded'),'true');
   for(const stage of group.events) {
    const button=page.locator(`button[data-phase-toggle="${stage.id}"]`);
    assert.equal(await button.innerText(),stage.label.replace(`${group.label} `,''));
    assert.match(await button.getAttribute('aria-label'),new RegExp(stage.label));
    assert.equal(await button.getAttribute('aria-expanded'),'false');
    if(width<=430) assert.ok((await button.boundingBox()).height>=44);
    await button.click();
    assert.equal(await button.getAttribute('aria-expanded'),'true');
    const dates=await page.locator(`tr[data-phase-node^="${stage.id}|"]`).count();
    const cells=await page.locator(`tr[data-phase-node="${stage.id}"] td`).allTextContents();
    assert.equal(Number(cells[17]),dates);
    assert.ok(dates>0);
    // Parent collapse must not discard independently saved stage expansion.
    await parent.click();assert.equal(await button.count(),0);
    await parent.click();assert.equal(await button.getAttribute('aria-expanded'),'true');
    assert.equal(await page.locator(`tr[data-phase-node^="${stage.id}|"]`).count(),dates);
    await button.click();
   }
   assert.equal(await page.evaluate(group=>{
    const keys=['spend','revenue','avg_daily_revenue',null,'roas','cac','nc_roas','new_customer_rate','new_customer_revenue','returning_customer_revenue','cvr','purchases','cpa','aov','unique_visitors','cpv','day_count'];
    const days=GlvPhases.buildPhaseDays(state.data.rows,state.data.phases,state.data.phase_contract.latest_date);
    const rows=GlvPhases.promoEventRows(days,[group,...group.events]);
    const parent=rows[0],children=rows.slice(1);
    return parent.metrics.day_count===children.reduce((s,e)=>s+e.metrics.day_count,0) && rows.every(e=>{
     const cells=document.querySelector(`tr[data-phase-node="${e.id}"]`).cells;
     return keys.every((key,i)=>cells[i+1].textContent===(key?phaseMetricCell(key,e.metrics[key]):'—'));
    });
   },group),true,'parent/stage metrics and denominators reconcile');
   await page.locator('#phaseTable').screenshot({path:`${out}/${width}-${theme}-${group.label}-stages.png`});
   await parent.click();
  }
  const vb='promo:2026-10-28/2026-11-04';
  const disclosure=page.locator(`button[data-phase-toggle="${vb}"]`);
  await disclosure.click();
  assert.equal(await disclosure.getAttribute('aria-expanded'),'true');
  assert.ok(await page.locator(`tr[data-phase-node="${vb}|2026-10-28"]`).count());
  assert.equal(await page.locator(`tr[data-phase-node="${vb}|2026-11-01"]`).count(),1,'VB2 retains its represented November 1 day');
  await disclosure.click();
  assert.equal(await page.locator(`tr[data-phase-node="${vb}|2026-10-28"]`).count(),0);
  await page.click('#phaseEvents > button');
  const values=await page.locator('#phaseEvents input').evaluateAll(inputs=>inputs.map(i=>i.dataset.value));
  for(const group of groups) {assert.ok(values.includes(group.id));for(const stage of group.events) assert.ok(!values.includes(stage.id));}
  for(const value of values){
   const input=page.locator(`#phaseEvents input[data-value="${value}"]`);
   await input.scrollIntoViewIfNeeded();
   assert.ok(await input.evaluate(i=>{const r=i.getBoundingClientRect(),m=i.closest('.phase-menu-options').getBoundingClientRect();return m.left>=0 && m.right<=innerWidth && document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===i;}),`checkbox hit target ${value}`);
   await input.uncheck(); await input.check();
  }
  await page.uncheck('#phaseEvents input[data-value="*"]');
  assert.equal(await page.locator('#phaseEvents > button').innerText(),'Promos: None');
  assert.equal(await page.locator('#phaseTableBody tr[data-phase-node]').count(),0);
  await page.check(`#phaseEvents input[data-value="${vb}"]`);
  assert.equal(await page.locator('#phaseEvents > button').innerText(),'Promos: 1 selected');
  assert.equal(await page.locator('#phaseTableBody tr[data-phase-node]').count(),1);
  await page.uncheck(`#phaseEvents input[data-value="${vb}"]`);
  await page.check(`#phaseEvents input[data-value="${groups[0].id}"]`);
  assert.equal(await page.locator('#phaseTableBody .phase-kind-event').count(),1);
  assert.equal(await page.locator('#phaseTableBody td').first().innerText(),'June');
  await page.check('#phaseEvents input[data-value="*"]');
  assert.equal(await page.locator('#phaseEvents > button').innerText(),'Promos: All');
  await page.uncheck(`#phaseEvents input[data-value="${vb}"]`);
  assert.equal(await page.locator(`tr[data-phase-node="${vb}"]`).count(),0);
  await page.check(`#phaseEvents input[data-value="${vb}"]`);
  await page.press(`#phaseEvents input[data-value="${vb}"]`,'Escape');
  // Exercise arbitrary 2/3 selections, resolved Chart.js elements, focus and rerenders.
  const old=values.find(v=>v.startsWith('promo:2026-01'));
  const meno='promo:2026-10-07/2026-10-14';
  async function inspectColors(ids, focused=null) {
   const resolved=await page.evaluate(()=>{
    const c=Chart.getChart(document.getElementById('promoChart'));
    return {ids:c.data.datasets.map(d=>d.month),legend:c.legend.legendItems.map(l=>l.strokeStyle),datasets:c.data.datasets.map((d,i)=>({id:d.month,line:c.getDatasetMeta(i).dataset.options.borderColor,point:c.getDatasetMeta(i).data.find((p,j)=>d.data[j]!=null)?.options.backgroundColor,hidden:!c.isDatasetVisible(i),values:d.data,dates:d.dates}))};
   });
   assert.deepEqual(resolved.ids,ids);
   const expected=await page.evaluate(({ids,theme})=>GlvPromoComparison.eventColors(ids,theme),{ids,theme:await page.locator('html').getAttribute('data-theme')});
   assert.equal(new Set(Object.values(expected)).size,ids.length);
   for(const [i,d] of resolved.datasets.entries()) {
    assert.equal(d.line,expected[d.id]+(focused&&focused!==d.id?'33':''));
    assert.equal(d.point,expected[d.id]+(focused&&focused!==d.id?'80':''));
    assert.equal(resolved.legend[i],d.line); assert.equal(d.hidden,false);
   }
   return resolved.datasets.map(d=>({id:d.id,values:d.values,dates:d.dates}));
  }
  await inspectColors([meno,vb]);
  for(const ids of [[old,vb],[old,meno,vb]]) {
   await page.click('#promoMonths > button');
   await page.check('#promoMonthOptions input[data-value="none"]');
   for(const id of ids) await page.check(`#promoMonthOptions input[data-value="${id}"]`);
   await page.press('#promoMonthOptions input[data-value="none"]','Escape');
   const original=await inspectColors(ids);
   // Real canvas legend activation, again resets without hiding any series.
   const box=await page.evaluate(()=>{const c=Chart.getChart(document.getElementById('promoChart'));return c.legend.legendHitBoxes[1];});
   await page.locator('#promoChart').click({position:{x:box.left+box.width/2,y:box.top+box.height/2}});
   await page.waitForFunction(id=>document.getElementById('promoFocus').value===id,ids[1]);
   assert.deepEqual(await inspectColors(ids,ids[1]),original);
   await page.selectOption('#promoMetric','roas'); await inspectColors(ids,ids[1]);
   await page.selectOption('#promoMetric','revenue');
   await page.click('#themeToggle'); await inspectColors(ids,ids[1]);
   await page.click('#themeToggle'); assert.deepEqual(await inspectColors(ids,ids[1]),original);
   await page.locator('#promoChart').click({position:{x:box.left+box.width/2,y:box.top+box.height/2}});
   await page.waitForFunction(()=>document.getElementById('promoFocus').value==='');
   assert.deepEqual(await inspectColors(ids),original);
   await page.locator('#promoChart').screenshot({path:`${out}/${width}-${theme}-${ids.length}-colors.png`});
  }
  await page.selectOption('#promoMetric','roas');
  await page.selectOption('#promoMetric','revenue');
  await page.click('#promoMonths > button');
  await page.check('#promoMonthOptions input[data-value="*"]');
  await page.press('#promoMonthOptions input[data-value="*"]','Escape');
  await page.selectOption('#promoMetric','cpv');
  const cohortEvidence=await page.evaluate(()=>{
    const chart=Chart.getChart('promoChart');
    const cohorts=GlvPhases.buildPromoEvents(state.data.phases);
    return chart.data.datasets.map(d=>{
      const cohort=cohorts.find(c=>c.id===d.month);
      const rows=state.data.rows.filter(r=>r.region==='czsk' && r.date>=cohort.start_date && r.date<=cohort.end_date);
      return {label:cohort.label,days:rows.length,spend:rows.reduce((s,r)=>s+r.spend,0),visitors:rows.reduce((s,r)=>s+r.unique_visitors,0),
        matches:d.data.every((v,i)=>{const row=rows.find(r=>r.date===d.dates[i]);return v===(row&&row.unique_visitors>0?row.spend/row.unique_visitors:null);})};
    });
  });
  assert.deepEqual(cohortEvidence.filter(c=>c.label.startsWith('June')).map(c=>c.label),['June Private','June Public']);
  assert.deepEqual(cohortEvidence.filter(c=>c.label.startsWith('August')).map(c=>c.label),['August Private','August Public']);
  assert.equal(cohortEvidence.filter(c=>['Menopause','VB2'].includes(c.label)).length,2);
  assert.ok(cohortEvidence.every(c=>c.matches));
  fs.writeFileSync(`${out}/${width}-${theme}-cpv-cohorts.json`,JSON.stringify(cohortEvidence,null,2));
  await page.locator('#promoChart').screenshot({path:`${out}/${width}-${theme}-cpv.png`});
  await page.selectOption('#promoMetric','revenue');
  const focus=await page.locator('#promoFocus option').nth(1).getAttribute('value');
  await page.locator('#promoFocus').focus();await page.selectOption('#promoFocus',focus);
  const chartCheck=await page.evaluate(()=>{
   const c=Chart.getChart(document.getElementById('promoChart'));
   return {height:c.height,wrap:getComputedStyle(c.canvas.parentElement).height, last:c.legend.legendHitBoxes.at(-1), count:c.data.datasets.length,boxes:c.legend.legendHitBoxes.map(b=>b.top+b.height<=c.height && b.left>=0 && b.left+b.width<=c.width),dimmed:c.getDatasetMeta(1).data[0].options.backgroundColor};
  });
  assert.ok(chartCheck.count>=3);assert.ok(chartCheck.boxes.every(Boolean),JSON.stringify(chartCheck));assert.match(chartCheck.dimmed,/80$/);
  await page.locator('#promoTitle').click();
  await page.locator('#phasesTitle').scrollIntoViewIfNeeded();
  await page.screenshot({path:`${out}/${width}-${theme}-promo.png`,fullPage:true});
  await page.click('[data-phase-mode="month"]');
  assert.equal(await page.locator('#phaseHierarchy').inputValue(),'phase-month');assert.equal(await page.locator('#phaseInfluSplit').isChecked(),true);
  assert.equal(await page.locator('#phaseTableBody').innerText(),before);
  assert.deepEqual(await page.evaluate(()=>{const c=Chart.getChart('phaseChart');return {labels:c.data.labels,datasets:c.data.datasets};}),monthlyBefore);
  await page.click('[data-phase-mode="promo"]');
  assert.equal(await page.locator('#promoFocus').inputValue(),focus);
  await page.evaluate(id=>{state.phaseEvents=[id];renderPhases();},groups[0].events[0].id);
  assert.deepEqual(await page.evaluate(()=>state.phaseEvents),[groups[0].id],'old stage selection reconciles to parent');
  assert.equal(await page.locator('#phaseTableBody .phase-kind-event').count(),1);
  await page.evaluate(()=>{state.phaseEvents=null;renderPhases();});
  // Synthetic browser-only sparse cross-month fixture; never writes source data.
  const sparse=await page.evaluate(()=>{
   const raw=state.data.rows.find(r=>r.region==='czsk' && r.date==='2026-10-28');
   const rows=[{...raw,date:'2026-10-28',revenue:100},{...raw,date:'2026-11-01',revenue:300}];
   const days=GlvPhases.buildPhaseDays(rows,state.data.phases,'2026-11-01');
   window.renderPromoComparison(days,GlvPhases.buildPromoEvents(state.data.phases));
   const c=Chart.getChart(document.getElementById('promoChart'));
   return {labels:c.data.labels,values:c.data.datasets.find(d=>d.month==='promo:2026-10-28/2026-11-04').data};
  });
  assert.deepEqual(sparse.labels,['Day 1','Day 2','Day 3','Day 4','Day 5']);
  assert.deepEqual(sparse.values,[100,null,null,null,300]);
  // Representation, not revenue truthiness, determines detail-table visibility.
  for(const revenue of [0,null]) {
   await page.evaluate(revenue=>{
    const raw=state.data.rows.find(r=>r.region==='czsk' && r.date==='2026-11-01');
    const days=GlvPhases.buildPhaseDays([{...raw,revenue}],state.data.phases,'2026-11-01');
    renderPhaseTable(days);
   },revenue);
   const cells=await page.locator(`tr[data-phase-node="${vb}"] td`).allTextContents();
   assert.equal(cells[0],'VB2');
   assert.equal(cells[2],revenue===0?'$0':'—');
   assert.equal(cells[17],'1');
   assert.equal(await page.locator('#phaseTableBody .phase-kind-event').count(),1);
   assert.equal(await page.locator(`tr[data-phase-node="${future}"]`).count(),0);
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({width,theme,events:actual.events.length,chart:chartCheck.count,errors}));
  await page.close();
 }
 } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
