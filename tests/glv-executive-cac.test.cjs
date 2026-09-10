const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '..', 'public', 'glv', name), 'utf8');
const { comparePeriods } = require('../public/glv/metrics.js');
test('CAC card comparison uses aggregate CAC in both periods', () => {
  assert.equal(comparePeriods([{spend: 300, new_customers: 5}], [{spend: 200, new_customers: 5}]).changes.cac, 0.5);
  assert.equal(comparePeriods([{spend: 300, new_customers: 0}], [{spend: 200, new_customers: 5}]).changes.cac, null);
});
test('executive read substitutes CAC for CPA without changing the eight-card order', () => {
  assert.match(read('app.js'), /\['revenue', 'spend', 'purchases', 'new_customer_rate', 'cvr', 'aov', 'cac', 'roas'\]/);
  assert.match(read('styles.css'), /\.kpi-grid-executive \.kpi-card\[data-metric="cac"\] \{ order: 8; \}/);
});
