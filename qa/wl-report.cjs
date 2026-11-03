// Synthetic browser fixture only; not the historical Notion report metrics.
const {chromium}=require('playwright-core');const http=require('node:http');const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../public');const evidence='/tmp/glv-wl-report-qa';fs.mkdirSync(evidence,{recursive:true});
const ad=(id,campaign,name,spend=20,revenue=80)=>({id,campaign_id:campaign,campaign_name:campaign,name,amount_spent:String(spend),'action_values:omni_purchase':String(revenue),'actions:omni_purchase':'2'});
const rows=[ad('a','GLV_1_CZ_WL_ActionKate','PAC462 V2'),ad('b','GLV_1_CZ_WL_ActionKate','PAC460 V1',30,20),ad('c','GLV_2_US_WL_ActionKate','PAC460 V1',10,0),ad('d','WL_befit_over40','PAC470 V1'),ad('e','GLV_3_CZ_WL_Kristyna','PAC419 V1'),ad('z','GLV_3_CZ_WL_Kristyna','zero spend',0,40)];
let fail=false;let calls=[];
const app=http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost');if(url.pathname.startsWith('/api/')){
 if(url.searchParams.get('wl')==='1'){
  calls.push(Object.fromEntries(url.searchParams));const range=url.searchParams.has('time_range')?JSON.parse(url.searchParams.get('time_range')):require('../public/glv-meta-ads/wl-report.js').lastMonth();
  if(fail)return res.writeHead(503).end('{}');
  const payload={rows,range,wl_version:2,generated_at:new Date().toISOString()};
  return setTimeout(()=>res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(payload)),range.since==='2026-08-01'?500:0);
 }
 return res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({rows:[]}));
}let f=path.join(root,url.pathname);if(fs.existsSync(f)&&fs.statSync(f).isDirectory())f=path.join(f,'index.html');if(!fs.existsSync(f))return res.writeHead(404).end();res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(f)]||'application/octet-stream');fs.createReadStream(f).pipe(res);});
(async()=>{await new Promise(r=>app.listen(0,'127.0.0.1',r));const libs='/home/tom/.cache/hermes-browser-libs/root';const browser=await chromium.launch({executablePath:'/home/tom/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',headless:true,args:['--no-sandbox'],env:{...process.env,LD_LIBRARY_PATH:`${libs}/usr/lib/x86_64-linux-gnu:${libs}/usr/lib`,FONTCONFIG_PATH:`${libs}/etc/fonts`}});const errors=[];const results=[];
try{for(const width of [1440,390,320])for(const theme of ['dark','light']){
 const page=await browser.newPage({viewport:{width,height:950},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));await page.route('https://api.frankfurter.dev/**',r=>r.fulfill({json:{rates:{USD:.04}}}));
 await page.goto(`http://127.0.0.1:${app.address().port}/glv-meta-ads/`,{waitUntil:'networkidle'});
 assert.equal(await page.locator('#tab-wl').count(),1,'new WL tab exists');await page.evaluate(t=>setTheme(t),theme);await page.locator('#tab-wl').click();
 await page.locator('#wl-overview table').waitFor();
 assert.equal(await page.locator('#wl-date').inputValue(),'last_month');assert.equal(await page.locator('#date-wrap').isVisible(),false);
 assert.equal(await page.locator('#panel-wl table').count(),5);
 assert.deepEqual(await page.locator('#wl-overview tbody tr').evaluateAll(rs=>rs.map(r=>r.cells[0].textContent)),['ActionKate','Kristyna','befit_over40','Total']);
 const total=await page.locator('#wl-overview tbody tr').last().innerText();assert.match(total,/100\.00/);assert.match(total,/80\.00/);assert.match(total,/300\.00/);
 assert.equal(await page.locator('#panel-wl svg').count(),0);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 for(const id of ['campaign','market','creator']){await page.locator('#wl-'+id).selectOption('__none');assert.match(await page.locator('#wl-results').innerText(),/No WL ads/);await page.locator('#wl-'+id).selectOption('__all');}
 await page.locator('#wl-market').selectOption('US');assert.equal(await page.locator('#wl-market-table tbody tr').count(),1);assert.match(await page.locator('#wl-overview tbody').innerText(),/10\.00/);await page.locator('#wl-market').selectOption('__all');
 const globalBefore=await page.evaluate(()=>JSON.stringify(requestScope()));
 await page.locator('#wl-date').selectOption('custom');await page.locator('#wl-from').fill('2026-09-01');await page.locator('#wl-to').fill('2026-09-30');await page.locator('#wl-apply').click();await page.waitForFunction(()=>document.querySelector('#wl-status').textContent.includes('2026-09-01'));
 assert.equal(await page.evaluate(()=>JSON.stringify(requestScope())),globalBefore);
 // Real UI race: slow older scope must not replace the later one.
 await page.locator('#wl-from').fill('2026-08-01');await page.locator('#wl-to').fill('2026-08-31');await page.locator('#wl-apply').click();await page.locator('#wl-from').fill('2026-09-01');await page.locator('#wl-to').fill('2026-09-30');await page.locator('#wl-apply').click();await page.waitForTimeout(650);assert.match(await page.locator('#wl-status').innerText(),/2026-09-01/);
 fail=true;await page.locator('#wl-reload').click();await page.locator('#wl-retry').waitFor();assert.equal(await page.locator('#wl-results table').count(),0);fail=false;await page.locator('#wl-retry').click();await page.locator('#wl-overview table').waitFor();
 await page.locator('#tab-czsk').click();assert.equal(await page.locator('#date-wrap').isHidden(),width<=720);await page.locator('#tab-wl').click();assert.equal(await page.locator('#wl-date').inputValue(),'custom');
 await page.locator('#wl-date').selectOption('last_month');await page.waitForFunction(()=>document.querySelector('#wl-status').textContent.includes('Source refreshed'));
 const geometry=await page.locator('#wl-overview .wl-scroll').evaluate(scroller=>{const first=scroller.querySelector('tbody th'),head=scroller.querySelector('thead th');const before=first.getBoundingClientRect().left;scroller.scrollLeft=300;const after=first.getBoundingClientRect().left;const result={client:scroller.clientWidth,scroll:scroller.scrollWidth,pinned:Math.abs(before-after)<1,header:getComputedStyle(head).position};scroller.scrollLeft=0;return result;});
 assert.equal(geometry.pinned,true);assert.equal(geometry.header,'sticky');if(width<=390)assert.ok(geometry.scroll>geometry.client);
 const tabs=await page.locator('.tab-btn').evaluateAll(bs=>bs.map(b=>({width:b.getBoundingClientRect().width,height:b.getBoundingClientRect().height})));if(width<=720)assert.ok(tabs.every(b=>b.width>=44&&b.height>=44),JSON.stringify(tabs));
 await page.screenshot({path:path.join(evidence,`${width}-${theme}.png`),fullPage:true});
 // All rows, source escaping and ambiguity in the actual DOM, not snapshots.
 const original=rows.length;rows.push(ad('hostile','GLV_9_CZ_WL_Unknown_"><svg onload=window.__wlXss=1></svg>','<img src=x onerror=window.__wlXss=1>'),...Array.from({length:75},(_,i)=>ad('extra'+i,'GLV_3_CZ_WL_Kristyna','asset '+i)));
 await page.locator('#wl-reload').click();await page.locator('#wl-warning').waitFor({state:'visible'});
 assert.equal(await page.locator('#wl-creative-Kristyna tbody tr').count(),77);assert.equal(await page.locator('#panel-wl svg,#panel-wl img').count(),0);assert.equal(await page.evaluate(()=>window.__wlXss),undefined);assert.match(await page.locator('#wl-warning').innerText(),/Unresolved creator/);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:path.join(evidence,`${width}-${theme}-unresolved.png`),fullPage:true});rows.length=original;
 results.push({width,theme,passed:true,geometry});await page.close();
}assert.deepEqual(errors,[]);fs.writeFileSync(path.join(evidence,'results.json'),JSON.stringify({synthetic:true,results,errors,requests:calls.length},null,2));console.log(JSON.stringify({evidence,results,errors}));}finally{await browser.close();app.close();}})().catch(e=>{console.error(e);process.exitCode=1;app.close();});
