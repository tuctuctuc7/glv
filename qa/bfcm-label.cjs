const {chromium}=require('playwright-core');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const root=path.resolve(__dirname,'../public');
const out=process.env.GLV_BFCM_EVIDENCE || '/home/tom/.hermes/cache/scratch/bfcm-label';
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 const server=http.createServer((req,res)=>{
  let file=path.join(root,new URL(req.url,'http://localhost').pathname);
  if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
  if(!file.startsWith(root)||!fs.existsSync(file)){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');
  fs.createReadStream(file).pipe(res);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const libs='/home/tom/.cache/hermes-browser-libs/root';
 const browser=await chromium.launch({executablePath:'/home/tom/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',headless:true,args:['--no-sandbox'],env:{...process.env,LD_LIBRARY_PATH:`${libs}/usr/lib/x86_64-linux-gnu:${libs}/usr/lib`,FONTCONFIG_PATH:`${libs}/etc/fonts`,XDG_DATA_DIRS:`${libs}/usr/share`}});
 try {
  for(const width of [1440,390]) for(const theme of ['dark','light']) {
   const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});
   await page.goto(`http://127.0.0.1:${server.address().port}/glv/`,{waitUntil:'networkidle'});
   await page.click('#phasesViewTab');
   if(await page.locator('html').getAttribute('data-theme')!==theme)await page.click('#themeToggle');
   const monthly=()=>page.evaluate(()=>({table:document.querySelector('#phaseTableBody').textContent,top:Chart.getChart('phaseChart').data.labels,lower:Chart.getChart('promoChart').data.datasets.map(d=>({label:d.label,data:d.data})),accessible:document.querySelector('#promoChartData').textContent}));
   const before=await monthly();
   assert.match(before.table,/November/);assert.ok(before.lower.some(d=>d.label==='November 2026'));
   await page.click('[data-phase-mode="promo"]');
   const result=await page.evaluate(()=>{
    const event=GlvPhases.buildPromoCohorts(state.data.phases).find(e=>e.start_date==='2026-11-25');
    const row=document.querySelector(`tr[data-phase-node="${event.id}"]`);
    const top=Chart.getChart('phaseChart'),lower=Chart.getChart('promoChart');
    const dataset=lower.data.datasets.find(d=>d.month===event.id);
    return {id:event.id,top:top.data.labels,topAccessible:document.querySelector('#phaseChartDataBody').textContent,table:row.cells[0].textContent,title:row.cells[0].title,aria:row.querySelector('button').getAttribute('aria-label'),lower:dataset.label,lowerAccessible:document.querySelector('#promoChartData').textContent,tooltip:lower.options.plugins.tooltip.callbacks.label({dataset,dataIndex:0,raw:dataset.data[0]})};
   });
   assert.ok(result.top.includes('BFCM'));assert.ok(!result.top.includes('November'));
   for(const key of ['topAccessible','title','aria','lowerAccessible','tooltip'])assert.match(result[key],/BFCM/);
   assert.equal(result.table,'BFCM');assert.match(result.lower,/^BFCM \(/);
   await page.click('#phaseEvents > button');
   assert.match(await page.locator('#phaseEventsOptions').innerText(),/BFCM/);
   await page.locator(`#phaseEvents input[data-value="${result.id}"]`).uncheck();
   assert.equal(await page.locator(`tr[data-phase-node="${result.id}"]`).count(),0);
   await page.locator(`#phaseEvents input[data-value="${result.id}"]`).check();
   await page.keyboard.press('Escape');
   await page.click('#promoMonths > button');
   assert.match(await page.locator('#promoMonths').innerText(),/BFCM/);
   await page.keyboard.press('Escape');
   await page.screenshot({path:`${out}/${width}-${theme}.png`,fullPage:true});
   fs.writeFileSync(`${out}/${width}-${theme}.json`,JSON.stringify(result,null,2));
   await page.click('[data-phase-mode="month"]');
   assert.deepEqual(await monthly(),before);
   await page.close();
  }
  console.log('BFCM label: top/table/filters/lower/tooltips/accessibility pass; By month November and values unchanged (1440/390, dark/light).');
 } finally {await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
