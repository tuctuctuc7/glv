'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const base=path.join(__dirname,'../public/glv-meta-ads'),html=fs.readFileSync(path.join(base,'index.html'),'utf8');
test('V1 browser date and freshness runtime is local and never adopts shared publication cutoffs',()=>{
 assert.doesNotMatch(html,/glv-meta-ads-v2\/|MadV2|MadDatePolicy|\/date-policy\.js/);
 const wl=fs.readFileSync(path.join(base,'wl-report-ui.js'),'utf8');assert.doesNotMatch(wl,/MadV2|MadDatePolicy/);
 const context=vm.createContext({Intl,Date:class extends Date{constructor(...args){super(...(args.length?args:['2026-10-31T23:30:00Z']));}static now(){return +new Date('2026-10-31T23:30:00Z');}}});
 for(const name of ['v1-dates.js','v1-freshness.js'])vm.runInContext(fs.readFileSync(path.join(base,name),'utf8'),context);
 assert.equal(context.MadV1Dates.range('last_7d').until,'2026-10-31');
 assert.equal(context.MadV1Dates.range('last_month',{shared_generation_id:'a'.repeat(64)}).since,'2026-10-01');
 const data={rows:[],range:{since:'2026-10-01',until:'2026-10-29'},requested_range:{since:'2026-10-01',until:'2026-10-31'},generated_at:'2026-10-30T00:00:00Z'};
 assert.equal(context.MadV1Freshness.validate(data,{range:data.requested_range,currency:'CZK',account:'TUC',legacy:true}).stale,true);
 assert.throws(()=>context.MadV1Freshness.validate({...data,report_currency:'USD'},{range:data.requested_range,currency:'CZK',account:'TUC',legacy:true}),/account\/currency/);
 assert.throws(()=>context.MadV1Freshness.bundle([{...data,generation_id:'one'},{...data,generation_id:'two'}],{range:data.requested_range,currency:'CZK',account:'TUC',legacy:true,strict:true}),/Mixed source generations/);
});
