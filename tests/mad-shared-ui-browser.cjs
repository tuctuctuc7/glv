'use strict';
// Offline actual production consumers; independent presentation/ownership checks.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const fixture=require('../qa/mad-full-parity.cjs');
const {selectScope}=require('../qa/mad-browser-conditions.cjs');
const root=path.join(__dirname,'../public'),evidence=process.env.MAD_UI_EVIDENCE||'/home/tom/.hermes/cache/scratch/mad-shared-ui-browser';
const tabs=['czsk','czsk-triage','czsk-promo','czsk-promo-creative','czsk-leadgen','us','wl'];
const report={synthetic:true,liveCalls:false,cases:[],errors:[],failures:[]};
async function main(){
 fs.mkdirSync(evidence,{recursive:true});
 const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/')){try{return res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(fixture.payload(u.searchParams,u.pathname.includes('-v2/'))));}catch(e){return res.writeHead(500).end(JSON.stringify({error:e.message}));}}let f=path.join(root,u.pathname);if(fs.existsSync(f)&&fs.statSync(f).isDirectory())f=path.join(f,'index.html');if(!f.startsWith(root)||!fs.existsSync(f))return res.writeHead(404).end();res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(res);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:'/home/tom/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',headless:true,args:['--no-sandbox'],env:{...process.env,LD_LIBRARY_PATH:'/home/tom/.cache/hermes-browser-libs/root/usr/lib/x86_64-linux-gnu:/home/tom/.cache/hermes-browser-libs/root/usr/lib'}});
 try{
 for(const scope of [{version:'glv-meta-ads',account:'TUC',currency:'CZK'},{version:'glv-meta-ads-v2',account:'TUC',currency:'CZK'},{version:'glv-meta-ads-v2',account:'All',currency:'CZK'},{version:'glv-meta-ads-v2',account:'All',currency:'USD'}]){
 const p=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});p.on('pageerror',e=>report.errors.push(e.message));await p.clock.setFixedTime(new Date('2026-11-11T12:00:00Z'));await p.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===base)return r.continue();if(u.hostname==='cdn.jsdelivr.net'){const n=u.pathname.includes('chart.js')?'chart.js':u.pathname.endsWith('.css')?'grid.css':'grid.js';return r.fulfill({path:'/home/tom/glv-creator-ghost-evidence/vendor/'+n,contentType:n.endsWith('.css')?'text/css':'text/javascript'});}if(u.hostname==='api.frankfurter.dev')return r.fulfill({json:{rates:{USD:.04}}});return r.abort();});await p.goto(`${base}/${scope.version}/?account=${scope.account}&currency=${scope.currency}`,{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>document.querySelector('#loading').style.display==='none');
 // Test the actual normalizers, not just an ownership helper. Wrong-prefix facts must survive.
 const owned=await p.evaluate(()=>{const row={id:'wrong',account_id:'359758259164738',name:'OTHER_099_US_BAU',market:'US',date_start:'2026-11-10',date_stop:'2026-11-10',amount_spent:37,impressions:370,reach:100};return {aggregate:processAggregateRows([row]).map(x=>[x.spend,x.segment]),daily:processDaily([row]).map(x=>[x.spend,x.segment])};});assert.deepEqual(owned,{aggregate:[[37,'us']],daily:[[37,'us']]});
 for(const width of [1440,390])for(const theme of ['dark','light']){
 await p.setViewportSize({width,height:1000});await p.evaluate(t=>setTheme(t),theme);
 for(const tab of tabs){await p.locator('[data-tab="'+tab+'"]').click();if(tab==='wl')await p.waitForFunction(()=>!document.querySelector('#wl-status')?.textContent.startsWith('Loading'));await p.waitForTimeout(250);
 const state=await p.evaluate(tab=>{const panel=document.getElementById('panel-'+tab);const visible=e=>!!e.getClientRects().length;return {visible:visible(panel),overflow:document.documentElement.scrollWidth>innerWidth+1,invalid:/\b(?:NaN|Infinity)\b/.test(panel.innerText),legends:[...panel.querySelectorAll('canvas')].map(c=>Chart.getChart(c)).filter(c=>c&&c.options.plugins.legend.display!==false).map(c=>[c.options.plugins.legend.position,c.options.plugins.legend.align]),controls:[...document.querySelectorAll('#v2-account,#v2-currency,#theme-toggle,#mobile-controls-toggle')].filter(visible).map(e=>{const r=e.getBoundingClientRect();return{id:e.id,inside:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight};})};},tab);
 const c={...scope,width,theme,tab,...state};report.cases.push(c);if(!state.visible||state.overflow||state.invalid||state.legends.some(x=>x[0]!=='bottom'||x[1]!=='start')||state.controls.some(x=>!x.inside))report.failures.push(c);
 if(tab==='czsk')await p.screenshot({path:path.join(evidence,`${scope.version}-${scope.account}-${scope.currency}-${width}-${theme}.png`),fullPage:false});
 }
 // Actual mobile filter disclosure must remain reachable after adding scope controls.
 if(width===390){await p.locator('[data-tab="czsk"]').click();await p.locator('#mobile-controls-toggle').click();assert.equal(await p.locator('#date-btn').isVisible(),true);await p.locator('#mobile-controls-toggle').click();}
 }
 if(scope.version==='glv-meta-ads-v2'){
 await p.locator('[data-tab="czsk"]').click();await p.evaluate(()=>{if(sortState.daily.czsk.dir!=='asc')toggleSortDir('daily','czsk');});
 await selectScope(p,'v2-currency',scope.currency==='CZK'?'USD':'CZK');
 const restored=await p.evaluate(()=>({dir:sortState.daily.czsk.dir,arrow:document.getElementById('daily-sort-dir-czsk').textContent}));assert.deepEqual(restored,{dir:'asc',arrow:'↑'});
 }
 await p.close();
 }
 }catch(e){report.failures.push({error:e.stack});}finally{await browser.close();await new Promise(r=>server.close(r));fs.writeFileSync(path.join(evidence,'results.json'),JSON.stringify(report,null,2));}
 console.log(JSON.stringify({evidence,cases:report.cases.length,failures:report.failures.length,pageErrors:report.errors.length}));if(report.failures.length||report.errors.length)process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
