const test = require('node:test');
const assert = require('node:assert/strict');
const promo = require('../public/glv/promo-comparison.js');
test('missing inputs remain null; valid daily ratios and derived revenue are computed', () => {
  const row = {revenue: 100, spend: 20, purchases: 4, new_customers: 2, returning_customers: 2, new_customer_revenue: 60, unique_visitors: 40};
  assert.equal(promo.value(row, 'roas'), 5);
  assert.equal(promo.value(row, 'nc_roas'), 3);
  assert.equal(promo.value(row, 'returning_customer_revenue'), 40);
  assert.equal(promo.value(row, 'avg_daily_revenue'), 100);
  assert.equal(promo.value(row, 'cac'), 10);
  assert.equal(promo.value({spend: 0, new_customers: 2}, 'cac'), 0);
  for (const metric of ['roas','cac','cpa','aov','cvr','nc_roas','returning_customer_revenue','avg_daily_revenue']) assert.equal(promo.value({}, metric), null);
  assert.equal(promo.value({...row, spend: 0}, 'roas'), null);
  assert.equal(promo.value({...row, revenue: ''}, 'revenue'), null);
});
test('no Promo, explicit none, and source-based partial-month defaults', () => {
  assert.deepEqual(promo.build([day('2026-09-19', 30, 'BAU')]).selected, []);
  const days = [day('2026-01-01', 1), day('2026-06-01', 2), day('2026-09-19', 3, 'BAU')];
  assert.deepEqual(promo.build(days).selected, ['2026-01','2026-06']);
  assert.deepEqual(promo.build(days, []).series, []);
  assert.deepEqual(promo.build(days, null).selected, ['2026-01','2026-06']);
});
test('palette is stable by calendar month, distinct for all twelve months in both themes', () => {
  for (const theme of ['light','dark']) {
    const colors = Array.from({length:12}, (_,i) => promo.color(`2026-${String(i+1).padStart(2,'0')}`, theme));
    assert.equal(new Set(colors).size, 12);
    assert.equal(promo.color('2026-09', theme), colors[8]);
  }
});
const day = (date, revenue, phase = 'Promo', region = 'czsk') => ({date, month: date.slice(0,7), phase, region, revenue});
test('Promo days compress disjoint windows, retain represented zeros and pad only with null', () => {
  const result = promo.build([day('2026-09-19', 30), day('2026-08-03', 0), day('2026-08-01', 10), day('2026-08-02', 900, 'BAU'), day('2026-08-10', 20), day('2026-09-01', 800, 'Influ'), day('2026-09-02', 999, 'Promo', 'us')]);
  assert.deepEqual(result.selected, ['2026-08','2026-09']);
  assert.deepEqual(result.labels, ['Day 1','Day 2','Day 3']);
  assert.deepEqual(result.series.map(s => s.values), [[10,0,20],[30,null,null]]);
  assert.deepEqual(result.series[0].dates, ['2026-08-01','2026-08-03','2026-08-10']);
});
