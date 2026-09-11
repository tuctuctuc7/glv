const test = require('node:test');
const assert = require('node:assert/strict');

const phases = require('../public/glv/phases.js');

const schedule = [
  { start_date: '2026-02-06', end_date: '2026-02-14', phase: 'Promo', label: 'promo', source_row: 4 },
  { start_date: '2026-02-19', end_date: '2026-02-22', phase: 'Influ', label: 'influ', source_row: 5 },
  { start_date: '2026-05-21', end_date: '2026-05-25', phase: 'Influ', label: 'influ kristyna', source_row: 20 },
  { start_date: '2026-05-27', end_date: '2026-05-27', phase: 'Influ', label: 'influ kristyna', source_row: 20 },
];

const row = (date, region, revenue, spend, purchases, visitors, newCustomers, returningCustomers, influRevenue = 0) => ({
  date,
  region,
  revenue,
  spend,
  purchases,
  unique_visitors: visitors,
  new_customers: newCustomers,
  returning_customers: returningCustomers,
  new_customer_revenue: revenue * 0.6,
  influ_revenue: influRevenue,
});

const rows = [
  row('2026-01-31', 'czsk', 50, 5, 1, 10, 1, 0),
  row('2026-02-01', 'czsk', 100, 10, 2, 20, 1, 1),
  row('2026-02-06', 'czsk', 300, 90, 3, 30, 2, 1),
  row('2026-02-19', 'czsk', 200, 40, 4, 40, 1, 3, 120),
  row('2026-02-19', 'us', 999, 999, 9, 90, 9, 0, 999),
  row('2026-05-25', 'czsk', 80, 20, 2, 25, 1, 1, 30),
  row('2026-05-26', 'czsk', 60, 30, 1, 20, 0, 1, 0),
  row('2026-05-27', 'czsk', 90, 10, 3, 30, 3, 0, 45),
];

test('strict ISO date parsing rejects rollover and non-ISO input', () => {
  assert.equal(phases.parseIsoDate('2026-02-06').toISOString().slice(0, 10), '2026-02-06');
  assert.throws(() => phases.parseIsoDate('2026-02-30'), /invalid date/i);
  assert.throws(() => phases.parseIsoDate('06\/02\/2026'), /invalid date/i);
});

test('classification is CZSK-only, covers YTD, and preserves disjoint Influ dates', () => {
  const days = phases.buildPhaseDays(rows, schedule, '2026-05-27');
  assert.equal(days.some((day) => day.region !== 'czsk'), false);
  assert.equal(days.find((day) => day.date === '2026-01-31').phase, 'BAU');
  assert.equal(days.find((day) => day.date === '2026-02-06').phase, 'Promo');
  assert.equal(days.find((day) => day.date === '2026-02-19').phase, 'Influ');
  assert.equal(days.find((day) => day.date === '2026-05-25').phase, 'Influ');
  assert.equal(days.find((day) => day.date === '2026-05-26').phase, 'BAU');
  assert.equal(days.find((day) => day.date === '2026-05-27').phase, 'Influ');
});

test('Promo and Influ overlap is rejected rather than assigned by row order', () => {
  assert.throws(() => phases.validateSchedule([
    ...schedule,
    { start_date: '2026-02-14', end_date: '2026-02-19', phase: 'Influ', label: 'influ guest', source_row: 99 },
  ]), /Promo.*Influ.*overlap.*2026-02-14/i);
});

test('monthly phase groups calculate ratios from grouped sums and Share from monthly CZSK revenue', () => {
  const days = phases.buildPhaseDays(rows, schedule, '2026-05-27');
  const groups = phases.aggregatePhaseGroups(days);
  const febPromo = groups.find((group) => group.month === '2026-02' && group.phase === 'Promo');
  assert.equal(febPromo.revenue, 300);
  assert.equal(febPromo.roas, 300 / 90);
  assert.equal(febPromo.cac, 90 / 2);
  assert.equal(febPromo.share, 300 / 600);
  const febInflu = groups.find((group) => group.month === '2026-02' && group.phase === 'Influ');
  assert.equal(febInflu.share, 200 / 600);
});

test('Influ split children reconcile revenue and expose no invented non-revenue metrics', () => {
  const days = phases.buildPhaseDays(rows, schedule, '2026-05-27');
  const nodes = phases.buildHierarchy(days, 'month-phase', true);
  const influ = nodes.find((node) => node.kind === 'phase' && node.month === '2026-02' && node.phase === 'Influ');
  const children = nodes.filter((node) => node.parentId === influ.id && node.kind === 'influ-split');
  assert.deepEqual(children.map((node) => node.label), ['Code', 'No code']);
  assert.equal(children.reduce((sum, node) => sum + node.metrics.revenue, 0), influ.metrics.revenue);
  assert.ok(Math.abs(children.reduce((sum, node) => sum + node.share, 0) - influ.share) < 1e-12);
  for (const child of children) {
    assert.equal(child.metrics.spend, null);
    assert.equal(child.metrics.purchases, null);
    assert.equal(child.metrics.cac, null);
    assert.equal(child.metrics.roas, null);
  }
});

test('both hierarchy orders retain month denominators and day-level disclosure nodes', () => {
  const days = phases.buildPhaseDays(rows, schedule, '2026-05-27');
  for (const orientation of ['month-phase', 'phase-month']) {
    const nodes = phases.buildHierarchy(days, orientation, false);
    assert.ok(nodes.some((node) => node.kind === 'day'));
    for (const node of nodes.filter((candidate) => candidate.kind === 'phase' || candidate.kind === 'month')) {
      if (node.month) assert.ok(node.share >= 0 && node.share <= 1);
    }
  }
});

test('monthly chart series keep stable phase order and ratio-of-sums metric values', () => {
  const days = phases.buildPhaseDays(rows, schedule, '2026-05-27');
  const revenue = phases.monthlySeries(days, 'revenue');
  assert.deepEqual(revenue.phases, ['BAU', 'Promo', 'Influ']);
  assert.deepEqual(revenue.months, ['2026-01', '2026-02', '2026-05']);
  const roas = phases.monthlySeries(days, 'roas');
  const febPromoIndex = roas.months.indexOf('2026-02');
  assert.equal(roas.series.Promo[febPromoIndex], 300 / 90);
});
