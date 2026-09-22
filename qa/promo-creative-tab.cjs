const { chromium } = require('playwright-core');
const http=require('node:http'), fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const { monthlyMix }=require('../public/glv-meta-ads/promo-format.js');
const root=path.resolve(__dirname,'../public');
const out=process.env.PROMO_FORMAT_QA_DIR||'/tmp/glv-promo-creative-browser';fs.mkdirSync(out,{recursive:true});
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
 const errors=[],results=[];let sectionCases=0;
 try {
  for(const width of [1440,1001,1000,800,721,720,390,320]){
   const page=await browser.newPage({viewport:{width,height:1100},reducedMotion:'reduce',hasTouch:width<=720});
   page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
   await page.route('https://api.frankfurter.dev/**',r=>r.fulfill({json:{rates:{USD:0.044}}}));
   await page.goto(`http://127.0.0.1:${server.address().port}/glv-meta-ads/`,{waitUntil:'networkidle'});
   await page.waitForFunction(()=>document.getElementById('loading').style.display==='none');
   assert.equal(await page.locator('#promo-format-section').count(),1,'native format section exists');
   assert.deepEqual(await page.evaluate(()=>({datePreset,customRange})),{datePreset:'last_30d',customRange:null});
   assert.equal(await page.locator('#panel-czsk-promo #promo-format-section').count(),0);
   assert.equal(await page.locator('.tab-btn').count(),6);
   await page.locator('[data-tab="czsk-promo-creative"]').click();
   const expected=monthlyMix(payload.rows);
   assert.equal(await page.locator('#promo-format-table tbody tr').count(),expected.reduce((n,m)=>n+3+(m.formats.Unknown.ads?1:0),0));
   const state=await page.evaluate(()=>({labels:charts['promo-format-spend'].data.labels,spend:charts['promo-format-spend'].data.datasets.map(d=>({label:d.label,data:d.data})),purchases:charts['promo-format-purchases'].data.datasets.map(d=>({label:d.label,data:d.data})),overflow:document.documentElement.scrollWidth>innerWidth+1,instances:Object.keys(Chart.instances).length,sticky:getComputedStyle(document.querySelector('#promo-format-table thead th')).position}));
   assert.equal(state.overflow,false);assert.equal(state.sticky,'sticky');
   for(const d of state.spend)assert.deepEqual(d.data,expected.map(m=>m.formats[d.label].spendShare));
   for(const d of state.purchases)assert.deepEqual(d.data,expected.map(m=>m.formats[d.label].purchaseShare));
   const table=await page.locator('#promo-format-table tbody tr').evaluateAll(rows=>rows.map(row=>[...row.cells].map(cell=>cell.textContent.trim())));
   let rowIndex=0;
   const pct=n=>n===null?'—':n.toFixed(1)+'%';
   for(const month of expected){
    const entries=[['Total',month.total],...Object.entries(month.formats).filter(([name,data])=>name!=='Unknown'||data.ads)];
    for(const [format,data] of entries){const row=table[rowIndex++];assert.equal(row[1],format);assert.equal(row[2],String(data.ads));assert.equal(row[4],pct(data.spendShare));assert.equal(row[6],pct(data.purchaseShare));}
   }
   assert.equal(await page.evaluate(()=>window.__formatXss),undefined);
   assert.equal(await page.locator('#promo-format-unknown img').count(),0);
   assert.match(await page.locator('#promo-format-status').textContent(),/Unknown/);
   const geometry=await page.locator('#promo-format-section .chart-card').evaluateAll(cards=>cards.map(c=>({x:c.getBoundingClientRect().x,y:c.getBoundingClientRect().y})));
   assert.equal(Math.abs(geometry[0].y-geometry[1].y)<2,width>1000);
   for(const theme of ['dark','light']){
    await page.evaluate(t=>{setTheme(t);for(const key of PROMO_FORMAT_CHART_KEYS){charts[key]?.stop();charts[key]?.update('none');}document.activeElement?.blur();},theme);
    assert.equal(await page.locator('.section-info-panel:not([hidden])').count(),0);
    const info=page.locator('#promo-format-title-info-button');
    if(width>720){
     await info.hover();assert.equal(await info.getAttribute('aria-expanded'),'true');
     await page.mouse.move(width-2,2);await page.waitForTimeout(220);
     assert.equal(await info.getAttribute('aria-expanded'),'false');
    } else {
     await info.tap();assert.equal(await info.getAttribute('aria-expanded'),'true');
     await info.tap();assert.equal(await info.getAttribute('aria-expanded'),'false');
     await info.evaluate(el=>el.blur());
    }
    await info.focus();
    assert.equal(await info.getAttribute('aria-expanded'),'true');
    const box=await page.locator('#promo-format-title-info').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1);
    await page.keyboard.press('Escape');
    assert.equal(await info.getAttribute('aria-expanded'),'false');
    await page.locator('[data-tab="czsk-promo"]').click();
    const controls=await page.locator('#panel-czsk-promo .compact-grouped-table-controls').evaluate(el=>{
     const nodes=[el.querySelector('.filter-toggle'),el.querySelector('.segmented'),el.querySelector('.metric-select'),el.querySelector('.sort-dir-btn')];return nodes.map(n=>({y:n.getBoundingClientRect().y,h:n.getBoundingClientRect().height}));
    });
    assert.ok(controls.every(r=>Math.abs(r.h-44)<1),'equal 44px controls');
    if(width>720)assert.ok(controls.every(r=>Math.abs(r.y-controls[0].y)<1),'desktop baseline');
    await page.locator('#panel-czsk-promo .compact-grouped-table-controls').screenshot({path:`${out}/${width}-${theme}-controls.png`});
    await page.locator('[data-tab="czsk-promo-creative"]').click();
    assert.equal(await page.locator('#date-wrap').isVisible(),false);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    await page.screenshot({path:`${out}/${width}-${theme}-page.png`});
    // Audit every section, including generated Triage headings, in both themes.
    const sections=await page.locator('.section-info-button').evaluateAll(buttons=>buttons.map(button=>({id:button.id,tab:button.closest('.panel').id.replace('panel-','')})));
    for(const item of sections){
     sectionCases++;
     await page.locator(`[data-tab="${item.tab}"]`).click();
     const button=page.locator('#'+item.id);await button.focus();
     const popup=page.locator('#'+await button.getAttribute('aria-controls'));
     assert.equal(await popup.isVisible(),true);
     const bounds=await popup.boundingBox();assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=width+1&&bounds.y+bounds.height<=1101);
     const styles=await popup.evaluate(el=>[el,...el.querySelectorAll('p,strong,.promo-note')].map(n=>{const s=getComputedStyle(n);return[s.fontSize,s.lineHeight,s.fontFamily];}));
     assert.ok(styles.every(s=>JSON.stringify(s)===JSON.stringify(styles[0])),'uniform popup typography');
     assert.equal(styles[0][0],'13px');
     if(item.id==='promo-format-title-info-button')await popup.screenshot({path:`${out}/${width}-${theme}-info.png`});
     await page.keyboard.press('Escape');assert.equal(await popup.isVisible(),false);
    }
    await page.locator('[data-tab="czsk-promo-creative"]').click();
    assert.equal(await page.locator('.section-info-panel:not([hidden])').count(),0);
    assert.equal(await page.locator('.panel .section-methodology').count(),0,'methodology moved, alerts retained');

    assert.equal(await page.locator('#promo-format-table thead th').evaluateAll(cells=>cells.every(cell=>cell.scrollWidth<=cell.clientWidth)),true,'metric headers must not truncate');
    // Freeze Chart.js explicitly (CSS reduced-motion does not stop its canvas
    // animation). Hide fixed navigation only for this isolated section capture.
    await page.locator('#promo-format-section').screenshot({path:`${out}/${width}-${theme}.png`,style:'.sticky-header,.skip-link{visibility:hidden!important}'});
   }
   const baseline=await page.evaluate(()=>JSON.stringify(charts['promo-format-spend'].data));
   await page.evaluate(()=>{filterState[tabFilterKey('czsk-promo','group')]=new Set(['wl']);setPromoActiveDaysOnly(true);setTabGrain('czsk-promo','week');customRange={since:'2026-09-01',until:'2026-09-10'};datePreset=null;});
   await page.evaluate(()=>loadData());
   assert.equal(await page.evaluate(()=>JSON.stringify(charts['promo-format-spend'].data)),baseline,'other tab dates/filters/grain cannot change creative history');
   if(!real){
    payload={...fixture,range:{since:'2026-03-01',until:'2026-10-02'},rows:[...fixture.rows,fact('next','2026-10-01','Video',100,2)]};
    await page.evaluate(()=>promoFormatHistory());
    assert.equal(await page.evaluate(()=>charts['promo-format-spend'].data.labels.at(-1)),'Oct 2026');
    assert.match(await page.locator('#promo-format-range').textContent(),/2026-10-02/);
    payload=fixture;await page.evaluate(()=>promoFormatHistory());
   }
   if(!real){
    payload={...fixture,rows:fixture.rows.filter(row=>row.format!=='Unknown')};
    await page.evaluate(()=>promoFormatHistory());
    assert.equal(await page.locator('#promo-format-status').isVisible(),false,'successful methodology stays out of the view');
    payload={...fixture,rows:[]};await page.evaluate(()=>promoFormatHistory());
    assert.match(await page.locator('#promo-format-status').textContent(),/No Promo ad activity in this history range/);
    assert.equal(await page.locator('#promo-format-status').isVisible(),true);
    assert.equal(await page.locator('#promo-format-section .promo-format-table-wrap').isVisible(),false);
    payload=fixture;await page.evaluate(()=>promoFormatHistory());
   }
   malformed=true;await page.evaluate(()=>loadData({force:true}));
   await page.waitForFunction(()=>Boolean(promoFormatError));
   assert.match(await page.locator('#promo-format-status').textContent(),/unavailable/i);
   assert.equal(await page.locator('#promo-format-status').isVisible(),true);
   assert.equal(await page.locator('#promo-format-table tbody tr').count(),0);
   assert.equal(await page.evaluate(()=>Boolean(charts['promo-format-spend'])),false);
   malformed=false;await page.evaluate(()=>loadData());
   await page.waitForFunction(()=>Boolean(promoFormatPayload && charts['promo-format-spend']));
   assert.equal(await page.evaluate(()=>Boolean(charts['promo-format-spend'])),true);
   const historyRequest=page.waitForRequest(request=>request.url().includes('/api/glv-meta-ads/fb-data?type=promo_formats'));
   await page.locator('.promo-format-history').click();
   const historyUrl=new URL((await historyRequest).url());
   const yesterday=new Date();yesterday.setUTCDate(yesterday.getUTCDate()-1);
   assert.equal(historyUrl.searchParams.get('date_preset'),'promo_history');
   assert.equal(historyUrl.searchParams.has('time_range'),false);
   assert.deepEqual(await page.evaluate(()=>({datePreset,customRange})),{datePreset:null,customRange:{since:'2026-09-01',until:'2026-09-10'}},'history refresh leaves global date state untouched');
   await page.waitForFunction(()=>Boolean(promoFormatPayload && charts['promo-format-spend']));
   for(const grain of ['week','month','day']){
    await page.evaluate(grain=>setTabGrain('czsk-promo',grain),grain);
    assert.equal(await page.evaluate(()=>charts['promo-format-spend'].data.labels.length),expected.length,'format view remains monthly');
   }
   results.push({width,pass:true,months:expected.length});await page.close();
  }
  assert.deepEqual(errors,[]);fs.writeFileSync(`${out}/results.json`,JSON.stringify({results,errors,sectionCases,themes:['dark','light']},null,2));console.log(JSON.stringify({results,errors,sectionCases,evidence:out}));
 } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
