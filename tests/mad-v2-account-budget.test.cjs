'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const runtime=require('../lib/glv-mad-v2-isolated.cjs'),v2=require('../lib/glv-mad-v2.cjs');
function memory(){const data=new Map();return {data,redis:async(cmd,key,value,...args)=>{if(cmd==='GET')return {result:data.get(key)||null};if(cmd==='SET'){if(args.includes('NX')&&data.has(key))return {result:null};data.set(key,value);return {result:'OK'};}if(cmd==='EVAL')return {result:1};if(cmd==='TTL')return {result:data.has(key)?-1:-2};throw Error(cmd);}};}
test('real slow TUC campaign pagination cannot starve available morning TGLV',async t=>{
 const now=new Date('2026-11-15T05:00:00Z');t.mock.timers.enable({apis:['Date'],now});
 const store=memory(),calls=[],start=Date.now();let page=0;
 const result=await runtime.refresh({redis:store.redis,mode:'morning',now,deadline:start+270000,presets:['last_7d'],includePromo:false,token:'synthetic',loadFx:async()=>({}),fetcher:async url=>{
  const u=new URL(url),account=v2.ACCOUNTS.find(a=>u.pathname.includes('act_'+a.id));assert.ok(account);calls.push(account.label);
  let body;
  if(!u.pathname.endsWith('/insights'))body={account_id:account.id,currency:account.currency,timezone_name:account.timezone,account_status:1};
  else if(account.label==='TUC'){t.mock.timers.tick(10000);u.searchParams.set('after',String(++page));body={data:[],paging:{next:u.toString()}};}
  else body={data:[]};
  return {ok:true,status:200,json:async()=>body};
 }});
 assert.ok(calls.includes('TGLV'),'TGLV must be attempted despite TUC exhausting its extraction allowance');
 const publication=await runtime.readPreset(store.redis,'last_7d');assert.ok(publication,'healthy account must remain readable');
 const coverage=publication.daily.account_coverage;
 assert.equal(coverage.find(a=>a.account_id===v2.ACCOUNTS[0].id).missing,true);
 assert.equal(coverage.find(a=>a.account_id===v2.ACCOUNTS[1].id).range.until,'2026-11-14');
 assert.equal(coverage.find(a=>a.account_id===v2.ACCOUNTS[1].id).partial,true);
 assert.equal(result.verified,false);assert.ok(result.errors.some(e=>e.account_id===v2.ACCOUNTS[0].id&&e.reason==='budget'));
 assert.ok(Date.now()<start+250000,'reserve remains for combined publication and response');
});
