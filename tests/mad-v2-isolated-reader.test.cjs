'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const source=require('../lib/glv-mad-v2-source.cjs'),v2=require('../lib/glv-mad-v2.cjs');
test('reader composes unequal ranges truthfully and retains exact period reach',()=>{
 const reader=require('../lib/glv-mad-v2-isolated-reader.cjs');
 const range={since:'2026-11-08',until:'2026-11-14'},old={since:'2026-11-07',until:'2026-11-13'};
 const bundles=Object.fromEntries(v2.ACCOUNTS.map((a,i)=>[a.id,{schema_version:1,creator_ad_version:1,complete:true,isolated_account_id:a.id,type:'aggregate',range:i?old:range,generated_at:'2026-11-15T05:00:00Z',fx:{'2026-11-08':{date:'2026-11-08',czk_per_usd:23}},accounts:[{...a,rows:[{id:'1',name:a.label+'_1_US_Test',date_start:'2026-11-08',date_stop:'2026-11-08',amount_spent:23,'action_values:omni_purchase':46,impressions:10,reach:8}],reach:[[a.id+':1',7]]}]}]));
 const account_coverage=v2.ACCOUNTS.map((a,i)=>({account_id:a.id,range:i?old:range,complete_through:i?'2026-11-13':'2026-11-14',partial:false,generated_at:'2026-11-15T05:00:00Z'}));
 const p=reader.render({aggregate:{type:'aggregate',range,generation_id:'test',account_bundles:bundles,account_coverage}},{type:'aggregate',currency:'USD',account:'All',range});
 assert.equal(p.date_policy,'account-isolated');assert.equal(p.coverage_complete,false);assert.equal(p.stale,true);assert.equal(p.rows.length,1);assert.deepEqual(p.omitted_accounts,[v2.ACCOUNTS[1].id]);assert.ok(p.rows.every(r=>r.reach===7));assert.deepEqual(p.account_coverage,account_coverage);
 assert.equal(reader.scope({type:'daily'},new Date('2026-11-15T05:00:00Z')).range.until,'2026-11-14');
});
