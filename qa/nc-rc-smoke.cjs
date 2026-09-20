const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = require('../public/glv/glv_dashboard.json');
module.exports = async (browser, baseUrl, evidenceDir) => {
 const results=[];
 for (const width of [1440,390,320]) for (const theme of ['dark','light']) {
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
  const page=await context.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  const fixture={...source,date_range:{start:'2026-01-15',end:'2026-01-17'},rows:[
   {...source.rows[0],date:'2026-01-15',region:'czsk',spend:100,revenue:500,new_customer_revenue:200},
   {...source.rows[0],date:'2026-01-16',region:'czsk',spend:300,revenue:600,new_customer_revenue:300},
   {...source.rows[0],date:'2026-01-17',region:'czsk',spend:0,revenue:10,new_customer_revenue:20}
  ]}; fixture.rows.forEach(r=>r.influ_revenue=0);
  await page.route('**/glv_dashboard.json',r=>r.fulfill({json:fixture}));
  await page.goto(`${baseUrl}?period=all`,{waitUntil:'networkidle'});
  await page.evaluate(t=>setTheme(t),theme);
  await page.locator('#grain').selectOption('day'); await page.locator('#auditGrain').selectOption('day');
  const headers=await page.locator('#metricsTable thead th').allTextContents();
  assert.equal(headers[headers.indexOf('CAC')+1],'NC ROAS');
  assert.equal(headers[headers.indexOf('New customer revenue')+1],'RC revenue');
  for (const id of ['trendMetric','trendMetricSecondary']) for (const [key,values] of [['nc_roas',[2,1,null]],['returning_customer_revenue',[300,300,-10]]]) {
   await page.locator('#'+id).selectOption(key);
   const series=await page.evaluate(id=>Chart.getChart('trendChart').data.datasets.find(d=>d.yAxisID===(id==='trendMetric'?'y':'y1')).data,id);
   assert.deepEqual(series,values);
  }
  assert.equal(await page.locator('#metricsTableBody tr').first().locator('td').nth(headers.indexOf('NC ROAS')).textContent(),'1.30');
  assert.equal(await page.locator('#metricsTableBody tr').first().locator('td').nth(headers.indexOf('RC revenue')).textContent(),'$590');
  assert.match(await page.locator('#trendDataBody').textContent(), /-\$10/);
  if(width<=720) await page.locator('#filtersToggle').click();
  const downloadPromise=page.waitForEvent('download'); await page.locator('#exportCsv').click();
  const download=await downloadPromise; const csv=fs.readFileSync(await download.path(),'utf8');
  assert.match(csv,/returning_customer_revenue_usd,nc_roas/); assert.match(csv,/,20,-10,\n/);
  await page.screenshot({path:path.join(evidenceDir,`nc-rc-home-${width}-${theme}.png`)});
  await page.locator('#phasesViewTab').click();
  const ph=await page.locator('#phaseTable thead th').allTextContents();
  assert.equal(ph.at(-1),'Number of days'); assert.equal(ph[ph.indexOf('CAC')+1],'NC ROAS');
  for(const [key,value] of [['nc_roas',1.3],['returning_customer_revenue',590]]) {
   await page.locator('#phaseMetric').selectOption(key);
   assert.deepEqual(await page.evaluate(()=>Chart.getChart('phaseChart').data.datasets.find(d=>d.label==='Influ').data),[value]);
   assert.ok((await page.locator('#phaseChartDataBody').textContent()).length>0);
  }
  await page.locator('label[for="phaseInfluSplit"]').click();
  await page.locator('#phaseChartTitle-info-button').focus();
  assert.equal(await page.locator('#phaseSplitNotice').isVisible(),true);
  assert.match(await page.locator('#phaseSplitNotice').innerText(), /Influ total; no cost, order or customer attribution/);
  await page.keyboard.press('Escape');
  await page.locator('#phaseTableBody [data-phase-toggle="month|2026-01|phase|Influ"]').click();
  for(const row of await page.locator('#phaseTableBody .phase-kind-influ-split').all()) {
   assert.equal(await row.locator('td').nth(ph.indexOf('NC ROAS')).textContent(),'—');
   assert.equal(await row.locator('td').nth(ph.indexOf('RC revenue')).textContent(),'—');
  }
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:path.join(evidenceDir,`nc-rc-phases-${width}-${theme}.png`)});
  assert.deepEqual(errors,[]); results.push({width,theme,passed:true}); await context.close();
 }
 fs.writeFileSync(path.join(evidenceDir,'nc-rc-results.json'),JSON.stringify(results,null,2));
};
