const test = require('node:test');
const assert = require('node:assert/strict');
const history = require('../public/glv-2/glv_2025_monthly.json');
const metrics = require('../public/glv-2/metrics.js');

test('static 2025 snapshot preserves provenance and twelve complete months', () => {
  assert.equal(history.schema_version, 1);
  assert.equal(history.status, 'static historical snapshot');
  assert.equal(history.currency, 'USD');
  assert.deepEqual(history.coverage, {
    start: '2025-01-01',
    end: '2025-12-31',
    source_grain: 'month',
    compatible_grains: ['month', 'year'],
    market_scope: 'company-wide / All markets only',
  });
  assert.equal(history.source.workbook_sha256, '8cd62dbdda301fa5fabdce63e3c8b61d8826c9235c4b7545a79ba1c3fcf958c7');
  assert.equal(history.rows.length, 12);
  assert.equal(new Set(history.rows.map((row) => row.date.slice(0, 7))).size, 12);
  assert.ok(history.rows.every((row) => row.period_start.endsWith('-01') && row.region === 'historical_all' && row.source_grain === 'month'));
});

test('snapshot matches workbook totals and reproduces every FX conversion', () => {
  const sourceRevenue = history.rows.reduce((sum, row) => sum + row.source_values.revenue_kczk, 0);
  const sourceSpend = history.rows.reduce((sum, row) => sum + row.source_values.spend_kczk, 0);
  const purchases = history.rows.reduce((sum, row) => sum + row.purchases, 0);
  assert.ok(Math.abs(sourceRevenue - 11982.635) < 1e-9);
  assert.ok(Math.abs(sourceSpend - 3856.374) < 1e-9);
  assert.equal(purchases, 4447);
  history.rows.forEach((row) => {
    const revenue = Math.round(row.source_values.revenue_kczk * 1000 * row.fx.usd_per_eur / row.fx.czk_per_eur * 100) / 100;
    const spend = Math.round(row.source_values.spend_kczk * 1000 * row.fx.usd_per_eur / row.fx.czk_per_eur * 100) / 100;
    assert.equal(row.revenue, revenue, `${row.date} revenue conversion`);
    assert.equal(row.spend, spend, `${row.date} spend conversion`);
  });
});

test('unavailable historical metrics stay null rather than becoming zero', () => {
  assert.deepEqual(Object.keys(history.normalization.unavailable_metrics).sort(), ['cvr', 'new_customer_revenue', 'unique_visitors']);
  assert.ok(history.rows.every((row) => row.unique_visitors === null && row.new_customer_revenue === null));
  const year = metrics.groupRows(history.rows, 'year')[0];
  assert.equal(year.label, '2025');
  assert.equal(year.unique_visitors, null);
  assert.equal(year.new_customer_revenue, null);
  assert.equal(year.cvr, null);
  assert.equal(metrics.metricValue(year, 'unique_visitors'), null);
});

test('mixed-period ratios use only rows with the required fields', () => {
  const workingRow = {
    date: '2026-01-01', region: 'czsk', spend: 100, revenue: 200, purchases: 10,
    unique_visitors: 100, new_customers: 6, returning_customers: 4, new_customer_revenue: 120,
  };
  const mixed = metrics.aggregateRows([history.rows[0], workingRow]);
  assert.equal(mixed.cvr, 0.1, 'historical purchases must not inflate working-source CVR');
  assert.equal(mixed.unique_visitors, 100);
  assert.equal(mixed.new_customer_revenue, 120);
  assert.equal(mixed.revenue, history.rows[0].revenue + 200);
  assert.equal(mixed.purchases, history.rows[0].purchases + 10);
});

test('year grain derives ratios from annual sums', () => {
  const year = metrics.groupRows(history.rows, 'year')[0];
  const revenue = history.rows.reduce((sum, row) => sum + row.revenue, 0);
  const spend = history.rows.reduce((sum, row) => sum + row.spend, 0);
  const purchases = history.rows.reduce((sum, row) => sum + row.purchases, 0);
  const newCustomers = history.rows.reduce((sum, row) => sum + row.new_customers, 0);
  assert.ok(Math.abs(year.roas - revenue / spend) < 1e-12);
  assert.ok(Math.abs(year.aov - revenue / purchases) < 1e-12);
  assert.ok(Math.abs(year.cpa - spend / purchases) < 1e-12);
  assert.ok(Math.abs(year.new_customer_rate - newCustomers / purchases) < 1e-12);
});