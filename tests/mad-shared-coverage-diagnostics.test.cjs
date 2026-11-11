'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const shared=require('../lib/glv-mad-shared.cjs');
const {fixture}=require('./mad-shared-publication.test.cjs');
test('rejected currency coverage identifies bounded source/type/identity differences',()=>{
 const f=fixture();for(const row of f.native.ads.accounts[0].rows)row.id='999';
 assert.throws(()=>shared.compose(f),error=>{
  assert.match(error.message,/Unsupported currency coverage/);
  assert.match(error.message,/type=ads/);
  assert.match(error.message,/canonical=1 observed=1 unique=1/);
  assert.match(error.message,/extra=999:false/);
  assert.ok(error.message.length<1200);
  return true;
 });
});
