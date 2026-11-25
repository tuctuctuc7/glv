'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {environment,request}=require('./helpers/mad-independent-fixture.cjs');
const history=require('../lib/glv-history-v1.cjs');
const range={since:'2026-11-19',until:'2026-11-24'};
const wide={since:'2026-11-18',until:'2026-11-24'};
const stamp='2026-11-25T00:10:00.000Z';
function pieces(r=wide){
 const row={id:'123',name:'TUC_001_CZSK_Leadgen',amount_spent:'10',impressions:'100',reach:'80','actions:lead':'2'};
 const daily=[];for(let day=r.since;day<=r.until;day=require('../lib/glv-v1-source.cjs').shift(day,1))daily.push({...row,date_start:day,date_stop:day});
 const base={creator_version:2,creator_reconciliation_version:1,creator_ad_version:1,range:r,generated_at:stamp};
 return {daily:{...base,rows:daily},aggregate:{...base,rows:[{...row,amount_spent:'70',reach:'123',date_start:r.since,date_stop:r.until}]},ads:{...base,wl_version:3,rows:[]}};
}
async function seed(h,r=wide){await history.savePublished(async(k,p)=>h.store.set(k,JSON.stringify(p)),'last_7d',pieces(r),async k=>JSON.parse(h.store.get(k)||'null'));}
test('V1 actual handler slices published daily facts for Nov19–24 without live Meta or invented reach',()=>environment(async h=>{
 await seed(h);h.failSource=true;
 const res=await request(require('../api/glv-meta-ads/fb-data.js'),{type:'daily',time_range:JSON.stringify(range)});
 assert.equal(res.code,200,JSON.stringify(res.body));assert.equal(res.body.rows.length,6);assert.deepEqual(res.body.range,range);assert.equal(res.body.generated_at,stamp);
 assert.equal(res.body.rows[0].reach,'80');assert.equal(h.calls.filter(c=>c[0]==='GRAPH').length,0);
 const aggregate=await request(require('../api/glv-meta-ads/fb-data.js'),{type:'aggregate',time_range:JSON.stringify(range)});
 assert.notEqual(aggregate.code,200,'must not slice seven-day period reach into six days');
}));
test('V1 actual custom handlers reuse an EXACT published period across all three concurrent requests',()=>environment(async h=>{
 await seed(h,range);h.failSource=true;
 const replies=await Promise.all(['aggregate','daily','ads'].map(type=>request(require('../api/glv-meta-ads/fb-data.js'),{type,time_range:JSON.stringify(range)})));
 assert.deepEqual(replies.map(r=>r.code),[200,200,200]);assert.equal(replies[0].body.rows[0].reach,'123');assert.equal(h.calls.filter(c=>c[0]==='GRAPH').length,0);
}));
test('V1 cold custom responses are retained and reused on reload when Meta becomes unavailable',()=>environment(async h=>{
 const api=require('../api/glv-meta-ads/fb-data.js'),query=type=>({type,time_range:JSON.stringify(range)});
 const first=await Promise.all(['aggregate','daily','ads'].map(type=>request(api,query(type))));
 assert.deepEqual(first.map(r=>r.code),[200,200,200]);
 const calls=h.calls.filter(c=>c[0]==='GRAPH').length;h.failSource=true;
 const next=await Promise.all(['aggregate','daily','ads'].map(type=>request(api,query(type))));
 assert.deepEqual(next.map(r=>r.code),[200,200,200]);
 assert.deepEqual(next.map(r=>r.body.generated_at),first.map(r=>r.body.generated_at));
 assert.equal(h.calls.filter(c=>c[0]==='GRAPH').length,calls);
}));
test('V1 stale exact custom remains readable on failure with original timestamp and truthful stale status',()=>environment(async h=>{
 const old=pieces(range).aggregate;old.generated_at='2026-11-20T00:00:00.000Z';
 h.store.set(history.customKey('aggregate',range),JSON.stringify(old));h.failSource=true;
 const res=await request(require('../api/glv-meta-ads/fb-data.js'),{type:'aggregate',time_range:JSON.stringify(range)});
 assert.equal(res.code,200);assert.equal(res.body.stale,true);assert.equal(res.body.generated_at,old.generated_at);assert.equal(res.body.rows[0].reach,'123');
}));
test('V1 corrupted custom cache cannot conceal unavailable source facts',()=>environment(async h=>{
 const bad=pieces(range).aggregate;delete bad.rows[0].reach;
 h.store.set(history.customKey('aggregate',range),JSON.stringify(bad));h.failSource=true;
 const res=await request(require('../api/glv-meta-ads/fb-data.js'),{type:'aggregate',time_range:JSON.stringify(range)});
 assert.equal(res.code,500);assert.equal(res.body.rows,undefined);
}));
module.exports={range,wide,pieces,seed};
