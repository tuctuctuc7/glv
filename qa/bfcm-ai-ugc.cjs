// Local replay of private API reports; NOT authenticated production browser QA.
const {chromium,webkit}=require('playwright-core'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {derived}=require('../lib/glv-bfcm.cjs');
const dir=process.env.BFCM_REPORT_DIR;assert(dir,'BFCM_REPORT_DIR required');
const prefix=process.env.BFCM_REPORT_PREFIX||'canonical';
const reports=Object.fromEntries(['aggregate','daily'].map(mode=>[mode,JSON.parse(fs.readFileSync(path.join(dir,`${prefix}-${mode}.json`)))]));
const keys=['spend','purchases','revenue','impressions','clicks','lpv','ad_count'],metrics=['spend','purchases','roas','ctr','cpm','cost_lpv','cvr'];
const sum=rows=>derived(rows.reduce((o,r)=>{for(const k of keys)o[k]+=r[k];return o;},Object.fromEntries(keys.map(k=>[k,0]))));
const fmt=(value,key)=>value===null?'—':new Intl.NumberFormat('en-GB',{maximumFractionDigits:2,minimumFractionDigits:key==='purchases'?0:2}).format(value)+(key==='roas'?'×':['ctr','cvr'].includes(key)?'%':'');
(async()=>{
 const libs='/home/tom/.cache/hermes-browser-libs/root',wk=process.env.BFCM_ENGINE==='webkit';
 const browser=await(wk?webkit:chromium).launch({executablePath:wk?'/home/tom/.cache/ms-playwright/webkit-2370/pw_run.sh':process.env.CHROME_PATH||'/home/tom/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',headless:true,args:wk?[]:['--no-sandbox'],env:{...process.env,LD_LIBRARY_PATH:`${libs}/usr/lib/x86_64-linux-gnu:${libs}/usr/lib`,FONTCONFIG_PATH:`${libs}/etc/fonts`,__EGL_VENDOR_LIBRARY_FILENAMES:`${libs}/usr/share/glvnd/egl_vendor.d/50_mesa.json`,LIBGL_DRIVERS_PATH:`${libs}/usr/lib/x86_64-linux-gnu/dri`}});
 try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.clock.install({time:new Date(reports.aggregate.generated_at)});
 await page.route('http://ugc.test/**',route=>{const u=new URL(route.request().url());if(u.pathname==='/api/glv-bfcm/data')return route.fulfill({json:reports[u.searchParams.get('daily')==='1'?'daily':'aggregate']});const file=path.join(__dirname,'../public',u.pathname==='/glv-bfcm/'?'glv-bfcm/index.html':u.pathname);return route.fulfill({body:fs.readFileSync(file),contentType:u.pathname.endsWith('.js')?'application/javascript':u.pathname.endsWith('.css')?'text/css':'text/html'});});
 const ready=()=>page.waitForFunction(()=>document.getElementById('notice').textContent.startsWith('Snapshot'));
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await page.goto('http://ugc.test/glv-bfcm/');await ready();
  for(const mode of ['aggregate','daily']){
   await page.locator('#daily-breakdown').setChecked(mode==='daily');await ready();
   const report=reports[mode],source=mode==='daily'?report.daily_rows:report.rows;
   for(const query of ['', 'AI UGC','AI UGC 01','AI UGC 02']){
    await page.locator('#search').fill(query);
    for(const view of ['concept','detail','campaign']){
     await page.locator(`[data-view="${view}"]`).click();
     const filtered=source.filter(r=>!query||`${r.concept} ${r.campaign_name}`.toLowerCase().includes(query.toLowerCase()));const total=sum(filtered);
     assert.deepEqual(await page.locator('#kpis strong').allTextContents(),metrics.map(k=>fmt(total[k],k)));
     if(view!=='campaign'&&query){const labels=await page.locator('#rows .parent-row th').allTextContents();assert(labels.some(s=>s.includes(query)));assert(labels.every(s=>!s.includes('Unmapped')));}
     if(mode==='daily'){
      const dates=await page.locator('#rows tr').evaluateAll(rows=>{const out=[];for(const r of rows){if(r.classList.contains('parent-row'))out.push([]);else out.at(-1).push(r.dataset.date);}return out;});
      for(const d of dates)assert.deepEqual(d,[...d].sort());
     }
    }
   }
   await page.locator('#search').fill('AI UGC 01');await page.locator('#campaign-trigger').click();await page.locator('#campaign-none').click();await page.keyboard.press('Escape');
   for(const view of ['concept','detail','campaign']){await page.locator(`[data-view="${view}"]`).click();assert.match(await page.locator('#rows').innerText(),/No results/);}
   await page.locator('#campaign-trigger').click();const campaign=source.find(r=>r.concept==='AI UGC 01').campaign_id;await page.locator(`#campaign-options input[value="${campaign}"]`).check();await page.keyboard.press('Escape');
   const selected=sum(source.filter(r=>r.campaign_id===campaign&&r.concept==='AI UGC 01'));assert.deepEqual(await page.locator('#kpis strong').allTextContents(),metrics.map(k=>fmt(selected[k],k)));
   await page.locator('#campaign-trigger').click();await page.locator('#campaign-all').click();await page.keyboard.press('Escape');await page.locator('#search').fill('');
   console.log(`PASS ${wk?'webkit':'chromium'} ${width}px ${mode}: all views, UGC filters, ratios, None, campaign subset, chronological days`);
  }
 }
 assert.deepEqual(errors,[]);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
