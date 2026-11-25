'use strict';
// Offline actual-handler regression: no live credentials or network.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const {customEnvironment,request,range,now}=require('../tests/helpers/mad-custom-fixture.cjs');
const runtime=require('../lib/glv-mad-v2-isolated.cjs'),history=require('../lib/glv-history-v1.cjs');
const v1=require('../api/glv-meta-ads/fb-data.js'),v2=require('../api/glv-meta-ads-v2/fb-data.js');
const evidence=path.resolve(__dirname,'../.extract-browser');
async function run(){
 const checks=[],audit=[],errors=[],RealDate=Date;fs.mkdirSync(evidence,{recursive:true});
 global.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[now.toISOString()]));}static now(){return +now;}};
 try{await customEnvironment(async h=>{
  h.withAds=true;h.scale=Number(process.env.MAD_SCALE||1);
  for(const preset of ['last_7d','last_30d','last_90d']){
   const pieces={};for(const type of runtime.TYPES){const r=await request(v1,{type,date_preset:preset});assert.equal(r.code,200,JSON.stringify(r.body));pieces[type]=r.body;}
   await history.savePublished(async(k,p)=>h.store.set(k,JSON.stringify(p)),preset,pieces,async k=>JSON.parse(h.store.get(k)||'null'));
  }
  const seeded=await runtime.refresh({redis:h.redis,fetcher:h.fetcher,token:'test',now,presets:['last_7d','last_30d','last_90d'],includePromo:false});assert.equal(seeded.verified,true,JSON.stringify(seeded.errors));
  const custom=require('../lib/glv-mad-v2-isolated-custom.cjs');
  const partial=await runtime.refresh({redis:h.redis,fetcher:h.fetcher,token:'test',now,presets:[custom.slot(range)],ranges:{[custom.slot(range)]:range},includePromo:false,tokenFor:a=>{if(a.label==='TUC')throw Error('TUC unavailable');return 'test';}});
  assert.ok(partial.errors.length);const prior=await runtime.readPreset(h.redis,custom.slot(range));assert.equal(Object.keys(prior.daily.account_bundles).length,1);
  h.rejectAll=true;h.graph.length=0;h.calls.length=0;
  const pub=path.resolve(__dirname,'../public');
  const server=http.createServer(async(req,res)=>{try{
   const u=new URL(req.url,'http://localhost');
   if(u.pathname.startsWith('/api/')){
    if(process.env.HOLD_ADS&&u.searchParams.get('type')==='ads')await new Promise(r=>setTimeout(r,2500));
    const r=await request(u.pathname.includes('-v2/')?v2:v1,Object.fromEntries(u.searchParams));audit.push({version:u.pathname,type:u.searchParams.get('type'),custom:u.searchParams.has('time_range'),code:r.code,range:r.body.range,coverage:r.body.account_coverage});
    res.writeHead(r.code,{'content-type':'application/json'}).end(JSON.stringify(r.body));return;
   }
   let file=path.join(pub,decodeURIComponent(u.pathname));if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
   if(!file.startsWith(pub)||!fs.existsSync(file)){res.writeHead(404).end();return;}
   // QA-only fixture includes Leadgen creatives, so their deferred dropdowns
   // have an observable population in both versions; no response cache seeded.
   if(file.endsWith('index.html')){
    let html=fs.readFileSync(file,'utf8').replace('let includeLeadGen = false;','let includeLeadGen = true;');
    if(u.searchParams.has('qa_custom'))html=html.replace('let customRange = null;',`let customRange = ${JSON.stringify(range)};`);
    res.writeHead(200,{'content-type':'text/html'}).end(html);return;
   }
   res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
  }catch(e){errors.push(e.message);res.writeHead(500).end();}});
  let browser;
  try{
   await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
   browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/home/tom/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',headless:true,args:['--no-sandbox'],env:{...process.env,LD_LIBRARY_PATH:'/home/tom/.cache/hermes-browser-libs/root/usr/lib/x86_64-linux-gnu:/home/tom/.cache/hermes-browser-libs/root/usr/lib'}});
   for(const version of (process.env.MAD_QA_VERSION?[process.env.MAD_QA_VERSION]:['glv-meta-ads','glv-meta-ads-v2']))for(const width of [1440,390])for(const mode of ['transition']){
    const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));await page.clock.setFixedTime(now);
    await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin===base)return route.continue();if(u.hostname==='cdn.jsdelivr.net'){const name=u.pathname.includes('chart.js')?'chart.js':u.pathname.endsWith('.css')?'grid.css':'grid.js';return route.fulfill({path:'/home/tom/glv-creator-ghost-evidence/vendor/'+name,contentType:name.endsWith('.css')?'text/css':'text/javascript'});}if(u.hostname==='api.frankfurter.dev')return route.abort();return route.abort();});
    const initialStart=performance.now();await page.goto(base+'/'+version+'/?account=All&currency=CZK'+(mode==='transition'?'':'&qa_custom=1'));await page.waitForFunction(()=>document.querySelector('#loading').style.display==='none');
    if(process.env.HOLD_ADS)assert.ok(performance.now()-initialStart<2000,'campaigns must paint before delayed ads');
    await page.waitForFunction(()=>lastGoodSources?.[2]);
    const creativeOptions=await page.evaluate(()=>['czsk','us'].map(seg=>({expected:new Set(filterTabRows(seg,adCreatives).filter(c=>c.segment===seg&&(seg!=='czsk'||includeLeadGen||!isLeadGen(c.campaignName))).map(c=>c.campaignId)).size,actual:document.querySelectorAll('#filter-options-'+seg+'-creative input').length})));
    assert.ok(creativeOptions.some(o=>o.expected>0));assert.ok(creativeOptions.every(o=>o.actual===o.expected),'deferred detail must populate creative dropdowns');
    if(mode==='reload'){await page.reload();await page.waitForFunction(()=>document.querySelector('#loading').style.display==='none');}
    await page.evaluate(()=>{Chart.defaults.animation=false;for(const c of Object.values(Chart.instances))c.stop();});
    await page.locator('[data-tab="czsk-leadgen"]').click();
    await page.clock.setFixedTime(new Date(+now+6*60000));
    const dataRequests=[];page.on('request',r=>{if(r.url().includes('/api/')||r.url().includes('frankfurter'))dataRequests.push(r.url());});await page.evaluate(()=>{window.overlaySeen=false;new MutationObserver(()=>{if(document.querySelector('#loading').style.display!=='none')window.overlaySeen=true;}).observe(document.querySelector('#loading'),{attributes:true});});const start=performance.now();
    if(width===390)await page.locator('#mobile-controls-toggle').click();
    if(mode==='transition'){assert.equal(await page.locator('#date-btn-label').innerText(),'Last 30 days');await page.locator('#date-btn').click();await page.locator('#date-from').fill(range.since);await page.locator('#date-to').fill(range.until);await page.locator('.date-apply-btn').click();}
    await page.waitForFunction(()=>document.querySelector('#loading').style.display==='none'&&document.querySelector('#date-btn-range').textContent.includes('19'));
    assert.equal(await page.locator('#panel-czsk-leadgen').isVisible(),true);
    await page.evaluate(()=>document.fonts.ready);
    await page.waitForFunction(()=>{const canvases=[...document.querySelectorAll('#panel-czsk-leadgen canvas')].filter(c=>c.getBoundingClientRect().width>0);return canvases.length>0&&canvases.every(c=>c.width>0&&c.height>0);});
    await page.evaluate(()=>{for(const c of Object.values(Chart.instances)){c.options.animation=false;c.update('none');}});
    const elapsed=performance.now()-start;checks.push({version,width,requests:dataRequests.length,elapsed,overlay:await page.evaluate(()=>window.overlaySeen)});
    const state=await page.evaluate(()=>({aggregate:getLeadgenRows('aggregate'),frequency:calcMetrics(aggregate(getLeadgenRows('aggregate'))).frequency,frequencyLabel:formatChartVal('frequency',calcMetrics(aggregate(getLeadgenRows('aggregate'))).frequency),creatives:adCreatives,table:document.querySelector('#leadgen-table').innerText,rows:getLeadgenRows('daily'),warning:document.querySelector('#error').innerText,canvas:[...document.querySelectorAll('#panel-czsk-leadgen canvas')].filter(c=>c.getBoundingClientRect().width>0).map(c=>({width:c.width,height:c.height}))}));
    assert.equal(state.rows.length,6*h.scale,JSON.stringify(state));assert.equal(state.aggregate[0].reach,null);assert.equal(state.frequency,null);assert.equal(state.frequencyLabel,'—');assert.match(state.warning,/Daily-derived/);
    if(version.endsWith('-v2')&&h.scale<40){assert.ok(state.creatives.some(r=>r.segment==='czsk'&&r.spend===24));assert.ok(state.creatives.some(r=>r.segment==='us'),'daily creatives retain both accounts');}else{assert.equal(state.creatives.length,0);assert.match(state.warning,/Creative source unavailable/);}assert.equal(state.rows.reduce((s,r)=>s+r.leads,0),12*h.scale);assert.ok(state.table.includes('Lead-gen'));assert.ok(state.canvas.length>0&&state.canvas.every(c=>c.width>0&&c.height>0));
    const plotted=await page.evaluate(()=>Chart.getChart(document.getElementById('chart-leadgen-metric')).data.datasets.flatMap(d=>d.data).filter(n=>typeof n==='number'));
    assert.ok(plotted.length>0&&plotted.some(n=>n>0),'Lead-gen chart must contain observed nonzero facts');
    const orangePixels=await page.evaluate(()=>{const c=document.getElementById('chart-leadgen-metric'),p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let count=0;for(let i=0;i<p.length;i+=4)if(p[i]>170&&p[i+1]>50&&p[i+1]<180&&p[i+2]<100&&p[i+3]>100)count++;return count;});
    assert.ok(orangePixels>20,'Lead-gen observations must actually be painted, not just present in Chart data');
    if(version.endsWith('-v2')){assert.ok(!state.warning.includes('TUC: missing'));assert.match(state.warning,/TGLV|partial|not refreshed/i);}
    await page.evaluate(()=>{filterState['us-creative']=new Set();});
    const outside={since:'2026-10-20',until:'2026-10-24'};
    for(const [label,selected,zero] of [['exact',{since:'2026-10-26',until:'2026-11-24'},true],['warm',range,true],['outside',outside,false],['back',range,true],['outside-reuse',outside,true]]){
      const before=dataRequests.length;
      const ms=await page.evaluate(async selected=>{const start=performance.now();customRange=selected;await loadData();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return performance.now()-start;},selected);
      if(!zero)await page.waitForFunction(()=>lastGoodSources?.[2]||document.querySelector('#error').textContent.includes('Creative source unavailable'));
      const requests=dataRequests.length-before;
      assert.equal(await page.evaluate(()=>filterState['us-creative'].size),0,'explicit None survives');
      if(zero)assert.equal(requests,0,label+' must not request data '+JSON.stringify(await page.evaluate(()=>browserExtract.stats())));else assert.ok(requests>0);
      const observed=await page.evaluate(()=>({rows:getLeadgenRows('daily').length,reach:getLeadgenRows('aggregate')[0].reach,leads:getLeadgenRows('daily').reduce((s,r)=>s+r.leads,0)}));
      assert.equal(observed.rows,(label==='exact'?30:label.startsWith('outside')?5:6)*h.scale);
      if(label==='exact')assert.equal(observed.reach,123);else assert.equal(observed.reach,null);
      checks.push({version,width,label,requests,filterToPaintMs:ms,observed});
    }
    await page.screenshot({path:path.join(evidence,version+'-'+mode+'.png'),fullPage:true});checks.push({version,mode,width,rows:state.rows.length,leads:12*h.scale,spend:state.aggregate.reduce((s,r)=>s+r.spend,0),reach:state.aggregate[0].reach,frequency:state.frequency,creativeRows:state.creatives.length,warning:state.warning});await page.close();
   }
   assert.equal(checks.filter(c=>(c.requests>0&&c.label!=='outside')||c.overlay).length,0,JSON.stringify(checks.filter(c=>c.requests!==undefined)));
   assert.deepEqual(errors,[]);assert.equal(h.graph.length,0);assert.equal(h.blocked||0,0);assert.equal(h.calls.filter(c=>['SET','EVAL','DEL'].includes(c[0])).length,0);
  }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
 });}finally{global.Date=RealDate;fs.writeFileSync(path.join(evidence,'results.json'),JSON.stringify({synthetic:true,checks,audit,errors},null,2));}
 console.log(JSON.stringify({passed:true,checks,evidence}));
}
run().catch(e=>{console.error(e);process.exitCode=1;});
