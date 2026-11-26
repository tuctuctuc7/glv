const test = require('node:test');
const assert = require('node:assert/strict');
const phases = require('../public/glv/phases.js');
const snapshot = require('../public/glv/glv_dashboard.json');

test('BFCM display identity is scoped to the 2026 launch and source, not mutable end', () => {
  const source = snapshot.phases.find(s => s.start_date === '2026-11-25' && s.label === 'promo bf');
  assert.ok(source);
  for (const [start, end, label, expected] of [
    ['2026-11-25', '2026-11-30', 'promo bf', 'BFCM'],
    ['2026-11-25', '2026-12-03', 'promo bf', 'BFCM'],
    ['2026-11-10', '2026-11-12', 'promo bf', 'November'],
    ['2027-11-25', '2027-11-30', 'promo bf', 'November'],
    ['2026-11-25', '2026-11-30', 'promo unrelated', 'November'],
  ]) {
    const entry = {...source, start_date:start, end_date:end, label};
    const frozen = JSON.stringify(entry);
    for (const build of [phases.buildPromoEvents, phases.buildPromoCohorts]) {
      const event = build([entry])[0];
      assert.equal(event.label, expected);
      assert.equal(event.id, `promo:${start}/${end}`);
      assert.equal(event.start_date, start); assert.equal(event.end_date, end);
      assert.deepEqual(event.sources, [entry]);
    }
    assert.equal(JSON.stringify(entry), frozen);
  }
});
