// Synthetic UI regression: sorting, retention, keyboard and narrow-screen targets.
const {chromium}=require('playwright-core');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../public');
const keys=['spend','purchases','roas','ctr','cpm','cost_lpv','cvr'];
const campaigns=[{id:'a',name:'TUC_039_Promo-BFCM_Banners'},{id:'b',name:'TUC_042_Promo-BFCM_AnimatedBanners'}];
const rows=[
 {campaign_id:'a',concept:'CC01',spend:120,purchases:3,revenue:360,impressions:1000,clicks:30,lpv:20,ad_count:1},
 {campaign_id:'a',concept:'CC02',spend:20,purchases:12,revenue:200,impressions:2000,clicks:10,lpv:15,ad_count:1},
 {campaign_id:'b',concept:'Animated banners',spend:200,purchases:2,revenue:100,impressions:500,clicks:40,lpv:100,ad_count:1},
 {campaign_id:'a',concept:'CC00',spend:0,purchases:0,revenue:0,impressions:0,clicks:0,lpv:0,ad_count:1},
].map(r=>({...r,campaign_name:campaigns.find(c=>c.id===r.campaign_id).name}));
// These synthetic rows represent full-range ad aggregates, not today's facts.
const fixture={schema_version:'glv-bfcm/v2',reporting_period:'campaign-to-date',since:'2026-11-25',until:'2026-11-26',date:'2026-11-26',timezone:'Europe/Prague',partial_day:true,currency:'CZK',generated_at:'2026-11-26T10:00:00Z',campaigns,rows};
(async()=>{
 const libs='/home/tom/.cache/hermes-browser-libs/root';
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/home/tom/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',headless:true,args:['--no-sandbox'],env:{...process.env,LD_LIBRARY_PATH:`${libs}/usr/lib/x86_64-linux-gnu:${libs}/usr/lib`,FONTCONFIG_PATH:`${libs}/etc/fonts`}});
 try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let requests=0,responseTime=fixture.generated_at;
 await page.route('http://bfcm-sort.test/**',route=>{const p=new URL(route.request().url()).pathname;if(p==='/api/glv-bfcm/data'){requests++;return route.fulfill({json:{...fixture,generated_at:responseTime}});}const file=path.join(root,p==='/glv-bfcm/'?'/glv-bfcm/index.html':p);return route.fulfill({body:fs.readFileSync(file),contentType:p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':'text/html'});});
 async function check(key,direction){
  const header=page.locator(`[data-sort="${key}"]`);
  assert.equal(await header.locator('..').getAttribute('aria-sort'),direction==='desc'?'descending':'ascending');
  const texts=await page.locator(`#rows tr td:nth-child(${keys.indexOf(key)+2})`).allTextContents();
  const values=texts.map(s=>s==='—'?null:Number(s.replace(/[,×%]/g,'')));
  let missing=false;let last=null;for(const v of values){if(v===null){missing=true;continue;}assert(!missing,'missing values must remain last');if(last!==null)assert(direction==='desc'?last>=v:last<=v,`${key} ${direction}: ${values}`);last=v;}
 }
 for(const [width,theme] of [1440,390,320].flatMap(width=>['light','dark'].map(theme=>[width,theme]))){
  responseTime=fixture.generated_at;
  await page.setViewportSize({width,height:1000});await page.goto('http://bfcm-sort.test/glv-bfcm/');await page.waitForFunction(()=>document.getElementById('notice').textContent.startsWith('Snapshot'));
  assert.match(await page.locator('#context').innerText(),/25 Nov 2026 – now/);
  assert.match(await page.locator('#context').innerText(),/through 2026-11-26 · Current day partial/);
  assert.match(await page.locator('#notice').innerText(),/26 Nov 2026, 11:00:00/);
  const toggle=page.locator('#theme-switch');
  const figma=page.locator('#figma-link');
  assert.equal(await figma.getAttribute('href'),'https://www.figma.com/design/iPeUCzn7FT6rC2tcuiWYEW/GELAVIS-%7C-Design?node-id=6967-361&t=cywGTLq0poFQh2c0-1');
  assert.equal(await figma.getAttribute('target'),'_blank');assert.equal(await figma.getAttribute('rel'),'noopener noreferrer');
  const figmaBounds=await figma.boundingBox();assert(figmaBounds.height>=44&&figmaBounds.x>=0&&figmaBounds.x+figmaBounds.width<=width);
  if(await page.locator('html').getAttribute('data-theme')!==theme) await toggle.click();
  const beforeToggleRequests=requests, beforeToggleValues=await page.locator('#kpis').innerText();
  await toggle.focus();await page.keyboard.press('Enter');await page.keyboard.press('Space');
  assert.equal(await page.locator('html').getAttribute('data-theme'),theme);
  assert.equal(requests,beforeToggleRequests,'theme switch must not request data');
  assert.equal(await page.locator('#kpis').innerText(),beforeToggleValues,'theme switch preserves metrics');
  assert.equal(await toggle.getAttribute('aria-label'),`Switch to ${theme==='light'?'dark':'light'} mode`);
  assert.equal(await toggle.innerText(),'','icon-only toggle');
  const bounds=await toggle.boundingBox();assert(bounds.width>=44&&bounds.height>=44);assert(bounds.x+bounds.width<=width);
  await page.reload();await page.waitForFunction(()=>document.getElementById('notice').textContent.startsWith('Snapshot'));
  assert.equal(await page.locator('html').getAttribute('data-theme'),theme,'saved theme survives reload');
  await page.screenshot({path:`/home/tom/.hermes/cache/scratch/bfcm-${theme}-${width}.png`,fullPage:true});
  const startRequests=requests, snapshotTime=Date.parse(fixture.generated_at);
  await page.evaluate(()=>{window.originalDateNow=Date.now;});
  const initialMarkup=await page.locator('body').innerHTML();
  for(const age of [-1,0,599999,600000]){
   await page.evaluate(now=>{Date.now=()=>now;},snapshotTime+age);
   await page.locator('#refresh').click();
   assert.equal(requests,startRequests,`no request for snapshot age ${age}ms`);
   assert.equal(await page.locator('body').innerHTML(),initialMarkup,'fresh click must not change UI');
  }
  await page.evaluate(now=>{Date.now=()=>now;},snapshotTime+600001);
  responseTime=new Date(snapshotTime+600001).toISOString();
  await page.locator('#refresh').click();await page.waitForFunction(()=>!document.getElementById('refresh').disabled);
  assert.equal(requests,startRequests+1,'refresh just beyond 10 minutes');
  await page.locator('#refresh').click();assert.equal(requests,startRequests+1,'new snapshot resets refresh eligibility');
  await page.evaluate(()=>{Date.now=window.originalDateNow;});
  console.log(`PASS refresh age boundary and network no-op: ${width}px`);
  await check('purchases','desc');const totals=await page.locator('#kpis').innerText();
  await page.locator('[data-sort="purchases"]').click();await check('purchases','desc');
  await page.locator('[data-sort="purchases"]').click();await check('purchases','asc');
  for(const view of ['concept','detail','campaign']){
   await page.locator(`[data-view="${view}"]`).click();
   assert.equal(await page.locator('#kpis').innerText(),totals,'all views retain cumulative KPIs');
   const spend=await page.locator('#rows tr td:nth-child(2)').allTextContents();
   assert.equal(spend.reduce((sum,s)=>sum+Number(s.replace(/,/g,'')),0),340,'all views sum full-range spend');
   const purchases=await page.locator('#rows tr td:nth-child(3)').allTextContents();
   assert.equal(purchases.reduce((sum,s)=>sum+Number(s.replace(/,/g,'')),0),17,'all views sum full-range purchases');
   for(const key of keys){
    // Selecting a different metric resets its next click to descending.
    const other=key==='spend'?'roas':'spend';await page.locator(`[data-sort="${other}"]`).click();
    const button=page.locator(`[data-sort="${key}"]`);await button.click();await check(key,'desc');await button.click();await check(key,'asc');
   }
  }
  assert.equal(await page.locator('#kpis').innerText(),totals);
  await page.locator('#refresh').click();await page.waitForFunction(()=>!document.getElementById('refresh').disabled);await check('cvr','asc');
  await page.locator('#campaign-trigger').click();await page.locator('#campaign-options input').first().uncheck();await page.keyboard.press('Escape');await check('cvr','asc');
  await page.locator('[data-view="concept"]').click();await check('cvr','asc');
  const button=page.locator('[data-sort="roas"]');await button.focus();await page.keyboard.press('Enter');await check('roas','desc');await page.keyboard.press('Space');await check('roas','asc');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.locator('#campaign-trigger').click();await page.locator('#campaign-none').click();await page.keyboard.press('Escape');
  await page.locator('#refresh').click();await page.waitForFunction(()=>!document.getElementById('refresh').disabled);
  for(const view of ['concept','detail','campaign']){
   await page.locator(`[data-view="${view}"]`).click();
   assert.equal(await page.locator('#campaign-trigger').innerText(),'None selected');
   assert.match(await page.locator('#rows').innerText(),/No results/);
  }
  console.log(`PASS ${theme} theme: ${width}px, persisted icon toggle; seven metrics × both directions × three views, retention, keyboard`);
 }
 fixture.schema_version='glv-bfcm/v1';
 await page.reload();await page.waitForFunction(()=>document.getElementById('notice').className==='error');
 assert.match(await page.locator('#notice').innerText(),/Unexpected campaign reporting window/);
 assert.equal(await page.locator('#kpis .kpi').count(),0,'never label a legacy daily payload cumulative');
 assert.deepEqual(errors,[]);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
