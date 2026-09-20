const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../public/glv/metrics.js');
const p = require('../public/glv/phases.js');
for (const [name, api] of [['Home', m], ['Phases', p]]) {
  test(`${name}: NC ROAS and RC use matching rows and weighted totals`, () => {
    const rows = [{spend: 100, revenue: 500, new_customer_revenue: 200}, {spend: 300, revenue: 600, new_customer_revenue: 300}, {spend: 900, revenue: 9000, new_customer_revenue: null}];
    const a = api.aggregateRows(rows);
    assert.equal(a.nc_roas, 1.25);
    assert.equal(a.returning_customer_revenue, 600);
    assert.equal(api.metricValue(a, 'nc_roas'), 1.25);
    assert.equal(api.metricValue(a, 'returning_customer_revenue'), 600);
  });
  test(`${name}: zero, negative, missing and historical inputs remain distinct`, () => {
    for (const rows of [[], [{revenue: 100, spend: 20}], [{revenue: 100, spend: 20, new_customer_revenue: null}]]) {
      assert.equal(api.aggregateRows(rows).nc_roas, null);
      assert.equal(api.aggregateRows(rows).returning_customer_revenue, null);
    }
    for (const spend of [0, -1, null, undefined]) assert.equal(api.aggregateRows([{spend, revenue: 10, new_customer_revenue: 20}]).nc_roas, null);
    assert.equal(api.aggregateRows([{spend: 10, revenue: 10, new_customer_revenue: 20}]).returning_customer_revenue, -10);
    assert.equal(api.aggregateRows([{spend: 10, revenue: 0, new_customer_revenue: 0}]).nc_roas, 0);
    assert.equal(api.aggregateRows([{spend: 10, revenue: 0, new_customer_revenue: 0}]).returning_customer_revenue, 0);
  });
}
test('Phases daily accessor derives NC metrics from raw rows', () => {
 assert.equal(p.metricValue({spend:100,revenue:500,new_customer_revenue:200}, 'nc_roas'),2);
 assert.equal(p.metricValue({spend:100,revenue:500,new_customer_revenue:200}, 'returning_customer_revenue'),300);
 assert.equal(p.metricValue({nc_roas:null,spend:100,new_customer_revenue:200}, 'nc_roas'),null);
});
test('Home filters and grains retain weighted NC ROAS and residual', () => {
  const rows = [{date:'2026-01-01',region:'czsk',spend:100,revenue:500,new_customer_revenue:200},{date:'2026-01-02',region:'czsk',spend:300,revenue:600,new_customer_revenue:300},{date:'2026-01-02',region:'us',spend:999,revenue:999,new_customer_revenue:0}];
  const filtered = m.filterRows(rows,{regions:['czsk'],from:'2026-01-01',to:'2026-01-02'});
  for (const grain of ['week','month','year']) { const a=m.groupRows(filtered,grain)[0]; assert.equal(a.nc_roas,1.25); assert.equal(a.returning_customer_revenue,600); }
});
test('Phase split descendants do not invent NC or cost allocation', () => {
 const days=[{date:'2026-01-01',month:'2026-01',phase:'Influ',spend:100,revenue:500,new_customer_revenue:200,code_revenue:100,no_code_revenue:400}];
 for (const orientation of ['month-phase','phase-month']) {
 const nodes=p.buildHierarchy(days,orientation,true);
 for (const n of nodes.filter(n=>n.id.includes('|code')||n.id.includes('|no-code'))) { assert.equal(n.metrics.nc_roas,null); assert.equal(n.metrics.returning_customer_revenue,null); }
 }
});
