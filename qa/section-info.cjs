const { chromium } = require('playwright-core');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../public');
const titles = ['executiveKpiTitle','trendTitle','detailTitle','marketComparisonTitle','phaseChartTitle','phaseTableTitle','promoTitle'];
(async () => {
 const server = http.createServer((req,res) => { let p = path.join(root, new URL(req.url,'http://local').pathname); if (p.endsWith('/')) p += 'index.html'; res.setHeader('Content-Type', ({'.js':'text/javascript','.css':'text/css','.json':'application/json','.html':'text/html','.svg':'image/svg+xml'})[path.extname(p)] || 'application/octet-stream'); fs.createReadStream(p).on('error',()=>res.end()).pipe(res); });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const lib='/home/tom/.cache/hermes-browser-libs/root';
 const browser=await chromium.launch({executablePath:'/home/tom/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',args:['--no-sandbox'],env:{...process.env,LD_LIBRARY_PATH:`${lib}/usr/lib/x86_64-linux-gnu:${lib}/usr/lib`}});
 const evidence='/tmp/glv-section-info-evidence'; fs.mkdirSync(evidence,{recursive:true});
 let checks=0;
 try {
 for (const width of [1440,390,320]) for (const theme of ['dark','light']) {
  const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<500}); const page=await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/glv/`); await page.locator('#dashboardContent').waitFor();
  await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
  assert.equal(await page.locator('.section-info-button').count(),7,'seven section info buttons');
  assert.equal(await page.locator('button button').count(),0);
  for (const [i,id] of titles.entries()) {
   await page.locator(i<4?'#homeViewTab':'#phasesViewTab').click();
   const button=page.locator(`#${id}-info-button`); const panel=page.locator(`#${id}-info`);
   await button.scrollIntoViewIfNeeded();
   const headingLayout = await page.locator(`#${id}`).evaluate(title => {
    const row = title.closest('.section-info-title');
    const eyebrow = row.previousElementSibling;
    const a = eyebrow.getBoundingClientRect(), b = row.getBoundingClientRect();
    return { eyebrow: eyebrow.classList.contains('eyebrow'), bottom: a.bottom, top: b.top };
   });
   assert.equal(headingLayout.eyebrow, true);
   assert.ok(headingLayout.top >= headingLayout.bottom - 1, `${id}: section label must remain above title`);
   assert.equal(await panel.isVisible(),false);
   const before=await page.locator(`#${id}`).boundingBox();
   await button.focus(); assert.equal(await panel.isVisible(),true,'keyboard focus opens');
   await page.keyboard.press('Escape'); assert.equal(await panel.isVisible(),false); assert.equal(await button.evaluate(e=>e===document.activeElement),true);
   if(width===1440){ await button.hover(); assert.equal(await panel.isVisible(),true); await panel.hover(); await page.waitForTimeout(220); assert.equal(await panel.isVisible(),true,'hover bridge'); await page.keyboard.press('Escape'); }
   if(width<500) await button.tap(); else await button.click();
   assert.equal(await panel.isVisible(),true,'activation opens');
   const box=await panel.boundingBox(); assert.ok(box.x>=7 && box.x+box.width<=width-7 && box.y>=7 && box.y+box.height<=901,'viewport containment');
   const after=await page.locator(`#${id}`).boundingBox(); assert.equal(before.height,after.height);
   assert.ok((await panel.innerText()).length>80);
   const typography = await panel.evaluate(el => [...el.querySelectorAll('*')].filter(node => node.textContent.trim()).map(node => { const s = getComputedStyle(node); return [s.fontFamily, s.fontSize, s.lineHeight]; }));
   const expectedTypography = await panel.evaluate(el => { const s = getComputedStyle(el); return [s.fontFamily, s.fontSize, s.lineHeight]; });
   for (const actual of typography) assert.deepEqual(actual, expectedTypography, `${id}: all info text must share typography`);
   assert.equal(await page.locator('#dashboardContent .historical-scope-note:visible').count(),0,'closed baseline has no inline explanatory panels');
   if(width===320 && id==='phaseTableTitle') {
    assert.ok(await panel.evaluate(e=>e.scrollHeight>e.clientHeight),'long content scrolls');
    await panel.evaluate(e=>e.scrollTop=100);
    assert.ok(await panel.evaluate(e=>e.scrollTop>0));
    await panel.evaluate(e=>e.scrollTop=0);
   }
   if(width<500) {const hit=await button.boundingBox(); assert.ok(hit.width>=44&&hit.height>=44);}
   await page.screenshot({path:`${evidence}/${width}-${theme}-${id}.png`});
   if(width<500) await button.tap(); else await button.click(); assert.equal(await panel.isVisible(),false,'activation closes');
   await button.blur(); await button.focus(); await page.locator('#themeToggle').click(); assert.equal(await panel.isVisible(),false,'outside closes');
   if(i===2||i===3) assert.equal(await page.locator(i===2?'#auditContent':'#marketComparisonContent').isVisible(),true,'independent collapse');
   await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
   checks++;
  }
  await context.close();
 }
 console.log(JSON.stringify({passed:true,sectionThemeViewportCases:checks,evidence}));
 } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
