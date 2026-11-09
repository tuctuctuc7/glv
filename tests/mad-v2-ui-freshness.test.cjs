const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const dates=require('../public/glv-meta-ads-v2/dates.js');
const range={since:'2026-10-01',until:'2026-10-31'},now=Date.parse('2026-11-02T12:00:00Z');
const expected={range,currency:'USD',account:'All',now};
const payload=()=>({rows:[],complete:true,range,requested_range:range,cached_range:range,stale:false,coverage_complete:true,generated_at:'2026-11-02T00:00:00Z',report_currency:'USD',account_filter:'All'});
test('ordinary reports validate successful cache scope before normalization and atomically reject mixed generations',()=>{
 const file='public/glv-meta-ads-v2/freshness.js';assert.ok(fs.existsSync(file),'frontend freshness contract is required');
 const f=require('../'+file);
 assert.equal(f.bundle([payload(),payload(),payload()],expected).warning,'');
 for(const change of [
  {range:{since:'2026-09-01',until:'2026-09-30'},cached_range:{since:'2026-09-01',until:'2026-09-30'},stale:true,coverage_complete:false},
  {requested_range:{since:'2026-09-01',until:'2026-09-30'}},
  {cached_range:{since:'2026-09-01',until:'2026-09-30'}},
  {report_currency:'CZK'},{account_filter:'TUC'},{complete:false},{coverage_complete:false}
 ])assert.throws(()=>f.bundle([payload(),{...payload(),...change},payload()],expected),/scope|range|coverage|complete/i);
 assert.throws(()=>f.bundle([payload(),payload(),{...payload(),generated_at:'2026-11-01T23:00:00Z'}],expected),/generation/i);
 assert.match(f.bundle([payload(),payload(),{...payload(),generated_at:'2026-11-01T23:00:00Z'}],{...expected,custom:true}).warning,/Independent custom-range source generations/);
 const aged={...payload(),stale:true,generated_at:'2026-10-31T00:00:00Z',warning:'Shared refresh pending'};
 const state=f.bundle([aged,aged,aged],expected);assert.match(state.warning,/stale/i);assert.match(state.warning,/2026-10-01 → 2026-10-31/);assert.match(state.warning,/Shared refresh pending/);
 assert.equal(f.bundle([payload(),payload(),payload()],expected).warning,'','recovery clears stale status');
});
const html=fs.readFileSync('public/glv-meta-ads-v2/index.html','utf8');
test('incompatible HTTP200 responses never poison session cache',async()=>{
 const fn=html.match(/async function apiFetch\(type,scope=requestScope\(\)\)\{[\s\S]*?\n\}/)[0];
 let saved,calls=0;
 const context={MadV2Dates:dates,MadV2Freshness:require('../public/glv-meta-ads-v2/freshness.js'),reportCurrency:'USD',reportAccount:'All',apiUrl:()=>'/synthetic',responseCache:{get:async(key,loader)=>saved||(saved=await loader())},fetch:async()=>({ok:true,json:async()=>{calls++;return {...payload(),generated_at:new Date().toISOString(),...(calls===1?{range:{since:'2026-09-01',until:'2026-09-30'}}:{})};}})};
 vm.createContext(context);vm.runInContext(fn+';this.run=()=>apiFetch("aggregate",{customRange:'+JSON.stringify(range)+'})',context);
 await assert.rejects(context.run(),/range/i);await context.run();assert.equal(calls,2);
});
test('retained independent history still warns after requested-day rollover',()=>{
 const fn=html.match(/function promoHistoryWarning\(payload,error=''\)\{[\s\S]*?\n\}/)[0];
 const context={MadV2Dates:{commonCutoff:()=> '2026-11-08'},MadV2Freshness:require('../public/glv-meta-ads-v2/freshness.js'),reportCurrency:'USD',reportAccount:'All'};
 vm.createContext(context);vm.runInContext(fn+';this.run=promoHistoryWarning',context);
 const old={...payload(),range:{since:'2026-03-01',until:'2026-11-07'},requested_range:{since:'2026-03-01',until:'2026-11-07'},cached_range:{since:'2026-03-01',until:'2026-11-07'}};
 assert.match(context.run(old,'refresh unavailable'),/Stale last-good.*2026-03-01 → 2026-11-07/);
});
test('HTTP200 stale source label must disclose stale and full actual coverage',()=>{
 const fn=html.match(/function mainSourceLabel\(results\)\{[\s\S]*?\n\}/)[0];
 const context={MadV2Dates:dates};vm.createContext(context);
 vm.runInContext(fn+';this.label=mainSourceLabel([0,1,2].map(()=>({status:"fulfilled",value:{stale:true,coverage_complete:false,generated_at:"2026-10-02T00:00:00Z",range:{since:"2026-09-01",until:"2026-09-30"}}})))',context);
 assert.match(context.label,/stale/i);assert.match(context.label,/2026-09-01/);assert.match(context.label,/2026-09-30/);
});
