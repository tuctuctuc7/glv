const test = require('node:test');
const assert = require('node:assert/strict');
const phases = require('../public/glv/phases.js');
const data = require('../public/glv/glv_dashboard.json');

test('day counts match represented dates in both hierarchies, filters and Influ splits', () => {
  const days = phases.buildPhaseDays(data.rows, data.phases, data.phase_contract.latest_date);
  for (const orientation of ['month-phase', 'phase-month']) {
    for (const split of [false, true]) {
      for (const filters of [{}, { months: ['2026-01', '2026-02'], phases: ['Influ', 'Promo'] }]) {
        const selected = days.filter(d => (!filters.months || filters.months.includes(d.month)) && (!filters.phases || filters.phases.includes(d.phase)));
        for (const node of phases.buildHierarchy(days, orientation, split, filters)) {
          const eligible = selected.filter(d => (!node.month || d.month === node.month) && (!node.phase || d.phase === node.phase) && (node.kind !== 'day' || d.date === node.label));
          assert.equal(node.metrics.day_count, new Set(eligible.map(d => d.date)).size, node.id);
          assert.equal(node.metrics.avg_daily_revenue, node.metrics.revenue / node.metrics.day_count, node.id);
        }
      }
    }
  }
});
