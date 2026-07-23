import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accountSummary,
  aggregateDaily,
  brokenAxisScale,
  dayOfMonthProfile,
  escapeHtml,
  filterDaily,
  filterMonthlyDetail,
  normalizeFilters,
  regionSummary,
  safeRatio,
  summarizeNamedGroups,
  withEfficiency,
} from '../public/elm-meta-ads/metrics.mjs';

const rows = [
  { date: '2025-01-01', account: 'A', spend: 100, purchases: 2, landing_page_views: 10, checkouts: 4, raw_purchase_value: 1000, modelled_purchase_value: 200, flagged: true },
  { date: '2025-01-02', account: 'A', spend: 200, purchases: 3, landing_page_views: 20, checkouts: 5, raw_purchase_value: 300, modelled_purchase_value: 300, flagged: false },
  { date: '2025-02-01', account: 'B', spend: 300, purchases: 0, landing_page_views: 10, checkouts: 0, raw_purchase_value: 0, modelled_purchase_value: 0, flagged: false },
];

test('safeRatio distinguishes undefined ratios from zero', () => {
  assert.equal(safeRatio(0, 2), 0);
  assert.equal(safeRatio(2, 0), null);
});

test('filterDaily applies date and account boundaries', () => {
  assert.deepEqual(filterDaily(rows, { from: '2025-01-02', to: '2025-02-01', accounts: ['A'] }), [rows[1]]);
});

test('normalizeFilters rejects unsupported values and repairs reversed ranges', () => {
  const range = { start: '2024-07-01', end: '2026-06-30' };
  assert.deepEqual(
    normalizeFilters({ from: '2026-01-01', to: '2025-01-01', account: 'A', grain: 'week' }, range, ['all', 'A']),
    { from: '2025-01-01', to: '2026-01-01', account: 'A', accounts: ['A'], grain: 'week' },
  );
  assert.deepEqual(
    normalizeFilters({ from: 'bad', to: '2030-01-01', account: '<script>', grain: 'quarter' }, range, ['all', 'A']),
    { from: range.start, to: range.end, account: 'all', accounts: [], grain: 'month' },
  );
});

test('escapeHtml neutralizes source-derived markup', () => {
  assert.equal(escapeHtml('<img src=x onerror="alert(1)"> & test'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; test');
});

test('brokenAxisScale preserves ordinary values and compresses extreme peaks', () => {
  const values = [...Array.from({ length: 40 }, (_, index) => (3 + (index % 5)) * 1e9), 10e9, 48e9, 213e9, 498e9, 649e9];
  const scale = brokenAxisScale(values);
  assert.equal(scale.enabled, true);
  assert.ok(scale.lowerMax >= 7e9 && scale.lowerMax <= 15e9);
  assert.equal(scale.map(5e9), 5e9);
  assert.equal(scale.map(649e9), scale.visualMax);
  assert.ok(scale.map(213e9) > scale.lowerMax);
  assert.ok(scale.map(213e9) < scale.map(498e9));
  values.forEach((value) => assert.ok(Math.abs(scale.inverse(scale.map(value)) - value) < 1));
});

test('brokenAxisScale keeps a linear axis when no extreme tail exists', () => {
  const scale = brokenAxisScale([2e9, 3e9, 4e9, 5e9, 6e9]);
  assert.equal(scale.enabled, false);
  assert.equal(scale.map(4e9), 4e9);
  assert.equal(scale.inverse(4e9), 4e9);
});

test('aggregateDaily computes ratio inputs as sums and counts flags', () => {
  const [january] = aggregateDaily(rows, 'month');
  assert.equal(january.label, '2025-01');
  assert.equal(january.spend, 300);
  assert.equal(january.purchases, 5);
  assert.equal(january.raw_purchase_value, 1300);
  assert.equal(january.modelled_purchase_value, 500);
  assert.equal(january.flagged_account_days, 1);
});

test('accountSummary returns null cost per purchase for zero-purchase account', () => {
  const result = accountSummary(rows);
  assert.equal(result.find((row) => row.account === 'A').cost_per_purchase, 60);
  assert.equal(result.find((row) => row.account === 'B').cost_per_purchase, null);
});

test('fixed-scope regional utility computes ratios of sums', () => {
  const regional = [
    { month: '2025-01', region: 'South', spend: 100, clicks: 2 },
    { month: '2025-02', region: 'South', spend: 300, clicks: 3 },
    { month: '2025-02', region: 'North', spend: 200, clicks: 4 },
  ];
  const result = regionSummary(regional);
  assert.equal(result.find((row) => row.region === 'South').cost_per_click, 80);
  assert.equal(result.find((row) => row.region === 'North').click_share, 4 / 9);
});

test('monthly efficiency metrics use ratios of aggregate numerators', () => {
  const january = withEfficiency(aggregateDaily(rows, 'month')[0]);
  assert.equal(january.modelled_roas, 500 / 300);
  assert.equal(january.cost_per_purchase, 60);
  assert.equal(january.purchase_cvr, 5 / 30);
  assert.equal(january.modelled_aov, 100);
});

test('day-of-month profile averages spend by observed month and preserves ratio inputs', () => {
  const profile = dayOfMonthProfile(rows);
  const first = profile.find((row) => row.day === 1);
  assert.equal(first.months, 2);
  assert.equal(first.average_spend, 200);
  assert.equal(first.modelled_roas, 200 / 400);
});

test('monthly detail filtering and group summaries respect account and clean-month scope', () => {
  const detail = [
    { month: '2025-01', account: 'A', group: 'Video', spend: 100, purchases: 2, landing_page_views: 10, raw_purchase_value: 500, value_reliable: true },
    { month: '2025-02', account: 'A', group: 'Banner', spend: 200, purchases: 4, landing_page_views: 40, raw_purchase_value: 300, value_reliable: false },
    { month: '2025-01', account: 'B', group: 'Banner', spend: 300, purchases: 3, landing_page_views: 20, raw_purchase_value: 600, value_reliable: true },
  ];
  const filtered = filterMonthlyDetail(detail, { from: '2025-01-01', to: '2025-01-31', accounts: ['A'] });
  assert.deepEqual(filtered, [detail[0]]);
  const summary = summarizeNamedGroups(detail);
  assert.equal(summary.find((row) => row.group === 'Video').clean_value_months_won, 1);
  assert.equal(summary.find((row) => row.group === 'Banner').clean_value_months_won, 1);
});
