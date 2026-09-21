const { chromium } = require('playwright-core');
const http=require('node:http'), fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const { monthlyMix }=require('../public/glv-meta-ads/promo-format.js');
const root=path.resolve(__dirname,'../public');
const out=process.env.PROMO_FORMAT_QA_DIR||'/tmp/glv-promo-format-browser';fs.mkdirSync(out,{recursive:true});
const fact=(id,date,format,spend,purchases)=>({ad_id:id,ad_name:id==='unknown'?'<img src=x onerror=window.__formatXss=1>':id,adset_id:'s-'+id,adset_name:format==='Unknown'?'EGC':format,campaign_id:'c1',campaign_name:'TUC_008_CZSK_Sales_Promo',date,format,reason:format==='Unknown'?'no_approved_mapping':'current_adset_label',spend,purchases,revenue:purchases*100,impressions:spend*10});
const fixture={schema_version:1,classification_version:1,reconciled:true,generated_at:new Date().toISOString(),range:{since:'2026-03-01',until:'2026-09-20'},rows:[fact('a','2026-03-10','Banner',300,1),fact('b','2026-03-10','Video',100,3),fact('a','2026-09-15','Banner',90,4),fact('b','2026-09-15','Video',10,1),fact('carry','2026-09-16','Video',0,1),fact('unknown','2026-09-17','Unknown',0,2)]};
const real=process.env.PROMO_FORMAT_LIVE_FIXTURE ? JSON.parse(fs.readFileSync(process.env.PROMO_FORMAT_LIVE_FIXTURE,'utf8')) : null;
let payload=real||fixture, malformed=false;
function campaignRows() {
  const map=new Map();
  for(const f of payload.rows){const key=f.campaign_id+'|'+f.date;const r=map.get(key)||{id:f.campaign_id,name:f.campaign_name,date_start:f.date,date_stop:f.date,amount_spent:0,reach:0,impressions:0,'actions:omni_purchase':0,'action_values:omni_purchase':0};r.amount_spent+=f.spend;r.impressions+=f.impressions;r['actions:omni_purchase']+=f.purchases;r['action_values:omni_purchase']+=f.revenue;map.set(key,r);}
  return [...map.values()];
}
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname==='/api/glv-meta-ads/fb-data') { const type=u.searchParams.get('type');res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(type==='promo_formats'?(malformed?{rows:[]}:payload):{rows:type==='ads'?[]:campaignRows()})); }
 let file=path.join(root,u.pathname);if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');if(!file.startsWith(root)||!fs.existsSync(file)){res.writeHead(404).end();return;}
 res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const libs='/home/tom/.cache/hermes-browser-libs/root';
 const browser=await chromium.launch({executablePath:'/home/tom/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',headless:true,args:['--no-sandbox'],env:{...process.env,LD_LIBRARY_PATH:`${libs}/usr/lib/x86_64-linux-gnu:${libs}/usr/lib`,FONTCONFIG_PATH:`${libs}/etc/fonts`}});
 const errors=[],results=[];
 try {
  for(const width of [1440,1001,1000,800,721,720,390,320]){
   const page=await browser.newPage({viewport:{width,height:1100},reducedMotion:'reduce'});
   page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
   await page.route('https://api.frankfurter.dev/**',r=>r.fulfill({json:{rates:{USD:0.044}}}));
   await page.goto(`http://127.0.0.1:${server.address().port}/glv-meta-ads/`,{waitUntil:'networkidle'});
   await page.waitForFunction(()=>document.getElementById('loading').style.display==='none');
   assert.equal(await page.locator('#promo-format-section').count(),1,'native format section exists');
   await page.locator('[data-tab="czsk-promo"]').click();
   const expected=monthlyMix(payload.rows);
   assert.equal(await page.locator('#promo-format-table tbody tr').count(),expected.reduce((n,m)=>n+3+(m.formats.Unknown.ads?1:0),0));
   const state=await page.evaluate(()=>({labels:charts['promo-format-spend'].data.labels,spend:charts['promo-format-spend'].data.datasets.map(d=>({label:d.label,data:d.data})),purchases:charts['promo-format-purchases'].data.datasets.map(d=>({label:d.label,data:d.data})),overflow:document.documentElement.scrollWidth>innerWidth+1,instances:Object.keys(Chart.instances).length,sticky:getComputedStyle(document.querySelector('#promo-format-table thead th')).position}));
   assert.equal(state.overflow,false);assert.equal(state.sticky,'sticky');
   for(const d of state.spend)assert.deepEqual(d.data,expected.map(m=>m.formats[d.label].spendShare));
   for(const d of state.purchases)assert.deepEqual(d.data,expected.map(m=>m.formats[d.label].purchaseShare));
   assert.equal(await page.evaluate(()=>window.__formatXss),undefined);
   assert.equal(await page.locator('#promo-format-unknown img').count(),0);
   assert.match(await page.locator('#promo-format-status').textContent(),/Unknown/);
   const geometry=await page.locator('#promo-format-section .chart-card').evaluateAll(cards=>cards.map(c=>({x:c.getBoundingClientRect().x,y:c.getBoundingClientRect().y})));
   assert.equal(Math.abs(geometry[0].y-geometry[1].y)<2,width>1000);
   for(const theme of ['dark','light']){
    await page.evaluate(t=>{setTheme(t);for(const key of PROMO_FORMAT_CHART_KEYS){charts[key]?.stop();charts[key]?.update('none');}document.activeElement?.blur();},theme);
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('#promo-format-section details')).color===getComputedStyle(document.getElementById('promo-format-range')).color);
    assert.equal(await page.locator('#promo-format-table thead th').evaluateAll(cells=>cells.every(cell=>cell.scrollWidth<=cell.clientWidth)),true,'metric headers must not truncate');
    // Freeze Chart.js explicitly (CSS reduced-motion does not stop its canvas
    // animation). Hide fixed navigation only for this isolated section capture.
    await page.locator('#promo-format-section').screenshot({path:`${out}/${width}-${theme}.png`,style:'.sticky-header,.skip-link{visibility:hidden!important}'});
   }
   await page.evaluate(()=>{filterState[tabFilterKey('czsk-promo','group')]=new Set(['wl']);renderTab('czsk-promo');});
   assert.match(await page.locator('#promo-format-status').textContent(),/No Promo/);
   await page.evaluate(()=>{filterState[tabFilterKey('czsk-promo','group')]=null;renderTab('czsk-promo');});
   assert.equal(await page.evaluate(()=>Object.keys(Chart.instances).length),state.instances);
   if(!real){
    // Format-only archived/carryover campaign must be selectable even if the
    // older campaign endpoint omits it. Its current name wins over stale names.
    await page.evaluate(()=>{
      promoFormatPayload={...promoFormatPayload,rows:[...promoFormatPayload.rows,{...promoFormatPayload.rows[0],ad_id:'orphan',campaign_id:'orphan-campaign',campaign_name:'TUC_099_CZSK_Sales_Promo_Carryover',spend:0,purchases:1}]};
      buildAllFilters();
    });
    assert.equal(await page.locator('#filter-options-tab-czsk-promo-campaign input[value="orphan-campaign"]').count(),1);
    await page.evaluate(()=>{filterState[tabFilterKey('czsk-promo','campaign')]=new Set(['orphan-campaign']);renderTab('czsk-promo');});
    assert.equal(await page.locator('#promo-format-table tbody tr').count(),3);
    assert.equal(await page.evaluate(()=>promoFormatRows().length),1);
    await page.evaluate(()=>{filterState[tabFilterKey('czsk-promo','campaign')]=null;promoFormatPayload.rows=promoFormatPayload.rows.filter(r=>r.ad_id!=='orphan');buildAllFilters();renderTab('czsk-promo');});
    await page.evaluate(()=>setPromoActiveDaysOnly(true));
    assert.equal(await page.evaluate(()=>charts['promo-format-purchases'].data.datasets.find(d=>d.label==='Video').data[1]),20);
    await page.evaluate(()=>setPromoActiveDaysOnly(false));
    assert.equal(await page.evaluate(()=>charts['promo-format-purchases'].data.datasets.find(d=>d.label==='Unknown').data[1]),25);
    payload={...fixture,rows:[...fixture.rows,fact('next','2026-09-18','Video',100,2)]};
    await page.evaluate(()=>loadData());
    assert.ok(Math.abs(await page.evaluate(()=>charts['promo-format-spend'].data.datasets.find(d=>d.label==='Video').data[1])-55)<1e-10);
    payload=fixture;
   }
   malformed=true;await page.evaluate(()=>loadData());
   assert.match(await page.locator('#promo-format-status').textContent(),/unavailable/i);
   assert.equal(await page.locator('#promo-format-table tbody tr').count(),0);
   assert.equal(await page.evaluate(()=>Boolean(charts['promo-format-spend'])),false);
   malformed=false;await page.evaluate(()=>loadData());
   assert.equal(await page.evaluate(()=>Boolean(charts['promo-format-spend'])),true);
   const historyRequest=page.waitForRequest(request=>request.url().includes('/api/glv-meta-ads/fb-data?type=promo_formats'));
   await page.locator('.promo-format-history').click();
   const historyUrl=new URL((await historyRequest).url());
   const yesterday=new Date();yesterday.setUTCDate(yesterday.getUTCDate()-1);
   assert.deepEqual(JSON.parse(historyUrl.searchParams.get('time_range')),{since:'2026-03-01',until:yesterday.toISOString().slice(0,10)});
   await page.waitForFunction(()=>document.getElementById('loading').style.display==='none');
   for(const grain of ['week','month','day']){
    await page.evaluate(grain=>setTabGrain('czsk-promo',grain),grain);
    assert.equal(await page.evaluate(()=>charts['promo-format-spend'].data.labels.length),expected.length,'format view remains monthly');
   }
   results.push({width,pass:true,months:expected.length});await page.close();
  }
  assert.deepEqual(errors,[]);fs.writeFileSync(`${out}/results.json`,JSON.stringify({results,errors},null,2));console.log(JSON.stringify({results,errors,evidence:out}));
 } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
