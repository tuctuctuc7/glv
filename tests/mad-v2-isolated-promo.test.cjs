'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');const {memory}=require('./fixtures/mad-v2-isolated.cjs');
test('isolated Promo retains history, replaces rolling seven days, serves both types',async()=>{
 const promo=require('../lib/glv-mad-v2-isolated-promo.cjs'),store=memory(),now=new Date('2026-11-15T05:00:00Z');let seen;
 const prior={schema_version:1,funnel_version:1,classification_version:2,inventory_version:2,reconciled:true,range:{since:'2026-03-01',until:'2026-11-13'},generated_at:'2026-11-14T12:00:00Z',rows:[]};
 store.data.set(require('../lib/glv-promo-format.cjs').CACHE_KEY,JSON.stringify(prior));
 await promo.refresh({redis:store.redis,token:'x',through:'2026-11-14',now,loadFx:async()=>({}),fetchPromo:async(token,range)=>{seen=range;return {...prior,range,generated_at:now.toISOString()};}});
 assert.deepEqual(seen,{since:'2026-11-08',until:'2026-11-14'});
 for(const type of ['promo_formats','promo_concepts'])for(const account of ['All','TUC','TGLV'])for(const currency of ['USD','CZK']){
  const range={since:'2026-03-01',until:'2026-11-14'},r=await promo.readRender(require('../lib/glv-mad-v2-isolated.cjs').readValue(store.redis),{type,currency,account,range},now);
  assert.equal(r.date_policy,'account-isolated');assert.equal(r.range.until,'2026-11-14');assert.equal(r.coverage_complete,true);
  const validator=require('../public/glv-meta-ads-v2/freshness.js'),expected={range,currency,account,now:+now,history:true,dataset:'tuc-promo'};
  assert.doesNotThrow(()=>validator.validate(r,expected));
  assert.throws(()=>validator.validate({...r,account_coverage:[]},expected),/coverage/);
  if(account==='All')assert.throws(()=>validator.validate(r,{...expected,dataset:'campaigns'}),/coverage/,'ordinary All-account data still requires TGLV');
  if(account==='TGLV')assert.throws(()=>validator.validate({...r,rows:[{account_id:'359758259164738'}]},expected),/scope/,'TGLV-only Promo cannot leak TUC rows');
 }
 assert.equal(store.data.get(require('../lib/glv-promo-format.cjs').CACHE_KEY),JSON.stringify(prior));
});
