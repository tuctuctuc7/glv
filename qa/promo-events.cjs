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
 for(const width of [1440,390,320]) for(const theme of ['dark','light']) {
  const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.GLV_QA_URL || `http://127.0.0.1:${server.address().port}/glv/`,{waitUntil:'networkidle'});
  await page.click('#phasesViewTab');
  if(await page.locator('html').getAttribute('data-theme')!==theme) await page.click('#themeToggle');
  await page.selectOption('#phaseHierarchy','phase-month');
  await page.click('label[for="phaseInfluSplit"]');
  const before=await page.locator('#phaseTableBody').innerText();
  await page.locator('#phasesTitle').scrollIntoViewIfNeeded();
  await page.screenshot({path:`${out}/${width}-${theme}-month.png`,fullPage:true});
  await page.click('[data-phase-mode="promo"]');
  assert.equal(await page.locator('[data-phase-mode="promo"]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('#phaseMonths').isVisible(),false);
  assert.equal(await page.locator('#phaseFilter').isVisible(),false);
  assert.equal(await page.locator('#promoPlanned').isVisible(),true);
  assert.match(await page.locator('#phaseTableBody').innerText(),/VB2 \(Oct 28 – Nov 4, 2026\)/);
  const actual=await page.evaluate(()=>{
   const days=GlvPhases.buildPhaseDays(state.data.rows,state.data.phases,state.data.phase_contract.latest_date);
   const events=GlvPhases.promoEventRows(days,GlvPhases.buildPromoEvents(state.data.phases));
   const chart=Chart.getChart(document.getElementById('promoChart'));
   return {events:events.map(e=>({id:e.id,revenue:e.metrics.revenue,spend:e.metrics.spend,days:e.metrics.day_count})),selected:chart.data.datasets.map(d=>d.month),touch:[...document.querySelectorAll('#phaseMode button')].map(b=>b.getBoundingClientRect().height),overflow:document.documentElement.scrollWidth>innerWidth};
  });
  assert.equal(actual.selected.length,2); assert.ok(actual.selected[1].includes('2026-10-28')); assert.ok(actual.touch.every(h=>h>=44)); assert.equal(actual.overflow,false);
  for(const e of actual.events){
   const cells=await page.locator(`tr[data-phase-node="${e.id}"] td`).allTextContents();
   const number=s=>Number(s.replace(/[^0-9.-]/g,''));
   assert.equal(number(cells[2]),Math.round(e.revenue));assert.equal(number(cells[1]),Math.round(e.spend));assert.equal(number(cells[16]),e.days);
  }
  const vb='promo:2026-10-28/2026-11-04';
  const disclosure=page.locator(`button[data-phase-toggle="${vb}"]`);
  await disclosure.click();
  assert.equal(await disclosure.getAttribute('aria-expanded'),'true');
  assert.ok(await page.locator(`tr[data-phase-node="${vb}|2026-10-28"]`).count());
  await disclosure.click();
  assert.equal(await page.locator(`tr[data-phase-node="${vb}|2026-10-28"]`).count(),0);
  await page.click('#phaseEvents > button');
  await page.uncheck(`#phaseEvents input[data-value="${vb}"]`);
  assert.equal(await page.locator(`tr[data-phase-node="${vb}"]`).count(),0);
  await page.check(`#phaseEvents input[data-value="${vb}"]`);
  await page.press(`#phaseEvents input[data-value="${vb}"]`,'Escape');
  await page.selectOption('#promoMetric','roas');
  await page.selectOption('#promoMetric','revenue');
  await page.click('#promoMonths > button');
  await page.check('#promoMonthOptions input[data-value="*"]');
  await page.press('#promoMonthOptions input[data-value="*"]','Escape');
  const focus=await page.locator('#promoFocus option').nth(1).getAttribute('value');
  await page.locator('#promoFocus').focus();await page.selectOption('#promoFocus',focus);
  const chartCheck=await page.evaluate(()=>{
   const c=Chart.getChart(document.getElementById('promoChart'));
   return {height:c.height,wrap:getComputedStyle(c.canvas.parentElement).height, last:c.legend.legendHitBoxes.at(-1), count:c.data.datasets.length,boxes:c.legend.legendHitBoxes.map(b=>b.top+b.height<=c.height && b.left>=0 && b.left+b.width<=c.width),dimmed:c.getDatasetMeta(1).data[0].options.backgroundColor};
  });
  assert.ok(chartCheck.count>=3);assert.ok(chartCheck.boxes.every(Boolean));assert.match(chartCheck.dimmed,/80$/);
  await page.locator('#promoTitle').click();
  await page.locator('#phasesTitle').scrollIntoViewIfNeeded();
  await page.screenshot({path:`${out}/${width}-${theme}-promo.png`,fullPage:true});
  await page.click('[data-phase-mode="month"]');
  assert.equal(await page.locator('#phaseHierarchy').inputValue(),'phase-month');assert.equal(await page.locator('#phaseInfluSplit').isChecked(),true);
  assert.equal(await page.locator('#phaseTableBody').innerText(),before);
  await page.click('[data-phase-mode="promo"]');
  assert.equal(await page.locator('#promoFocus').inputValue(),focus);
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
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({width,theme,events:actual.events.length,chart:chartCheck.count,errors}));
  await page.close();
 }
 } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
