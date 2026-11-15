'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const publication=require('../lib/glv-history-publication.cjs'),source=require('../lib/glv-mad-v2-source.cjs'),v2=require('../lib/glv-mad-v2.cjs');
test('resumed native bundles use the daily piece FX for all converted observations',async()=>{
 const runtime=require('../lib/glv-mad-v2-isolated.cjs'),{memory,snapshot}=require('./fixtures/mad-v2-isolated.cjs'),store=memory(),now=new Date('2026-11-15T09:00:00Z');
 const result=await runtime.refresh({redis:store.redis,token:'synthetic',now,presets:['last_7d'],includePromo:false,loadFx:async()=>({}),build:async options=>({...snapshot(options),fx:{'2026-11-13':{date:'2026-11-13',czk_per_usd:24,source:'synthetic',sha256:options.type==='daily'?'old-annual-response':'new-annual-response',provider:'Czech National Bank'}}})});
 assert.equal(result.verified,true,JSON.stringify(result.errors));
 const bundle=await runtime.readPreset(store.redis,'last_7d');
 for(const account of v2.ACCOUNTS)for(const type of ['aggregate','ads'])assert.deepEqual(bundle[type].account_bundles[account.id].fx,bundle.daily.account_bundles[account.id].fx);
});
test('operator failure summaries never disclose multiline error messages or stack-like text',async()=>{
 const runtime=require('../lib/glv-mad-v2-isolated.cjs'),{memory}=require('./fixtures/mad-v2-isolated.cjs'),store=memory();
 const result=await runtime.refresh({redis:store.redis,token:'synthetic',presets:['last_7d'],includePromo:false,loadFx:async()=>({}),build:async()=>{throw Error('transport failed\nlib/SYNTHETIC_PRIVATE_MARKER:123:45');}});
 assert.equal(result.verified,false);assert.doesNotMatch(JSON.stringify(result),/SYNTHETIC_PRIVATE_MARKER|failure_site|transport failed/);
});
test('immutable bundle identity does not depend on Redis piece completion order',async()=>{
 const store=new Map(),key='test:publication',range={since:'2026-11-08',until:'2026-11-14'},pieces=Object.fromEntries(publication.TYPES.map(type=>[type,{type,range,rows:[]}])) ,validate=()=>{};
 await publication.publishBundle({key,pieces,validate,write:async(k,v)=>store.set(k,structuredClone(v))});
 const actual=await publication.readBundle({key,validate,read:async k=>{if(k.includes(':piece:'))await new Promise(r=>setTimeout(r,k.includes(':daily:')?20:k.includes(':aggregate:')?10:0));return store.get(k);}});
 assert.deepEqual(Object.keys(actual),publication.TYPES);assert.equal(publication.digest(actual),publication.digest(pieces));
});
test('account-isolated source follows Meta upgraded-version paging only within the same account',async()=>{
 const account=v2.ACCOUNTS[1],range={since:'2026-11-14',until:'2026-11-14'};
 for(const foreign of [false,true]){
  const calls=[];
  const run=()=>source.buildSnapshot({account,range,type:'daily',token:'synthetic',fx:{},fetcher:async url=>{
   const u=new URL(url);calls.push(u.pathname);
   const body=!u.pathname.endsWith('/insights')?{account_id:account.id,currency:account.currency,timezone_name:account.timezone,account_status:1}:u.pathname.startsWith('/v21.0/')?{data:[],paging:{next:`https://graph.facebook.com/v25.0/act_${foreign?v2.ACCOUNTS[0].id:account.id}/insights?after=next`}}:{data:[]};
   return {ok:true,status:200,json:async()=>body};
  }});
  if(foreign){await assert.rejects(run,/pagination account scope/);assert.ok(!calls.some(p=>p.includes(v2.ACCOUNTS[0].id)));}
  else {const s=await run();assert.equal(s.accounts[0].id,account.id);assert.ok(calls.some(p=>p.startsWith('/v25.0/')));}
 }
});
