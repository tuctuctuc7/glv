const {chromium}=require('playwright-core');
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const root=path.resolve(__dirname,'../public'),out=process.env.GLV_LABEL_EVIDENCE||'/tmp/glv-label-qa';
fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{let file=path.join(root,new URL(req.url,'http://localhost').pathname);if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');if(!file.startsWith(root)||!fs.existsSync(file))return res.writeHead(404).end();res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const libs='/home/tom/.cache/hermes-browser-libs/root';
 const browser=await chromium.launch({executablePath:process.env.GLV_CHROME_PATH||'/home/tom/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',headless:true,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage'],env:{...process.env,LD_LIBRARY_PATH:`${libs}/usr/lib/x86_64-linux-gnu:${libs}/usr/lib`,FONTCONFIG_PATH:`${libs}/etc/fonts`,XDG_DATA_DIRS:`${libs}/usr/share`}});
 try {
 const results=[];
 for(const width of [1440,390]) for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(t=>localStorage.setItem('glv-theme',t),theme);
  await page.goto(process.env.GLV_QA_URL||`http://127.0.0.1:${server.address().port}/glv/`,{waitUntil:'networkidle'});
  console.log('loaded',width,theme);
  await page.waitForFunction(()=>state.data && Chart.getChart('trendChart'));
  const names={nc_roas:'NC ROAS',new_customer_revenue:'NC Revenue',returning_customer_revenue:'RC Revenue',new_customer_rate:'NC Rate'};
  assert.match(await page.locator('#executiveKpis').textContent(),/NC Rate/);
  for(const [key,label] of Object.entries(names)){
   await page.selectOption('#trendMetric',key);
   assert.equal(await page.evaluate(()=>Chart.getChart('trendChart').data.datasets[0].label),label);
  }
  await page.locator('#phasesViewTab').click();console.log('phases',width,theme);
  for(const mode of ['month','promo']){
   await page.locator(`[data-phase-mode="${mode}"]`).click();
   for(const [key,label] of Object.entries(names)){
    await page.selectOption('#phaseMetric',key);await page.selectOption('#promoMetric',key);
    assert.match(await page.locator('#promoChartCaption').textContent(),new RegExp(label));
    const resolved=await page.evaluate(()=>({phase:Chart.getChart('phaseChart').options.scales.y.title.text,promo:Chart.getChart('promoChart').options.scales.y.title.text}));
    assert.equal(await page.locator('#phaseMetric option:checked').textContent(),label);assert.doesNotMatch(JSON.stringify(resolved),/New customer|Returning customer/);
   }
   const bad=await page.locator('option,th,.kpi-label,caption,[aria-label],[title]').evaluateAll(nodes=>nodes.flatMap(n=>[n.textContent,n.getAttribute('aria-label'),n.getAttribute('title')]).filter(t=>t&&/(?:New|Returning|Repeat) customer (?:revenue|rate|ROAS)|\b(?:NC|RC) (?:revenue|rate)\b/.test(t)));
   assert.deepEqual(bad,[]);
  }
  await page.selectOption('#phaseMetric','revenue');await page.selectOption('#promoMetric','revenue');
  const vb=await page.evaluate(()=>GlvPhases.buildPromoEvents(state.data.phases).find(e=>e.start_date==='2026-10-28'));
  assert.equal(vb.label,'VB2');assert.equal(vb.end_date,'2026-11-06');
  const button=page.locator(`button[data-phase-toggle="${vb.id}"]`);assert.equal(await button.innerText(),'VB2');assert.match(await button.getAttribute('aria-label'),/VB2/);
  await button.click();assert.equal(await page.locator(`tr[data-phase-node="${vb.id}|2026-11-05"]`).count(),1);assert.equal(await page.locator(`tr[data-phase-node="${vb.id}|2026-11-06"]`).count(),0);
  await page.locator('#phaseEvents > button').click();const choice=page.locator(`#phaseEvents input[data-value="${vb.id}"]`);assert.match(await choice.locator('..').textContent(),/VB2/);await choice.uncheck();await choice.check();await choice.press('Escape');
  const chart=await page.evaluate(()=>({top:Chart.getChart('phaseChart').data.labels,accessible:document.querySelector('#phaseChartDataBody').textContent,daily:Chart.getChart('promoChart').data.datasets.map(d=>({label:d.label,dates:d.dates,values:d.data})),legend:Chart.getChart('promoChart').legend.legendItems.map(l=>l.text)}));
  assert.ok(chart.top.includes('VB2'));assert.ok(!chart.top.includes('October'));assert.match(chart.accessible,/VB2/);assert.ok(chart.legend.includes('VB2'));
  const daily=chart.daily.find(d=>d.dates.includes('2026-11-05'));assert.ok(daily,JSON.stringify(chart));assert.equal(daily.dates[8],'2026-11-05');assert.equal(daily.values.length,9);
  assert.deepEqual(errors,[]);await page.screenshot({path:`${out}/${width}-${theme}.png`,fullPage:true});results.push({width,theme,event:vb,chart,errors});await page.close();
 }
 fs.writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2));console.log('PASS',results.length,'viewport/theme states');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
