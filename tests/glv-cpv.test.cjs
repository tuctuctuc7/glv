const test = require('node:test');
const assert = require('node:assert/strict');
const home = require('../public/glv/metrics.js');
const phases = require('../public/glv/phases.js');
const promo = require('../public/glv/promo-comparison.js');
for (const [name, api] of Object.entries({home, phases})) test(`${name} CPV uses matching summed inputs and preserves unavailable`, () => {
  const rows = [{spend:100,unique_visitors:10},{spend:20,unique_visitors:30},{spend:900,unique_visitors:null},{spend:null,unique_visitors:900}];
  assert.equal(api.aggregateRows(rows).cpv, 3);
  assert.equal(api.metricValue(api.aggregateRows(rows),'cpv'),3);
  for(const unique_visitors of [null,undefined,0,-1,NaN,Infinity,'invalid','']) assert.equal(api.metricValue({spend:20,unique_visitors},'cpv'),null);
  for(const spend of [null,undefined,NaN,Infinity,'invalid','']) assert.equal(api.metricValue({spend,unique_visitors:10},'cpv'),null);
  assert.equal(api.metricValue({spend:0,unique_visitors:10},'cpv'),0);
  assert.equal(api.aggregateRows([]).cpv,null);
});
test('daily promo CPV is not cumulative',()=>{
 assert.equal(promo.value({spend:12,unique_visitors:3},'cpv'),4);
 for(const spend of [null,undefined,NaN,Infinity,'invalid','', ' ', false]) assert.equal(promo.value({spend,unique_visitors:3},'cpv'),null);
 assert.equal(promo.value({spend:0,unique_visitors:3},'cpv'),0);
 for(const unique_visitors of [null,undefined,0,-1,NaN,Infinity,'invalid','']) assert.equal(promo.value({spend:12,unique_visitors},'cpv'),null);
});
