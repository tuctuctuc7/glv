const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright-core');
const out = process.env.GLV_CHECKBOX_EVIDENCE || '/tmp/glv-promo-checkbox-evidence';
(async () => {
  const root = path.resolve(__dirname, '../public');
  const server = http.createServer((req, res) => {
    let file = path.join(root, new URL(req.url, 'http://localhost').pathname);
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!file.startsWith(root) || !fs.existsSync(file)) return res.writeHead(404).end();
    res.setHeader('Content-Type', ({'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const libs = '/home/tom/.cache/hermes-browser-libs/root';
  const browser = await chromium.launch({executablePath:process.env.GLV_CHROME_PATH || '/home/tom/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome', args:['--no-sandbox'], env:{...process.env, LD_LIBRARY_PATH:`${libs}/usr/lib/x86_64-linux-gnu:${libs}/usr/lib`, FONTCONFIG_PATH:`${libs}/etc/fonts`, XDG_DATA_DIRS:`${libs}/usr/share`}});
  fs.mkdirSync(out, {recursive:true});
  const results = [];
  try {
    for (const width of [1440,390,320]) for (const theme of ['dark','light']) {
      const page = await browser.newPage({viewport:{width,height:1000}, reducedMotion:'reduce'});
      await page.goto(`http://127.0.0.1:${server.address().port}/glv/`, {waitUntil:'networkidle'});
      await page.click('#phasesViewTab');
      if (await page.locator('html').getAttribute('data-theme') !== theme) await page.click('#themeToggle');
      const geometry = async id => {
        const rows = await page.locator(`#${id} .phase-menu-options input`).evaluateAll(inputs => inputs.map(e => {
          const s = getComputedStyle(e), r = e.getBoundingClientRect();
          return {width:r.width,height:r.height,appearance:s.appearance,padding:s.padding,checked:e.checked,mixed:e.indeterminate,rowHeight:e.parentElement.getBoundingClientRect().height};
        }));
        console.log(JSON.stringify({width,theme,id,first:rows[0]}));
        for (const r of rows) {
          assert.ok(r.width >= 16 && r.width <= 22 && r.width === r.height, `${id}: square checkbox ${JSON.stringify(r)}`);
          assert.notEqual(r.appearance, 'none', `${id}: native checked/mixed glyph must be rendered`);
          assert.ok(r.rowHeight >= 44);
        }
        return rows;
      };
      // Siblings share the menu CSS; the custom Influ switch must stay untouched.
      const switchStyle = await page.locator('#phaseInfluSplit').evaluate(e => ({appearance:getComputedStyle(e).appearance,width:getComputedStyle(e).width,height:getComputedStyle(e).height}));
      for (const id of ['phaseFilter','phaseMonths','promoMonths']) {
        await page.click(`#${id} > button`); await geometry(id); await page.press(`#${id} > button`, 'Escape');
      }
      await page.click('[data-phase-mode="promo"]');
      // Preserve the existing metric option order; this fix does not alter selectors.
      const charts = () => page.evaluate(() => ['phaseChart','promoChart'].map(id => {const c=Chart.getChart(id);return {labels:c.data.labels,data:c.data.datasets.map(d=>({label:d.label,data:d.data}))};}));
      const before = await charts();
      const initialRowCount = await page.locator('#phaseTableBody tr').count();
      await page.click('#phaseEvents > button');
      const rows = await geometry('phaseEvents');
      const all = page.locator('#phaseEvents input[data-value="*"]');
      assert.equal(await all.isChecked(), true);
      await all.click();
      assert.equal(await page.locator('#phaseEvents > button').textContent(), 'Promos: None');
      assert.equal(await page.locator('#phaseTableBody tr').count(), 0);
      const options = page.locator('#phaseEvents input:not([data-value="*"])');
      await options.nth(0).click();
      await options.nth(1).focus(); await page.keyboard.press('Space');
      assert.equal(await options.nth(0).isChecked(), true);
      assert.equal(await options.nth(1).isChecked(), true);
      assert.equal(await options.nth(2).isChecked(), false);
      assert.equal(await all.evaluate(e => e.indeterminate), true);
      assert.equal(await page.locator('#phaseEvents > button').textContent(), 'Promos: 2 selected');
      assert.equal(await page.locator('#phaseTableBody tr').count(), 2);
      assert.deepEqual(await charts(), before, 'table filter must not change either chart');
      await geometry('phaseEvents');
      const menu = await page.locator('#phaseEvents .phase-menu-options').boundingBox();
      assert.ok(menu.x >= 0 && menu.x + menu.width <= width);
      await page.locator('#phaseEvents .phase-menu-options').screenshot({path:`${out}/${width}-${theme}-mixed.png`});
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#phaseEvents > button').evaluate(e=>e===document.activeElement), true);
      await page.keyboard.press('Enter');
      await all.click();
      assert.equal(await all.isChecked(), true);
      assert.equal(await all.evaluate(e=>e.indeterminate), false);
      assert.equal(initialRowCount, await page.locator('#phaseTableBody tr').count());
      await page.press('#phaseEvents > button','Escape');
      await page.click('[data-phase-mode="month"]');
      assert.deepEqual(await page.locator('#phaseInfluSplit').evaluate(e => ({appearance:getComputedStyle(e).appearance,width:getComputedStyle(e).width,height:getComputedStyle(e).height})), switchStyle);
      results.push({width,theme,rows,menu});
      fs.writeFileSync(`${out}/results.json`, JSON.stringify(results,null,2));
      await page.close();
    }
    console.log(JSON.stringify({passed:results.length,out}));
  } finally {await browser.close(); server.close();}
})().catch(e => {console.error(e); process.exitCode=1;});
