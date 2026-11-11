'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const shared=require('../lib/glv-mad-shared.cjs');
const {fixture}=require('./mad-shared-publication.test.cjs');
const v2=require('../lib/glv-mad-v2.cjs');
test('publication reconciles canonical counts and identity before currency rendering',()=>{
 const f=fixture();f.native.ads.accounts[0].rows[0].impressions='999';
 const b=shared.compose(f),czk=shared.render(b,'ads','v2','CZK','TUC'),usd=shared.render(b,'ads','v2','USD','TUC');
 assert.equal(usd.rows[0].impressions,czk.rows[0].impressions);
 assert.deepEqual(usd.rows.map(r=>r.id),czk.rows.map(r=>r.id));
 assert.equal(usd.rows[0].monetary_provenance.basis,'daily_CNB');
});
test('unsupported daily currency entity coverage rejects publication',()=>{
 const f=fixture();f.native.ads.accounts[0].rows[0].id='999';
 assert.throws(()=>shared.compose(f),/currency coverage/);
});
test('metadata is bound to the served generation, identically in both routes',()=>{
 const b=shared.compose(fixture());
 const m=name=>({schema_version:1,source:'Meta campaign objects',generated_at:'2026-11-03T13:00:00Z',accounts:[{id:v2.ACCOUNTS[0].id,campaigns:[{id:'1',account_id:v2.ACCOUNTS[0].id,name}]}]});
 const a=shared.render(b,'ads','v1','CZK','All',m('one')),c=shared.render(b,'daily','v2','CZK','TUC',m('two'));
 assert.notEqual(a.generation_id,c.generation_id);
 assert.equal(a.shared_generation_id,b.generation_id);
 assert.equal(a.generation_id,shared.render(b,'daily','v2','CZK','TUC',m('one')).generation_id);
});
test('multiple ad-grain creator children and signed Ghost retain currency-invariant facts and labels',()=>{
 const f=fixture(),parent=f.legacy.daily.rows[0];
 const children=[{...parent,ad_id:'21',ad_name:'Kristyna_A',adset_id:'3',adset_name:'same'},{...parent,ad_id:'22',ad_name:'ActionKate_B',adset_id:'3',adset_name:'same'},{...parent,is_ghost:true,creator:null,reason:'campaign_adset_residual',reach:null,amount_spent:-1}];
 for(const k of ['amount_spent','impressions','actions:link_click','actions:landing_page_view','actions:omni_purchase','actions:initiate_checkout','actions:outbound_click','actions:lead','action_values:omni_purchase'])children[2][k]=Number(children[2][k]||0);
 for(const row of f.legacy.daily.rows)row.creator_rows=children.map(c=>({...c,date_start:row.date_start,date_stop:row.date_stop}));
 f.legacy.aggregate.rows[0].creator_rows=children.map(c=>({...c,date_start:f.legacy.aggregate.range.since,date_stop:f.legacy.aggregate.range.until,amount_spent:Number(c.amount_spent)*2}));
 for(const type of ['daily','aggregate'])f.native[type].accounts[0].rows=structuredClone(f.legacy.daily.rows);
 const b=shared.compose(f),metadata={schema_version:1,source:'Meta campaign objects',generated_at:'2026-11-03T13:00:00Z',accounts:[{id:v2.ACCOUNTS[0].id,campaigns:[{id:'1',account_id:v2.ACCOUNTS[0].id,name:'TUC_099_CZSK_BAU'}]}]};
 const a=shared.render(b,'aggregate','v2','CZK','TUC',metadata),u=shared.render(b,'aggregate','v2','USD','TUC',metadata);
 assert.equal(u.rows[0].creator_rows.length,3);
 assert.deepEqual(u.rows[0].creator_rows.map(r=>r.campaign_name),a.rows[0].creator_rows.map(r=>r.campaign_name));
 assert.deepEqual(u.rows[0].creator_rows.map(r=>r.impressions),a.rows[0].creator_rows.map(r=>r.impressions));
 assert.ok(u.rows[0].creator_rows.find(r=>r.is_ghost).amount_spent<0);
});
test('publication rejects a tampered materialized USD observation',()=>{
 const b=shared.compose(fixture());b.pieces.ads.usd[0].amount_spent=999;
 const pieces=Object.fromEntries(['daily','aggregate','ads'].map(t=>[t,{range:b.range,generation_id:b.generation_id,provenance:b.provenance,piece:b.pieces[t]}]));
 assert.throws(()=>shared.validate(pieces),/content identity/);
});
test('old native wrapper with actual recent account correction evidence is reusable',()=>{
 const f=fixture(),now=new Date('2026-11-11T14:00:00Z'),s=f.native.ads;
 s.generated_at='2026-10-01T00:00:00Z';s.range={since:'2026-11-01',until:'2026-11-10'};s.refresh_through='2026-11-10';s.shared_correction_id='pending';
 s.source_extractions=v2.ACCOUNTS.map(a=>({account_id:a.id,range:{since:'2026-11-04',until:'2026-11-10'},generated_at:'2026-11-11T13:00:00Z'}));
 const cache=require('../lib/glv-mad-v2-cache.cjs');
 assert.equal(cache.cacheState(s,{type:'ads',range:s.range,now}).stale,false);
 s.source_extractions.pop();assert.equal(cache.cacheState(s,{type:'ads',range:s.range,now}).stale,true);
});
test('fresh corrected account-window evidence permits an old retained-history wrapper',()=>{
 const f=fixture();f.native.ads.generated_at='2026-11-03T08:00:00Z';
 f.native.ads.shared_correction_id='migration';
 f.native.ads.source_extractions=v2.ACCOUNTS.map(a=>({account_id:a.id,range:f.native.ads.range,generated_at:'2026-11-03T12:34:00Z'}));
 assert.doesNotThrow(()=>shared.compose({...f,correction:{id:'migration',requested_at:'2026-11-03T12:30:00Z',through:'2026-11-02'}}));
 f.native.ads.source_extractions.pop();
 assert.throws(()=>shared.compose({...f,correction:{id:'migration',requested_at:'2026-11-03T12:30:00Z',through:'2026-11-02'}}),/correction/);
});
