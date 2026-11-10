// Synthetic integration fixture. No client exports or credentials.
const {chromium}=require('playwright-core'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {attachCreatorFacts}=require('../lib/glv-wl-creators.cjs');
const {lastMonth}=require('../public/glv-meta-ads/wl-report.js');
const evidence='/tmp/glv-global-wl-qa';fs.mkdirSync(evidence,{recursive:true});
let invalid=false;
const fact=(spend,reach)=>({amount_spent:String(spend),impressions:String(spend*10),reach:String(reach),'actions:link_click':String(spend),'actions:landing_page_view':String(spend),'actions:omni_purchase':String(spend/10),'actions:initiate_checkout':String(spend/5),'actions:outbound_click':'0','actions:lead':'0','action_values:omni_purchase':String(spend*3)});
function campaignRows(daily=false){
 const dates=daily?['2026-10-10','2026-10-11']:[null];
 return dates.flatMap(date=>{
  const parent={id:'35',name:'GLV_035_CZ_WL',date_start:date,date_stop:date,...fact(30,150)};
  const kids=ads().map(r=>({...r,id:r.campaign_id,name:r.campaign_name,ad_id:r.id,ad_name:r.name,date_start:date,date_stop:date}));
  return attachCreatorFacts([parent,{...parent,id:'36',name:'GLV_036_CZ_WL_Kristyna',...fact(40,190)}],kids);
 });
}
function ads(){return [
 {id:'ak',campaign_id:'35',campaign_name:'GLV_035_CZ_WL',adset_id:'AS13',adset_name:invalid?'Unknown_<svg onload=window.__globalXss=1>':'AS13_Purchase_Videos_WL_KPI',name:invalid?'PAC462':'ActionKate_PAC462_V2',...fact(20,100)},
 {id:'kr',campaign_id:'35',campaign_name:'GLV_035_CZ_WL',adset_id:'AS13',adset_name:'AS13_Purchase_Videos_WL_KPI',name:'Kristyna_PAC419_v6-9',...fact(10,80)},
 {id:'precedence',campaign_id:'36',campaign_name:'GLV_036_CZ_WL_Kristyna',adset_id:'conflict',adset_name:'Set_ActionKate',name:'PAC462',...fact(40,190)}
 ].map(r=>({...r,partnership:{status:'verified_positive',reason:'sponsor_metadata',evidence:['instagram_branded_content.sponsor_id']}}));}
const root=path.resolve(__dirname,'../public');
const app=http.createServer((req,res)=>{const u=new URL(req.url,'http://local');if(u.pathname.startsWith('/api/')){
 const type=u.searchParams.get('type'),wl=u.searchParams.get('wl')==='1';
 const payload={creator_version:2,rows:type==='aggregate'?campaignRows():type==='daily'?campaignRows(true):ads(),...(wl?{wl_version:3,range:lastMonth(),generated_at:new Date().toISOString()}:{} )};
 return res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(payload));
 }let file=path.join(root,u.pathname);if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');if(!fs.existsSync(file))return res.writeHead(404).end();res.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
});
(async()=>{await new Promise(r=>app.listen(0,'127.0.0.1',r));const libs='/home/tom/.cache/hermes-browser-libs/root';const browser=await chromium.launch({executablePath:'/home/tom/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',headless:true,args:['--no-sandbox'],env:{...process.env,LD_LIBRARY_PATH:`${libs}/usr/lib/x86_64-linux-gnu:${libs}/usr/lib`,FONTCONFIG_PATH:`${libs}/etc/fonts`}});const results=[],errors=[];
try{for(const width of [1440,390,320])for(const theme of ['dark','light']){
 invalid=false;const page=await browser.newPage({viewport:{width,height:950},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));await page.route('https://api.frankfurter.dev/**',r=>r.fulfill({json:{rates:{USD:.04}}}));
 await page.goto(`http://127.0.0.1:${app.address().port}/glv-meta-ads/`,{waitUntil:'networkidle'});await page.waitForFunction(()=>document.querySelector('#loading').style.display==='none');await page.evaluate(t=>setTheme(t),theme);
 const before=await page.evaluate(()=>({total:aggregate(getMainSegmentRows('czsk','aggregate')),count:aggregateCampaigns.length,adCreators:adCreatives.map(r=>r.creator)}));
 assert.equal(before.total.spend,70);assert.equal(before.total.reach,340);assert.equal(before.count,2);assert.deepEqual(before.adCreators,['ActionKate','Kristyna','Kristyna']);
 await page.locator('#tab-czsk-promo').click();await page.getByRole('checkbox',{name:'Break down WL influencers',exact:true}).check();
 const split=await page.evaluate(()=>({issues:wlNamingIssues,kpi:byPromoGroup(getPromoKpiRows()),daily:byDateGroup(getPromoDailyRows()),labels:charts['promo-spend'].data.datasets.map(r=>r.label),table:document.querySelector('#promo-table').textContent}));
 assert.deepEqual(split.issues,[]);assert.equal(split.kpi.find(r=>r.group==='wl-kristyna').spend,50);assert.equal(split.kpi.find(r=>r.group==='wl-actionkate').spend,20);assert.equal(split.kpi.reduce((n,r)=>n+r.spend,0),70);assert.equal(split.daily.reduce((n,r)=>n+r.spend,0),140);assert.ok(split.labels.includes('WL · ActionKate'));assert.match(split.table,/ActionKate/);
 await page.evaluate(()=>setTabGrain('czsk-promo','month'));assert.equal(await page.evaluate(()=>byDateGroup(periodRows(getPromoDailyRows(),'czsk-promo')).filter(r=>r.group==='wl-actionkate')[0].spend),40);
 await page.screenshot({path:path.join(evidence,`${width}-${theme}-mixed.png`),fullPage:true});
 await page.locator('#tab-wl').click();await page.locator('#wl-overview table').waitFor();const total=await page.locator('#wl-overview tbody tr').last().innerText();assert.match(total,/70\.00/);assert.match(total,/50\.00/);assert.match(total,/210\.00/);assert.equal(await page.locator('#wl-warning').isVisible(),false);
 invalid=true;await page.evaluate(()=>loadData({force:true}));await page.locator('#wl-reload').click();await page.locator('#wl-warning').waitFor({state:'visible'});assert.match(await page.locator('#wl-warning').innerText(),/Unknown_<svg/);
 await page.locator('#tab-czsk-promo').click();assert.equal(await page.locator('#wl-naming-warning').isVisible(),true);assert.equal(await page.evaluate(()=>wlInfluencerBreakdown),true);assert.deepEqual(await page.evaluate(()=>activePromoGroups().map(r=>r.key)),['promo','wl','bau']);assert.equal(await page.evaluate(()=>aggregate(getPromoKpiRows()).spend),70);
 for(const tab of ['czsk','czsk-triage','czsk-leadgen']){await page.locator('#tab-'+tab).click();assert.equal(await page.locator('#panel-'+tab+' .global-creator-warning').isVisible(),true);assert.match(await page.locator('#panel-'+tab+' .global-creator-warning').innerText(),/Unknown_<svg/);}
 assert.equal(await page.locator('.global-creator-warning svg,#wl-warning svg,#wl-naming-warning svg').count(),0);assert.equal(await page.evaluate(()=>window.__globalXss),undefined);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:path.join(evidence,`${width}-${theme}-warning.png`),fullPage:true});
 invalid=false;await page.evaluate(()=>loadData({force:true}));await page.locator('#tab-czsk-promo').click();assert.equal(await page.locator('#wl-naming-warning').isVisible(),false);assert.equal(await page.evaluate(()=>byPromoGroup(getPromoKpiRows()).find(r=>r.group==='wl-actionkate').spend),20);
 results.push({width,theme,passed:true});await page.close();
 }assert.deepEqual(errors,[]);fs.writeFileSync(path.join(evidence,'results.json'),JSON.stringify({synthetic:true,results,errors},null,2));console.log(JSON.stringify({evidence,results,errors}));
}finally{await browser.close();app.close();}})().catch(e=>{console.error(e);process.exitCode=1;app.close();});
