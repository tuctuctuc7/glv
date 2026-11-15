'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const source=require('../lib/glv-mad-v2-source.cjs'),v2=require('../lib/glv-mad-v2.cjs');
test('explicit source account performs no requests for another account',async()=>{
 const account=v2.ACCOUNTS[1],urls=[];
 const s=await source.buildSnapshot({account,range:{since:'2026-11-14',until:'2026-11-14'},type:'daily',token:'test',fx:{},now:new Date('2026-11-15T05:00:00Z'),fetcher:async url=>{urls.push(url);const u=new URL(url);return {ok:true,json:async()=>u.pathname.endsWith('/insights')?{data:[]}:{account_id:account.id,currency:account.currency,timezone_name:account.timezone,account_status:1}};}});
 assert.equal(s.accounts.length,1);assert.equal(s.accounts[0].id,account.id);assert.ok(urls.every(u=>!u.includes(v2.ACCOUNTS[0].id)));assert.equal(source.renderSnapshot(s).rows.length,0);
});
