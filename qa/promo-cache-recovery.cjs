// Real Chromium against the actual UI; synthetic API facts, never live evidence.
const {chromium}=require('playwright-core');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../public');
const payload={schema_version:1,classification_version:2,funnel_version:1,reconciled:true,generated_at:'2026-10-20T00:00:00Z',range:{since:'2026-03-01',until:'2026-10-19'},freshness:{status:'stale'},rows:[{ad_id:'a',ad_name:'PAC403',adset_id:'s',adset_name:'Video',campaign_id:'120241268747040687',campaign_name:'TUC_008_CZSK_Promo',date:'2026-09-02',format:'Video',reason:'current_adset_label',spend:100,purchases:2,revenue:400,impressions:50,link_clicks:10,landing_page_views:8,checkouts:3}]};
let mode='stale',historyCalls=0;
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname==='/api/glv-meta-ads/fb-data'){
  res.setHeader('Content-Type','application/json');
  if(u.searchParams.get('type').startsWith('promo_')){historyCalls++;if(mode==='missing'){res.statusCode=503;return res.end(JSON.stringify({status:'unavailable',error:'Promo history cache unavailable. Awaiting the scheduled shared refresh.'}));}return res.end(JSON.stringify(payload));}
  return res.end(JSON.stringify({rows:[]}));
 }
 let file=path.join(root,u.pathname);if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');if(!file.startsWith(root)||!fs.existsSync(file))return res.writeHead(404).end();
 res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const libs='/home/tom/.cache/hermes-browser-libs/root';
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/home/tom/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',headless:true,args:['--no-sandbox'],env:{...process.env,LD_LIBRARY_PATH:`${libs}/usr/lib/x86_64-linux-gnu:${libs}/usr/lib`,FONTCONFIG_PATH:`${libs}/etc/fonts`}});
 const results=[];
 try{for(const width of [1440,390]){
  mode='stale';historyCalls=0;const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://api.frankfurter.dev/**',r=>r.fulfill({json:{rates:{USD:0.044}}}));
  await page.goto(`http://127.0.0.1:${server.address().port}/glv-meta-ads/`,{waitUntil:'networkidle'});
  await page.locator('[data-tab="czsk-promo-creative"]').click();
  await page.waitForFunction(()=>document.querySelector('#promo-format-table tbody tr')&&document.querySelector('#promo-concept-section tbody tr'));
  assert.equal(historyCalls,1,'both sections coalesce one history request');
  const counts=await page.evaluate(()=>[document.querySelectorAll('#promo-format-table tbody tr').length,document.querySelectorAll('#promo-concept-section tbody tr').length]);
  for(const id of ['promo-format-status','promo-concept-status']){const text=await page.locator('#'+id).textContent();assert.match(text,/Last-good data/);assert.match(text,/2026-10-20T00:00:00Z/);assert.match(text,/2026-10-19/);}
  mode='missing';await page.evaluate(async()=>{responseCache.clear();await Promise.all([loadPromoFormats(),loadPromoConcepts()]);});
  assert.equal(historyCalls,2);
  assert.deepEqual(await page.evaluate(()=>[document.querySelectorAll('#promo-format-table tbody tr').length,document.querySelectorAll('#promo-concept-section tbody tr').length]),counts);
  for(const id of ['promo-format-status','promo-concept-status'])assert.match(await page.locator('#'+id).textContent(),/Refresh failed/);
  await page.evaluate(()=>chooseConceptCampaigns(conceptSelection));assert.match(await page.locator('#promo-concept-status').textContent(),/Refresh failed/,'warning survives local rerender');
  for(const theme of ['light','dark']){await page.evaluate(t=>setTheme(t),theme);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await page.screenshot({path:`/tmp/promo-cache-recovery-${width}-${theme}.png`,fullPage:true});}
  await page.reload({waitUntil:'networkidle'});await page.locator('[data-tab="czsk-promo-creative"]').click();
  assert.equal(await page.locator('#promo-format-table tbody tr').count(),0);assert.equal(await page.locator('#promo-concept-section tbody tr').count(),0);
  for(const id of ['promo-format-status','promo-concept-status'])assert.match(await page.locator('#'+id).textContent(),/unavailable/);
  assert.deepEqual(errors,[]);results.push({width,coalesced:true,lastGoodRows:counts,missingCacheHonest:true,pageErrors:errors.length});await page.close();
 }console.log(JSON.stringify({synthetic:true,results},null,2));}finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
