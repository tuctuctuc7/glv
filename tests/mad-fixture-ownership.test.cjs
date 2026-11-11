'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const qa=require('../qa/mad-full-parity.cjs');
const {renderSnapshot}=require('../lib/glv-mad-v2-source.cjs');
const presentation=require('../public/glv-meta-ads/presentation.js');
test('wrong-prefix fixture ownership comes from the production account renderer, not its name',()=>{
 const range={since:'2026-11-04',until:'2026-11-10'};
 for(const type of ['aggregate','daily','ads']){
  const native=qa.fixture(range,type,'current-wrong-prefix');
  const rendered=renderSnapshot(native,'CZK','TUC');
  const v1=qa.legacyPayload(native,type,range);
  for(const row of v1.rows){
   const actual=rendered.rows.find(r=>r.source_id===row.id&&(type!=='daily'||r.date_start===row.date_start));
   assert.ok(actual);assert.equal(row.account_id,actual.account_id);
  }
  const wrong=v1.rows.filter(r=>(r.campaign_name||r.name)==='TGLV_002_CZSK_BAU_TrueTUCAccount');
  assert.ok(wrong.length);assert.ok(wrong.every(presentation.ownedTuc));
  assert.ok(presentation.namingWarnings([v1]).some(w=>w.includes('prefix mismatch')));
 }
 assert.equal(presentation.ownedTuc({name:'TGLV_002_CZSK_BAU_TrueTUCAccount'}),false);
 assert.equal(presentation.ownedTuc({account_id:'unknown',name:'TGLV_002_CZSK_BAU_TrueTUCAccount'}),false);
});
