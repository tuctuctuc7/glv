// Local replay of private canonical API responses; never production browser auth.
const {chromium,webkit}=require('playwright-core');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../public');
const out=process.env.BFCM_CONTROLS_EVIDENCE;
assert(out,'Set BFCM_CONTROLS_EVIDENCE to a private evidence directory');fs.mkdirSync(out,{recursive:true});
const source=process.env.BFCM_REPORT_DIR;assert(source,'Set BFCM_REPORT_DIR to private canonical API reports');
const report=JSON.parse(fs.readFileSync(path.join(source,'canonical-aggregate.json')));
(async()=>{const libs='/home/tom/.cache/hermes-browser-libs/root';const engine=process.env.BFCM_ENGINE||'chromium';
const browser=await (engine==='webkit'?webkit:chromium).launch({headless:true,...(engine==='chromium'?{executablePath:process.env.CHROME_PATH||'/home/tom/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',args:['--no-sandbox']}:{executablePath:process.env.WEBKIT_PATH||'/home/tom/.cache/ms-playwright/webkit-2370/pw_run.sh'}),env:{...process.env,LD_LIBRARY_PATH:`${libs}/usr/lib/x86_64-linux-gnu:${libs}/usr/lib`,FONTCONFIG_PATH:`${libs}/etc/fonts`}});
try{const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('http://bfcm-controls.test/**',route=>{const p=new URL(route.request().url()).pathname;if(p==='/api/glv-bfcm/data')return route.fulfill({json:report});return route.fulfill({body:fs.readFileSync(path.join(root,p==='/glv-bfcm/'?'glv-bfcm/index.html':p)),contentType:p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':'text/html'});});
for(const width of [320,390,768,1024,1440])for(const theme of ['light','dark'])for(const zoom of [1,1.25]){
await page.setViewportSize({width,height:1000});await page.goto('http://bfcm-controls.test/glv-bfcm/');await page.waitForFunction(()=>document.querySelector('#notice').textContent.startsWith('Snapshot'));
await page.evaluate(({theme,zoom})=>{document.documentElement.dataset.theme=theme;document.body.style.zoom=zoom;},{theme,zoom});
await page.screenshot({path:path.join(out,`${engine}-${width}-${theme}-${zoom}.png`),fullPage:true});
if(process.env.BFCM_CAPTURE_ONLY)continue;
const result=await page.evaluate(()=>{const form=document.querySelector('#range-form'),r=form.getBoundingClientRect();return {background:getComputedStyle(form).backgroundColor,overflow:document.documentElement.scrollWidth>innerWidth,fields:[...form.querySelectorAll('input[type=date]')].map(e=>{const b=e.getBoundingClientRect(),p=e.parentElement.getBoundingClientRect();return {width:b.width,parent:p.width,left:b.left,right:b.right,formRight:r.right,shrink:getComputedStyle(e).minWidth}})};});
assert(!result.overflow,`${engine} ${width} ${theme} ${zoom} page overflow`);
if(theme==='light')assert.notEqual(result.background,'rgb(255, 255, 255)','filter must use translucent shell surface, not white card');
for(const f of result.fields){assert(f.width/zoom>=145,'full native date and picker need at least 145 CSS px');assert(f.width<=f.parent+1&&f.right<=f.formRight,JSON.stringify(result));assert.equal(f.shrink,'0px','native dates must be shrinkable');}
assert.equal(await page.locator('#daily-breakdown').isChecked(),false);
await page.locator('#range-from').focus();assert.equal(await page.locator('#range-from').evaluate(e=>getComputedStyle(e).outlineStyle),'solid');
await page.evaluate(()=>{const e=document.querySelector('#notice');e.className='error';e.textContent='Choose a valid reporting period: From must be on or after 25 November 2026 and To must not be earlier than From or later than today in Europe/Prague.';});
assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'long validation must wrap');
console.log(`PASS ${engine} ${width} ${theme} zoom ${zoom}`);
}assert.deepEqual(errors,[]);}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
