'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs');
const path='../public/glv-meta-ads/browser-extract.js';
test('immutable daily window projects signed nested facts, exact observations and bounded isolated reuse',()=>{
 assert.ok(fs.existsSync(require('node:path').resolve(__dirname,path)),'browser extract module must exist');
 const E=require(path),range={since:'2026-11-01',until:'2026-11-24'},narrow={since:'2026-11-19',until:'2026-11-24'};
 const row={id:'c',account_id:'tuc',date_start:'2026-11-19',date_stop:'2026-11-19',amount_spent:10,impressions:100,reach:80,'actions:lead':1.5,creator_rows:[{id:'child',ad_id:'a',amount_spent:12,'actions:lead':2},{id:'g',is_ghost:true,amount_spent:-2,'actions:lead':-.5}]};
 const daily={rows:[row,{...row,date_start:'2026-11-20',date_stop:'2026-11-20'}],range,generated_at:'2026-11-25T00:00:00Z',generation_id:'one'};
 const direct={...daily,rows:[{...row,amount_spent:99,reach:155}]};
 const store=E.create({maxWindows:2}),before=JSON.stringify(daily);store.put('TUC/CZK',[direct,daily,null]);
 const sliced=store.get('TUC/CZK',narrow);assert.equal(sliced[0].rows[0].amount_spent,20);assert.equal(sliced[0].rows[0].reach,null);assert.equal(sliced[0].rows[0].creator_rows[1].amount_spent,-4);assert.equal(sliced[0].rows[0]['actions:lead'],3);assert.equal(sliced[2],null);
 assert.deepEqual(sliced[0].rows,require('../lib/glv-v1-source.cjs').aggregateDaily(daily.rows,narrow));
 assert.equal(store.get('TUC/CZK',range)[0].rows[0].amount_spent,99);assert.equal(store.get('TUC/CZK',range)[0].rows[0].reach,155);assert.equal(store.get('TUC/USD',range),null);assert.equal(JSON.stringify(daily),before);
 assert.throws(()=>store.put('TUC/CZK',[direct,{...daily,generation_id:'two'},null]),/generation/);
 assert.throws(()=>store.put('TUC/CZK',[{...direct,generation_id:undefined},{...daily,generation_id:undefined},null]),/generation/);
});

test('missing/null account coverage is not promoted by a contained range; session is bounded',()=>{
 const E=require(path),store=E.create({maxWindows:2}),range={since:'2026-11-01',until:'2026-11-24'},selected={since:'2026-11-10',until:'2026-11-12'};
 const d={rows:[],range,generation_id:'x',generated_at:'2026-11-25T00:00:00Z',account_filter:'All',accounts:[{id:'t',label:'TUC'},{id:'g',label:'TGLV'}],account_coverage:[{account_id:'t',range,complete_through:null,partial:true,generated_at:'2026-11-25T00:00:00Z'},{account_id:'g',range:null,complete_through:null,partial:true,generated_at:null,missing:true}]};
 store.put('All/USD',[d,d,null]);const got=store.get('All/USD',selected);assert.equal(got[0].account_coverage[0].complete_through,null);assert.equal(got[0].coverage_complete,false);assert.equal(got[0].account_coverage[1].generated_at,null);
 store.put('TUC/USD',[d,d,null]);store.put('TGLV/USD',[d,d,null]);assert.equal(store.stats().windows,2);assert.equal(store.get('All/USD',range),null);
});

test('daily creative reconciliation retains separate campaign Ghost identities',()=>{
 const E=require(path),r={since:'2026-11-01',until:'2026-11-02'};
 const rows=E.aggregateDaily([{id:'c1:ghost',is_ghost:true,amount_spent:-1},{id:'c2:ghost',is_ghost:true,amount_spent:3}],r);
 assert.equal(rows.length,2);assert.deepEqual(rows.map(r=>r.amount_spent),[-1,3]);
});

test('successful oversized replacement cannot leave a stale session window eligible for zoom',()=>{
 const E=require(path),range={since:'2026-11-01',until:'2026-11-24'};
 const old={rows:[],range,generation_id:'old'},store=E.create({maxBytes:2000});
 store.put('TUC/CZK',[old,old,null]);
 const newer={...old,generation_id:'new',note:'x'.repeat(2000)};
 assert.equal(store.put('TUC/CZK',[newer,newer,null],{replace:true}),false);
 assert.equal(store.get('TUC/CZK',range),null);assert.deepEqual(store.stats(),{windows:0,bytes:0});
});

test('late attachments cannot recreate evicted windows or replace newer generations',()=>{
 const E=require(path),range={since:'2026-11-01',until:'2026-11-24'},store=E.create();
 const old={rows:[],range,generation_id:'old'},newer={...old,generation_id:'new'};
 store.put('TUC/CZK',[newer,newer,null]);
 assert.equal(store.attach('TUC/CZK',[old,old,old]),false);assert.equal(store.get('TUC/CZK',range)[2],null);
 store.clear();assert.equal(store.attach('TUC/CZK',[newer,newer,newer]),false);assert.equal(store.stats().windows,0);
});
