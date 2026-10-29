const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {chromium} = require('playwright-core');
const out = process.env.GLV_CONTROLS_EVIDENCE || '/tmp/glv-phase-controls-evidence';
(async () => {
 const root = path.resolve(__dirname, '../public');
 const server = http.createServer((req,res) => {
  let file = path.join(root, new URL(req.url,'http://localhost').pathname);
  if(fs.existsSync(file) && fs.statSync(file).isDirectory()) file=path.join(file,'index.html');
  if(!file.startsWith(root)||!fs.existsSync(file)) return res.writeHead(404).end();
  res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');
  fs.createReadStream(file).pipe(res);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:'/home/tom/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',args:['--no-sandbox'],env:{...process.env,LD_LIBRARY_PATH:'/home/tom/.cache/hermes-browser-libs/root/usr/lib/x86_64-linux-gnu:/home/tom/.cache/hermes-browser-libs/root/usr/lib'}});
 fs.mkdirSync(out,{recursive:true}); const results=[];
 try {
  for(const width of [1440,390,320]) for(const theme of ['dark','light']) {
   const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(`http://127.0.0.1:${server.address().port}/glv/`,{waitUntil:'networkidle'});
   await page.click('#phasesViewTab'); await page.evaluate(t=>setTheme(t),theme);
   await page.selectOption('#phaseHierarchy','phase-month');
   await page.locator('#phaseInfluSplit').check({force:true});
   await page.click('#phaseFilter > button');
   await page.uncheck('#phaseFilter input[data-value="BAU"]');
   await page.press('#phaseFilter input[data-value="Promo"]','Escape');
   const before=await page.locator('#phaseTableBody').innerText();
   const rect=()=>page.locator('#phaseMode').evaluate(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y+scrollY,width:r.width,height:r.height};});
   await page.evaluate(()=>scrollTo(0,0));
   const month=await rect();
   const viewportMonth=await page.locator('#phaseMode').boundingBox();
   await page.screenshot({path:`${out}/${width}-${theme}-month.png`,fullPage:true});
   await page.click('[data-phase-mode="promo"]');
   const promo=await rect(); assert.deepEqual(promo,month,'mode toggle must not shift');
   assert.deepEqual(await page.locator('#phaseMode').boundingBox(),viewportMonth,'viewport toggle bounds must stay fixed');
   for(const id of ['phaseMode','phaseFilter','phaseInfluSplit','phaseMetric','phaseHierarchy','phaseMonths','phaseEvents','promoMonths','promoMetric']) {
    assert.equal(await page.locator(`#${id}`).evaluate(e=>!!e.closest('#phaseControls')),true,`${id} belongs to unified panel`);
   }
   for(const id of ['phaseFilter','phaseMonths']) {
    assert.equal(await page.locator(`#${id}`).isVisible(),true);
    assert.equal(await page.locator(`#${id} > button`).isDisabled(),true);
   }
   assert.equal(await page.locator('#phaseInfluSplit').isDisabled(),true);
   assert.equal(await page.locator('#phaseInfluSplit').isChecked(),true);
   const faded=await page.locator('label[for="phaseInfluSplit"]').evaluate(e=>Number(getComputedStyle(e).opacity));assert.ok(faded<1);
   await page.click('#phaseEvents > button');
   const labels=['June Private','June Public','August Private','August Public'];
   for(const label of labels) assert.ok((await page.locator('#phaseEvents').innerText()).includes(label));
   await page.press('#phaseEvents > button','Escape');
   for(const label of labels) assert.ok((await page.locator('#phaseTableBody').innerText()).includes(label));
   await page.click('#promoMonths > button'); await page.check('#promoMonthOptions input[data-value="*"]'); await page.press('#promoMonths > button','Escape');
   const rendered=await page.evaluate(()=>({datasets:Chart.getChart(document.getElementById('promoChart')).data.datasets.map(d=>d.label),legend:Chart.getChart(document.getElementById('promoChart')).legend.legendItems.map(l=>l.text),focus:document.getElementById('promoFocus').textContent,accessible:document.getElementById('promoChartData').textContent,overflow:document.documentElement.scrollWidth>innerWidth}));
   for(const label of labels) {assert.ok(rendered.datasets.some(s=>s.includes(label))); assert.ok(rendered.legend.includes(label)); assert.ok(rendered.focus.includes(label));assert.ok(rendered.accessible.includes(label));}
   assert.equal(rendered.overflow,false);
   await page.waitForTimeout(400);
   await page.screenshot({path:`${out}/${width}-${theme}-promo.png`,fullPage:true});
   await page.click('[data-phase-mode="month"]');assert.deepEqual(await rect(),month);
   assert.equal(await page.locator('#phaseInfluSplit').isDisabled(),false);
   assert.equal(await page.locator('#phaseHierarchy').inputValue(),'phase-month');
   assert.equal(await page.locator('#phaseTableBody').innerText(),before);
   assert.deepEqual(errors,[]);
   results.push({width,theme,month,promo,faded,errors});
   fs.writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2));await page.close();
  }
  console.log(JSON.stringify({passed:results.length,out}));
 } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
