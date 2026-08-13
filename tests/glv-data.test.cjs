const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'glv-2', 'glv_dashboard.json'), 'utf8'));
const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');

const DAY_MS = 86_400_000;
const isoDay = (date) => new Date(`${date}T00:00:00Z`);
const near = (actual, expected, tolerance = 0.0001) => Math.abs(actual - expected) <= tolerance;

test('dataset declares its business contract', () => {
  assert.equal(data.currency, 'USD');
  assert.equal(data.source.mode, 'read-only');
  assert.equal(data.source.tab, 'Daily');
  assert.ok(data.updated_at);
  assert.ok(Array.isArray(data.rows));
  assert.ok(data.rows.length > 0);
  assert.deepEqual(data.absolute_metrics, ['spend', 'revenue', 'purchases', 'unique_visitors', 'new_customers', 'returning_customers', 'new_customer_revenue']);
});

test('coverage is contiguous and has exactly one row per date and market', () => {
  const expectedDays = Math.round((isoDay(data.date_range.end) - isoDay(data.date_range.start)) / DAY_MS) + 1;
  assert.equal(data.rows.length, expectedDays * 3);

  const counts = new Map();
  data.rows.forEach((row) => {
    const key = `${row.date}|${row.region}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  assert.equal(counts.size, data.rows.length);
  assert.ok([...counts.values()].every((count) => count === 1));

  for (let cursor = isoDay(data.date_range.start); cursor <= isoDay(data.date_range.end); cursor = new Date(cursor.getTime() + DAY_MS)) {
    const date = cursor.toISOString().slice(0, 10);
    assert.deepEqual(['czsk', 'row', 'us'].filter((region) => counts.has(`${date}|${region}`)), ['czsk', 'row', 'us']);
  }
});

test('absolute metrics are finite and non-negative', () => {
  for (const row of data.rows) {
    for (const key of ['spend', 'revenue', 'purchases', 'unique_visitors', 'new_customers', 'returning_customers', 'new_customer_revenue']) {
      assert.equal(Number.isFinite(row[key]), true, `${row.date} ${row.region} ${key} is finite`);
      assert.ok(row[key] >= 0, `${row.date} ${row.region} ${key} is non-negative`);
    }
  }
});

test('source rows omit derived ratios so the dashboard must calculate them after aggregation', () => {
  for (const row of data.rows) {
    for (const key of ['roas', 'cpa', 'aov', 'cvr', 'new_customer_rate']) {
      assert.equal(Object.hasOwn(row, key), false, `${row.date} ${row.region} must not carry a pre-aggregated ${key}`);
    }
  }
});

test('README documents the complete source metric and derived metric contracts', () => {
  for (const metric of ['spend', 'revenue', 'purchases', 'unique visitors', 'new customers', 'returning customers', 'new customer revenue']) {
    assert.match(readme, new RegExp(`- ${metric}`, 'i'), `README omits ${metric}`);
  }
  assert.match(readme, /Cost per purchase = spend \/ purchases/);
  assert.doesNotMatch(readme, /- CPA = spend \/ purchases/);
});

test('declared date range matches actual row bounds', () => {
  const dates = data.rows.map((row) => row.date).sort();
  assert.equal(dates[0], data.date_range.start);
  assert.equal(dates.at(-1), data.date_range.end);
});
