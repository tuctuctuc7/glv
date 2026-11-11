'use strict';
// Fixture/oracle integrity tests. Actual browser execution: node qa/mad-full-parity.cjs.
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,aggregateNative,payload,canonical,differences}=require('../qa/mad-full-parity.cjs');
const {renderSnapshot}=require('../lib/glv-mad-v2-source.cjs');
const range={since:'2026-10-01',until:'2026-10-31'};
test('canonicalization changes only explicit account namespaces, never numeric/name differences',()=>{
 assert.equal(canonical('359758259164738:123'),'123');
 assert.equal(canonical('TUC_002'),'TUC_002');
 assert.equal(differences({n:1},{n:1.00000001}).length,1);
 assert.equal(differences({n:null},{n:0}).length,1);
});
test('TUC-only rendered conversion agrees with independently aggregated monetary inputs',()=>{
 for(const type of ['daily','aggregate','ads']){
 const n=fixture(range,type,'normal'),v2=renderSnapshot(n,'CZK','TUC');
 const native=type==='daily'?n.accounts[0].rows:aggregateNative(n.accounts[0].rows,range);
 const sum=(rs,k)=>rs.reduce((n,r)=>n+Number(r[k]),0);
 for(const k of ['amount_spent','action_values:omni_purchase','actions:omni_purchase','actions:outbound_click'])assert.equal(sum(v2.rows,k),sum(native,k));
 assert.equal(v2.rows.length,native.length);
 }
});
test('two creators sharing an adset remain distinct through real V2 nested aggregation',()=>{
 const n=fixture(range,'aggregate','normal'),out=renderSnapshot(n,'CZK','TUC');
 const parent=out.rows.find(r=>r.source_id==='3');
 assert.equal(parent.creator_rows.length,2);
 assert.deepEqual(parent.creator_rows.map(r=>r.ad_name),['Kristyna_PAC419_v6-9','ActionKate_PAC462_v2']);
 assert.deepEqual(parent.creator_rows.map(r=>r.amount_spent),[45,45]);
});
test('extra account merge adds only its USD-to-CZK converted rows with distinct IDs',()=>{
 const n=fixture(range,'aggregate','normal'),t=renderSnapshot(n,'CZK','TUC'),m=renderSnapshot(n,'CZK','All');
 assert.deepEqual(m.rows.filter(r=>r.account_label==='TUC'),t.rows);
 const extra=m.rows.filter(r=>r.account_label==='TGLV');assert.equal(extra.length,1);assert.equal(extra[0].amount_spent,525);assert.equal(extra[0].market,'US');assert.equal(new Set(m.rows.map(r=>r.id)).size,m.rows.length);
});
test('shared zero is genuine zero and stale-name fixture changes no amounts',()=>{
 const z=renderSnapshot(fixture(range,'ads','zero'),'CZK','TUC');assert.ok(z.rows.every(r=>r.amount_spent===0));
 const a=fixture(range,'ads','normal'),b=fixture(range,'ads','stale-names');assert.deepEqual(a.accounts[0].rows.map(r=>r.amount_spent),b.accounts[0].rows.map(r=>r.amount_spent));assert.notDeepEqual(a.accounts[0].rows.map(r=>r.name),b.accounts[0].rows.map(r=>r.name));
});
test('Promo fixtures traverse the real V2 native conversion including negative Ghost facts',()=>{
 const q=new URLSearchParams({type:'promo_formats',date_preset:'promo_history',currency:'CZK',account:'TUC'}),a=payload(q,false),b=payload(q,true);
 for(const key of ['spend','revenue','purchases'])assert.deepEqual(b.rows.map(r=>r[key]),a.rows.map(r=>r[key]));
 assert.ok(b.rows.some(r=>r.is_ghost&&r.spend<0));
});
