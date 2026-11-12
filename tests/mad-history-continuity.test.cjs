const test=require('node:test'),assert=require('node:assert/strict');
const F=require('../public/glv-meta-ads-v2/freshness.js');
const requested={since:'2026-10-12',until:'2026-11-10'};
const old={since:'2026-10-11',until:'2026-11-09'};
const opts={range:requested,currency:'USD',account:'All',now:Date.parse('2026-11-11T12:00:00Z'),available:true};
const payload=(range=old)=>({rows:[],complete:true,range,cached_range:range,requested_range:requested,coverage_complete:false,generated_at:'2026-11-10T08:00:00Z',generation_id:'good',report_currency:'USD',account_filter:'All'});
test('screenshot rollover preserves whole actual bundle, never relabels totals as requested',()=>{
 const state=F.bundle([payload(),payload(),payload()],opts);
 assert.deepEqual(state.range,old);assert.equal(state.stale,true);
 assert.match(state.warning,/Showing 2026-10-11 → 2026-11-09; later days not refreshed yet/);
});
test('multiple missed days preserve untouched rows and unique reach',()=>{
 for(const until of ['2026-11-11','2026-11-14']){
  const range={since:until==='2026-11-11'?'2026-10-13':'2026-10-16',until};
  const p={...payload(),requested_range:range,rows:[{reach:123,amount_spent:456}]};
  const before=JSON.stringify(p),state=F.bundle([p,p],{...opts,range,now:Date.parse(until+'T23:00:00Z')});
  assert.deepEqual(state.range,old);assert.equal(JSON.stringify(p),before);assert.match(state.warning,/not refreshed yet/);
 }
});
test('available history rejects wrong identity and malformed data, but shows disjoint or mixed data with a note',()=>{
 for(const change of [{account_filter:'TUC'},{report_currency:'CZK'},{range:{since:'2026-02-30',until:'2026-11-09'}},{range:{since:'2026-11-09',until:'2026-10-11'}},{complete:false},{generated_at:'bad'},{generated_at:'2026-11-12T00:00:00Z'}]){
  const p={...payload(),...change};if(change.range)p.cached_range=change.range;
  assert.throws(()=>F.bundle([payload(),p],opts));
 }
 const disjoint={...payload(),range:{since:'2026-09-01',until:'2026-09-30'},cached_range:{since:'2026-09-01',until:'2026-09-30'}};
 assert.match(F.bundle([disjoint,disjoint],opts).warning,/not refreshed yet; showing latest available 2026-09-01 → 2026-09-30/);
 const other=F.bundle([payload(),{...payload(),generation_id:'other'}],opts);assert.equal(other.mixed,true);assert.match(other.warning,/different times/);
 assert.throws(()=>F.bundle([payload(),{...payload(),generation_id:'other'}],{...opts,strict:true}),/generations/);
 assert.throws(()=>F.bundle([payload(),payload({since:'2026-10-12',until:'2026-11-09'})],{...opts,strict:true}),/ranges/);
 assert.equal(F.bundle([payload(),payload({since:'2026-10-12',until:'2026-11-09'})],opts).mixed,true);
});
test('historical scope accepts exact aged data, and shows a different month only with an explicit note',()=>{
 const range={since:'2026-10-01',until:'2026-10-31'},p={...payload(range),requested_range:range,coverage_complete:true};
 assert.equal(F.validate(p,{...opts,range,available:false}).stale,true);
 const shifted=F.validate({...p,range:old,cached_range:old,requested_range:undefined},{...opts,range,available:false});
 assert.equal(shifted.stale,true);assert.match(shifted.warning,/Showing 2026-10-11 → 2026-11-09/);
 assert.throws(()=>F.validate({...p,range:old,cached_range:old,requested_range:old},{...opts,range,available:false}),/requested range/);
});
test('recovered generation clears warning without changing requested scope',()=>{
 const p={...payload(requested),coverage_complete:true,generated_at:'2026-11-11T11:00:00Z',generation_id:'recovered'};
 const state=F.bundle([p,p,p],opts);assert.equal(state.stale,false);assert.equal(state.warning,'');assert.deepEqual(state.range,requested);
});
