const test=require('node:test'),assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs');
const helper=require('../lib/glv-bfcm.cjs');
function harness(start) {
 let clock=Date.parse(start);const requests=[];
 class Clock extends Date {constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
 const context={module:{exports:{}},Buffer,Date:Clock,process:{env:{CRON_SECRET:'synthetic',FB_ACCESS_TOKEN:'synthetic'}},require(name){
  if(name==='crypto')return require(name);
  return {...helper,today:()=>helper.today(new Clock()),fetchReport:(_token,_fetch,now,options)=>new Promise((resolve,reject)=>requests.push({now,options,resolve,reject}))};
 }};
 vm.runInNewContext(fs.readFileSync(require.resolve('../api/glv-bfcm/data.js'),'utf8'),context);
 async function get(query={}){let body,status;await context.module.exports({query,method:'GET',headers:{authorization:'Bearer synthetic'}},{setHeader(){},status(s){status=s;return this;},json(b){body=b;}});return {status,body};}
 function complete(index,overrides={}){const request=requests[index];const {since,until}=helper.reportWindow(request.now||new Clock(),request.options);request.resolve({schema_version:'glv-bfcm/v3',daily_breakdown:request.options?.daily===true,reporting_period:since==='2026-11-25'&&until===helper.today(request.now)?'campaign-to-date':'custom',since,until,date:until,generated_at:new Clock().toISOString(),...overrides});}
 return {get,requests,complete,set:iso=>{clock=Date.parse(iso);}};
}
test('in-flight requests on opposite sides of Prague midnight cannot share or return the earlier window',async()=>{
 const h=harness('2026-11-26T22:59:59Z');
 const previous=h.get();assert.equal(h.requests.length,1);
 h.set('2026-11-26T23:00:01Z');const next=h.get();
 assert.equal(h.requests.length,2,'new account day must get its own pending extraction');
 h.complete(1);assert.equal((await next).body.until,'2026-11-27');
 h.complete(0);assert.equal((await previous).body.until,'2026-11-26');
 const again=h.get();await Promise.resolve();
 if(h.requests.length===3)h.complete(2);
 assert.equal((await again).body.until,'2026-11-27');
});
test('same-window requests coalesce; warm cache remains 60 seconds; old schema/window fails closed',async()=>{
 const h=harness('2026-11-26T04:00:00Z');const a=h.get(),b=h.get();assert.equal(h.requests.length,1);
 h.complete(0);assert.equal((await a).status,200);assert.equal((await b).status,200);
 h.set('2026-11-26T04:00:59Z');assert.equal((await h.get()).status,200);assert.equal(h.requests.length,1);
 h.set('2026-11-26T04:01:00Z');const expired=h.get();assert.equal(h.requests.length,2);
 h.complete(1,{schema_version:'glv-bfcm/v1',since:'2026-11-26'});
 assert.equal((await expired).status,502,'today-only payload must never enter the cumulative cache');
 const retry=h.get();assert.equal(h.requests.length,3);h.complete(2);assert.equal((await retry).status,200);
});
test('the same explicit range is re-extracted across midnight so partial metadata cannot leak',async()=>{
 const h=harness('2026-11-26T22:59:59Z'),q={since:'2026-11-25',until:'2026-11-26'};
 const a=h.get(q);h.complete(0);await a;h.set('2026-11-26T23:00:01Z');const b=h.get(q);
 assert.equal(h.requests.length,2);h.complete(1);assert.equal((await b).body.reporting_period,'custom');
});
test('range and daily mode isolate in-flight responses and cache; invalid input never calls Meta',async()=>{
 const h=harness('2026-11-27T12:00:00Z');
 assert.equal((await h.get({since:'2026-11-26'})).status,400);assert.equal(h.requests.length,0);
 assert.equal((await h.get({daily:['1']})).status,400);assert.equal(h.requests.length,0);
 const q={since:'2026-11-25',until:'2026-11-26'};
 const a=h.get(q),b=h.get({...q,daily:'1'}),c=h.get({since:'2026-11-26',until:'2026-11-26'});
 assert.equal(h.requests.length,3);
 for(const i of [2,0,1])h.complete(i);
 assert.equal((await a).body.daily_breakdown,false);assert.equal((await b).body.daily_breakdown,true);assert.equal((await c).body.since,'2026-11-26');
 await h.get(q);await h.get({...q,daily:'1'});assert.equal(h.requests.length,3);
});
