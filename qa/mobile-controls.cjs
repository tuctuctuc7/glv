const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
module.exports = async (browser, baseUrl, evidenceDir) => {
  const results = [];
  for (const width of [320,390,1440]) for (const theme of ['dark','light']) {
    const context = await browser.newContext({viewport:{width,height:900},hasTouch:true,reducedMotion:'reduce'});
    const page = await context.newPage();
    await page.goto(baseUrl,{waitUntil:'networkidle'});
    await page.evaluate(t=>setTheme(t),theme);
    await page.evaluate(()=>document.fonts.ready);
    for (const tab of ['home','phases']) {
      await page.locator(`#${tab}ViewTab`).click();
      const geometry = await page.evaluate(() => {
        const rect = s => {const r=document.querySelector(s).getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right};};
        return {logo:rect('.brand-mark'),nav:rect('.dashboard-view-nav'),themeButton:rect('#themeToggle'),tabs:[rect('#homeViewTab'),rect('#phasesViewTab')],overflow:document.documentElement.scrollWidth>innerWidth};
      });
      results.push({width,theme,tab,...geometry});
      if (!process.env.MOBILE_BASELINE && width<720) {
        for (const r of [geometry.logo,geometry.nav,geometry.themeButton,...geometry.tabs]) assert.equal(r.height,44,JSON.stringify(results.at(-1)));
        assert.equal(geometry.logo.y,geometry.nav.y); assert.equal(geometry.nav.y,geometry.themeButton.y);
        assert.ok(!geometry.overflow);
      }
      if(width===1440) assert.deepEqual([geometry.logo.height,geometry.nav.height,geometry.themeButton.height,...geometry.tabs.map(r=>r.height)],[38,38,36,30,30],'desktop header preserved');
      await page.screenshot({path:path.join(evidenceDir,`controls-${width}-${theme}-${tab}.png`)});
    }
    const geometry = await page.evaluate(() => {
      const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right};};
      const panel=document.querySelector('.phase-table-panel'),p=panel.getBoundingClientRect(),s=getComputedStyle(panel);
      const wrap=rect('.phase-table-wrap');
      return {hierarchy:rect('#phaseHierarchy'),months:rect('#phaseMonths button'),promoMonths:rect('#promoMonths button'),metric:rect('#promoMetric'),wrap,leftGap:wrap.x-p.x-parseFloat(s.borderLeftWidth),rightGap:p.right-parseFloat(s.borderRightWidth)-wrap.right};
    });
    results.push({width,theme,...geometry});
    fs.writeFileSync(path.join(evidenceDir,process.env.MOBILE_BASELINE?'mobile-before.json':'mobile-after.json'),JSON.stringify(results,null,2));
    if (!process.env.MOBILE_BASELINE) {
      assert.ok(Math.abs(geometry.leftGap)<=1 && Math.abs(geometry.rightGap)<=1,JSON.stringify(results.at(-1)));
      if(width<720) {
        assert.ok(geometry.months.y >= geometry.hierarchy.y + geometry.hierarchy.height, 'Unified mobile panel stacks table controls');
        assert.ok(geometry.metric.y >= geometry.promoMonths.y + geometry.promoMonths.height, 'Unified mobile panel stacks comparison controls');
        for(const r of [geometry.hierarchy,geometry.months,geometry.promoMonths,geometry.metric]) {assert.equal(r.height,44);assert.ok(r.x>=0&&r.right<=width);}
      }
    }
    await page.locator('#phaseHierarchy').focus();
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    assert.equal(await page.locator('#phaseHierarchy').inputValue(),'phase-month');
    assert.match(await page.locator('#phaseTableSubtitle').textContent(),/Phase/);
    await page.locator('#promoMetric').selectOption('new_customer_revenue');
    assert.match(await page.locator('#promoChartCaption').textContent(),/New customer revenue/);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.ok(await page.locator('#promoMetric').evaluate(n=>n.getBoundingClientRect().right<=innerWidth));
    for(const id of ['phaseMonths','promoMonths']) {
      const trigger=page.locator(`#${id} button`);
      await trigger.focus();await page.keyboard.press('Enter');
      const menu=page.locator(`#${id} .phase-menu-options`);
      assert.ok(await menu.isVisible());
      const bounds=await menu.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width);
      const all=page.locator(`#${id} input[data-value="*"]`);
      await all.focus();await page.keyboard.press('Space');
      await trigger.press('Escape');assert.ok(!await menu.isVisible());
      await trigger.tap();assert.ok(await menu.isVisible());
      await all.check();await trigger.press('Escape');
    }
    await page.locator('.phase-table-heading').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('.app-header').evaluate(n=>n.getBoundingClientRect().top),0);
    await page.screenshot({path:path.join(evidenceDir,`controls-${width}-${theme}-table.png`)});
    await page.locator('#promoComparison').scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(evidenceDir,`controls-${width}-${theme}-promo.png`)});
    await context.close();
  }
};
if(require.main===module) {
 const {chromium}=require('playwright-core');const http=require('node:http');
 const server=http.createServer((req,res)=>{let p=path.join(__dirname,'../public',new URL(req.url,'http://localhost').pathname);if(!fs.existsSync(p)){res.writeHead(404).end();return;}if(fs.statSync(p).isDirectory())p=path.join(p,'index.html');res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':p.endsWith('.json')?'application/json':p.endsWith('.svg')?'image/svg+xml':'text/html');fs.createReadStream(p).pipe(res);});
 (async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({executablePath:'/home/tom/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',args:['--no-sandbox'],env:{...process.env,LD_LIBRARY_PATH:'/home/tom/.cache/hermes-browser-libs/root/usr/lib/x86_64-linux-gnu:/home/tom/.cache/hermes-browser-libs/root/usr/lib'}});try{const dir=process.env.GLV_QA_EVIDENCE_DIR||'/tmp/glv-mobile-controls-evidence';fs.mkdirSync(dir,{recursive:true});await module.exports(browser,`http://127.0.0.1:${server.address().port}/glv/`,dir);console.log('Mobile controls matrix passed');}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
}
