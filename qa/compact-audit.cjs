const assert = require('node:assert/strict');
const path = require('node:path');
module.exports = async (browser, baseUrl, evidenceDir) => {
  const results = [];
  for (const width of [1440, 1024, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.locator('#dashboardContent').waitFor({ state: 'visible' });
    const geometry = await page.evaluate(() => {
      const panel = document.querySelector('#auditTable').getBoundingClientRect();
      const heading = document.querySelector('#auditTable .panel-heading').getBoundingClientRect();
      const grain = document.querySelector('#auditGrain').getBoundingClientRect();
      const table = document.querySelector('#auditTableWrap').getBoundingClientRect();
      return { headerHeight: table.top - panel.top, headingBottom: heading.bottom, grainBottom: grain.bottom, grainHeight: grain.height, overflow: document.documentElement.scrollWidth - innerWidth };
    });
    assert.ok(geometry.headerHeight <= (width > 720 ? 116 : 220), JSON.stringify({ width, ...geometry }));
    assert.ok(geometry.grainBottom <= geometry.headingBottom + 1, 'grain must share the heading instead of reserving a separate toolbar below');
    assert.ok(geometry.grainHeight >= 44);
    assert.ok(geometry.overflow <= 1);
    const toggle = page.locator('.section-toggle[aria-controls="auditContent"]');
    await toggle.click();
    assert.equal(await page.locator('#auditContent').isVisible(), false);
    assert.equal(await page.locator('#auditGrain').isVisible(), false);
    await toggle.click();
    assert.equal(await page.locator('#auditGrain').isVisible(), true);
    await page.locator('#auditGrain').selectOption('month');
    assert.equal(await page.locator('#grain').inputValue(), 'day');
    assert.equal(await page.locator('#auditPeriodHeader').textContent(), 'Month');
    await page.locator('#auditGrain').selectOption('day');
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
      await page.locator('#auditTable').scrollIntoViewIfNeeded();
      await page.locator('#auditTable').screenshot({ path: path.join(evidenceDir, `audit-${width}-${theme}.png`) });
    }
    results.push({ width, ...geometry });
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('Compact audit geometry:', JSON.stringify(results));
};
