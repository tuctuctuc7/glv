// Local canonical-data replay, not authenticated production or physical iOS.
const {chromium,webkit}=require('playwright-core');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=process.env.BFCM_PUBLIC||path.resolve(__dirname,'../public');
const out=process.env.BFCM_CONTROLS_EVIDENCE;assert(out);fs.mkdirSync(out,{recursive:true});
const report=JSON.parse(fs.readFileSync(path.join(process.env.BFCM_REPORT_DIR,'canonical-aggregate.json')));
const engine=process.env.BFCM_ENGINE||'chromium',libs='/home/tom/.cache/hermes-browser-libs/root';
(async()=>{
 const browser=await (engine==='webkit'?webkit:chromium).launch({headless:true,executablePath:engine==='webkit'?'/home/tom/.cache/ms-playwright/webkit-2370/pw_run.sh':'/home/tom/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',args:engine==='chromium'?['--no-sandbox']:[],env:{...process.env,LD_LIBRARY_PATH:`${libs}/usr/lib/x86_64-linux-gnu:${libs}/usr/lib`,FONTCONFIG_PATH:`${libs}/etc/fonts`,__EGL_VENDOR_LIBRARY_FILENAMES:`${libs}/usr/share/glvnd/egl_vendor.d/50_mesa.json`,LIBGL_DRIVERS_PATH:`${libs}/usr/lib/x86_64-linux-gnu/dri`}});
 const results=[];
 try{
 const page=await browser.newPage({serviceWorkers:'block'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.clock.install({time:new Date(`${report.until}T12:00:00Z`)});
 await page.route('http://bfcm.test/**',route=>{const p=new URL(route.request().url()).pathname;if(p==='/api/glv-bfcm/data')return route.fulfill({json:report});return route.fulfill({body:fs.readFileSync(path.join(root,p==='/glv-bfcm/'?'glv-bfcm/index.html':p)),contentType:p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':'text/html'});});
 const sizes=process.env.BFCM_QUICK?[[390,844]]:[[320,844],[375,844],[390,844],[430,932],[568,320],[667,375],[844,390],[932,430],[1024,1000],[1440,1000]];
 for(const [width,height] of sizes)for(const theme of ['light','dark'])for(const zoom of [1,1.25])for(const fontScale of [1,1.25]){
 await page.setViewportSize({width,height});await page.goto('http://bfcm.test/glv-bfcm/');await page.waitForFunction(()=>document.querySelector('#notice').textContent.startsWith('Snapshot'));
 await page.evaluate(({theme,zoom,fontScale})=>{document.documentElement.dataset.theme=theme;document.body.style.zoom=zoom;if(fontScale!==1){for(const e of document.querySelectorAll('#range-form, #range-form *'))e.style.fontSize=`${parseFloat(getComputedStyle(e).fontSize)*fontScale}px`;}},{theme,zoom,fontScale});
 await page.waitForTimeout(300); // Finish theme transitions before deterministic comparison.
 const tag=`${engine}-${width}x${height}-${theme}-z${zoom}-f${fontScale}`;
 if(!process.env.BFCM_BASELINE){
 const mobile=true;
 const geometry=await page.evaluate(()=>{const form=document.querySelector('#range-form'),panel=form.getBoundingClientRect();const rect=e=>{const b=e.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,height:b.height};};return {overflow:document.documentElement.scrollWidth>innerWidth,panel:rect(form),fields:[...form.querySelectorAll('input[type=date]')].map(e=>{const shell=e.closest('.date-field'),text=shell?.querySelector('.date-value');let textRect=null;if(text){const r=document.createRange();r.selectNodeContents(text);const b=r.getBoundingClientRect();textRect={left:b.left,right:b.right,top:b.top,bottom:b.bottom};}return {input:rect(e),shell:shell&&rect(shell),text:textRect,value:e.value,label:text?.textContent,opacity:getComputedStyle(e).opacity,overflow:shell&&getComputedStyle(shell).overflow};})};});
 assert(!geometry.overflow,tag+' document overflow');
 const [from,to]=geometry.fields;
 assert(Math.abs(from.shell.top-to.shell.top)<1 && from.shell.right<=to.shell.left,tag+' From/To must stay side by side');
 assert(Math.abs(from.shell.width-to.shell.width)<1,tag+' equal date widths');
 assert.equal(await page.locator('#range-apply, #range-latest').count(),0,tag+' no date action buttons');
 for(const f of geometry.fields){assert(f.input.left>=geometry.panel.left&&f.input.right<=geometry.panel.right,tag+' input outside panel');if(mobile){assert(f.shell&&f.text,tag+' mobile needs independently constrained visible date');assert.equal(f.opacity,'0',tag+' native rendering must not paint oversized iOS chrome');assert.notEqual(f.overflow,'hidden',tag+' must fit, not conceal overflow');assert(f.shell.height/zoom>=44&&f.shell.height/zoom<=56,tag+' compact touch height');assert(f.text.left>=f.shell.left&&f.text.right<=f.shell.right&&f.text.top>=f.shell.top&&f.text.bottom<=f.shell.bottom,tag+' date text inside visible border '+JSON.stringify(f));assert(f.input.width<=f.shell.width+1&&f.input.height<=f.shell.height+1,tag+' picker overlay contained');assert(f.text.bottom>f.text.top,tag+' actual text painted with working fonts');assert(Math.abs((f.text.left+f.text.right)-(f.shell.left+f.shell.right))<2,tag+' centered date value');assert(f.label.includes('2026'),tag+' full year visible');}}
 if(mobile){await page.locator('#theme-switch').focus();await page.keyboard.press('Tab');assert.equal(await page.getByLabel('From',{exact:true}).evaluate(e=>document.activeElement===e),true,tag+' keyboard Tab reaches native date');const [a,b]=geometry.fields;assert(a.shell.bottom<=b.shell.top||a.shell.right<=b.shell.left,tag+' date borders overlap');
 for(const id of ['range-from','range-to']){await page.locator('#'+id).scrollIntoViewIfNeeded();const hit=await page.locator('#'+id).evaluate(e=>{const b=e.getBoundingClientRect();return document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)===e;});assert(hit,tag+' native picker receives actual touch');await page.locator('#'+id).click();await page.keyboard.press('Escape');await page.locator('#'+id).focus();assert.equal(await page.locator('#'+id).evaluate(e=>document.activeElement===e),true);assert.equal(await page.locator('#'+id).locator('..').evaluate(e=>getComputedStyle(e).outlineStyle),'solid');}
 await page.locator('#range-from').fill('2026-11-26');assert.match(await page.locator('#range-from').locator('..').innerText(),/26 Nov 2026/);await page.locator('#range-from').fill('');assert.match(await page.locator('#range-from').locator('..').innerText(),/Choose date/);await page.locator('#range-from').fill('2026-11-25');await page.waitForFunction(()=>document.querySelector('#notice').textContent.startsWith('Snapshot'));}
 assert.equal(await page.locator('#daily-breakdown').isChecked(),false);
 results.push({tag,geometry});}
 await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0);});
 await page.screenshot({path:path.join(out,tag+'.png'),fullPage:true});
 if(!process.env.BFCM_BASELINE){
 if(theme==='light')assert.notEqual(await page.locator('#range-form').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(255, 255, 255)');
 await page.locator('#notice').evaluate(e=>{e.textContent='Choose a valid reporting period: From must be on or after 25 November 2026 and To must not be earlier than From or later than today in Europe/Prague.';});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),tag+' long validation must wrap');
 }
 console.log('PASS '+tag);
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,engine+'-geometry.json'),JSON.stringify(results,null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
