const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'public/glv-meta-ads-v2/index.html'),'utf8');

test('V2 loads its Quiet Glass presentation after shared styles, retaining current runtime dependencies',()=>{
 const styles=[...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)].map(m=>m[0]);
 assert.match(styles.at(-1),/\/glv-meta-ads-v2\/quiet-precision\.css\?v=/,'the shipped V2 design must remain the final cascade layer');
 assert.match(html,/<h1[^>]*id="dashboard-title"[^>]*>Performance<\/h1>/);
 assert.match(html,/<div class="dashboard-actions">[\s\S]*?id="v2-scope-account"[\s\S]*?id="refresh-data"[\s\S]*?<\/section>/);
 assert.match(html,/Chart\.defaults\.color=light\?'#646674':'#b2b5c4'/);
 for(const asset of ['date-policy.js','shared-ui.js','presentation.js','freshness.js']) assert.ok(html.includes(asset),`preserve ${asset}`);
 assert.match(html,/restoreV2ControlElements\(\)/);
 assert.match(html,/lastGoodSources/);
});

test('Quiet Glass shell keeps scope controls in flow and reachable at responsive breakpoints',async()=>{
 const {chromium}=require('playwright-core');
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/home/tom/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',headless:true,args:['--no-sandbox'],env:{...process.env,LD_LIBRARY_PATH:'/home/tom/.cache/hermes-browser-libs/root/usr/lib/x86_64-linux-gnu:/home/tom/.cache/hermes-browser-libs/root/usr/lib'}});
 try {
  const page=await browser.newPage();
  // Presentation-only shell: no API fixtures, client data, or third-party requests.
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.hostname!=='quiet.test')return route.abort();
   if(url.pathname==='/glv-meta-ads-v2/')return route.fulfill({contentType:'text/html',body:html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'')});
   const file=path.join(root,'public',url.pathname);
   if(!fs.existsSync(file))return route.abort();
   return route.fulfill({contentType:url.pathname.endsWith('.css')?'text/css':'application/octet-stream',body:fs.readFileSync(file)});
  });
  for(const width of [1440,1200,1024,721,720,390,320])for(const theme of ['light','dark']){
   await page.setViewportSize({width,height:900});
   await page.goto('http://quiet.test/glv-meta-ads-v2/');
   await page.evaluate(({theme,width})=>{document.documentElement.dataset.theme=theme;document.querySelector('.header-right').classList.toggle('controls-collapsed',width<=720);}, {theme,width});
   const state=await page.evaluate(()=>{
    const rect=e=>e.getBoundingClientRect();
    const header=document.querySelector('.sticky-header');
    return {background:getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),position:getComputedStyle(header).position,scopePosition:getComputedStyle(document.querySelector('.v2-scope-selects')).position,title:document.querySelector('#dashboard-title').textContent,overflow:document.documentElement.scrollWidth>innerWidth+1,controls:['v2-account','v2-currency','theme-toggle'].map(id=>{const e=document.getElementById(id),r=rect(e),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {id,reachable:e===hit||e.contains(hit),inside:r.x>=0&&r.right<=innerWidth+1};})};
   });
   assert.equal(state.background,theme==='light'?'#f8f7f5':'#17191f');
   assert.equal(state.position,'sticky');
   assert.equal(state.scopePosition,'static',`${width}/${theme}: account and currency must stay in the compact header flow`);
   assert.equal(state.overflow,false,`${width}/${theme}: no document overflow`);
   assert.ok(state.controls.every(c=>c.reachable&&c.inside),JSON.stringify({width,theme,state}));
  }
 }finally{await browser.close();}
});
