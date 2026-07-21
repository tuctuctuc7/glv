import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accountSummary,
  aggregateDaily,
  escapeHtml,
  filterDaily,
  normalizeFilters,
  regionSummary,
  safeRatio,
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
    { month: '2025-01', region: 'South', spend: 100, purchases: 2 },
    { month: '2025-02', region: 'South', spend: 300, purchases: 3 },
    { month: '2025-02', region: 'North', spend: 200, purchases: 4 },
  ];
  const result = regionSummary(regional);
  assert.equal(result.find((row) => row.region === 'South').cost_per_purchase, 80);
  assert.equal(result.find((row) => row.region === 'North').purchase_share, 4 / 9);
});
