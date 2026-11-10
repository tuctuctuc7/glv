// Synthetic fixtures only: browser behavior evidence, NOT live Meta reconciliation.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..'),pub=path.join(root,'public');
const dates=require('../public/glv-meta-ads-v2/dates.js');
const {renderSnapshot}=require('../lib/glv-mad-v2-source.cjs');
const evidence=process.env.GLV_V2_EVIDENCE||'/tmp/glv-mad-v2-browser';fs.mkdirSync(evidence,{recursive:true});
const design=require('./mad-v2-design.cjs'),designChecks=[],designInteractions=[];
const requests=[],checks=[],errors=[],freshnessChecks=[];let failure=false,scenario='fresh';
const stamp=new Date().toISOString();
const {cacheState,presetKey}=require('../lib/glv-mad-v2-cache.cjs');
const {cacheKey}=require('../lib/glv-mad-v2-source.cjs');
const reader=require('../api/glv-meta-ads-v2/fb-data.js');
// Only synthetic in-memory GETs. No credentials loaded, no external transport.
Object.assign(process.env,{GLV_MAD_V2_ENABLED:'1',GLV_META_BETA_AUTH_TOKEN:'synthetic-browser-auth',KV_REST_API_URL:'https://synthetic.invalid',KV_REST_API_TOKEN:'synthetic-only',UPSTASH_REDIS_REST_URL:'https://synthetic.invalid',UPSTASH_REDIS_REST_TOKEN:'synthetic-only'});
const store=new Map();global.fetch=async url=>{
 const u=new URL(url);assert.equal(u.origin,'https://synthetic.invalid');assert.ok(u.pathname.startsWith('/get/'));
 return {ok:true,status:200,json:async()=>({result:store.get(decodeURIComponent(u.pathname.slice(5)))||null})};
};
function freshnessFixture(data,type,requested){
 if(type==='promo_formats')return {...data,complete:true,...cacheState(data,{range:requested}),...(scenario==='promo-stale'?{stale:true,coverage_complete:false,warning:'Shared history refresh pending'}:{})};
 const priorEnd=dates.shift(requested.since,-1),prior={since:priorEnd.slice(0,7)+'-01',until:priorEnd};
 if(scenario==='rollover'||scenario==='mixed-range'&&type==='daily')data={...data,range:prior};
 if(scenario==='mixed-generation'&&type==='ads')data={...data,generated_at:new Date(Date.parse(stamp)-3600000).toISOString()};
 if(scenario==='age-stale')data={...data,generated_at:new Date(Date.parse(stamp)-26*3600000).toISOString()};
 if(scenario==='mixed-account'&&type==='aggregate')data={...data,account_filter:'TUC'};
 const state=cacheState(data,{range:requested});
 return {...data,...state,...(state.stale?{warning:'Last-good snapshot; shared refresh has not verified requested coverage.'}:{})};
}
function payload(q,raw=false,overrideRange=null){
 const type=q.get('type'),currency=q.get('currency'),account=q.get('account');
 const range=overrideRange|| (q.has('time_range')?JSON.parse(q.get('time_range')):type==='promo_formats'?{since:'2026-03-01',until:dates.commonCutoff()}:dates.rangeFor(q.get('date_preset')));
 if(type==='promo_formats')return {schema_version:1,classification_version:2,funnel_version:1,reconciled:true,generated_at:stamp,range,account_filter:account,report_currency:currency,rows:account==='TGLV'?[]:[{ad_id:'359758259164738:promo',ad_name:'SYNTHETIC CC001 PAC001 Video',adset_id:'359758259164738:s',adset_name:'Video',campaign_id:'359758259164738:1',campaign_name:'TUC_001_CZSK_Promo_SYNTHETIC',date:range.until,format:'Video',reason:'synthetic_fixture',spend:currency==='USD'?100:2500,revenue:currency==='USD'?300:7500,purchases:10,impressions:1000,link_clicks:100,landing_page_views:80,checkouts:20}]};
 const accounts=dates.ACCOUNTS.map((a,i)=>({...a,rows:(i?['TGLV_001_US_SYNTHETIC','AS | PPE | US']:['TUC_001_CZSK_Promo_SYNTHETIC','TUC_002_US_WL_Kristyna_SYNTHETIC','TUC_003_CZSK_Leads_SYNTHETIC']).map((name,j)=>({id:String(j+1),name:type==='ads'?'SYNTHETIC PAC001 V1':name,...(type==='ads'?{campaign_id:String(j+1),campaign_name:name,adset_id:'s'+j,adset_name:'Kristyna',partnership:{status:'verified_positive',reason:'sponsor_metadata',evidence:['facebook_branded_content.sponsor_page_id']}}:{}),date_start:range.until,date_stop:range.until,amount_spent:i?100:2500,'action_values:omni_purchase':i?300:7500,impressions:1000,reach:500,'actions:link_click':100,'actions:landing_page_view':80,'actions:omni_purchase':10,'actions:initiate_checkout':20,'actions:lead':j===2?5:0,video_thruplay_watched_actions:50,video_3_sec_watched_actions:100})),reach:[]}));
 const snapshot={schema_version:1,complete:true,type,range,generated_at:stamp,accounts,fx:{[range.until]:{date:range.until,czk_per_usd:25,provider:'SYNTHETIC QA ONLY'}}};
 return raw?snapshot:renderSnapshot(snapshot,currency,account);
}
const app=http.createServer(async(req,res)=>{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname==='/api/glv-meta-ads-v2/fb-data'){
  requests.push(Object.fromEntries(u.searchParams));
  // A valid HTTP JSON application error exercises UI failure without expected network-console noise.
  const q=u.searchParams,type=q.get('type');
  if(failure||type==='promo_formats'){
   const data=failure?{error:'SYNTHETIC source unavailable'}:payload(q);
   res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(failure?data:freshnessFixture(data,type,data.range)));return;
  }
  const original=payload(q,true),mutated=freshnessFixture(original,type,original.range);
  const snapshot={...payload(q,true,mutated.range),generated_at:mutated.generated_at};
  const key=q.has('time_range')?cacheKey(type,original.range):presetKey(type,q.get('date_preset'));
  store.set(key,JSON.stringify(snapshot));
  // Execute the actual API reader through its synthetic Redis GET boundary.
  await reader({method:'GET',headers:{cookie:'glv_meta_beta=synthetic-browser-auth'},query:Object.fromEntries(q)},{
   setHeader:(k,v)=>res.setHeader(k,v),status(n){res.statusCode=n;return this;},json(body){
    if(scenario==='mixed-account'&&type==='aggregate')body.account_filter='TUC';
    if(scenario==='flag-stale')body.stale=true;
    res.setHeader('content-type','application/json');res.end(JSON.stringify(body));
   }
  });return;
 }
 let file=path.join(pub,decodeURIComponent(u.pathname));if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
 if(!file.startsWith(pub)||!fs.existsSync(file)){res.writeHead(404).end();return;}
 res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'})[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
});
async function run(){
 await new Promise(r=>app.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.address().port}/glv-meta-ads-v2/`;
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/home/tom/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',headless:true,args:['--no-sandbox'],env:{...process.env,LD_LIBRARY_PATH:'/home/tom/.cache/hermes-browser-libs/root/usr/lib/x86_64-linux-gnu:/home/tom/.cache/hermes-browser-libs/root/usr/lib'}});
 try{
 for(const width of (process.env.GLV_V2_WIDTH?[Number(process.env.GLV_V2_WIDTH)]:[1440,1200,1100,1024,800,768,721,720,390,320])){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  const ready=async()=>{await page.waitForFunction(()=>document.querySelector('#loading').style.display==='none');assert.equal(await page.locator('#error').isVisible(),false,await page.locator('#error').textContent());};
  await page.goto(base);await ready();assert.equal(await page.locator('#v2-currency').inputValue(),'USD');
  assert.ok((await page.locator('#v2-date-note').textContent()).includes(dates.commonCutoff()),'common completed cutoff is explicit');
  if(width<=720){assert.ok(await page.locator('.header-brand').evaluate(el=>el.getBoundingClientRect().height<=44),'mobile branding must fit header');await page.locator('#mobile-controls-toggle').click();assert.ok(await page.evaluate(()=>{const a=document.querySelector('#v2-currency').getBoundingClientRect(),b=document.querySelector('#theme-toggle').getBoundingClientRect();return Math.abs(a.top-b.top)<15&&a.right<=b.left;}),'global currency/theme stay together while filters open');await page.locator('#mobile-controls-toggle').click();}
  for(const theme of ['dark','light']){
   if(await page.locator('html').getAttribute('data-theme')!==theme)await page.locator('#theme-toggle').click();
   for(const currency of ['USD','CZK']){
    if(await page.locator('#v2-currency').inputValue()!==currency){await page.locator('[data-tab="wl"]').click();await page.locator('#v2-currency').selectOption(currency);await page.waitForURL(u=>u.searchParams.get('currency')===currency);await ready();assert.equal(await page.locator('[data-tab="wl"]').getAttribute('aria-selected'),'true');await page.waitForFunction(()=>document.querySelector('#wl-status')?.textContent.includes('Source refreshed'),{},{timeout:5000});}
    for(const tab of ['czsk','us','czsk-triage','czsk-promo','czsk-promo-creative','czsk-leadgen','wl']){
     await page.locator(`[data-tab="${tab}"]`).click();
     if(tab==='wl')await page.waitForFunction(()=>document.querySelector('#wl-status')?.textContent.includes('Source refreshed'));
     assert.equal(await page.locator('#panel-'+tab).isVisible(),true);
     if(tab==='czsk-promo-creative'){await page.locator('#promo-concept-table tbody tr').first().waitFor();assert.ok(await page.locator('#promo-format-table tbody tr').count()>0);assert.ok(!(await page.locator('#promo-concept-status').textContent()).includes('unavailable'));}
     if(tab==='czsk-leadgen')assert.ok(await page.locator('#leadgen-table tbody tr').count()>0);
     if(tab==='czsk-promo')assert.ok(await page.locator('#promo-table tbody tr').count()>0);
     if(tab==='czsk-triage')assert.equal(await page.evaluate(()=>TRIAGE_PRESETS.every(p=>charts['triage-'+p.id]?.data.labels.length>0)),true);
     await page.evaluate(()=>{Object.values(charts).forEach(c=>{c.stop();c.options.animation=false;c.update('none');});window.scrollTo(0,0);});
     await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
     const geometry=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,currency:document.querySelector('#v2-currency').getBoundingClientRect().toJSON(),theme:document.querySelector('#theme-toggle').getBoundingClientRect().toJSON()}));
     assert.ok(geometry.scroll<=width+1,JSON.stringify({tab,theme,currency,geometry}));
     assert.ok(geometry.currency.right<=geometry.theme.left+1&&Math.abs(geometry.currency.top-geometry.theme.top)<15,JSON.stringify(geometry));
     const labels=await page.locator('.panel.active').innerText();assert.ok(!labels.includes(currency==='USD'?'CZK':'USD'),`wrong currency ${tab}: ${labels}`);
     designChecks.push(await design.inspect(page,{width,theme,tab}));
     if(width<=720){
      await page.locator('#mobile-controls-toggle').click();
      await design.header(page);
      assert.equal(await page.locator(tab==='wl'?'#wl-status':'#updated-at').isVisible(),true,'active view freshness remains readable with mobile filters open');
      if(currency==='USD'&&tab==='czsk')await page.screenshot({path:path.join(evidence,`${width}-${theme}-filters-open.png`)});
      await page.locator('#mobile-controls-toggle').click();
     }
     await page.evaluate(()=>document.activeElement?.blur());
     if(currency==='USD')await page.screenshot({path:path.join(evidence,`${width}-${theme}-${tab}-viewport.png`)});
     await page.screenshot({path:path.join(evidence,`${width}-${theme}-${currency}-${tab}.png`),fullPage:true});checks.push({width,theme,currency,tab});
    }
    // Real HTTP-200 reader freshness contract, not rejected fetch promises.
    await page.locator('[data-tab="czsk"]').click();
    await page.evaluate(()=>{datePreset='last_month';customRange=null;updateDateLabel();return loadData({force:true});});await ready();
    const good=await page.evaluate(()=>JSON.stringify([aggregateCampaigns,dailyCampaigns,adCreatives]));
    for(const staleCase of ['rollover','mixed-range','mixed-generation','mixed-account','age-stale']){
     scenario=staleCase;await page.evaluate(()=>loadData({force:true}));
     assert.equal(await page.locator('#error').isVisible(),true,staleCase);
     const status=await page.locator('#error').innerText();assert.match(status,/stale|generation|scope|range/i);
     await design.header(page);
     if(staleCase!=='age-stale')assert.equal(await page.evaluate(()=>JSON.stringify([aggregateCampaigns,dailyCampaigns,adCreatives])),good,'invalid bundle must never replace last-good');
     else {assert.match(await page.locator('#updated-at').innerText(),/Stale last-good.*actual range/);assert.match(await page.evaluate(()=>lastGoodLabel),/^Stale last-good/);assert.ok(!status.includes('Mixed source generations'));assert.match(status,/Scheduled refresh pending/);}
     for(const affected of ['czsk','us','czsk-triage','czsk-promo','czsk-leadgen']){await page.locator(`[data-tab="${affected}"]`).click();assert.equal(await page.locator('#error').isVisible(),true);}
     await page.screenshot({path:path.join(evidence,`${width}-${theme}-${currency}-${staleCase}.png`),fullPage:true});
     freshnessChecks.push({width,theme,currency,scenario:staleCase,status});
     scenario='fresh';await page.evaluate(()=>loadData({force:true}));await ready();assert.ok(!(await page.locator('#updated-at').innerText()).includes('Stale'));
    }
    scenario='rollover';await page.evaluate(()=>{datePreset='last_7d';updateDateLabel();return loadData({force:true});});
    assert.equal(await page.locator('#panel-czsk-leadgen').isVisible(),false,'different selected scope must not relabel last-good');
    assert.match(await page.locator('#error').innerText(),/No results.*selected range/);
    scenario='fresh';await page.evaluate(()=>loadData({force:true}));await ready();
    await page.locator('[data-tab="wl"]').click();
    for(const wlCase of ['rollover','age-stale','flag-stale']){
     scenario=wlCase;await page.evaluate(()=>GlvWlUI.load(true));
     assert.match(await page.locator('#wl-status').innerText(),/unavailable/);assert.equal(await page.locator('#wl-results').innerText(),'');
     freshnessChecks.push({width,theme,currency,scenario:'wl-'+wlCase});
    }
    scenario='fresh';await page.evaluate(()=>GlvWlUI.load(true));assert.match(await page.locator('#wl-status').innerText(),/Source refreshed/);
    scenario='promo-stale';await page.locator('[data-tab="czsk-promo-creative"]').click();await page.evaluate(()=>refreshPromoConceptHistory());
    await page.waitForFunction(()=>document.querySelector('#promo-concept-status').textContent.includes('Stale'));
    assert.match(await page.locator('#promo-format-status').innerText(),/Stale/);
    freshnessChecks.push({width,theme,currency,scenario:'promo-stale'});
    scenario='fresh';await page.evaluate(()=>refreshPromoConceptHistory());
    await page.waitForFunction(()=>!document.querySelector('#promo-concept-status').textContent.includes('Stale'));
    await page.locator('[data-tab="us"]').click();
    assert.equal(await page.evaluate(()=>aggregate(getMainSegmentRows('us','aggregate')).spend),currency==='USD'?300:7500);
    assert.equal(await page.evaluate(()=>aggregateCampaigns.filter(r=>r.segment==='us').some(r=>r.name==='AS | PPE | US')),true);
    assert.equal(await page.locator('#v2-naming-warnings').isVisible(),true);
   }
  }
  await page.locator('[data-tab="us"]').click();
  await page.locator('#filter-toggle-tab-us-campaign').click();await page.locator('#filter-dropdown-tab-us-campaign').getByRole('button',{name:'None',exact:true}).click();assert.equal(await page.evaluate(()=>getMainSegmentRows('us','aggregate').length),0);
  await page.locator('#filter-dropdown-tab-us-campaign').getByRole('button',{name:'Select all',exact:true}).click();await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>getMainSegmentRows('us','aggregate').length),3);
  await page.locator('[data-tab="wl"]').click();await page.locator('#wl-campaign').selectOption('__none');assert.ok((await page.locator('#wl-results').textContent()).includes('No WL ads'));await page.locator('#wl-campaign').selectOption('__all');
  for(const account of ['TGLV','TUC','All']){
   await page.locator('#v2-account').selectOption(account);await page.waitForURL(u=>u.searchParams.get('account')===account);await ready();
   const counts=await page.evaluate(()=>({cz:aggregateCampaigns.filter(r=>r.segment==='czsk').length,us:aggregateCampaigns.filter(r=>r.segment==='us').length,unique:new Set(aggregateCampaigns.map(r=>r.id)).size,total:aggregateCampaigns.length}));
   assert.equal(counts.unique,counts.total);assert.equal(counts.cz,account==='TGLV'?0:2);assert.equal(counts.us,account==='TUC'?1:account==='TGLV'?2:3);
   await page.locator('[data-tab="czsk-triage"]').click();
   if(width<=720)await page.locator('#mobile-controls-toggle').click();
   for(const market of ['us','all','czsk']){await page.locator('#triage-market').selectOption(market);assert.equal(await page.evaluate(()=>getTriageSegmentRows().some(r=>r.name==='AS | PPE | US')),account!=='TUC'&&market!=='czsk');}
  }
  await page.reload();await ready();assert.equal(await page.locator('#v2-account').inputValue(),'All');assert.equal(await page.locator('#v2-currency').inputValue(),'CZK');
  const before=requests.filter(r=>r.type==='promo_formats').length;await page.evaluate(()=>refreshPromoConceptHistory());assert.ok(requests.filter(r=>r.type==='promo_formats').length>before,'concept refresh makes new scoped request');
  failure=true;await page.evaluate(()=>loadData({force:true}));assert.equal(await page.locator('#error').isVisible(),true);failure=false;await page.evaluate(()=>loadData({force:true}));await ready();
  scenario='rollover';await page.reload();await page.waitForFunction(()=>document.querySelector('#loading').style.display==='none');
  assert.match(await page.locator('#error').innerText(),/No results shown for the selected range/);
  assert.equal(await page.locator('#panel-czsk').isVisible(),false);
  assert.equal(await page.evaluate(()=>aggregateCampaigns.length+dailyCampaigns.length+adCreatives.length),0);
  scenario='fresh';await page.evaluate(()=>loadData({force:true}));await ready();
  freshnessChecks.push({width,scenario:'cold-start-rollover-and-recovery'});
  designInteractions.push(await design.interactions(page,width,evidence));
  await page.screenshot({path:path.join(evidence,`${width}-recovered.png`),fullPage:true});await context.close();
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(evidence,'results.json'),JSON.stringify({fixture:'SYNTHETIC ONLY; no live Meta calls',checks,freshnessChecks,designChecks,designInteractions,errors,requests:requests.length},null,2));console.log(JSON.stringify({passed:true,states:checks.length,freshnessStates:freshnessChecks.length,errors,evidence}));
 }finally{await browser.close();await new Promise(r=>app.close(r));}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
