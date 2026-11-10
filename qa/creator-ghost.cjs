// Synthetic campaign/ad-set fixture; never contacts Meta or writes a cache.
const {chromium}=require('playwright-core'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {attachCreatorFacts}=require('../lib/glv-wl-creators.cjs');
const root=path.resolve(__dirname,'../public'),evidence=process.env.CREATOR_GHOST_QA_DIR||'/tmp/glv-creator-ghost-qa';
const v2=process.env.GLV_QA_V2==='1',stamp=new Date().toISOString();
const parent={account_id:'359758259164738',id:'35',name:'TUC_035_CZSK_CBO_Sales_WL',date_start:'2026-11-01',date_stop:'2026-11-01',amount_spent:'30',reach:'150',impressions:'300','actions:omni_purchase':'1.25','action_values:omni_purchase':'90'};
function fixture(delta=-10,actionDelta=-.75){return attachCreatorFacts([parent],[{...parent,adset_id:'k',adset_name:'Set_Kristyna',amount_spent:String(30-delta),'action_values:omni_purchase':String(90-delta),'actions:omni_purchase':String(1.25-actionDelta)}]);}
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/')){const type=u.searchParams.get('type');return res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({creator_version:2,...(v2?{report_currency:u.searchParams.get('currency')||'USD',account_filter:u.searchParams.get('account')||'All',range:u.searchParams.has('time_range')?JSON.parse(u.searchParams.get('time_range')):require('../public/glv-meta-ads-v2/dates.js').rangeFor(u.searchParams.get('date_preset')==='promo_history'?'last_7d':u.searchParams.get('date_preset')||'last_7d'),generated_at:stamp}:{}),rows:['aggregate','daily'].includes(type)?fixture():[]}));}let f=path.join(root,u.pathname);if(fs.existsSync(f)&&fs.statSync(f).isDirectory())f=path.join(f,'index.html');if(!f.startsWith(root)||!fs.existsSync(f))return res.writeHead(404).end();res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(f)]||'application/octet-stream');fs.createReadStream(f).pipe(res);});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;const results=[],errors=[];try{const libs='/home/tom/.cache/hermes-browser-libs/root';browser=await chromium.launch({executablePath:'/home/tom/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',headless:true,args:['--no-sandbox'],env:{...process.env,LD_LIBRARY_PATH:`${libs}/usr/lib/x86_64-linux-gnu:${libs}/usr/lib`,FONTCONFIG_PATH:`${libs}/etc/fonts`}});fs.mkdirSync(evidence,{recursive:true});
for(const width of (process.env.GLV_QA_WIDTH?[Number(process.env.GLV_QA_WIDTH)]:[1440,390,320]))for(const theme of ['dark','light']){const page=await browser.newPage({viewport:{width,height:1100},hasTouch:width<600});page.on('pageerror',e=>errors.push(e.message));if(process.env.QA_VENDOR_DIR)await page.route('https://cdn.jsdelivr.net/**',r=>{const u=r.request().url(),f=u.includes('chart.umd')?'chart.js':u.endsWith('.css')?'grid.css':'grid.js';return r.fulfill({path:path.join(process.env.QA_VENDOR_DIR,f),contentType:f.endsWith('.css')?'text/css':'text/javascript',headers:{'access-control-allow-origin':'*'}});});await page.route('https://api.frankfurter.dev/**',r=>r.fulfill({json:{rates:{USD:.044}}}));await page.goto(`http://127.0.0.1:${server.address().port}/${v2?'glv-meta-ads-v2':'glv-meta-ads'}/`,{waitUntil:'networkidle',timeout:90000});await page.locator('[data-tab="czsk-promo"]').click().catch(async e=>{console.error({url:page.url(),body:(await page.content()).slice(0,1000),errors});throw e;});await page.evaluate(t=>setTheme(t),theme);await page.locator('#wl-influencer-breakdown').check();
for(const grain of ['day','week','month']){await page.locator('#tab-grain-czsk-promo').selectOption(grain);const r=await page.evaluate(()=>({naming:wlNamingIssues,totals:byPromoGroup(getPromoKpiRows()),parent:aggregate(getPromoKpiRows()),chart:charts['promo-pie'].config.type,values:charts['promo-pie'].data.datasets[0].data,line:charts['promo-spend'].data.datasets.find(d=>d.label.includes('Ghost'))?.data,table:document.querySelector('#promo-table').textContent,overflow:document.documentElement.scrollWidth>innerWidth+1}));assert.deepEqual(r.naming,[]);assert.equal(r.parent.spend,30);assert.equal(r.parent.reach,150);assert.equal(r.totals.find(x=>x.group==='wl-ghost').purchases,-.75);assert.equal(r.chart,'bar','negative values must not become positive doughnut arcs');assert.ok(r.values.includes(-10));assert.ok(r.line.includes(-10));assert.match(r.table,/-10/);assert.match(await page.locator('#kpi-czsk-promo').textContent(),/-10.*revenue/);assert.equal(r.overflow,false);}
assert.equal(await page.locator('.global-creator-warning:visible').count(),0);
const info=page.locator('#kpi-czsk-promo button[data-creator-ghost-info]');
assert.equal(await info.count(),1,'Ghost KPI needs an adjacent accessible info button');
assert.equal(await info.locator('..').locator('.group-badge').textContent(),'Ghost','Compact KPI label must remain readable on narrow cards');
await info.focus();await page.locator('#creator-ghost-info').waitFor({state:'visible'});
assert.match(await page.locator('#creator-ghost-info').textContent(),/signed.*campaign.*ad-set/i);
await page.keyboard.press('Escape');assert.equal(await info.getAttribute('aria-expanded'),'false');assert.equal(await info.evaluate(el=>el===document.activeElement),true);
if(width<600)await info.tap();else await info.click();await page.locator('#creator-ghost-info').waitFor({state:'visible'});
const box=await page.locator('#creator-ghost-info').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width);
await page.screenshot({path:path.join(evidence,`${width}-${theme}-ghost-info.png`)});
await page.keyboard.press('Escape');
assert.equal(await page.locator('#promo-table button button').count(),0,'Info cannot be nested inside the group disclosure');
assert.ok(await page.locator('#promo-table button[data-creator-ghost-info]').count());
for(const id of ['spend','roas','pie']){
 const legend=page.locator(`#chart-promo-${id}-legend`);
 assert.equal(await legend.locator('button[data-creator-ghost-info]').count(),1);
 const toggle=legend.locator('[data-index]').filter({hasText:'Ghost'});
 await toggle.click();assert.equal(await toggle.getAttribute('aria-pressed'),'false');
 assert.equal(await page.evaluate(id=>{const c=charts['promo-'+id];return id==='pie'?c.getDataVisibility(c.data.labels.findIndex(l=>l.includes('Ghost'))):c.isDatasetVisible(c.data.datasets.findIndex(d=>d.label.includes('Ghost')));},id),false);
 await toggle.click();assert.equal(await toggle.getAttribute('aria-pressed'),'true');
 const help=legend.locator('[data-creator-ghost-info]');await help.focus();await page.keyboard.press('Enter');await page.locator('#creator-ghost-info').waitFor({state:'visible'});await page.keyboard.press('Escape');
}
await page.locator('#promo-mode-days').click();assert.ok(await page.locator('#promo-table button[data-creator-ghost-info]').count());
await page.locator('#promo-mode-groups').click();
await page.screenshot({path:path.join(evidence,`${width}-${theme}.png`),fullPage:true});
// Exercise cancellation and sub-cent accumulation at the aggregation seam.
for(const [deltas,visible] of [[[0],false],[[.003,.003],true],[[10,-10],false]]){const rows=deltas.flatMap(d=>fixture(d,0));const r=await page.evaluate(rows=>{aggregateCampaigns=processAggregateRows(rows);dailyCampaigns=processDaily(rows);renderTab('czsk-promo');return {labels:charts['promo-pie'].data.labels,raw:byPromoGroup(getPromoKpiRows())};},rows);assert.equal(r.labels.some(x=>x.includes('Ghost')),visible);assert.equal(await page.locator('.global-creator-warning:visible').count(),0);const cards=await page.locator('#kpi-czsk-promo').textContent();assert.equal(cards.includes('Ghost'),visible);assert.equal(r.raw.reduce((n,x)=>n+x.purchases,0),1.25*deltas.length);}
// Non-financial signed residuals remain visible; OFF restores untouched parents.
await page.evaluate(rows=>{aggregateCampaigns=processAggregateRows(rows);dailyCampaigns=processDaily(rows);renderTab('czsk-promo');},fixture(0));
assert.equal(await info.count(),1);
if(width<600)await info.tap();else await info.click();await page.locator('#creator-ghost-info').waitFor({state:'visible'});
await page.locator('#wl-influencer-breakdown').uncheck();
assert.equal(await page.locator('#panel-czsk-promo [data-creator-ghost-info]').count(),0);
await page.locator('#creator-ghost-info').waitFor({state:'hidden'});
assert.equal(await page.evaluate(()=>aggregate(getPromoKpiRows()).spend),30);
// Exact actionable names survive even alongside a signed reconciliation residual.
const unresolved=fixture();unresolved[0].creator_rows[0].adset_name='AS13_Purchase_Videos_WL_KPI';
await page.evaluate(rows=>{aggregateCampaigns=processAggregateRows(rows);dailyCampaigns=processDaily(rows);renderTab('czsk-promo');},unresolved);
await page.locator('#wl-influencer-breakdown').check();
assert.match(await page.locator('#wl-naming-warning').textContent(),/TUC_035_CZSK_CBO_Sales_WL \/ AS13_Purchase_Videos_WL_KPI/);
assert.equal(await page.locator('#panel-czsk-promo [data-creator-ghost-info]').count(),0);
await page.locator('[data-tab="czsk"]').click();
await page.evaluate(()=>renderTab('czsk'));
const warning=page.locator('#panel-czsk .global-creator-warning');
assert.equal(await warning.isVisible(),true);assert.match(await warning.textContent(),/TUC_035_CZSK_CBO_Sales_WL \/ AS13_Purchase_Videos_WL_KPI/);
assert.match(await warning.textContent(),/check campaign name first, then ad-set name/);
assert.doesNotMatch(await warning.textContent(),/Ghost|Meta reconciliation/);
await warning.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(evidence,`${width}-${theme}-actionable-warning.png`)});
assert.equal(await page.locator('#panel-czsk-promo [data-creator-ghost-info]').count(),0);
assert.equal(await page.evaluate(()=>aggregate(getPromoKpiRows()).spend),30);
// Individual ad identity must survive the mixed AS13 split in both frontends.
const mixed=attachCreatorFacts([parent],['Kristyna_PAC419_v6-9','ActionKate_PAC462_V2'].map((ad_name,i)=>({...parent,ad_id:'ad-'+i,ad_name,adset_id:'AS13',adset_name:'AS13_Purchase_Videos_WL_KPI',amount_spent:'15',impressions:'150','action_values:omni_purchase':'45','actions:omni_purchase':'.625'})));
await page.evaluate(rows=>{aggregateCampaigns=processAggregateRows(rows);dailyCampaigns=processDaily(rows);renderTab('czsk-promo');},mixed);
await page.locator('[data-tab="czsk-promo"]').click();
const split=await page.evaluate(()=>({issues:wlNamingIssues,totals:byPromoGroup(getPromoKpiRows()).map(r=>[r.group,r.spend]),ghost:wlGhostVisible}));
assert.deepEqual(split.issues,[]);assert.equal(split.ghost,false);assert.equal(split.totals.filter(r=>r[1]===15).length,2);
results.push({width,theme,passed:true});await page.close();}assert.deepEqual(errors,[]);fs.writeFileSync(path.join(evidence,'results.json'),JSON.stringify({synthetic:true,results,errors},null,2));console.log(JSON.stringify({evidence,results,errors}));}finally{await browser?.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
