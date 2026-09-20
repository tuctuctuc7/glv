const assert = require('node:assert/strict');
module.exports = async function checkPromo(page, evidenceDir) {
  const source = await page.evaluate(async () => (await fetch('/glv/glv_dashboard.json')).json());
  const recovery = await page.context().newPage();
  try {
    await recovery.route('**/glv_dashboard.json', route => route.fulfill({ json: { ...source, phases: source.phases.map(p => ({ ...p, phase: 'Influ' })) } }));
    await recovery.goto(page.url(), { waitUntil: 'networkidle' });
    assert.match(await recovery.locator('#promoEmpty').innerText(), /No represented/);
    const refreshPromo = () => recovery.evaluate(raw => window.renderPromoComparison(GlvPhases.buildPhaseDays(raw.rows, raw.phases, raw.phase_contract.latest_date)), source);
    await refreshPromo();
    assert.equal(await recovery.evaluate(() => Chart.getChart('promoChart').data.datasets.length), 2, 'late Promo data initializes latest two months');
    await recovery.locator('#promoMonths button').click();
    await recovery.locator('#promoMonths input[data-value="none"]').check();
    await refreshPromo();
    assert.match(await recovery.locator('#promoEmpty').innerText(), /Select months/, 'explicit None survives source refresh');
  } finally { await recovery.close(); }
  const read = () => page.evaluate(() => { const c = Chart.getChart('promoChart'); return c ? c.data.datasets.map(d => ({month:d.month, data:d.data, dates:d.dates, color:d.borderColor, spanGaps:d.spanGaps})) : []; });
  const initial = await read();
  const expected = await page.evaluate(async () => {
    const raw = await (await fetch('/glv/glv_dashboard.json')).json();
    const days = GlvPhases.buildPhaseDays(raw.rows,raw.phases,raw.phase_contract.latest_date);
    const months = [...new Set(days.filter(d => d.phase === 'Promo').map(d => d.month))].sort().slice(-2);
    return months.map(month => ({month, days:days.filter(d => d.phase === 'Promo' && d.month === month)}));
  });
  assert.deepEqual(initial.map(d => d.month),expected.map(d => d.month));
  initial.forEach((s,i) => { assert.deepEqual(s.dates,expected[i].days.map(d => d.date)); assert.deepEqual(s.data.slice(0,s.dates.length),expected[i].days.map(d => d.revenue)); assert.ok(s.data.slice(s.dates.length).every(v => v === null)); assert.equal(s.spanGaps,false); });
  await page.locator('#promoMonths button').click();
  await page.locator('#promoMonths input[data-value="none"]').check();
  assert.match(await page.locator('#promoEmpty').innerText(),/Select months/);
  await page.locator('#promoMonths input[data-value="*"]').check();
  const all = await read(); assert.ok(all.length >= initial.length); assert.equal(new Set(all.map(d => d.color)).size,all.length);
  await page.locator('#promoMonths input[data-value="none"]').check();
  await page.locator(`#promoMonths input[data-value="${initial[0].month}"]`).check();
  assert.equal((await read())[0].color,initial[0].color);
  await page.locator('#promoMonths button').press('Escape');
  await page.locator('#promoMetric').selectOption('nc_roas');
  assert.match(await page.locator('#promoChartCaption').innerText(),/NC ROAS/);
  await page.locator('#phaseMonths button').click();
  await page.locator('#phaseMonths input[data-value="*"]').uncheck();
  assert.equal((await read()).length,1);
  await page.locator('#phaseMonths input[data-value="*"]').check();
  await page.locator('#phaseMonths button').press('Escape');
  await page.locator('#phaseFilter button').click();
  await page.locator('#phaseFilter input[data-value="*"]').uncheck();
  assert.equal((await read()).length,1);
  await page.locator('#phaseFilter input[data-value="*"]').check();
  await page.locator('#phaseFilter button').press('Escape');
  await page.locator('#promoMetric').selectOption('revenue');
  for (const width of [1440,390,320]) {
    await page.setViewportSize({width,height:1100});
    for (const theme of ['light','dark']) {
      if (await page.locator('html').getAttribute('data-theme') !== theme) await page.locator('#themeToggle').click();
      await page.locator('#promoComparison').scrollIntoViewIfNeeded();
      assert.ok(await page.locator('#promoChart').isVisible());
      assert.equal(await page.evaluate(() => Chart.getChart('promoChart').options.scales.x.ticks.font.family), await page.evaluate(() => getComputedStyle(document.body).fontFamily));
      const layout = await page.locator('#promoComparison').evaluate(n => ({right:n.getBoundingClientRect().right, width:innerWidth}));
      assert.ok(layout.right <= layout.width, `Promo overflows ${width} ${theme}`);
      assert.equal(await page.locator('#promoMetric').evaluate(n => n.getBoundingClientRect().height >= 44),true);
      await page.locator('#promoMonths button').click();
      const menuBounds = await page.locator('#promoMonthOptions').evaluate(n => { const r = n.getBoundingClientRect(); return { left:r.left, right:r.right, width:innerWidth }; });
      assert.ok(menuBounds.left >= 0 && menuBounds.right <= menuBounds.width, 'open Promo month menu stays inside viewport');
      await page.locator('#promoTitle').click();
      assert.equal(await page.locator('#promoMonthOptions').isVisible(), false, 'outside click closes Promo months');
      await page.locator('#promoComparison').screenshot({path:`${evidenceDir}/promo-${width}-${theme}.png`});
    }
  }
  await page.setViewportSize({width:1440,height:1100});
  await page.locator('#promoMonths button').click();
  await page.locator('#promoMonths input[data-value="none"]').check();
  for (const s of initial) await page.locator(`#promoMonths input[data-value="${s.month}"]`).check();
  await page.locator('#promoMonths button').press('Escape');
  assert.deepEqual(await read(),initial);
};
