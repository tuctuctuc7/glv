'use strict';
// Offline actual-handler regression: no live credentials or network.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const {customEnvironment,request,range,now}=require('../tests/helpers/mad-custom-fixture.cjs');
const runtime=require('../lib/glv-mad-v2-isolated.cjs'),history=require('../lib/glv-history-v1.cjs');
const v1=require('../api/glv-meta-ads/fb-data.js'),v2=require('../api/glv-meta-ads-v2/fb-data.js');
const evidence=path.resolve(__dirname,'../.custom-range-browser');
async function run(){
 const checks=[],audit=[],errors=[],RealDate=Date;fs.mkdirSync(evidence,{recursive:true});
 global.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[now.toISOString()]));}static now(){return +now;}};
 try{await customEnvironment(async h=>{
  for(const preset of ['last_7d','last_30d']){
   const pieces={};for(const type of runtime.TYPES){const r=await request(v1,{type,date_preset:preset});assert.equal(r.code,200);pieces[type]=r.body;}
   await history.savePublished(async(k,p)=>h.store.set(k,JSON.stringify(p)),preset,pieces,async k=>JSON.parse(h.store.get(k)||'null'));
  }
  const seeded=await runtime.refresh({redis:h.redis,fetcher:h.fetcher,token:'test',now,presets:['last_7d','last_30d'],includePromo:false});assert.equal(seeded.verified,true,JSON.stringify(seeded.errors));
  h.rejectDaily=true;h.graph.length=0;
  const pub=path.resolve(__dirname,'../public');
  const server=http.createServer(async(req,res)=>{try{
   const u=new URL(req.url,'http://localhost');
   if(u.pathname.startsWith('/api/')){
    const r=await request(u.pathname.includes('-v2/')?v2:v1,Object.fromEntries(u.searchParams));audit.push({version:u.pathname,type:u.searchParams.get('type'),custom:u.searchParams.has('time_range'),code:r.code,range:r.body.range,coverage:r.body.account_coverage});
    res.writeHead(r.code,{'content-type':'application/json'}).end(JSON.stringify(r.body));return;
   }
   let file=path.join(pub,decodeURIComponent(u.pathname));if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
   if(!file.startsWith(pub)||!fs.existsSync(file)){res.writeHead(404).end();return;}
   res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
  }catch(e){errors.push(e.message);res.writeHead(500).end();}});
  let browser;
  try{
   await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
   browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/home/tom/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',headless:true,args:['--no-sandbox'],env:{...process.env,LD_LIBRARY_PATH:'/home/tom/.cache/hermes-browser-libs/root/usr/lib/x86_64-linux-gnu:/home/tom/.cache/hermes-browser-libs/root/usr/lib'}});
   for(const version of ['glv-meta-ads','glv-meta-ads-v2']){
    const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));await page.clock.setFixedTime(now);
    await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin===base)return route.continue();if(u.hostname==='cdn.jsdelivr.net'){const name=u.pathname.includes('chart.js')?'chart.js':u.pathname.endsWith('.css')?'grid.css':'grid.js';return route.fulfill({path:'/home/tom/glv-creator-ghost-evidence/vendor/'+name,contentType:name.endsWith('.css')?'text/css':'text/javascript'});}if(u.hostname==='api.frankfurter.dev')return route.fulfill({json:{rates:{USD:.04}}});return route.abort();});
    await page.goto(base+'/'+version+'/?account=All&currency=CZK');await page.waitForFunction(()=>document.querySelector('#loading').style.display==='none');
    await page.evaluate(()=>{Chart.defaults.animation=false;for(const c of Object.values(Chart.instances))c.stop();});
    await page.locator('[data-tab="czsk-leadgen"]').click();
    await page.locator('#date-btn').click();await page.locator('#date-from').fill(range.since);await page.locator('#date-to').fill(range.until);await page.locator('.date-apply-btn').click();
    await page.waitForFunction(()=>document.querySelector('#loading').style.display==='none'&&document.querySelector('#date-btn-range').textContent.includes('19'));
    assert.equal(await page.locator('#panel-czsk-leadgen').isVisible(),true);
    await page.evaluate(()=>document.fonts.ready);
    await page.waitForFunction(()=>{const canvases=[...document.querySelectorAll('#panel-czsk-leadgen canvas')].filter(c=>c.getBoundingClientRect().width>0);return canvases.length>0&&canvases.every(c=>c.width>0&&c.height>0);});
    await page.evaluate(()=>{for(const c of Object.values(Chart.instances)){c.options.animation=false;c.update('none');}});
    const state=await page.evaluate(()=>({table:document.querySelector('#leadgen-table').innerText,rows:getLeadgenRows('daily'),warning:document.querySelector('#error').innerText,canvas:[...document.querySelectorAll('#panel-czsk-leadgen canvas')].filter(c=>c.getBoundingClientRect().width>0).map(c=>({width:c.width,height:c.height}))}));
    assert.equal(state.rows.length,6,JSON.stringify(state));assert.equal(state.rows.reduce((s,r)=>s+r.leads,0),12);assert.ok(state.table.includes('Lead-gen'));assert.ok(state.canvas.length>0&&state.canvas.every(c=>c.width>0&&c.height>0));
    const plotted=await page.evaluate(()=>Chart.getChart(document.getElementById('chart-leadgen-metric')).data.datasets.flatMap(d=>d.data).filter(n=>typeof n==='number'));
    assert.ok(plotted.length>0&&plotted.some(n=>n>0),'Lead-gen chart must contain observed nonzero facts');
    const orangePixels=await page.evaluate(()=>{const c=document.getElementById('chart-leadgen-metric'),p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let count=0;for(let i=0;i<p.length;i+=4)if(p[i]>170&&p[i+1]>50&&p[i+1]<180&&p[i+2]<100&&p[i+3]>100)count++;return count;});
    assert.ok(orangePixels>20,'Lead-gen observations must actually be painted, not just present in Chart data');
    if(version.endsWith('-v2')){assert.ok(!state.warning.includes('TUC: missing'));assert.match(state.warning,/TGLV|partial|not refreshed/i);}
    await page.screenshot({path:path.join(evidence,version+'.png'),fullPage:true});checks.push({version,rows:state.rows.length,leads:12,warning:state.warning});await page.close();
   }
   assert.deepEqual(errors,[]);assert.equal(h.graph.filter(g=>g.daily).length,0);assert.equal(audit.filter(a=>a.custom&&['aggregate','daily','ads'].includes(a.type)&&a.code===200).length,6);
  }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
 });}finally{global.Date=RealDate;fs.writeFileSync(path.join(evidence,'results.json'),JSON.stringify({synthetic:true,checks,audit,errors},null,2));}
 console.log(JSON.stringify({passed:true,checks,evidence}));
}
run().catch(e=>{console.error(e);process.exitCode=1;});
