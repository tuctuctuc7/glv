// Synthetic network latency only: no Meta requests or private facts.
const {chromium}=require('playwright-core');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../public'),delay=200;
const requests=[];
let failedTypes=new Set(),empty=false,malformed=false,historyDelay=delay,fxDelay=delay,fxValue=0.044;
let historyStamp='2026-09-21T00:00:00Z';
const row={id:'c1',name:'TUC_008_CZSK_Sales_Promo',amount_spent:'100',impressions:'1000',reach:'800','actions:omni_purchase':'2','action_values:omni_purchase':'300',date_start:'2026-09-10',date_stop:'2026-09-10'};
const formats={schema_version:1,classification_version:1,reconciled:true,generated_at:'2026-09-21T00:00:00Z',range:{since:'2026-03-01',until:'2026-09-20'},rows:[{ad_id:'a',ad_name:'a',adset_id:'s',adset_name:'Banner',campaign_id:'c1',campaign_name:row.name,date:'2026-09-10',format:'Banner',reason:'current_adset_label',spend:100,purchases:2,revenue:300,impressions:1000}]};
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname==='/api/glv-meta-ads/fb-data'){
  const type=u.searchParams.get('type');requests.push({type,scope:u.searchParams.get('time_range')||u.searchParams.get('date_preset'),start:performance.now()});
  const range=JSON.parse(u.searchParams.get('time_range')||'null');
  const amount=range?Number(range.since.slice(-2))*100:100;
  const wait=type==='promo_formats'?historyDelay:range?.since==='2026-09-01'?600:delay;
  const fail=failedTypes.has(type),isEmpty=empty,isMalformed=malformed;
  const historyPayload={...formats,generated_at:historyStamp,rows:isEmpty?[]:formats.rows};
  return setTimeout(()=>{res.setHeader('Content-Type','application/json');res.statusCode=fail?503:200;res.end(JSON.stringify(fail?{error:'Fixture offline'}:isMalformed?{rows:null}:type==='promo_formats'?historyPayload:{rows:type==='ads'||isEmpty?[]:[{...row,amount_spent:String(amount)}]}));},wait);
 }
 let file=path.join(root,u.pathname);if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');if(!file.startsWith(root)||!fs.existsSync(file))return res.writeHead(404).end();
 res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const libs='/home/tom/.cache/hermes-browser-libs/root';
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/home/tom/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',headless:true,args:['--no-sandbox'],env:{...process.env,LD_LIBRARY_PATH:`${libs}/usr/lib/x86_64-linux-gnu:${libs}/usr/lib`,FONTCONFIG_PATH:`${libs}/etc/fonts`}});
 try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.clock.install({time:new Date('2026-09-22T12:00:00Z')});
 await page.route('https://api.frankfurter.dev/**',async r=>{requests.push({type:'fx',start:performance.now()});const value=fxValue;await new Promise(r=>setTimeout(r,fxDelay));await r.fulfill({json:{rates:{USD:value}}});});
 await page.goto(`http://127.0.0.1:${server.address().port}/glv-meta-ads/`);
 await page.waitForFunction(()=>document.getElementById('loading').style.display==='none');
 const initial=requests.slice();const beforeTabs=requests.length;
 const tabs=await page.evaluate(async()=>{const timings=[];for(const b of document.querySelectorAll('.tab-btn')){const t=performance.now();b.click();await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);timings.push({tab:b.dataset.tab,ms:performance.now()-t});}return timings;});
 assert.equal(requests.length,beforeTabs,'tabs must not fetch');
 const snapshot=()=>page.evaluate(()=>JSON.stringify({aggregateCampaigns,dailyCampaigns,adCreatives,promo:PromoFormat.monthlyMix(promoFormatRows())}));const first=await snapshot();
 const run=async preset=>page.evaluate(async p=>{datePreset=p;customRange=null;updateDateLabel();const t=performance.now();await loadData();return performance.now()-t;},preset);
 const coldStart=requests.length,cold=await run('last_7d'),count=requests.length;
 const warm=await run('last_30d'),warmRequests=requests.length-count;
 assert.equal(await snapshot(),first,'cached metrics must equal cold metrics');
 const report={syntheticDelayMs:delay,initialRequestCount:initial.length,initialStartSpreadMs:initial.at(-1).start-initial[0].start,coldDateMs:cold,coldRequests:count-coldStart,warmDateMs:warm,warmRequests,tabRequests:coldStart-beforeTabs,tabs,requests:requests.map(r=>({...r,start:Math.round(r.start-initial[0].start)})),errors};
 console.log(JSON.stringify(report,null,2));
 if(process.env.PERF_REPORT)fs.writeFileSync(process.env.PERF_REPORT,JSON.stringify(report,null,2));
 assert.deepEqual(errors,[]);
 if(!process.env.PERF_BASELINE){assert.equal(warmRequests,0,'fresh revisited range must issue zero requests');assert.ok(report.initialStartSpreadMs<delay,'independent initial fetches must overlap');assert.ok(warm<delay,'warm render must not wait for network');}
 if(!process.env.PERF_BASELINE){
  historyDelay=1100;fxDelay=1000;fxValue=0.055;
  const independent=await page.evaluate(async()=>{const t=performance.now();await loadData({force:true});return {ms:performance.now()-t,rate:usdRate,visible:getComputedStyle(document.getElementById('panel-us')).display!=='none'};});
  assert.ok(independent.ms<800,'slow history and FX must not gate main data');
  assert.equal(independent.rate,0.044,'slow FX remains pending when main data is ready');
  assert.equal(independent.visible,true);
  await page.waitForFunction(()=>usdRate===0.055);
  assert.match(await page.locator('#kpi-czsk').textContent(),/\$6/,'late FX repaints current KPI conversions');
  await page.evaluate(()=>loadPromoFormats());
  historyDelay=delay;fxDelay=delay;
  report.independentMainMs=independent.ms;
  // A force refresh starts new independent generations, not just new main rows.
  historyDelay=1100;fxDelay=1000;fxValue=0.066;historyStamp='2026-09-20T00:00:00Z';
  await page.evaluate(async()=>{await loadData({force:true});window.oldIndependent=Promise.all([loadPromoFormats(),fetchUsdRate()]);});
  historyDelay=delay;fxDelay=delay;fxValue=0.077;historyStamp='2026-09-22T00:00:00Z';
  await page.evaluate(()=>loadData({force:true}));
  await page.waitForFunction(()=>usdRate===0.077&&promoFormatPayload.generated_at==='2026-09-22T00:00:00Z');
  await page.evaluate(()=>window.oldIndependent);
  assert.deepEqual(await page.evaluate(()=>[usdRate,promoFormatPayload.generated_at]),[0.077,'2026-09-22T00:00:00Z'],'old FX/history must not overwrite forced newer generations');
  const race=await page.evaluate(async()=>{
   customRange={since:'2026-09-01',until:'2026-09-10'};datePreset=null;updateDateLabel();const old=loadData();
   await new Promise(r=>setTimeout(r,30));
   customRange={since:'2026-09-02',until:'2026-09-10'};updateDateLabel();const latest=loadData();
   await latest;const first=aggregateCampaigns[0]?.spend;await old;
   return {first,last:aggregateCampaigns[0]?.spend};
  });
  assert.deepEqual(race,{first:200,last:200},'obsolete delayed response must not overwrite latest date selection');
  await page.locator('[data-tab="czsk"]').click();
  const refreshStart=requests.length;
  const retained=await page.evaluate(()=>{
   window.pendingRefresh=loadData({force:true});
   return {visible:!!document.querySelector('#panel-czsk.active'),rows:dailyCampaigns.length,history:!!promoFormatPayload};
  });
  assert.deepEqual(retained,{visible:true,rows:1,history:true},'same-range refresh keeps content visible while updating');
  await page.evaluate(()=>window.pendingRefresh);
  assert.equal(requests.length-refreshStart,5,'explicit refresh invalidates every resource including rate and history');
  const hidden=await page.evaluate(()=>{
   customRange={since:'2026-09-03',until:'2026-09-10'};updateDateLabel();window.pendingRange=loadData();
   document.querySelector('[data-tab="czsk-promo"]').click();
   return getComputedStyle(document.getElementById('panel-czsk-promo')).display==='none';
  });
  assert.equal(hidden,true,'tab navigation while new dates load must not reveal mislabeled old rows');
  await page.evaluate(()=>window.pendingRange);
  const historyStart=requests.length;await page.evaluate(()=>promoFormatHistory());
  assert.equal(requests.length-historyStart,1,'history refresh only invalidates independent history');
  const dedupStart=requests.length;
  await page.evaluate(async()=>{customRange={since:'2026-09-04',until:'2026-09-10'};await Promise.all([loadData(),loadData()]);});
  assert.equal(requests.length-dedupStart,3,'concurrent same-scope loads coalesce all three scoped requests');
  failedTypes=new Set(['aggregate','daily','ads']);await page.evaluate(()=>loadData({force:true}));
  assert.deepEqual(await page.evaluate(()=>[aggregateCampaigns.length,dailyCampaigns.length,adCreatives.length]),[0,0,0]);
  assert.match(await page.locator('#error').textContent(),/Fixture offline/);
  assert.match(await page.locator('#kpi-czsk').textContent(),/unavailable/i,'failed totals must not display invented zero summaries');
  failedTypes.clear();const retryStart=requests.length;await page.evaluate(()=>loadData());
  assert.equal(requests.length-retryStart,3,'failed responses are not memoized');
  assert.equal(await page.locator('#error').isVisible(),false);
  failedTypes.add('daily');await page.evaluate(()=>loadData({force:true}));
  assert.deepEqual(await page.evaluate(()=>[aggregateCampaigns.length,dailyCampaigns.length]),[1,0]);
  assert.match(await page.locator('#daily-table-czsk').textContent(),/unavailable/i);
  assert.doesNotMatch(await page.locator('#kpi-czsk').textContent(),/unavailable/i,'one source failing must not erase successful totals');
  failedTypes.clear();await page.evaluate(()=>loadData());
  malformed=true;await page.evaluate(()=>loadData({force:true}));malformed=false;
  assert.match(await page.locator('#error').textContent(),/schema unavailable/);
  assert.equal(await page.locator('#promo-format-table tbody tr').count(),0);
  const schemaRetry=requests.length;await page.evaluate(()=>loadData());
  assert.equal(requests.length-schemaRetry,4,'malformed payloads never enter successful cache');
  empty=true;await page.evaluate(()=>loadData({force:true}));
  assert.match(await page.locator('#kpi-czsk').textContent(),/No campaign activity/);
  const emptyStart=requests.length;await page.evaluate(()=>loadData());assert.equal(requests.length,emptyStart,'valid empty response is reusable');
  empty=false;
  await page.locator('#refresh-data').click();await page.waitForFunction(()=>document.getElementById('loading').style.display==='none');
  assert.equal(await page.evaluate(()=>aggregateCampaigns.length),1,'visible explicit refresh reloads empty cache');
  await run('yesterday');
  const rolloverStart=requests.length;
  await page.clock.setSystemTime(new Date('2026-09-25T12:00:00Z'));
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.waitForFunction(()=>document.getElementById('loading').style.display==='none'&&renderedScope.startsWith('2026-09-25'));
  assert.equal(requests.length-rolloverStart,5,'UTC rollover invalidates all cached resources when page resumes');
  const duplicateStart=requests.length;
  await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('pageshow'));document.dispatchEvent(new Event('visibilitychange'));});
  assert.equal(requests.length,duplicateStart,'same UTC day resume must not fetch');
  await page.clock.setSystemTime(new Date('2026-09-26T00:01:00Z'));
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForFunction(()=>document.getElementById('loading').style.display==='none'&&renderedScope.startsWith('2026-09-26'));
  assert.equal(requests.length-duplicateStart,5,'visibility resume refreshes UTC-relative scopes');
  await page.clock.setSystemTime(new Date('2026-09-26T00:07:00Z'));
  const expiredStart=requests.length;await page.evaluate(()=>loadData());
  assert.equal(requests.length-expiredStart,5,'expired data refetches at the next load');
  assert.deepEqual(errors,[]);
  if(process.env.PERF_REPORT)fs.writeFileSync(process.env.PERF_REPORT,JSON.stringify({...report,expandedQaPassed:true},null,2));
  console.log('PASS cache concurrency, race, refresh visibility, retry/schema/empty recovery, UTC rollover');
 }
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
