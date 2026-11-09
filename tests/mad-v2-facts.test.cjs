const test=require('node:test'),assert=require('node:assert/strict');
const v2=require('../lib/glv-mad-v2.cjs');
const [tuc,tglv]=v2.ACCOUNTS;
const fx={'2025-01-03':{date:'2025-01-03',czk_per_usd:25,source:'test'}};
const row=(name,spend=25)=>({id:'001',name,date_start:'2025-01-05',date_stop:'2025-01-05',amount_spent:spend,'action_values:omni_purchase':spend*2,'actions:omni_purchase':1,reach:7,impressions:10});
test('identity comes from immutable account, mismatch is warned not discarded; native and ghost retained',()=>{
 const a=v2.convertRow(row('TUC_001_US_Sales'),tuc,'USD',fx);
 const b=v2.convertRow({...row('AS | PPE | US'),creator_rows:[{...row('AS | PPE | US',-5),is_ghost:true,reach:null}]},tglv,'USD',fx);
 assert.notEqual(a.id,b.id);assert.equal(a.source_id,'001');assert.equal(a.account_id,tuc.id);
 assert.equal(a.amount_spent,1);assert.equal(a.native.amount_spent,25);assert.equal(a.fx.date,'2025-01-03');
 assert.equal(b.amount_spent,25);assert.equal(b.market,'US');assert.match(b.naming_warning,/prefix/);
 assert.equal(b.creator_rows[0].amount_spent,-5);assert.equal(b.creator_rows[0].reach,null);
 assert.equal(v2.convertRow(row('TUC_001_CZSK_Sales'),tglv,'CZK',fx).market,'US');
 assert.throws(()=>v2.convertRow(row('TUC_001_US_Sales'),{...tuc,currency:'USD'},'USD',fx),/identity/);
});
test('aggregation sums converted daily inputs, never daily ratios or reach',()=>{
 const a=v2.convertRow(row('TUC_001_US_Sales'),tuc,'USD',fx);
 const b=v2.convertRow({...row('TUC_001_US_Sales',50),date_start:'2025-01-06'},tuc,'USD',{...fx,'2025-01-06':{date:'2025-01-06',czk_per_usd:50}});
 const other=v2.convertRow(row('TGLV_001_US_Sales'),tglv,'USD',fx);
 const out=v2.aggregateRows([a,b,other],new Map([[a.id,9],[other.id,7]]));
 assert.equal(out.length,2);assert.equal(out[0].amount_spent,2);assert.equal(out[0]['action_values:omni_purchase'],4);
 assert.equal(out[0].reach,9);assert.equal(out[0].native.amount_spent,75);assert.equal(out[0].daily_provenance.length,2);
});
