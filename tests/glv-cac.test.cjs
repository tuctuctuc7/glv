const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../public/glv/metrics.js');
const fs = require('node:fs');
const path = require('node:path');

test('CAC is offered on both Home chart axes, the Phases chart, and audit tables', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/glv/index.html'), 'utf8');
  assert.equal((html.match(/<option value="cac">CAC<\/option>/g) || []).length, 3);
  assert.match(html, /<th[^>]*>CAC<\/th>/);
});

test('CAC divides total spend, including zero-acquisition days, by total new customers', () => {
  const rows = [{ date: '2026-09-01', spend: 100, new_customers: 2 }, { date: '2026-09-02', spend: 200, new_customers: 0 }, { date: '2026-09-03', spend: 300, new_customers: 8 }];
  assert.equal(m.aggregateRows(rows).cac, 60);
  for (const grain of ['week', 'month', 'year']) assert.equal(m.groupRows(rows, grain)[0].cac, 60);
  assert.equal(m.metricValue(rows[0], 'cac'), 50);
});

test('CAC is null for nonpositive or unavailable new customers, never an invented zero', () => {
  for (const n of [0, -1, null, undefined]) {
    const row = { spend: 100, new_customers: n };
    assert.equal(m.aggregateRows([row]).cac, null);
    assert.equal(m.metricValue(row, 'cac'), null);
  }
  assert.equal(m.aggregateRows([]).cac, null);
  assert.equal(m.aggregateRows([{ spend: null, new_customers: 2 }]).cac, null);
  assert.equal(m.aggregateRows([{ spend: 100, new_customers: 2 }, { spend: 200, new_customers: null }]).cac, null);
  assert.equal(m.metricValue(m.aggregateRows([{ spend: 100, new_customers: 2 }, { spend: 200, new_customers: null }]), 'cac'), null);
  assert.equal(m.aggregateRows([{ spend: 0, new_customers: 2 }]).cac, 0);
});
