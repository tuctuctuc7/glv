'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const owner=require('../lib/glv-refresh-owner.cjs');
test('same-cutoff metadata hook runs under existing lease before performance receipt skip',async()=>{
 const store=new Map(),redis=async(cmd,key,value,...rest)=>{
  if(cmd==='SET'){if(rest.includes('NX')&&store.has(key))return {result:null};store.set(key,value);return {result:'OK'};}
  if(cmd==='EVAL'){store.delete(rest[0]);return {result:1};}
  return {result:store.get(key)||null};
 };
 let names=0,performance=0;
 const opts={redis,keys:['facts'],through:'same-cutoff',beforeVerify:async()=>{assert.ok(store.has(owner.LOCK_KEY));names++;},refresh:async()=>{performance++;store.set('facts','synthetic');return {allErrors:[],hashes:{facts:owner.hash('synthetic')},summaries:[],freshness:{all_tabs_verified:true}};}};
 await owner.scheduledRefresh(opts);const before=store.get(owner.STATE_KEY);
 assert.equal((await owner.scheduledRefresh(opts)).skipped,'already_verified');
 assert.equal(names,2);assert.equal(performance,1);assert.equal(store.get(owner.STATE_KEY),before);
 store.set(owner.LOCK_KEY,'other owner');
 assert.equal((await owner.scheduledRefresh(opts)).skipped,'refresh_in_progress');assert.equal(names,2,'no concurrent metadata producer');
});
