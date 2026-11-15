const test=require('node:test');
const assert=require('node:assert/strict');
const v2=require('../lib/glv-mad-v2.cjs');
test('V2 morning Prague and late LA targets remain distinct across DST and LA midnight',()=>{
 const isolated=require('../lib/glv-mad-v2-isolated.cjs');
 for(const [stamp,morning,late] of [
  ['2026-03-29T06:30:00Z','2026-03-28','2026-03-27'],
  ['2026-03-29T07:30:00Z','2026-03-28','2026-03-28'],
  ['2026-11-01T07:30:00Z','2026-10-31','2026-10-31'],
  ['2026-11-02T07:30:00Z','2026-11-01','2026-10-31'],
 ]){
  const now=new Date(stamp);
  assert.equal(isolated.target('morning',now),morning);
  assert.equal(isolated.target('late',now),late);
  assert.equal(v2.commonCutoff(now),morning,'public requested range is not clipped to LA');
 }
 assert.deepEqual(v2.rangeFor('last_7d',new Date('2026-11-02T07:30:00Z')),{since:'2026-10-26',until:'2026-11-01'});
 assert.deepEqual(isolated.rangeFor('last_7d','2026-10-31'),{since:'2026-10-25',until:'2026-10-31'});
});
test('daily official FX uses historical fixing, reciprocal direction and holiday fallback',()=>{
 const table=v2.parseCnb('Date|1 EUR|1 USD\n02.01.2025|25|24.398\n03.01.2025|25|24.427\n06.01.2025|25|24.5\n','official-test-source');
 const fixing=v2.fixingFor('2025-01-05',table);
 assert.equal(fixing.date,'2025-01-03');assert.equal(fixing.czk_per_usd,24.427);
 assert.equal(v2.convertMoney(24.427,'CZK','USD',fixing),1);
 assert.equal(v2.convertMoney(2,'USD','CZK',fixing),48.854);
 assert.equal(v2.convertMoney(-2,'USD','USD',fixing),-2);
 assert.throws(()=>v2.fixingFor('2024-12-31',table),/FX/);
 assert.throws(()=>v2.fixingFor('2025-02-01',table),/FX/);
 assert.throws(()=>v2.parseCnb('<html>unavailable</html>','source'),/CNB/);
 assert.throws(()=>v2.convertMoney(null,'USD','CZK',fixing),/monetary/);
});
