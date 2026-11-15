'use strict';
// Historical filename; actual independent V1/native and V2/isolated handlers.
// Synthetic publications only. No credentials loaded and no external network.
const runtime=require('../lib/glv-mad-v2-isolated.cjs');
const storage=require('../lib/glv-mad-v2-storage.cjs'),fixture=require('./mad-full-parity.cjs');
const reader=require('../lib/glv-mad-v2-isolated-reader.cjs');
function create({clock='2026-11-11T12:00:00Z'}={}){
 const values=new Map(),bundles=new Map(),audit=[];let failWrite=false,hold=false,now=clock;
 const previous={env:{...process.env},fetch:global.fetch,Date:global.Date};
 class Clock extends previous.Date{constructor(...a){super(...(a.length?a:[now]));}static now(){return +new previous.Date(now);}}
 global.Date=Clock;
 Object.assign(process.env,{GLV_MAD_V2_ENABLED:'1',GLV_META_BETA_AUTH_TOKEN:'offline-qa-only',KV_REST_API_URL:'https://redis.invalid',KV_REST_API_TOKEN:'offline-qa-only'});
 delete process.env.UPSTASH_REDIS_REST_URL;delete process.env.UPSTASH_REDIS_REST_TOKEN;
 const redis=async(cmd,k,val,...args)=>{audit.push({cmd,key:k});if(cmd==='GET')return {result:values.get(k)||null};if(cmd==='TTL')return {result:values.has(k)?-1:-2};if(cmd==='PERSIST')return {result:values.has(k)?1:0};if(cmd==='EVAL'){if(values.get(args[0])===args[1])values.delete(args[0]);return {result:1};}if(cmd==='SET'){if(failWrite&&k.includes(':piece:aggregate:'))throw Error('Injected partial publication failure');if(args.includes('NX')&&values.has(k))return {result:null};values.set(k,val);return {result:'OK'};}throw Error('Unexpected offline command '+cmd);};
 const response=body=>({ok:true,status:200,json:async()=>body,text:async()=>JSON.stringify(body)});
 // V1 intentionally has no custom publication cache. Exercise its actual Graph
 // normalization boundary with synthetic raw observations, never a reader adapter.
 process.env.GLV_META_FB_ACCESS_TOKEN='offline-qa-only';
 global.fetch=async(url,options={})=>{
  const u=new URL(url);
  if(u.hostname==='graph.facebook.com'){
   audit.push({syntheticGraph:true,path:u.pathname});
   if(u.searchParams.has('ids'))return response(Object.fromEntries(u.searchParams.get('ids').split(',').map(id=>[id,{effective_status:'ACTIVE',creative:{facebook_branded_content:{sponsor_page_id:'123'}}}])));
   if(!u.pathname.includes('/act_359758259164738/insights'))throw Error('Unexpected synthetic Graph query');
   const range=JSON.parse(u.searchParams.get('time_range')),ad=u.searchParams.get('level')==='ad',daily=u.searchParams.get('time_increment')==='1';
   const native=fixture.fixture(range,ad?'ads':'daily').accounts[0].rows;
   const rows=daily?native:fixture.aggregateNative(native,range);
   return response({data:rows.map(r=>({...(ad?{ad_id:r.id,ad_name:r.name,campaign_id:r.campaign_id,campaign_name:r.campaign_name,adset_id:r.adset_id,adset_name:r.adset_name}:{campaign_id:r.id,campaign_name:r.name}),date_start:r.date_start,date_stop:r.date_stop,spend:String(r.amount_spent),impressions:String(r.impressions),reach:String(r.reach),actions:Object.entries(r).filter(([k])=>k.startsWith('actions:')).map(([k,value])=>({action_type:k.slice(8),value:String(value)})),action_values:Object.entries(r).filter(([k])=>k.startsWith('action_values:')).map(([k,value])=>({action_type:k.slice(14),value:String(value)}))}))});
  }
  if(u.hostname!=='redis.invalid')throw Error('Offline network denied: '+u.origin);
  return response(u.pathname.startsWith('/get/')?await redis('GET',decodeURIComponent(u.pathname.slice(5))):await redis(...JSON.parse(options.body)));
 };
 const read=k=>Promise.resolve(values.has(k)?storage.decode(values.get(k)):null);
 async function seed(s,v2){
  const key=s.promo?'promo':s.custom?require('../lib/glv-mad-v2-isolated-custom.cjs').slot(s.range):s.preset;
  const identity=(v2?'v2:':'v1:')+key+':'+JSON.stringify(s.range);
  if(hold)return;if(bundles.has(identity))return bundles.get(identity);
  const pending=(async()=>{
   const stamp=new Date(Date.now()-3*3600000).toISOString();
   if(s.promo){
    const payload={...fixture.promoPayload(),range:s.range,generated_at:stamp};
    if(v2)await require('../lib/glv-mad-v2-isolated-promo.cjs').refresh({redis,through:s.range.until,now:new Date(),fetchPromo:async()=>payload,loadFx:async()=>({'2026-10-20':{date:'2026-10-20',czk_per_usd:25,provider:'SYNTHETIC QA ONLY'},'2026-10-21':{date:'2026-10-21',czk_per_usd:25,provider:'SYNTHETIC QA ONLY'}})});
    else await redis('SET',require('../lib/glv-promo-format.cjs').CACHE_KEY,JSON.stringify(payload));
   }else if(v2){
    const result=await runtime.refresh({redis,now:new Date(),presets:[key],ranges:{[key]:s.range},includePromo:false,token:'synthetic',loadFx:async()=>({}),build:async({account,type,range})=>{const native=fixture.fixture(range,type);return {...native,generated_at:stamp,isolated_account_id:account.id,accounts:native.accounts.filter(a=>a.id===account.id)};}});
    if(!result.verified)throw Error('Synthetic isolated publication failed: '+JSON.stringify(result.errors));
   }else{
    if(s.custom)return; // Actual V1 handler extracts through synthetic Graph above.
    const pieces=Object.fromEntries(['daily','aggregate','ads'].map(type=>[type,{...fixture.legacyPayload(fixture.fixture(s.range,type),type,s.range),generated_at:stamp}]));
    await require('../lib/glv-history-v1.cjs').savePublished((k,p)=>redis('SET',k,JSON.stringify(p)),key,pieces,read,redis);
   }
  })();bundles.set(identity,pending);try{await pending;}catch(e){bundles.delete(identity);throw e;}
 }
 async function request(q,v2,{authorized=true,method='GET'}={}){
  let s;try{s=reader.scope(Object.fromEntries(q),new Date());}catch{}
  if(s&&authorized&&method==='GET')await seed(s,v2);
  const res={code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(body){this.body=body;return this;}};
  await require(v2?'../api/glv-meta-ads-v2/fb-data.js':'../api/glv-meta-ads/fb-data.js')({method,headers:{cookie:authorized?'glv_meta_beta=offline-qa-only':''},query:Object.fromEntries(q)},res);
  audit.push({handler:v2?'v2':'v1',status:res.code,type:q.get('type'),requestedRange:res.body?.requested_range,readGeneration:res.body?.generation_id,range:res.body?.range});return res;
 }
 async function payload(q,v2){const r=await request(q,v2);if(r.code!==200)throw Error('Handler '+r.code+': '+JSON.stringify(r.body));return r.body;}
 return {payload,request,audit,redis,read,values,reset(){values.clear();bundles.clear();hold=false;},setFailure:x=>{failWrite=x;},hold:x=>{hold=x;},setClock:x=>{now=x;},close(){global.fetch=previous.fetch;global.Date=previous.Date;process.env=previous.env;}};
}
async function browserProof(){
 const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
 const {chromium}=require('playwright-core'),transport=create(),checks=[],errors=[];
 const evidence=process.env.MAD_INDEPENDENT_EVIDENCE||'/home/tom/.hermes/cache/scratch/mad-independent-browser';
 const pub=path.resolve(__dirname,'../public');fs.mkdirSync(evidence,{recursive:true});
 const app=http.createServer(async(req,res)=>{
  try{
   const u=new URL(req.url,'http://localhost');
   if(u.pathname.startsWith('/api/')){
    const result=await transport.request(u.searchParams,u.pathname.includes('-v2/'));
    res.writeHead(result.code,{'content-type':'application/json'}).end(JSON.stringify(result.body));return;
   }
   let file=path.join(pub,decodeURIComponent(u.pathname));if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
   if(!file.startsWith(pub)||!fs.existsSync(file)){res.writeHead(404).end();return;}
   res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'})[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
  }catch(e){errors.push(e.stack);res.writeHead(500,{'content-type':'application/json'}).end(JSON.stringify({error:'Synthetic transport failed'}));}
 });
 let browser;
 try{
  await new Promise(r=>app.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.address().port;
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/home/tom/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',headless:true,args:['--no-sandbox'],env:{...process.env,LD_LIBRARY_PATH:'/home/tom/.cache/hermes-browser-libs/root/usr/lib/x86_64-linux-gnu:/home/tom/.cache/hermes-browser-libs/root/usr/lib'}});
  for(const version of ['glv-meta-ads','glv-meta-ads-v2']){
   const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
   page.on('pageerror',e=>errors.push(e.message));
   await page.clock.setFixedTime(new Date('2026-11-11T12:00:00Z'));
   await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin===base)return route.continue();if(u.hostname==='cdn.jsdelivr.net'){const name=u.pathname.includes('chart.js')?'chart.js':u.pathname.endsWith('.css')?'grid.css':'grid.js';return route.fulfill({path:'/home/tom/glv-creator-ghost-evidence/vendor/'+name,contentType:name.endsWith('.css')?'text/css':'text/javascript'});}if(u.hostname==='api.frankfurter.dev')return route.fulfill({json:{rates:{USD:.04}}});return route.abort();});
   await page.goto(base+'/'+version+'/?account=TUC&currency=CZK');
   await page.waitForFunction(()=>document.querySelector('#loading').style.display==='none');
   assert.equal(await page.locator('#error').isVisible(),false,await page.locator('#error').innerText());
   const population=await page.evaluate(()=>({aggregate:aggregateCampaigns.length,daily:dailyCampaigns.length,ads:adCreatives.length}));
   assert.ok(Object.values(population).every(n=>n>0));
   for(const tab of ['czsk','us','czsk-triage','czsk-promo','czsk-promo-creative','czsk-leadgen','wl']){
    await page.locator('[data-tab="'+tab+'"]').click();
    if(tab==='wl'){await page.waitForFunction(()=>document.querySelector('#wl-status').textContent.includes('Source refreshed'));assert.ok(await page.locator('#wl-overview table').count()>0);}
    if(tab==='czsk-promo-creative')await page.locator('#promo-concept-table tbody tr').first().waitFor();
    assert.equal(await page.locator('#panel-'+tab).isVisible(),true);
    assert.ok(await page.locator('#panel-'+tab+' table tbody tr').count()>0,version+'/'+tab+' is populated');
    await page.screenshot({path:path.join(evidence,version+'-'+tab+'.png'),fullPage:true});checks.push({version,tab,population});
   }
   if(version.endsWith('-v2')){
    await page.locator('#v2-currency').selectOption('USD');await page.waitForURL(u=>u.searchParams.get('currency')==='USD');
    await page.waitForFunction(()=>document.querySelector('#loading').style.display==='none');
    assert.deepEqual(await page.evaluate(()=>({aggregate:aggregateCampaigns.length,daily:dailyCampaigns.length,ads:adCreatives.length})),population);
    assert.equal(await page.locator('#error').isVisible(),false);checks.push({version,currency:'USD',population});
    assert.ok(await page.locator('link[href*="quiet-precision.css"]').count(),'V2 distinct Quiet Glass design loaded');
   }
   await page.close();
  }
  assert.deepEqual(errors,[]);
  assert.ok(transport.audit.some(a=>a.handler==='v1'&&a.status===200));assert.ok(transport.audit.some(a=>a.handler==='v2'&&a.status===200));
  assert.ok([...transport.values.keys()].some(k=>k.startsWith('glv:published:')));assert.ok([...transport.values.keys()].some(k=>k.startsWith(runtime.PREFIX+'published:')));
  console.log(JSON.stringify({passed:true,checks:checks.length,evidence}));
 }finally{
  fs.writeFileSync(path.join(evidence,'results.json'),JSON.stringify({synthetic:true,checks,errors,audit:transport.audit},null,2));
  if(browser)await browser.close();await new Promise(r=>app.close(r));transport.close();
 }
}
module.exports={create,browserProof};
if(require.main===module&&process.argv.includes('--browser'))browserProof().catch(e=>{console.error(e);process.exitCode=1;});
