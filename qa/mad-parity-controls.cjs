'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright-core');
const {payload}=require('./mad-full-parity.cjs');
async function run(){
 const pub=path.resolve(__dirname,'../public'),errors=[];
 const app=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/')){try{return res.setHeader('content-type','application/json'),res.end(JSON.stringify(payload(u.searchParams,true)));}catch(e){return res.writeHead(500).end(e.message);}}let f=path.join(pub,u.pathname);if(fs.existsSync(f)&&fs.statSync(f).isDirectory())f=path.join(f,'index.html');if(!fs.existsSync(f))return res.writeHead(404).end();res.setHeader('content-type',f.endsWith('.html')?'text/html':f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':'application/octet-stream');fs.createReadStream(f).pipe(res);});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.address().port;
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/home/tom/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',headless:true,args:['--no-sandbox'],env:{...process.env,LD_LIBRARY_PATH:'/home/tom/.cache/hermes-browser-libs/root/usr/lib/x86_64-linux-gnu:/home/tom/.cache/hermes-browser-libs/root/usr/lib'}});
 try{const p=await browser.newPage({viewport:{width:1440,height:1000}});p.on('pageerror',e=>errors.push(e.message));await p.clock.install({time:new Date('2026-11-11T12:00:00Z')});await p.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin===base)return route.continue();if(u.hostname==='cdn.jsdelivr.net'){const name=u.pathname.includes('chart.js')?'chart.js':u.pathname.endsWith('.css')?'grid.css':'grid.js';return route.fulfill({path:'/home/tom/glv-creator-ghost-evidence/vendor/'+name,contentType:name.endsWith('.css')?'text/css':'text/javascript'});}return route.abort();});
 const ready=()=>p.waitForFunction(()=>document.querySelector('#loading')?.style.display==='none');
 const tab=t=>p.locator('[data-tab="'+t+'"]').click();
 await p.goto(base+'/glv-meta-ads-v2/?account=TUC&currency=CZK');await ready();
 await p.locator('#date-btn').click();await p.locator('#date-from').fill('2026-10-05');await p.locator('#date-to').fill('2026-10-10');await p.locator('.date-apply-btn').click();await ready();
 await p.locator('#tab-grain-czsk').selectOption('month');await p.locator('#include-leadgen').check();
 await p.locator('#filter-toggle-tab-czsk-campaign').click();await p.locator('#filter-dropdown-tab-czsk-campaign').getByText('None',{exact:true}).click();
 await tab('czsk-triage');await p.locator('#triage-market').selectOption('us');await p.locator('#triage-grain').selectOption('week');
 await tab('czsk-promo');await p.locator('#wl-influencer-breakdown').check();
 await tab('wl');await p.waitForSelector('#wl-overview');await p.locator('#wl-date').selectOption('custom');await p.locator('#wl-from').fill('2026-09-01');await p.locator('#wl-to').fill('2026-09-10');await p.locator('#wl-apply').click();await p.waitForFunction(()=>document.querySelector('#wl-status').textContent.startsWith('2026-09-01'));
 await p.locator('#wl-creator').selectOption('Kristyna');await p.locator('#wl-market').selectOption('CZSK');
 // Exercise every select-backed tab-local metric, sort, grain, and mode via actual DOM events.
 for(const t of ['czsk','us','czsk-triage','czsk-promo','czsk-leadgen','czsk-promo-creative']){
  await tab(t);
  const choices=await p.locator('#panel-'+t+' select').evaluateAll(es=>es.map(e=>({id:e.id,value:[...e.options].find(o=>!o.disabled&&o.value!==e.value)?.value})));
  for(const c of choices)if(c.value!==undefined&&await p.locator('#'+c.id).isVisible())await p.locator('#'+c.id).selectOption(c.value);
 }
 await tab('czsk-promo');await p.locator('#promo-mode-days').click();await p.locator('#promo-active-days-only').check();
 await tab('czsk-leadgen');await p.locator('#leadgen-mode-days').click();await p.locator('#leadgen-only').check();
 await tab('czsk-promo-creative');await p.locator('#promo-concept-section [data-sort="revenue"]').click();
 await tab('wl');
 const complete=()=>p.evaluate(()=>JSON.parse(v2Encode(snapshotV2Controls())));
 const completeBefore=await complete();
 const money=async()=>Number((await p.locator('#wl-overview .wl-total td').first().textContent()).replace(/,/g,''));
 const czk=await money();
 for(const value of ['USD','CZK']){await p.locator('#v2-currency').selectOption(value);await ready();await p.waitForSelector('#wl-overview');assert.deepEqual(await complete(),completeBefore,'all tab-local state survives '+value);assert.equal(await money(),value==='USD'?czk/25:czk,'only monetary conversion changes');assert.equal(await p.locator('#promo-active-days-only').isChecked(),true);assert.equal(await p.locator('#leadgen-only').isChecked(),true);assert.match(await p.locator('#promo-mode-days').getAttribute('class'),/active/);assert.match(await p.locator('#leadgen-mode-days').getAttribute('class'),/active/);}
 const snapshot=()=>p.evaluate(()=>({wl:Object.fromEntries(['date','from','to','creator','market','campaign'].map(k=>[k,document.getElementById('wl-'+k).value])),grain:tabGrain.czsk,includeLeadGen,wlInfluencerBreakdown,triageMarket,triageState,none:filterState['tab-czsk-campaign']==null?null:[...filterState['tab-czsk-campaign']],tab:document.querySelector('.tab-btn.active').dataset.tab}));
 const before=await snapshot();
 for(const [id,value] of [['v2-currency','USD'],['v2-currency','CZK'],['v2-account','All'],['v2-account','TGLV'],['v2-account','TUC']]){await p.locator('#'+id).selectOption(value);await ready();await p.waitForSelector('#wl-overview');assert.deepEqual(await snapshot(),before,id+' '+value+' retains independent controls');}
 await p.locator('#wl-campaign').selectOption('359758259164738:3');
 await p.locator('#v2-account').selectOption('TGLV');await ready();await p.waitForSelector('#wl-overview');assert.equal(await p.locator('#wl-campaign').inputValue(),'__none');
 await p.locator('#v2-account').selectOption('All');await ready();await p.waitForSelector('#wl-overview');assert.equal(await p.locator('#wl-campaign').inputValue(),'__none');
 assert.deepEqual(errors,[]);console.log('PASS 9 real reload transitions: all tab selects/sorts/grains/modes, independent custom dates, filters, None, toggles, ID reconciliation and monetary conversion');return {transitions:9,errors};
 }finally{await browser.close();await new Promise(r=>app.close(r));}
}
module.exports={run};if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
