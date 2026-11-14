const test=require('node:test');
const assert=require('node:assert/strict');
const v2=require('../lib/glv-mad-v2.cjs');
test('reporting cutoff follows TUC Prague day; TGLV last day is partial until LA midnight (DST-aware)',()=>{
 const at=t=>new Date(t);
 // Prague day ends 23:00 UTC in winter: TUC/V1 has yesterday before 08:00 GMT+7.
 assert.equal(v2.commonCutoff(at('2026-11-12T23:30:00Z')),'2026-11-12');
 assert.equal(v2.refreshPhase(at('2026-11-13T01:00:00Z')),'tglv-partial');
 assert.equal(v2.accountCompleteThrough(at('2026-11-13T01:00:00Z'),'TGLV'),'2026-11-11');
 assert.equal(v2.refreshPhase(at('2026-11-13T08:00:00Z')),'final');
 // Spring DST (CEST and PDT both active on 2026-03-29).
 assert.equal(v2.commonCutoff(at('2026-03-29T06:30:00Z')),'2026-03-28');
 assert.equal(v2.refreshPhase(at('2026-03-29T06:30:00Z')),'tglv-partial');
 assert.equal(v2.refreshPhase(at('2026-03-29T07:30:00Z')),'final');
 // Autumn: PDT ends 2026-11-01 09:00 UTC.
 assert.equal(v2.commonCutoff(at('2026-11-01T07:30:00Z')),'2026-10-31');
 assert.equal(v2.refreshPhase(at('2026-11-01T07:30:00Z')),'final');
 assert.equal(v2.commonCutoff(at('2026-11-02T07:30:00Z')),'2026-11-01');
 assert.equal(v2.refreshPhase(at('2026-11-02T07:30:00Z')),'tglv-partial');
 assert.deepEqual(v2.rangeFor('last_7d',at('2026-11-02T07:30:00Z')),{since:'2026-10-26',until:'2026-11-01'});
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
