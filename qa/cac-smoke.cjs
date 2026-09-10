const assert = require('node:assert/strict');
const path = require('node:path');
const source = require('../public/glv/glv_dashboard.json');

module.exports = async function verifyCac(browser, baseUrl, evidenceDir) {
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const fixture = { ...source, date_range: { start: '2026-09-01', end: '2026-09-03' }, rows: [
      { ...source.rows[0], date: '2026-09-01', region: 'czsk', spend: 100, new_customers: 2 },
      { ...source.rows[0], date: '2026-09-02', region: 'czsk', spend: 200, new_customers: 0 },
      { ...source.rows[0], date: '2026-09-03', region: 'czsk', spend: 300, new_customers: 8 },
    ] };
    await page.route('**/glv_dashboard.json', route => route.fulfill({ json: fixture }));
    await page.goto(`${baseUrl}?period=custom&from=2026-09-01&to=2026-09-03&grain=day&auditGrain=day`, { waitUntil: 'networkidle' });
    await page.locator('#dashboardContent').waitFor({ state: 'visible' });
    for (const id of ['trendMetric', 'trendMetricSecondary']) {
      assert.equal(await page.locator(`#${id} option`).first().getAttribute('value'), 'none');
    }
    assert.equal(await page.locator('#executiveKpis .kpi-card').count(), 8);
    assert.equal(await page.locator('#executiveKpis [data-metric="cpa"]').count(), 0);
    assert.equal(await page.locator('#executiveKpis [data-metric="cac"] .kpi-label').textContent(), 'CAC');
    assert.equal(await page.locator('#executiveKpis [data-metric="cac"] .kpi-value').textContent(), '$60');
    if (width <= 720) assert.equal(await page.locator('#executiveKpis [data-metric="cac"]').evaluate(node => getComputedStyle(node).order), '8');
    await page.locator('#trendMetric').selectOption('cac');
    await page.locator('#trendMetricSecondary').selectOption('cac');
    assert.deepEqual(await page.evaluate(() => Chart.getChart('trendChart').data.datasets.map(d => d.data)), [[50, null, 37.5], [50, null, 37.5]]);
    assert.equal(await page.evaluate(() => Chart.getChart('trendChart').data.datasets[1].spanGaps), false);
    assert.deepEqual(await page.locator('#metricsTableBody tr td:last-child').allTextContents(), ['$60.00', '$37.50', '', '$50.00']);
    await page.locator('#grain').selectOption('month');
    await page.locator('#auditGrain').selectOption('month');
    assert.deepEqual(await page.evaluate(() => Chart.getChart('trendChart').data.datasets[0].data), [60]);
    assert.deepEqual(await page.locator('#metricsTableBody tr td:last-child').allTextContents(), ['$60.00', '$60.00']);
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await page.locator('#trendMetric').inputValue(), 'cac');
    assert.equal(await page.locator('#trendMetricSecondary').inputValue(), 'cac');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.locator('#auditTableWrap').evaluate(node => { node.scrollLeft = node.scrollWidth; });
    await page.locator('#metricsTable').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(evidenceDir, `cac-${width}.png`) });
    fixture.rows.forEach(row => { row.new_customers = 0; });
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await page.locator('#executiveKpis [data-metric="cac"] .kpi-value').textContent(), '');
    assert.deepEqual(await page.locator('#metricsTableBody tr td:last-child').allTextContents(), ['', '']);
    assert.deepEqual(await page.evaluate(() => Chart.getChart('trendChart').data.datasets[0].data), [null]);
    assert.deepEqual(errors, []);
    await context.close();
  }
};
