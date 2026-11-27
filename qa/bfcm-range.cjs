// Synthetic browser acceptance; real-source replay and production are separate.
const {chromium,webkit}=require('playwright-core'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {derived}=require('../lib/glv-bfcm.cjs');
const root=path.resolve(__dirname,'../public');
const campaigns=[{id:'a',name:'TUC_Promo-BFCM_Banners'},{id:'b',name:'TUC_Promo-BFCM_AnimatedBanners'},{id:'z',name:'TUC_Promo-BFCM_Zero',status:'PAUSED'}];
const absolute=['spend','purchases','revenue','impressions','clicks','lpv','ad_count'];
function fixture(q){
 const since=q.get('since')||'2026-11-25',until=q.get('until')||'2026-11-27',daily=q.get('daily')==='1';
 const daily_rows=['2026-11-25','2026-11-26'].filter(d=>d>=since&&d<=until).flatMap((date,i)=>['CC01','PAC02','AI EGC 01','Animated banners'].map((concept,j)=>derived({date,concept,campaign_id:j===3?'b':'a',campaign_name:campaigns[j===3?1:0].name,spend:(j+1)*10,purchases:i+j,revenue:(i+j)*100,impressions:100,clicks:10,lpv:5,ad_count:1})));
 const groups=new Map();for(const row of daily_rows){if(!groups.has(row.concept))groups.set(row.concept,{...row,...Object.fromEntries(absolute.map(k=>[k,0]))});for(const k of absolute)groups.get(row.concept)[k]+=row[k];}
 return {schema_version:'glv-bfcm/v4',reporting_period:since==='2026-11-25'&&until>='2026-11-27'?'campaign-to-date':'custom',since,until,date:until,timezone:'Europe/Prague',partial_day:until>='2026-11-27',currency:'CZK',generated_at:new Date().toISOString(),daily_breakdown:daily,campaigns,rows:[...groups.values()].map(derived),...(daily?{daily_rows}:{})};
}
(async()=>{
 const libs='/home/tom/.cache/hermes-browser-libs/root';
 const isWebkit=process.env.BFCM_ENGINE==='webkit';
 const browser=await (isWebkit?webkit:chromium).launch({executablePath:isWebkit?'/home/tom/.cache/ms-playwright/webkit-2370/pw_run.sh':process.env.CHROME_PATH||'/home/tom/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',headless:true,args:isWebkit?[]:['--no-sandbox'],env:{...process.env,LD_LIBRARY_PATH:`${libs}/usr/lib/x86_64-linux-gnu:${libs}/usr/lib`,FONTCONFIG_PATH:`${libs}/etc/fonts`,__EGL_VENDOR_LIBRARY_FILENAMES:`${libs}/usr/share/glvnd/egl_vendor.d/50_mesa.json`,LIBGL_DRIVERS_PATH:`${libs}/usr/lib/x86_64-linux-gnu/dri`}});
 try{
 const page=await browser.newPage();await page.clock.install({time:new Date('2026-11-27T12:00:00Z')});const errors=[];page.on('pageerror',e=>errors.push(e.message));let requests=0,slow=false,fail=false;
 await page.route('http://bfcm-range.test/**',async route=>{const u=new URL(route.request().url());if(u.pathname==='/api/glv-bfcm/data'){requests++;const result=fixture(u.searchParams);if(slow&&u.searchParams.get('since')==='2026-11-25')await new Promise(r=>setTimeout(r,250));return route.fulfill(fail?{status:502,json:{error:'synthetic failure'}}:{json:result});}const file=path.join(root,u.pathname==='/glv-bfcm/'?'glv-bfcm/index.html':u.pathname);return route.fulfill({body:fs.readFileSync(file),contentType:u.pathname.endsWith('.js')?'application/javascript':u.pathname.endsWith('.css')?'text/css':'text/html'});});
 const ready=()=>page.waitForFunction(()=>document.getElementById('notice').textContent.startsWith('Snapshot'));
 async function apply(s,u){await page.locator('#range-from').fill(s);await page.locator('#range-from').press('Tab');await page.locator('#range-to').fill(u);await page.locator('#range-to').press('Tab');}
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:1000});await page.goto('http://bfcm-range.test/glv-bfcm/');await ready();
  assert.equal(await page.locator('#range-from').inputValue(),'2026-11-25');assert.equal(await page.locator('#range-to').inputValue(),'2026-11-27');assert.equal(await page.getByLabel('Daily breakdown',{exact:true}).isChecked(),false);
  assert.equal(await page.locator('#range-apply, #range-latest').count(),0);
  assert.equal(await page.locator('#daily-breakdown').evaluate(el=>getComputedStyle(el).minHeight),'18px');
  const before=requests;await page.getByLabel('Daily breakdown',{exact:true}).check();await ready();assert.equal(requests,before+1);
  assert.equal(await page.locator('#rows .parent-row').count(),4);assert.equal(await page.locator('#rows .daily-row').count(),12);
  const rendered=await page.locator('#rows tr').evaluateAll(rows=>rows.map(r=>({daily:r.classList.contains('daily-row'),date:r.dataset.date,spend:Number(r.cells[1].textContent.replace(/,/g,'')),purchases:Number(r.cells[2].textContent.replace(/,/g,'')),roas:r.cells[3].textContent})));
  for(let i=0;i<rendered.length;i+=4){const parent=rendered[i],children=rendered.slice(i+1,i+4);for(const k of ['spend','purchases'])assert.equal(parent[k],children.reduce((n,r)=>n+r[k],0));assert.equal(children[2].spend,0);assert.equal(children[2].purchases,0);assert.equal(children[2].roas,'—');}
  for(const view of ['concept','detail','campaign']){
   await page.locator(`[data-view="${view}"]`).click();
   for(const key of ['spend','purchases','roas','ctr','cpm','cost_lpv','cvr']){await page.locator(`[data-sort="${key}"]`).click();await page.locator(`[data-sort="${key}"]`).click();
    const groups=await page.locator('#rows tr').evaluateAll(rows=>{const groups=[];for(const r of rows){if(r.classList.contains('parent-row'))groups.push([]);else groups.at(-1).push(r.dataset.date);}return groups;});for(const dates of groups)assert.deepEqual(dates,['2026-11-25','2026-11-26','2026-11-27']);
   }
  }
  await page.locator('[data-view="concept"]').click();
  await apply('2026-11-26','2026-11-26');await ready();assert.equal(await page.locator('#rows .daily-row').count(),4);assert.match(await page.locator('#context').innerText(),/2026-11-26/);assert.doesNotMatch(await page.locator('#context').innerText(),/Current day partial/);
  assert.equal(await page.locator('[data-sort="cvr"]').locator('..').getAttribute('aria-sort'),'ascending');
  const count=requests;await apply('2026-11-27','2026-11-26');assert.equal(requests,count);assert.equal(await page.locator('#rows tr').count(),0,'invalid new controls must not retain old scope');
  await page.locator('#range-to').focus();assert.equal(await page.locator('#range-to').evaluate(e=>document.activeElement===e),true,'validation does not steal focus');await page.locator('#range-to').fill('2026-11-27');await page.locator('#range-to').press('Tab');await ready();assert.equal(requests,count+1,'editing the OTHER date repairs ordering and auto-fetches once');
  const validCount=requests;await page.locator('#range-from').fill('2026-11-28');await page.locator('#range-from').press('Enter');assert.equal(requests,validCount,'future dates and implicit submit never fetch');await page.locator('#range-from').fill('');await page.locator('#range-to').focus();assert.equal(requests,validCount,'incomplete date never fetches or blocks other control');
  await apply('2026-11-25','2026-11-27');await ready();
  await page.locator('#campaign-trigger').click();await page.locator('#campaign-none').click();await page.keyboard.press('Escape');
  await apply('2026-11-26','2026-11-26');await ready();assert.equal(await page.locator('#campaign-trigger').innerText(),'None selected');assert.match(await page.locator('#rows').innerText(),/No results/);
  await page.getByLabel('Daily breakdown',{exact:true}).uncheck();await ready();assert.equal(await page.locator('#campaign-trigger').innerText(),'None selected');
  await page.locator('#campaign-trigger').click();await page.locator('#campaign-all').click();await page.keyboard.press('Escape');
  slow=true;await apply('2026-11-25','2026-11-26');
  await page.locator('#campaign-trigger').click();await page.locator('#campaign-none').click();await page.keyboard.press('Escape');
  assert.equal(await page.locator('#campaign-trigger').innerText(),'None selected','None works while a new range is pending');
  await ready();assert.match(await page.locator('#rows').innerText(),/No results/);
  await page.locator('#campaign-trigger').click();await page.locator('#campaign-all').click();await page.keyboard.press('Escape');
  await apply('2026-11-25','2026-11-26');await page.locator('#campaign-trigger').click();await page.locator('#campaign-options input').first().uncheck();await page.keyboard.press('Escape');await ready();
  assert.equal(await page.locator('#campaign-trigger').innerText(),'2 selected','subset works during pending range');
  await page.locator('#campaign-trigger').click();await page.locator('#campaign-all').click();await page.keyboard.press('Escape');
  await apply('2026-11-25','2026-11-26');await apply('2026-11-26','2026-11-26');await ready();await new Promise(r=>setTimeout(r,350));assert.doesNotMatch(await page.locator('#context').innerText(),/25 Nov/);slow=false;
  fail=true;await apply('2026-11-25','2026-11-25');await page.waitForFunction(()=>document.getElementById('notice').className==='error');assert.equal(await page.locator('#rows tr').count(),0);assert.equal(await page.locator('#kpis .kpi').count(),0);fail=false;
  await page.locator('#campaign-trigger').click();await page.locator('#campaign-none').click();assert.equal(await page.locator('#campaign-trigger').innerText(),'None selected');await page.locator('#campaign-options input').first().check();assert.equal(await page.locator('#campaign-trigger').innerText(),'1 selected');await page.locator('#campaign-all').click();await page.keyboard.press('Escape');
  await page.locator('#refresh').click();await ready();await page.reload();await ready();assert.equal(await page.locator('#range-to').inputValue(),'2026-11-27');
  for(const theme of ['light','dark']){if(await page.locator('html').getAttribute('data-theme')!==theme)await page.locator('#theme-switch').click();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`/home/tom/.hermes/cache/scratch/bfcm-range-${width}-${theme}.png`,fullPage:true});}
  console.log(`PASS range/daily/zero-day/sort/none/race/failure/themes ${width}px`);
 }
 assert.deepEqual(errors,[]);
 slow=true;await page.reload();await page.clock.setFixedTime(new Date('2026-11-28T00:00:00Z'));await ready();slow=false;
 assert.equal(await page.locator('#range-to').inputValue(),'2026-11-27','response remains bound to request-start account date');
 await page.locator('#refresh').click();await ready();assert.equal(await page.locator('#range-to').inputValue(),'2026-11-28');
 console.log('PASS advancing default after Prague midnight');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
