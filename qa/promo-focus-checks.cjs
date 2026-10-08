const assert = require('node:assert/strict');
module.exports = async function checkFocus(page, evidenceDir) {
  const snapshot = () => page.evaluate(() => {
    const c = Chart.getChart('promoChart');
    return { focus: document.getElementById('promoFocus').value,
      values: c.data.datasets.map(d => ({month:d.month, data:d.data, dates:d.dates})),
      bounds: Object.values(c.scales).map(s => [s.min,s.max]),
      styles: c.data.datasets.map((d,i) => ({month:d.month, color:d.borderColor, point:d.pointBackgroundColor, width:d.borderWidth, visible:c.isDatasetVisible(i)})),
      legend: c.legend.legendItems.map(i => ({index:i.datasetIndex, hidden:i.hidden})),
      renderedPoints: c.data.datasets.map((d,i) => c.getDatasetMeta(i).data.map(p => ({fill:p.options.backgroundColor, border:p.options.borderColor}))),
      order:c.getSortedVisibleDatasetMetas().map(m => c.data.datasets[m.index].month) };
  });
  const clickLegend = async (index, touch = false) => {
    await page.locator('#promoChart').scrollIntoViewIfNeeded();
    const expectedFocus = await page.evaluate(index => {
      const month = Chart.getChart('promoChart').data.datasets[index].month;
      return document.getElementById('promoFocus').value === month ? '' : month;
    }, index);
    const p = await page.evaluate(index => {
      const c = Chart.getChart('promoChart'), r = c.canvas.getBoundingClientRect(), h = c.legend.legendHitBoxes[index];
      return { x:r.left + h.left + h.width/2, y:r.top + h.top + h.height/2 };
    }, index);
    if (touch) {
      const session = await page.context().newCDPSession(page);
      await session.send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[p]});
      await session.send('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
      await session.detach();
    } else await page.mouse.click(p.x,p.y);
    await page.waitForFunction(month => document.getElementById('promoFocus').value === month, expectedFocus);
  };
  const verify = async (baseline, month) => {
    await page.waitForFunction(month => document.getElementById('promoFocus').value === (month || ''), month);
    const s = await snapshot();
    assert.equal(s.focus, month || '');
    assert.deepEqual(s.values, baseline.values, 'focus does not change data/dates/null gaps');
    assert.deepEqual(s.bounds, baseline.bounds, 'focus does not change axis bounds');
    assert.deepEqual(s.legend, baseline.legend, 'no hidden/struck-through or reordered legend items');
    for (const d of s.styles) {
      assert.equal(d.visible,true);
      assert.equal(d.width,d.month === month ? 3.5 : 2.5);
      assert.equal(d.point, month && d.month !== month ? d.color.slice(0,7) + '80' : d.color);
      assert.equal(d.color.length,month && d.month !== month ? 9 : 7);
      if (month && d.month !== month) assert.ok(d.color.endsWith('33'));
    }
    if (month) assert.equal(s.order[0],month,'focused dataset drawn last/on top');
    s.renderedPoints.forEach((points,i) => points.forEach(point => {
      assert.equal(point.fill,s.styles[i].point,'resolved dot fill matches focus opacity');
      assert.equal(point.border,s.styles[i].point,'resolved dot border matches focus opacity');
    }));
  };
  const baseline = await snapshot();
  assert.ok(baseline.values.length >= 3);
  const [first, second] = baseline.values.map(d => d.month);
  await clickLegend(0); await verify(baseline,first);
  await clickLegend(1); await verify(baseline,second);
  await clickLegend(1); await verify(baseline,null);
  await page.locator('#promoFocus').focus();
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await verify(baseline,first);
  await page.locator('#promoFocus').press('Home'); await page.keyboard.press('Enter');
  await verify(baseline,null);
  await page.locator('#promoFocus').blur();
  await clickLegend(1);
  for (const metric of ['nc_roas','cac','revenue']) {
    await page.locator('#promoMetric').selectOption(metric);
    const current = await snapshot(); assert.equal(current.focus,second);
    await verify(current,second);
  }
  await page.evaluate(async () => {
    const raw = await (await fetch('/glv/glv_dashboard.json')).json();
    window.renderPromoComparison(GlvPhases.buildPhaseDays(raw.rows,raw.phases,raw.phase_contract.latest_date));
  });
  await verify(baseline,second);
  for (const width of [1440,390,320]) {
    await page.setViewportSize({width,height:1100});
    for (const theme of ['light','dark']) {
      if (await page.locator('html').getAttribute('data-theme') !== theme) await page.locator('#themeToggle').click();
      const current = await snapshot(); await verify(current,second);
      await page.locator('#promoComparison').scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(() => { const c = Chart.getChart('promoChart'); return c.legend.legendHitBoxes.every(h => h.top >= 0 && h.top + h.height <= c.height); }),true,'every month legend item stays inside canvas');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
      await page.locator('#promoFocus').focus();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true,'keyboard control fits');
      await page.locator('#promoFocus').blur();
      await page.locator('#promoComparison').screenshot({path:`${evidenceDir}/promo-focus-${width}-${theme}.png`});
    }
  }
  await clickLegend(0,true); await verify(await snapshot(),first);
  await page.locator('#promoMonths button').click();
  await page.locator(`#promoMonths input[data-value="${first}"]`).uncheck();
  assert.equal((await snapshot()).focus,'','removing focused month clears focus');
  await page.locator('#promoMonths input[data-value="*"]').check();
  await page.locator('#promoMonths button').press('Escape');
  await clickLegend(1);
  await page.evaluate(async month => {
    const raw = await (await fetch('/glv/glv_dashboard.json')).json();
    window.renderPromoComparison(GlvPhases.buildPhaseDays(raw.rows,raw.phases,raw.phase_contract.latest_date).filter(d => d.month !== month));
  },second);
  assert.equal((await snapshot()).focus,'','source removal clears focus');
  await page.evaluate(async () => {
    const raw = await (await fetch('/glv/glv_dashboard.json')).json();
    window.renderPromoComparison(GlvPhases.buildPhaseDays(raw.rows,raw.phases,raw.phase_contract.latest_date));
  });
  await clickLegend(0);
  await page.locator('#promoMonths button').click();
  await page.locator('#promoMonths input[data-value="none"]').check();
  assert.equal(await page.locator('#promoFocus').inputValue(),'');
  await page.locator('#promoMonths input[data-value="*"]').check();
  await page.locator('#promoMonths button').press('Escape');
  await page.setViewportSize({width:1440,height:1100});
  await verify(await snapshot(),null);
  console.log('Promo focus: real legend focus/switch/reset/touch, keyboard, metric/theme/data persistence/removal, unchanged values/axes/visibility; 1440/390/320 both themes PASS');
};
