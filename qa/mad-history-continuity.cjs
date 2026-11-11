// Explicitly synthetic browser evidence; no credentials or production data.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..'),pub=process.env.GLV_HISTORY_PUBLIC||path.join(root,'public');
const dates=require('../public/glv-meta-ads-v2/dates.js');
const evidence=process.env.GLV_HISTORY_EVIDENCE||'/home/tom/.hermes/cache/scratch/mad-history-continuity';fs.mkdirSync(evidence,{recursive:true});
let clock='2026-11-11T12:00:00Z',mode='old',missingAds=false,missingCampaign='';
const old={since:'2026-10-11',until:'2026-11-09'};
function payload(q,v2){
 const type=q.get('type'),wl=q.has('wl'),history=type==='promo_formats';
 const requested=q.has('time_range')?JSON.parse(q.get('time_range')):history?{since:'2026-03-01',until:dates.commonCutoff(new Date(clock))}:dates.rangeFor(q.get('date_preset'),new Date(clock));
 const range=mode==='fresh'||wl?requested:history?{since:'2026-03-01',until:old.until}:old;
 const currency=v2?q.get('currency'):'CZK',account=v2?q.get('account'):'TUC';
 const meta={complete:true,range,cached_range:range,requested_range:requested,generation_id:'synthetic-'+range.until,generated_at:mode==='fresh'?clock:'2026-11-10T08:00:00Z',coverage_complete:mode==='fresh',report_currency:currency,account_filter:account,wl_version:3,creator_version:2};
 const names=['TUC_001_CZSK_Promo_SYNTHETIC','TUC_002_US_WL_Kristyna_SYNTHETIC','TUC_003_CZSK_Leads_SYNTHETIC'];
 const rows=names.map((name,i)=>({id:String(i+1),name:type==='ads'?'Kristyna_PAC419_v6-9':name,campaign_id:String(i+1),campaign_name:name,adset_id:'s'+i,adset_name:'Kristyna',account_id:'359758259164738',account_label:'TUC',market:i===1?'US':'CZSK',date_start:range.until,date_stop:range.until,amount_spent:2500,'action_values:omni_purchase':7500,impressions:1000,reach:500,'actions:link_click':100,'actions:landing_page_view':80,'actions:omni_purchase':10,'actions:initiate_checkout':20,'actions:lead':i===2?5:0,partnership:{status:'verified_positive',reason:'sponsor_metadata',evidence:['facebook_branded_content.sponsor_page_id']}}));
 if(history)return {...meta,schema_version:1,classification_version:2,funnel_version:1,reconciled:true,rows:[{ad_id:'promo',ad_name:'SYNTHETIC CC001 PAC001 Video',adset_id:'s',adset_name:'Video',campaign_id:'1',campaign_name:names[0],date:range.until,format:'Video',reason:'synthetic_fixture',spend:2500,revenue:7500,purchases:10,impressions:1000,link_clicks:100,landing_page_views:80,checkouts:20}]};
 return {...meta,rows};
}
const app=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname.includes('/api/')){
  const failed=mode==='fail'||missingCampaign===u.searchParams.get('type')||missingAds&&u.searchParams.get('type')==='ads'&&!u.searchParams.has('wl');
  res.writeHead(failed?503:200,{'content-type':'application/json'}).end(JSON.stringify(failed?{error:'Synthetic scheduled refresh unavailable'}:payload(u.searchParams,u.pathname.includes('-v2/'))));return;
 }
 let file=path.join(pub,decodeURIComponent(u.pathname));if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
 if(!file.startsWith(pub)||!fs.existsSync(file)){res.writeHead(404).end();return;}
 res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
});
async function raceProof(browser,version,checks,errors){
 for(const scenario of ['recovered','persistent','superseded']){
  mode='fresh';clock='2026-11-11T12:00:00Z';missingAds=false;missingCampaign='';
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),counts={};
  page.on('pageerror',e=>errors.push(e.message));
  let release;const held=new Promise(r=>release=r);let retryReached;const reached=new Promise(r=>retryReached=r);
  await page.clock.install({time:new Date(clock)});
  await page.route('https://api.frankfurter.dev/**',r=>r.fulfill({json:{rates:{USD:0.04}}}));
  await page.route('**/api/**',async route=>{
   const u=new URL(route.request().url()),type=u.searchParams.get('type'),data=payload(u.searchParams,version.endsWith('-v2'));
   if(['aggregate','daily','ads'].includes(type)&&!u.searchParams.has('wl')){
    const key=(u.searchParams.get('date_preset')||'custom')+':'+type;counts[key]=(counts[key]||0)+1;
    const newer=u.searchParams.get('date_preset')==='last_7d';
    data.generation_id=newer?'newer-scope':scenario==='persistent'&&type==='ads'||counts[key]===1&&type==='aggregate'?'before':'after';
    if(scenario==='superseded'&&!newer&&counts[key]===2){retryReached();await held;}
   }
   await route.fulfill({json:data});
  });
  await page.goto(`http://127.0.0.1:${app.address().port}/${version}/`);
  if(scenario==='superseded'){
   await reached;
   await page.evaluate(()=>{datePreset='last_7d';customRange=null;return loadData();});release();
   await page.waitForFunction(()=>lastGoodSources?.[0]?.generation_id==='newer-scope');
  }
  await page.waitForFunction(()=>document.querySelector('#loading').style.display==='none');
  if(scenario==='persistent'){
   assert.equal(await page.locator('#panel-czsk').isVisible(),false);assert.equal(await page.evaluate(()=>aggregateCampaigns.length),0);
   assert.match(await page.locator('#error').innerText(),/Mixed source generations/);
  }else{
   assert.equal(await page.locator('#panel-czsk').isVisible(),true);assert.ok(await page.evaluate(()=>aggregateCampaigns.length>0&&dailyCampaigns.length>0&&adCreatives.length>0));
   assert.equal(await page.evaluate(()=>new Set(lastGoodSources.map(s=>s.generation_id)).size),1);
  }
  if(scenario==='superseded'){
   // Drain old responses before checking that they did not overwrite the newer scope.
   await page.waitForTimeout(150);
   assert.equal(await page.evaluate(()=>lastGoodSources[0].generation_id),'newer-scope');
   assert.equal(Object.values(counts).reduce((a,b)=>a+b,0),9);
  }else assert.deepEqual(Object.values(counts),[2,2,2]);
  await page.screenshot({path:path.join(evidence,version+'-race-'+scenario+'.png'),fullPage:true});
  checks.push({version,case:'publication race '+scenario,counts});await context.close();
 }
}
(async()=>{
 await new Promise(r=>app.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/home/tom/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',headless:true,args:['--no-sandbox'],env:{...process.env,LD_LIBRARY_PATH:'/home/tom/.cache/hermes-browser-libs/root/usr/lib/x86_64-linux-gnu:/home/tom/.cache/hermes-browser-libs/root/usr/lib'}});
 const checks=[],errors=[];
 try{for(const version of ['glv-meta-ads-v2','glv-meta-ads']){
  await raceProof(browser,version,checks,errors);
  mode='old';clock='2026-11-11T12:00:00Z';missingAds=false;
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));await page.clock.install({time:new Date(clock)});
  await page.route('https://api.frankfurter.dev/**',r=>r.fulfill({json:{rates:{USD:0.04}}}));
  await page.goto(`http://127.0.0.1:${app.address().port}/${version}/`);
  await page.waitForFunction(()=>document.querySelector('#loading').style.display==='none');
  await page.evaluate(()=>{datePreset='last_30d';customRange=null;updateDateLabel();return loadData({force:true});});
  await page.screenshot({path:path.join(evidence,version+'-cold.png'),fullPage:true});
  assert.equal(await page.locator('#panel-czsk').isVisible(),true,'cold cached history must stay visible');
  assert.ok(await page.evaluate(()=>aggregateCampaigns.length>0),'cold history facts rendered');
  assert.match(await page.locator('#error').innerText(),/2026-10-11.*2026-11-09/);
  assert.match(await page.locator('#date-btn-range').innerText(),/Available/);
  const good=await page.evaluate(()=>JSON.stringify([aggregateCampaigns,dailyCampaigns,adCreatives]));
  missingAds=true;await page.evaluate(()=>loadData({force:true}));
  assert.equal(await page.evaluate(()=>JSON.stringify([aggregateCampaigns,dailyCampaigns,adCreatives])),good,'same-generation creatives remain available on ads failure');
  missingAds=false;
  for(const type of ['aggregate','daily']){
   missingCampaign=type;await page.evaluate(()=>loadData({force:true}));
   assert.equal(await page.evaluate(()=>JSON.stringify([aggregateCampaigns,dailyCampaigns,adCreatives])),good,'one missing campaign payload preserves coherent last-good');
   assert.equal(await page.locator('#panel-czsk').isVisible(),true);
  }
  missingCampaign='';
  for(const day of ['2026-11-12T12:00:00Z','2026-11-15T12:00:00Z']){
   clock=day;await page.clock.setSystemTime(new Date(day));mode='fail';
   await page.locator('[data-tab="czsk"]').click();
   assert.notEqual(await page.evaluate(()=>{void loadData({force:true});return document.querySelector('#panel-czsk').style.display;}),'none','rollover must not hide compatible history while refresh is pending');
   await page.waitForFunction(()=>document.querySelector('#loading').style.display==='none');
   assert.equal(await page.evaluate(()=>JSON.stringify([aggregateCampaigns,dailyCampaigns,adCreatives])),good,'failed refresh retains prior valid facts');
   for(const tab of ['czsk','us','czsk-triage','czsk-promo','czsk-leadgen','czsk-promo-creative']){await page.locator(`[data-tab="${tab}"]`).click();assert.equal(await page.locator('#panel-'+tab).isVisible(),true);}
   assert.ok(await page.locator('#promo-format-table tbody tr').count()>0,'retained independent history stays usable');
   assert.match(await page.locator('#promo-format-status').innerText(),/last-good/i);
   await page.locator('[data-tab="czsk"]').click();
   await page.screenshot({path:path.join(evidence,version+'-rollover-'+day.slice(0,10)+'.png'),fullPage:true});
   checks.push({version,day,case:'open rollover failure and all tabs'});
  }
  mode='old';await page.reload();await page.waitForFunction(()=>document.querySelector('#loading').style.display==='none');
  assert.ok(await page.evaluate(()=>aggregateCampaigns.length>0),'multiple missed days cold reload');
  await page.locator('[data-tab="wl"]').click();await page.waitForFunction(()=>!document.querySelector('#wl-status').textContent.startsWith('Loading WL'));assert.match(await page.locator('#wl-status').innerText(),/Source refreshed/);
  const wl=await page.locator('#wl-results').innerText();assert.ok(wl.includes('7,500'));
  mode='fail';await page.evaluate(()=>GlvWlUI.load(true));assert.equal(await page.locator('#wl-results').innerText(),wl,'WL retains last-good on HTTP failure');
  assert.match(await page.locator('#wl-status').innerText(),/last-good/i);
  mode='fresh';missingAds=true;await page.locator('[data-tab="czsk"]').click();await page.evaluate(()=>loadData({force:true}));
  assert.equal(await page.locator('#panel-czsk').isVisible(),true);assert.ok(await page.evaluate(()=>aggregateCampaigns.length>0));
  assert.match(await page.locator('#creative-czsk').innerText(),/unavailable/i);
  missingAds=false;await page.evaluate(()=>loadData({force:true}));assert.equal(await page.locator('#error').isVisible(),false);
  assert.ok(!(await page.locator('#date-btn-range').innerText()).includes('Available'));
  await page.screenshot({path:path.join(evidence,version+'-recovered.png'),fullPage:true});
  checks.push({version,case:'cold reload, stale WL, partial ads, recovered refresh'});
  mode='fresh';missingAds=true;await page.reload();await page.waitForFunction(()=>document.querySelector('#loading').style.display==='none');
  assert.ok(await page.evaluate(()=>aggregateCampaigns.length>0),'cold missing ads preserves independent campaign facts');
  assert.match(await page.locator('#creative-czsk').innerText(),/unavailable/i);missingAds=false;
  await page.evaluate(()=>{datePreset='last_month';customRange=null;updateDateLabel();return loadData({force:true});});
  const historical=await page.evaluate(()=>JSON.stringify([aggregateCampaigns,dailyCampaigns,adCreatives]));
  mode='fail';clock='2026-11-16T12:00:00Z';await page.clock.setSystemTime(new Date(clock));await page.evaluate(()=>loadData({force:true}));
  assert.equal(await page.evaluate(()=>JSON.stringify([aggregateCampaigns,dailyCampaigns,adCreatives])),historical);
  assert.match(await page.locator('#date-btn-range').innerText(),/Oct/);
  await page.evaluate(()=>{customRange={since:'2026-08-01',until:'2026-08-31'};datePreset=null;updateDateLabel();return loadData({force:true});});
  assert.equal(await page.locator('#panel-czsk').isVisible(),false,'disjoint historical selection must not inherit old totals');
  mode='fresh';await page.evaluate(()=>loadData({force:true}));assert.equal(await page.locator('#panel-czsk').isVisible(),true);
  if(version.endsWith('-v2')){
   for(const [id,value] of [['v2-currency','CZK'],['v2-account','TUC'],['v2-account','All'],['v2-currency','USD']]){
    await page.locator('#'+id).selectOption(value);await page.waitForURL(u=>u.searchParams.get(id==='v2-account'?'account':'currency')===value);
    await page.waitForFunction(()=>document.querySelector('#loading').style.display==='none');
    assert.equal(await page.locator('#error').isVisible(),false);assert.ok(await page.evaluate(()=>aggregateCampaigns.length>0));
   }
  }
  checks.push({version,case:'cold ads failure, historical rollover/disjoint scope, account/currency switches'});await context.close();
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(evidence,'results.json'),JSON.stringify({synthetic:true,checks,errors},null,2));console.log(JSON.stringify({passed:true,evidence,checks}));
 }finally{await browser.close();await new Promise(r=>app.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
