// Synthetic fixtures only: browser behavior evidence, NOT live Meta reconciliation.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..'),pub=path.join(root,'public');
const dates=require('../public/glv-meta-ads-v2/dates.js');
const {renderSnapshot}=require('../lib/glv-mad-v2-source.cjs');
const evidence=process.env.GLV_V2_EVIDENCE||'/home/tom/.hermes/cache/scratch/mad-v2-browser-isolated';fs.mkdirSync(evidence,{recursive:true});
const design=require('./mad-v2-design.cjs'),designChecks=[],designInteractions=[];
const requests=[],checks=[],errors=[],freshnessChecks=[],expectedHttpFailures=[];let failure=false,scenario='fresh';
// Fixed reporting clock, real animation timers: fixtures are never live data.
const clock='2026-11-15T12:00:00.000Z',stamp='2026-11-15T09:00:00.000Z';
const RealDate=Date;
global.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return +new RealDate(clock);}};
const runtime=require('../lib/glv-mad-v2-isolated.cjs');
const publication=require('../lib/glv-history-publication.cjs');

const fixtureAudits=[],chartChecks=[],productFailures=[];
async function verify(label,fn){try{await fn();}catch(error){productFailures.push({label,error:error.stack});fs.writeFileSync(path.join(evidence,'product-failures.json'),JSON.stringify(productFailures,null,2));}}

const read=async key=>store.has(key)?JSON.parse(store.get(key)):null;
const write=async(key,value)=>store.set(key,JSON.stringify(value));
async function publish(key,pieces,validate){
 await publication.publishBundle({key,pieces,validate,write});
 if(validate!==invalidFixture){const actual=await publication.readBundle({key,read,validate});assert.equal(publication.digest(actual),publication.digest(pieces));}
}
// Invalid publications deliberately have valid hashes, but incompatible facts.
// The ACTUAL reader must reject them; never bypass its validation in responses.
const invalidFixture=()=>{};
async function seedPublication(q){
 const scope=require('../lib/glv-mad-v2-isolated-reader.cjs').scope(Object.fromEntries(q));
 const requested=scope.range;
 const priorEnd=dates.shift(requested.since,-1);
 const range=scenario==='rollover'?{since:priorEnd.slice(0,7)+'-01',until:priorEnd}:requested;
 const preset=scope.custom?'last_90d':scope.preset;
 const generated=scenario==='age-stale'?new Date(Date.parse(stamp)-26*3600000).toISOString():stamp;
 const bundles={},coverage=[];
 for(const account of dates.ACCOUNTS){
  const partial=scenario==='partial'&&account.label==='TGLV';
  const completeThrough=partial?dates.shift(range.until,-1):range.until;
  const pieces={};
  for(const type of runtime.TYPES){
   const query=new URLSearchParams(q);query.set('type',type);
   const native=payload(query,true,range),a=native.accounts.find(a=>a.id===account.id);
   // A partial day is unobserved, not a synthetic measured zero.
   const observedDays=[dates.shift(completeThrough,-1),completeThrough].filter(d=>d>=range.since);
   a.rows=a.rows.flatMap(original=>observedDays.map(day=>{const row=structuredClone(original);const scale=r=>{r.date_start=day;r.date_stop=day;for(const key of Object.keys(r))if(typeof r[key]==='number'&&key!=='reach')r[key]/=observedDays.length;for(const child of r.creator_rows||[])scale(child);};scale(row);return row;}));
   const metrics=['actions:outbound_click','video_p100_watched_actions'];
   const fill=row=>{row.account_id=account.id;for(const metric of metrics)row[metric]??=0;for(const child of row.creator_rows||[])fill(child);};a.rows.forEach(fill);
   const fx=Object.fromEntries([range.until,...observedDays].map(d=>[d,{date:d,czk_per_usd:25,provider:'SYNTHETIC QA ONLY'}]));
   if(account.label==='TUC'&&type!=='daily'){
    const rows=require('./mad-full-parity.cjs').aggregateNative(a.rows,range);
    const period=row=>{if(type==='aggregate'){row.date_start=range.since;row.date_stop=range.until;}for(const child of row.creator_rows||[])period(child);};rows.forEach(period);
    a.direct_observation={version:1,account_id:account.id,type,range:{...range},generated_at:generated,basis:'native_direct_period',rows};
   }
   pieces[type]={...native,fx,generated_at:generated,observation_contract:'account-local-direct-v1',isolated_account_id:account.id,accounts:[a],partial,complete_through:completeThrough,refresh_mode:'morning',refresh_through:requested.until,source_extractions:[{account_id:account.id,type,range:{...range},generated_at:generated,basis:'SYNTHETIC observed daily facts'}]};
  }
  const generation=publication.digest(pieces);for(const type of runtime.TYPES)pieces[type].generation_id=generation;
  await publish(runtime.accountKey(account.id,preset),pieces,runtime.validateNative);
  bundles[account.id]=pieces;
  coverage.push({account_id:account.id,range,complete_through:completeThrough,partial,generated_at:generated});
 }
 const generation=publication.digest({range,coverage,bundles});
 const pieces=Object.fromEntries(runtime.TYPES.map(type=>[type,{type,range,through:requested.until,date_policy:'account-isolated',generation_id:generation,account_coverage:coverage,account_bundles:Object.fromEntries(Object.entries(bundles).map(([id,p])=>[id,p[type]]))}]));
 if(scenario==='mixed-range')pieces.daily={...pieces.daily,range:{...range,until:dates.shift(range.until,-1)}};
 if(scenario==='mixed-generation')pieces.ads={...pieces.ads,generation_id:'SYNTHETIC incompatible generation'};
 const invalid=['mixed-range','mixed-generation'].includes(scenario);
 await publish(runtime.combinedKey(preset),pieces,invalid?invalidFixture:runtime.validateCombined);
 // Exact custom reads use the same real isolated immutable publication contract.
 if(scope.custom&&scenario==='rollover')await publish(runtime.combinedKey(require('../lib/glv-mad-v2-isolated-custom.cjs').slot(requested)),pieces,runtime.validateCombined);
 fixtureAudits.push({scenario,type:scope.type,requested,actual:range,generation,coverage,invalid});
}
async function seedPromo(q){
 const promo=require('../lib/glv-mad-v2-isolated-promo.cjs');
 const requested=require('../lib/glv-mad-v2-isolated-reader.cjs').scope(Object.fromEntries(q)).range;
 const range={...requested,until:scenario==='promo-stale'?dates.shift(requested.until,-1):requested.until};
 const payload={...require('./mad-full-parity.cjs').promoPayload(),range,generated_at:stamp,rows:[{ad_id:'promo',ad_name:'SYNTHETIC CC001 PAC001 Video',adset_id:'s0',adset_name:'Video',campaign_id:'1',campaign_name:'TUC_001_CZSK_Promo_SYNTHETIC',date:range.until,format:'Video',reason:'synthetic_fixture',spend:2500,revenue:7500,purchases:10,impressions:1000,link_clicks:100,landing_page_views:80,checkouts:20}]};
 const fx=Object.fromEntries(payload.rows.map(r=>[r.date,{date:r.date,czk_per_usd:25,provider:'SYNTHETIC QA ONLY'}]));
 const snapshot={payload,fx},generation_id=publication.digest(snapshot);
 await publish(promo.KEY,{daily:{range,generation_id,snapshot},aggregate:{range,generation_id},ads:{range,generation_id}},promo.validate);
}
const reader=require('../api/glv-meta-ads-v2/fb-data.js');
// Only synthetic in-memory GETs. No credentials loaded, no external transport.
Object.assign(process.env,{GLV_MAD_V2_ENABLED:'1',GLV_META_BETA_AUTH_TOKEN:'synthetic-browser-auth',KV_REST_API_URL:'https://synthetic.invalid',KV_REST_API_TOKEN:'synthetic-only',UPSTASH_REDIS_REST_URL:'https://synthetic.invalid',UPSTASH_REDIS_REST_TOKEN:'synthetic-only'});
const store=new Map();global.fetch=async (url,options={})=>{
 const u=new URL(url);assert.equal(u.origin,'https://synthetic.invalid');if(options.method==='POST'){assert.equal(scenario,'rollover');return {ok:false,status:503,json:async()=>({error:'SYNTHETIC custom recovery unavailable'})};}assert.ok(u.pathname.startsWith('/get/'));
 return {ok:true,status:200,json:async()=>({result:store.get(decodeURIComponent(u.pathname.slice(5)))||null})};
};
function payload(q,raw=false,overrideRange=null){
 const type=q.get('type'),currency=q.get('currency'),account=q.get('account');
 const range=overrideRange|| (q.has('time_range')?JSON.parse(q.get('time_range')):type==='promo_formats'?{since:'2026-03-01',until:dates.commonCutoff()}:dates.rangeFor(q.get('date_preset')));
 if(type==='promo_formats')return {schema_version:1,classification_version:2,funnel_version:1,reconciled:true,generated_at:stamp,range,account_filter:account,report_currency:currency,rows:account==='TGLV'?[]:[{ad_id:'359758259164738:promo',ad_name:'SYNTHETIC CC001 PAC001 Video',adset_id:'359758259164738:s',adset_name:'Video',campaign_id:'359758259164738:1',campaign_name:'TUC_001_CZSK_Promo_SYNTHETIC',date:range.until,format:'Video',reason:'synthetic_fixture',spend:currency==='USD'?100:2500,revenue:currency==='USD'?300:7500,purchases:10,impressions:1000,link_clicks:100,landing_page_views:80,checkouts:20}]};
 const accounts=dates.ACCOUNTS.map((a,i)=>({...a,rows:(i?['TGLV_001_US_SYNTHETIC','AS | PPE | US']:['TUC_001_CZSK_Promo_SYNTHETIC','TUC_002_US_WL_Kristyna_SYNTHETIC','TUC_003_CZSK_Leads_SYNTHETIC']).map((name,j)=>({id:String(j+1),name:type==='ads'?'SYNTHETIC PAC001 V1':name,...(type==='ads'?{campaign_id:String(j+1),campaign_name:name,adset_id:'s'+j,adset_name:'Kristyna',partnership:{status:'verified_positive',reason:'sponsor_metadata',evidence:['facebook_branded_content.sponsor_page_id']}}:{}),date_start:range.until,date_stop:range.until,amount_spent:i?100:2500,'action_values:omni_purchase':i?300:7500,impressions:1000,reach:500,'actions:link_click':100,'actions:landing_page_view':80,'actions:omni_purchase':10,'actions:initiate_checkout':20,'actions:lead':j===2?5:0,video_thruplay_watched_actions:50,video_3_sec_watched_actions:100})),reach:[]}));
 if(type!=='ads')for(const account of accounts)account.rows=require('../lib/glv-wl-creators.cjs').attachCreatorFacts(account.rows,account.rows.filter(r=>r.name.includes('_WL')).map(r=>({...r,ad_id:'creator-'+r.id,ad_name:'Kristyna_PAC419_v6-9',adset_id:'AS13',adset_name:'AS13_Purchase_Videos_WL_KPI'})));
 const snapshot={schema_version:1,creator_ad_version:1,complete:true,type,range,generated_at:stamp,accounts,fx:{[range.until]:{date:range.until,czk_per_usd:25,provider:'SYNTHETIC QA ONLY'}}};
 return raw?snapshot:renderSnapshot(snapshot,currency,account);
}
let pending=Promise.resolve();
const app=http.createServer(async(req,res)=>{
 const prior=pending;let release;pending=new Promise(r=>release=r);await prior;
 try{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname==='/api/glv-meta-ads-v2/fb-data'){
  requests.push(Object.fromEntries(u.searchParams));
  // A valid HTTP JSON application error exercises UI failure without expected network-console noise.
  const q=u.searchParams,type=q.get('type');
  if(failure){res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({error:'SYNTHETIC source unavailable'}));return;}
  if(type.startsWith('promo_'))await seedPromo(q);else await seedPublication(q);
  // Execute the actual API reader through its synthetic Redis GET boundary.
  await reader({method:'GET',headers:{cookie:'glv_meta_beta=synthetic-browser-auth'},query:Object.fromEntries(q)},{
   setHeader:(k,v)=>res.setHeader(k,v),status(n){res.statusCode=n;return this;},json(body){
    if(res.statusCode===503){assert.ok((['mixed-range','mixed-generation'].includes(scenario)||scenario==='rollover'&&q.has('time_range')),'only intentionally incoherent or unavailable custom fixtures may be unavailable');expectedHttpFailures.push({scenario,type});}
    if(scenario==='mixed-account'&&type==='aggregate')body.account_filter='TUC';
    if(scenario==='flag-stale')body.stale=true;
    res.setHeader('content-type','application/json');res.end(JSON.stringify(body));
   }
  });return;
 }
 let file=path.join(pub,decodeURIComponent(u.pathname));if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
 if(!file.startsWith(pub)||!fs.existsSync(file)){res.writeHead(404).end();return;}
 res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'})[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
 }catch(e){errors.push(e.stack);fs.writeFileSync(path.join(evidence,'server-error.txt'),e.stack);res.writeHead(500).end('Synthetic fixture failure');}finally{release();}
});
async function run(){
 await new Promise(r=>app.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.address().port}/glv-meta-ads-v2/`;
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/home/tom/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',headless:true,args:['--no-sandbox'],env:{...process.env,LD_LIBRARY_PATH:'/home/tom/.cache/hermes-browser-libs/root/usr/lib/x86_64-linux-gnu:/home/tom/.cache/hermes-browser-libs/root/usr/lib'}});
 try{
 for(const width of (process.env.GLV_V2_WIDTH?[Number(process.env.GLV_V2_WIDTH)]:[1440,1200,1100,1024,800,768,721,720,390,320])){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),page=await context.newPage();
  const screenshot=page.screenshot.bind(page);
  page.screenshot=async options=>{await page.evaluate(async()=>{await document.fonts.ready;if(window.Chart)Chart.defaults.animation=false;if(typeof charts!=='undefined')Object.values(charts).forEach(c=>{c.stop();c.options.animation=false;c.update('none');});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});return screenshot({...options,timeout:60000});};
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.clock.setFixedTime(new Date(clock));
  // Frozen Date must not freeze Chart.js tween progress; no data/style overrides.
  await page.addInitScript(()=>document.addEventListener('load',e=>{if(e.target.tagName==='SCRIPT'&&e.target.src.includes('chart.js')&&window.Chart)Chart.defaults.animation=false;},true));
  await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin===new URL(base).origin)return route.continue();if(u.hostname==='cdn.jsdelivr.net'){const name=u.pathname.includes('chart.js')?'chart.js':u.pathname.endsWith('.css')?'grid.css':'grid.js';return route.fulfill({path:'/home/tom/glv-creator-ghost-evidence/vendor/'+name,contentType:name.endsWith('.css')?'text/css':'text/javascript'});}if(u.hostname==='api.frankfurter.dev')return route.fulfill({json:{rates:{USD:.04}}});return route.abort();});
  const ready=async()=>{await page.waitForFunction(()=>document.querySelector('#loading').style.display==='none');assert.equal(await page.locator('#error').isVisible(),false,await page.locator('#error').textContent());};
  await page.goto(base);await ready();assert.equal(await page.locator('#v2-currency').inputValue(),'USD');
  assert.ok((await page.locator('#v2-date-note').textContent()).includes(dates.commonCutoff()),'Prague reporting cutoff is explicit');
  assert.match(await page.locator('#v2-date-note').innerText(),/TUC reporting cutoff:.*TGLV completes separately/);
  if(width<=720){assert.ok(await page.locator('.header-brand').evaluate(el=>el.getBoundingClientRect().height<=44),'mobile branding must fit header');await page.locator('#mobile-controls-toggle').click();assert.ok(await page.evaluate(()=>{const a=document.querySelector('#v2-currency').getBoundingClientRect(),b=document.querySelector('#theme-toggle').getBoundingClientRect();return Math.abs(a.top-b.top)<15&&a.right<=b.left;}),'global currency/theme stay together while filters open');await page.locator('#mobile-controls-toggle').click();}
  for(const theme of ['dark','light']){
   if(await page.locator('html').getAttribute('data-theme')!==theme)await page.locator('#theme-toggle').click();
   for(const currency of ['USD','CZK']){
    if(await page.locator('#v2-currency').inputValue()!==currency){await page.locator('[data-tab="wl"]').click();await page.locator('#v2-currency').selectOption(currency);await page.waitForURL(u=>u.searchParams.get('currency')===currency);await ready();assert.equal(await page.locator('[data-tab="wl"]').getAttribute('aria-selected'),'true');await page.waitForFunction(()=>document.querySelector('#wl-status')?.textContent.includes('Source refreshed'),{},{timeout:5000});}
    for(const tab of ['czsk','us','czsk-triage','czsk-promo','czsk-promo-creative','czsk-leadgen','wl']){
     if(process.env.GLV_QA_TRACE)console.log({width,theme,currency,tab});
     await page.locator(`[data-tab="${tab}"]`).click();
     if(tab==='wl')await page.waitForFunction(()=>document.querySelector('#wl-status')?.textContent.includes('Source refreshed'));
     assert.equal(await page.locator('#panel-'+tab).isVisible(),true);
     if(tab==='czsk-promo-creative')await verify(`${width}/${theme}/${currency}/promo-population`,async()=>{await page.waitForFunction(()=>!/Loading/.test(document.querySelector('#promo-concept-status').textContent));assert.ok(!(await page.locator('#promo-concept-status').textContent()).includes('unavailable'),await page.locator('#promo-concept-status').textContent());await page.locator('#promo-concept-table tbody tr').first().waitFor();assert.ok(await page.locator('#promo-format-table tbody tr').count()>0);});
     if(tab==='czsk-leadgen')assert.ok(await page.locator('#leadgen-table tbody tr').count()>0);
     if(tab==='czsk-promo')assert.ok(await page.locator('#promo-table tbody tr').count()>0);
     if(tab==='czsk-triage')assert.equal(await page.evaluate(()=>TRIAGE_PRESETS.every(p=>charts['triage-'+p.id]?.data.labels.length>0)),true);
     await page.evaluate(async()=>{await document.fonts.ready;Object.values(charts).forEach(c=>{c.stop();c.options.animation=false;c.resize();c.update('none');});window.scrollTo(0,0);});
     const rendered=await page.evaluate(()=>Object.entries(charts).filter(([,c])=>c.canvas.closest('.panel.active')&&c.canvas.getClientRects().length).map(([id,c])=>{
      const datasets=c.data.datasets.map((d,i)=>({label:d.label,values:d.data,points:c.getDatasetMeta(i).data.filter(p=>!p.skip&&Number.isFinite(p.x)&&Number.isFinite(p.y)).length}));
      const a=c.chartArea,r=c.currentDevicePixelRatio||1;let coloredPixels=0;
      if(a&&a.width>0&&a.height>0){const pixels=c.ctx.getImageData(Math.ceil(a.left*r)+2,Math.ceil(a.top*r)+2,Math.max(1,Math.floor(a.width*r)-4),Math.max(1,Math.floor(a.height*r)-4)).data;for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>80&&Math.max(pixels[i],pixels[i+1],pixels[i+2])-Math.min(pixels[i],pixels[i+1],pixels[i+2])>35)coloredPixels++;}
      return {id,type:c.config.type,datasets,coloredPixels,width:c.width,height:c.height};
     }));
     for(const chart of rendered){assert.ok(chart.width>0&&chart.height>0,chart.id);if(chart.datasets.some(d=>d.values.some(v=>typeof v==='number'&&v>0))){assert.ok(chart.datasets.some(d=>d.points>0),`no drawable points: ${chart.id}`);assert.ok(chart.coloredPixels>0,`nonzero datasets but no rendered colored plot pixels: ${chart.id}`);}}
     if(['czsk','us'].includes(tab))assert.ok(rendered.some(c=>c.datasets.some(d=>d.values.filter(v=>typeof v==='number'&&v>0).length>=2)),`${tab} must have two observed daily values, not just axes`);
     chartChecks.push({width,theme,currency,tab,rendered});
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
    for(const staleCase of ['rollover','mixed-range','mixed-generation','mixed-account','age-stale','partial']){
     scenario=staleCase;await page.evaluate(()=>loadData({force:true}));
     assert.equal(await page.locator('#error').isVisible(),true,staleCase);
     const status=await page.locator('#error').innerText();assert.match(status,/stale|generation|scope|range|refreshed|partial|publication/i);
     await design.header(page);
     if(['mixed-range','mixed-generation','mixed-account'].includes(staleCase))assert.equal(await page.evaluate(()=>JSON.stringify([aggregateCampaigns,dailyCampaigns,adCreatives])),good,'invalid bundle must never replace last-good');
     else {assert.match(await page.locator('#updated-at').innerText(),/Stale last-good.*actual range/);assert.match(await page.evaluate(()=>lastGoodLabel),/^Stale last-good/);assert.ok(!status.includes('Mixed source generations'));assert.match(status,/pending|not refreshed|partial|available/i);}
     for(const affected of ['czsk','us','czsk-triage','czsk-promo','czsk-leadgen']){await page.locator(`[data-tab="${affected}"]`).click();assert.equal(await page.locator('#error').isVisible(),true);}
     await page.screenshot({path:path.join(evidence,`${width}-${theme}-${currency}-${staleCase}.png`),fullPage:true});
     freshnessChecks.push({width,theme,currency,scenario:staleCase,status});
     scenario='fresh';await page.evaluate(()=>loadData({force:true}));await ready();assert.ok(!(await page.locator('#updated-at').innerText()).includes('Stale'));
    }
    scenario='rollover';await page.evaluate(()=>{datePreset='last_7d';updateDateLabel();return loadData({force:true});});
    assert.equal(await page.locator('#panel-czsk-leadgen').isVisible(),true,'coherent retained history remains available under its actual range');
    assert.match(await page.locator('#error').innerText(),/Selected dates.*showing latest available/);
    assert.match(await page.locator('#updated-at').innerText(),/Stale last-good.*actual range/);
    scenario='fresh';await page.evaluate(()=>loadData({force:true}));await ready();
    await page.locator('[data-tab="wl"]').click();
    const wlGood=await page.locator('#wl-results').innerText();assert.ok(wlGood.length>0);
    for(const wlCase of ['rollover','age-stale','flag-stale']){
     scenario=wlCase;await page.evaluate(()=>GlvWlUI.load(true));
     assert.match(await page.locator('#wl-status').innerText(),wlCase==='rollover'?/Stale last-good retained.*Refresh unavailable/:/Source refreshed.*newer data pending/);
     assert.equal(await page.locator('#wl-results').innerText(),wlGood,'failed or aged exact-range WL refresh preserves the known report');
     freshnessChecks.push({width,theme,currency,scenario:'wl-'+wlCase});
    }
    scenario='fresh';await page.evaluate(()=>GlvWlUI.load(true));assert.match(await page.locator('#wl-status').innerText(),/Source refreshed/);
    scenario='promo-stale';await page.locator('[data-tab="czsk-promo-creative"]').click();await page.evaluate(()=>refreshPromoConceptHistory());
    await verify(`${width}/${theme}/${currency}/promo-stale`,async()=>{await page.waitForFunction(()=>!/Loading/.test(document.querySelector('#promo-concept-status').textContent));for(const id of ['promo-concept-status','promo-format-status']){const text=await page.locator('#'+id).innerText();assert.match(text,/later days not refreshed yet/);assert.ok(text.includes('2026-03-01 → '+dates.shift(dates.commonCutoff(),-1)),'actual retained range must be disclosed');assert.match(text,/TUC: missing days/);assert.doesNotMatch(text,/Incompatible account coverage/);}});
    freshnessChecks.push({width,theme,currency,scenario:'promo-stale'});
    scenario='fresh';await page.evaluate(()=>refreshPromoConceptHistory());
    await page.waitForFunction(()=>!/(Stale|missing days|not refreshed yet)/.test(document.querySelector('#promo-concept-status').textContent));
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
  assert.match(await page.locator('#error').innerText(),/Selected dates.*showing latest available/);
  assert.equal(await page.locator('#panel-czsk-triage').isVisible(),true,'retained history preserves the selected tab');
  assert.ok(await page.evaluate(()=>aggregateCampaigns.length>0&&dailyCampaigns.length>0&&adCreatives.length>0),'cold load retains coherent history with truthful coverage');
  scenario='fresh';await page.evaluate(()=>loadData({force:true}));await ready();
  freshnessChecks.push({width,scenario:'cold-start-rollover-and-recovery'});
  designInteractions.push(await design.interactions(page,width,evidence));
  await page.screenshot({path:path.join(evidence,`${width}-recovered.png`),fullPage:true});await context.close();
 }
 assert.deepEqual(errors,expectedHttpFailures.map(()=> 'Failed to load resource: the server responded with a status of 503 (Service Unavailable)'),'only the exact intentionally rejected reader responses may log network errors');
 fs.writeFileSync(path.join(evidence,'results.json'),JSON.stringify({fixture:'SYNTHETIC ONLY; no live Meta calls',fixtureAudits,chartChecks,productFailures,checks,freshnessChecks,designChecks,designInteractions,expectedHttpFailures,unexpectedErrors:[],requests:requests.length},null,2));assert.deepEqual(productFailures,[],'product assertions failed; full evidence retained');console.log(JSON.stringify({passed:true,states:checks.length,freshnessStates:freshnessChecks.length,expectedHttpFailures:expectedHttpFailures.length,unexpectedErrors:[],evidence}));
 }catch(e){for(const context of browser.contexts())for(const page of context.pages()){fs.writeFileSync(path.join(evidence,'failure.json'),JSON.stringify({error:e.stack,errors,requests,fixtureAudits,body:await page.locator('body').innerText(),charts:await page.evaluate(()=>Object.entries(charts).map(([id,c])=>({id,data:c.data})))},null,2));await page.screenshot({path:path.join(evidence,'failure.png'),fullPage:true});}throw e;}finally{await browser.close();await new Promise(r=>app.close(r));}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
