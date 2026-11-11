'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeCampaign,normalizeAd}=require('../api/glv-meta-ads/fb-data.js')._test;
const shared=require('../lib/glv-mad-shared.cjs');
const {fixture}=require('./mad-shared-publication.test.cjs');
const TUC='359758259164738';
test('generic normalizers preserve explicit source ownership without inventing it',()=>{
 for(const normalize of [normalizeCampaign,r=>normalizeAd(r,{})]){
  assert.equal(normalize({account_id:TUC}).account_id,TUC);
  assert.equal(normalize({account_id:'other-account'}).account_id,'other-account');
  assert.equal(normalize({}).account_id,undefined);
 }
});
test('shared original-account adapter supplies trusted provenance to retained rows',()=>{
 const f=fixture();f.legacy.aggregate.rows[0].name='OTHER_002_CZSK_BAU';
 const b=shared.compose(f);
 for(const type of ['aggregate','daily','ads']){
  const p=shared.render(b,type,'v1');
  assert.ok(p.rows.every(r=>r.account_id===TUC));
 }
 assert.equal(shared.render(b,'aggregate','v1').rows[0].name,'OTHER_002_CZSK_BAU');
});
test('shared original-account publication rejects contradictory ownership',()=>{
 const f=fixture();f.legacy.aggregate.rows[0].account_id='other-account';
 assert.throws(()=>shared.compose(f),/account ownership/);
});
