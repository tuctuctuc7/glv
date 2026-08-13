const test = require('node:test');
const assert = require('node:assert/strict');

const metrics = require('../public/glv-2/metrics.js');

const sample = [
  { date: '2026-07-01', region: 'czsk', spend: 100, revenue: 200, purchases: 4, unique_visitors: 100, new_customers: 3, returning_customers: 1, new_customer_revenue: 150 },
  { date: '2026-07-01', region: 'us', spend: 50, revenue: 25, purchases: 1, unique_visitors: 50, new_customers: 1, returning_customers: 0, new_customer_revenue: 25 },
  { date: '2026-07-02', region: 'czsk', spend: 120, revenue: 300, purchases: 6, unique_visitors: 150, new_customers: 4, returning_customers: 2, new_customer_revenue: 220 },
  { date: '2026-07-02', region: 'us', spend: 80, revenue: 0, purchases: 0, unique_visitors: 40, new_customers: 0, returning_customers: 0, new_customer_revenue: 0 },
];

test('aggregateRows sums absolutes and derives ratios after aggregation', () => {
  const result = metrics.aggregateRows(sample);
  assert.deepEqual(result, {
    spend: 350,
    revenue: 525,
    purchases: 11,
    unique_visitors: 340,
    new_customers: 8,
    returning_customers: 3,
    new_customer_revenue: 395,
    roas: 1.5,
    cpa: 350 / 11,
    aov: 525 / 11,
    cvr: 11 / 340,
    new_customer_rate: 8 / 11,
  });
});

test('derived ratios are null when their denominator is zero', () => {
  const result = metrics.aggregateRows([
    { date: '2026-07-01', region: 'row', spend: 0, revenue: 100, purchases: 0, unique_visitors: 0 },
  ]);
  assert.equal(result.roas, null);
  assert.equal(result.cpa, null);
  assert.equal(result.aov, null);
  assert.equal(result.cvr, null);
  assert.equal(result.new_customer_rate, null);
});

test('new customer rate is derived after aggregation from customer counts', () => {
  const result = metrics.aggregateRows(sample);
  assert.equal(result.new_customer_rate, 8 / 11);
});

test('filterRows applies inclusive dates and selected regions', () => {
  const result = metrics.filterRows(sample, {
    from: '2026-07-02',
    to: '2026-07-02',
    regions: ['us'],
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].region, 'us');
  assert.equal(result[0].date, '2026-07-02');
});

test('groupRows derives weekly metrics from summed absolutes', () => {
  const result = metrics.groupRows(sample, 'week');
  assert.equal(result.length, 1);
  assert.equal(result[0].label, '2026-W27');
  assert.equal(result[0].spend, 350);
  assert.equal(result[0].roas, 1.5);
});

test('presetBounds returns inclusive periods ending at the latest data date', () => {
  assert.deepEqual(metrics.presetBounds('7d', '2026-07-15'), {
    from: '2026-07-09',
    to: '2026-07-15',
  });
  assert.deepEqual(metrics.presetBounds('mtd', '2026-07-15'), {
    from: '2026-07-01',
    to: '2026-07-15',
  });
  assert.deepEqual(metrics.presetBounds('ytd', '2026-07-15'), {
    from: '2026-01-01',
    to: '2026-07-15',
  });
});

test('previousPeriodBounds creates the immediately preceding equal-length range', () => {
  assert.deepEqual(metrics.previousPeriodBounds('2026-07-09', '2026-07-15'), {
    from: '2026-07-02',
    to: '2026-07-08',
  });
});

test('percentageChange preserves undefined comparisons instead of inventing zero', () => {
  assert.equal(metrics.percentageChange(120, 100), 0.2);
  assert.equal(metrics.percentageChange(0, 100), -1);
  assert.equal(metrics.percentageChange(10, 0), null);
  assert.equal(metrics.percentageChange(null, 10), null);
});

test('metric direction encodes that lower CPA is better but higher revenue is better', () => {
  assert.equal(metrics.deltaSignal('revenue', 0.1), 'positive');
  assert.equal(metrics.deltaSignal('revenue', -0.1), 'negative');
  assert.equal(metrics.deltaSignal('cpa', -0.1), 'positive');
  assert.equal(metrics.deltaSignal('cpa', 0.1), 'negative');
  assert.equal(metrics.deltaSignal('spend', 0.1), 'neutral');
});

test('regionalBreakdown reports contribution shares without dividing by zero', () => {
  const result = metrics.regionalBreakdown(sample, ['czsk', 'us']);
  const czsk = result.find((row) => row.region === 'czsk');
  const us = result.find((row) => row.region === 'us');
  assert.equal(czsk.revenueShare, 500 / 525);
  assert.equal(us.revenueShare, 25 / 525);
  assert.equal(czsk.spendShare, 220 / 350);
});

test('comparePeriods calculates metric deltas from independently aggregated periods', () => {
  const comparison = metrics.comparePeriods(sample.slice(2), sample.slice(0, 2));
  assert.equal(comparison.current.revenue, 300);
  assert.equal(comparison.previous.revenue, 225);
  assert.ok(Math.abs(comparison.changes.revenue - (1 / 3)) < 1e-12);
  assert.ok(Math.abs(comparison.changes.spend - (1 / 3)) < 1e-12);
  assert.ok(Math.abs(comparison.changes.roas) < 1e-12);
});

test('decisionGate blocks scale when targets and unit economics are unavailable', () => {
  const decision = metrics.decisionGate(
    { spend: 12071, revenue: 7674, purchases: 76, unique_visitors: 7000, roas: 0.64, cpa: 158.83, aov: 100.97, cvr: 0.0152 },
    { spend: 9719, revenue: 5059, purchases: 51, unique_visitors: 6200, roas: 0.52, cpa: 190.57, aov: 99.2, cvr: 0.0082 },
    { targetsConfigured: false, attributedRevenue: false, marginAvailable: false },
  );
  assert.equal(decision.action, 'HOLD');
  assert.equal(decision.eligibility, 'INSUFFICIENT EVIDENCE');
  assert.equal(decision.tone, 'warning');
  assert.match(decision.reason, /improved/i);
  assert.doesNotMatch(decision.reason, /efficient growth|profit|scale-ready/i);
});

test('decisionGate prioritizes traffic investigation when visitors fall but purchases hold', () => {
  const decision = metrics.decisionGate(
    { spend: 90, revenue: 95, purchases: 99, unique_visitors: 800 },
    { spend: 100, revenue: 100, purchases: 100, unique_visitors: 1000 },
    { targetsConfigured: false },
  );
  assert.equal(decision.action, 'INVESTIGATE');
  assert.equal(decision.issue, 'TRAFFIC VOLUME');
  assert.equal(decision.capitalAuthorized, false);
});

test('decisionGate classifies revenue with zero recorded spend as source context, not an efficiency win', () => {
  const decision = metrics.decisionGate(
    { spend: 0, revenue: 100, purchases: 5, unique_visitors: 500 },
    { spend: 0, revenue: 50, purchases: 2, unique_visitors: 200 },
    { targetsConfigured: false },
  );
  assert.equal(decision.action, 'INVESTIGATE');
  assert.equal(decision.issue, 'SPEND CLASSIFICATION');
  assert.equal(decision.capitalAuthorized, false);
});

test('validateRows rejects malformed values instead of coercing them to zero', () => {
  assert.throws(() => metrics.validateRows([{ date: 'bad', region: 'us', spend: null, revenue: 1, purchases: 1, unique_visitors: 1 }]), /date|finite/i);
  assert.throws(() => metrics.validateRows([{ date: '2026-07-01', region: 'xx', spend: 1, revenue: 1, purchases: 1, unique_visitors: 1 }]), /region/i);
  assert.throws(() => metrics.validateRows([
    { date: '2026-07-01', region: 'us', spend: 1, revenue: 1, purchases: 1, unique_visitors: 1 },
    { date: '2026-07-01', region: 'us', spend: 1, revenue: 1, purchases: 1, unique_visitors: 1 },
  ]), /duplicate/i);
});

test('revenueBridge exactly decomposes revenue change into purchase-volume and AOV effects', () => {
  const previous = { revenue: 1000, purchases: 10, aov: 100 };
  const current = { revenue: 1800, purchases: 15, aov: 120 };
  const bridge = metrics.revenueBridge(current, previous);
  assert.ok(Math.abs(bridge.purchaseEffect - 550) < 1e-12);
  assert.ok(Math.abs(bridge.aovEffect - 250) < 1e-12);
  assert.ok(Math.abs(bridge.totalChange - 800) < 1e-12);
  assert.ok(Math.abs(bridge.purchaseEffect + bridge.aovEffect - bridge.totalChange) < 1e-12);
});

test('rollingRows derives rolling ratios from rolling sums rather than averaging daily ratios', () => {
  const daily = [
    { label: 'd1', spend: 100, revenue: 100, purchases: 1, unique_visitors: 10 },
    { label: 'd2', spend: 10, revenue: 100, purchases: 9, unique_visitors: 90 },
    { label: 'd3', spend: 90, revenue: 200, purchases: 10, unique_visitors: 100 },
  ];
  const rolling = metrics.rollingRows(daily, 2);
  assert.equal(rolling.length, 3);
  assert.equal(rolling[0], null);
  assert.equal(rolling[1].spend, 110);
  assert.equal(rolling[1].revenue, 200);
  assert.ok(Math.abs(rolling[1].roas - (200 / 110)) < 1e-12);
  assert.equal(rolling[2].spend, 100);
  assert.equal(rolling[2].revenue, 300);
  assert.equal(rolling[2].roas, 3);
});

test('rollingMetricValues keeps absolute overlays on a daily-average scale while ratios remain ratios of sums', () => {
  const daily = [
    { label: 'd1', spend: 100, revenue: 100, purchases: 1, unique_visitors: 10 },
    { label: 'd2', spend: 10, revenue: 300, purchases: 9, unique_visitors: 90 },
  ];
  const revenue = metrics.rollingMetricValues(daily, 'revenue', 2);
  const roas = metrics.rollingMetricValues(daily, 'roas', 2);
  assert.deepEqual(revenue, [null, 200]);
  assert.equal(roas[0], null);
  assert.ok(Math.abs(roas[1] - (400 / 110)) < 1e-12);
});
