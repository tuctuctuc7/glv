const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// Resize one live document: layout must follow the scrollport, not a cached width.
module.exports = async (browser, baseUrl, evidenceDir) => {
  const results = [];
  for (const theme of ['dark', 'light']) {
    const page = await browser.newPage({viewport:{width:2560,height:900},reducedMotion:'reduce'});
    await page.goto(baseUrl+'?period=all', {waitUntil:'networkidle'});
    await page.evaluate(t=>setTheme(t), theme);
    for (const width of [2560,1920,1440,1024,768,390,320,2560]) {
      await page.setViewportSize({width,height:900});
      for (const id of ['metricsTable','marketComparisonTable','phaseTable']) {
        await page.locator(id==='phaseTable'?'#phasesViewTab':'#homeViewTab').click();
        const geometry = await page.evaluate(id=>{
          const t=document.getElementById(id), w=t.parentElement;
          w.scrollLeft=0;
          const original=t.style.width;
          t.style.width='min-content';
          const minimum=t.getBoundingClientRect().width;
          t.style.width=original;
          const rect=t.getBoundingClientRect(), wr=w.getBoundingClientRect();
          const clipped=[...t.querySelectorAll('th,td')].filter(c=>c.scrollWidth>c.clientWidth+1).map(c=>c.textContent);
          return {table:rect.width,viewport:w.clientWidth,minimum,left:rect.left-wr.left,right:rect.right-wr.left,clipped,pageOverflow:document.documentElement.scrollWidth-innerWidth};
        },id);
        results.push({theme,width,id,...geometry});
        assert.ok(Math.abs(geometry.table-Math.max(geometry.viewport,geometry.minimum))<=1,JSON.stringify(results.at(-1)));
        assert.ok(Math.abs(geometry.left)<=1);
        assert.deepEqual(geometry.clipped,[]);
        assert.ok(geometry.pageOverflow<=1);
        if(width<=390)assert.ok(geometry.table>geometry.viewport);
      }
    }
    await page.close();
  }
  fs.writeFileSync(path.join(evidenceDir,'table-fill-resize.json'),JSON.stringify(results,null,2));
};
