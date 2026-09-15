const test = require('node:test');
const assert = require('node:assert/strict');
const p = require('../public/glv/phases.js');
const schedule = [{ phase: 'Influ', start_date: '2026-01-02', end_date: '2026-02-20' }];
const row = (date, revenue, influ_revenue = 0, region = 'czsk') => ({ date, revenue, influ_revenue, region });
const rows = [row('2026-01-01', 900), row('2026-01-02', 120, 60), row('2026-01-03', 0), row('2026-02-01', 300, 30), row('2026-02-02', 999), row('2026-01-02', 999, 0, 'us')];
const days = () => p.buildPhaseDays(rows, schedule, '2026-02-01');
test('daily revenue uses represented phase dates including zero days, not whole months or future/missing/foreign days', () => {
  const groups = p.aggregatePhaseGroups(days());
  assert.equal(groups.find(g => g.phase === 'Influ' && g.month === '2026-01').avg_daily_revenue, 60);
  assert.equal(p.aggregateRows([]).avg_daily_revenue, null);
  assert.equal(p.aggregateRows([{ date: '2026-01-01', revenue: null }]).avg_daily_revenue, null);
  assert.equal(p.aggregateRows([row('2026-01-01', 40), row('2026-01-01', 60)]).avg_daily_revenue, 100);
  assert.throws(() => p.buildPhaseDays([...rows, rows[0]], schedule, '2026-02-01'), /Duplicate CZSK day/);
});
test('weighted parents and both split hierarchies share all parent Influ dates', () => {
  for (const orientation of ['month-phase', 'phase-month']) {
    const nodes = p.buildHierarchy(days(), orientation, true);
    for (const parent of nodes.filter(n => n.phase === 'Influ' && n.kind === 'phase')) {
      const children = nodes.filter(n => n.parentId === parent.id);
      assert.equal(children.reduce((sum, n) => sum + n.metrics.avg_daily_revenue, 0), parent.metrics.avg_daily_revenue);
    }
    for (const day of nodes.filter(n => n.kind === 'day')) assert.equal(day.metrics.avg_daily_revenue, day.metrics.revenue);
  }
  const nodes = p.buildHierarchy(days(), 'phase-month', true);
  assert.equal(nodes.find(n => n.id === 'phase|Influ').metrics.avg_daily_revenue, 140);
  assert.equal(nodes.find(n => n.id === 'phase|Influ|code').metrics.avg_daily_revenue, 30);
  assert.equal(p.buildHierarchy(days(), 'phase-month', true, { months: ['2026-01'] }).find(n => n.id === 'phase|Influ|code').metrics.avg_daily_revenue, 30);
});
test('average split chart derives two revenue curves with shared denominators and gaps', () => {
  const chart = p.monthlySeries(days(), 'avg_daily_revenue', { splitInflu: true });
  assert.deepEqual(chart.phases, ['BAU', 'Promo', 'Influ · Code', 'Influ · No code']);
  assert.deepEqual(chart.series['Influ · Code'], [30, 30]);
  assert.deepEqual(chart.series['Influ · No code'], [30, 270]);
  assert.deepEqual(chart.series.Promo, [null, null]);
  assert.deepEqual(p.monthlySeries(days(), 'spend', { splitInflu: true }).phases, ['BAU', 'Promo', 'Influ']);
});
