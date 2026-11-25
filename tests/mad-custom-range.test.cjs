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
 assert.equal(aggregate.code,200,'daily facts must support zoom without a new period observation');
 assert.equal(aggregate.body.rows[0].reach,null);assert.equal(Number(aggregate.body.rows[0].amount_spent),60);
 assert.equal(h.calls.filter(c=>c[0]==='GRAPH').length,0);
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
 assert.equal(res.code,200);assert.equal(res.body.stale,true);assert.equal(res.body.generated_at,old.generated_at);assert.equal(res.body.rows[0].reach,'123');assert.equal(h.calls.filter(c=>c[0]==='GRAPH').length,0,'valid exact observations are read-only even when stale');
}));
test('V1 corrupted custom cache cannot conceal unavailable source facts',()=>environment(async h=>{
 const bad=pieces(range).aggregate;delete bad.rows[0].reach;
 h.store.set(history.customKey('aggregate',range),JSON.stringify(bad));h.failSource=true;
 const res=await request(require('../api/glv-meta-ads/fb-data.js'),{type:'aggregate',time_range:JSON.stringify(range)});
 assert.equal(res.code,500);assert.equal(res.body.rows,undefined);
}));
test('V1 cached zoom rejects foreign account/currency and malformed scopes before reuse',()=>environment(async h=>{
 for(const mutate of [p=>p.daily.report_currency='USD',p=>p.daily.account_filter='TGLV',p=>p.daily.rows[0].account_id='1021777267558882',p=>p.daily.rows[0].creator_rows=[{account_id:'1021777267558882',adset_name:'test',adset_id:'1',ad_id:'2',ad_name:'test'}]]){
  h.store.clear();const p=pieces();mutate(p);await history.savePublished(async(k,v)=>h.store.set(k,JSON.stringify(v)),'last_7d',p,async k=>JSON.parse(h.store.get(k)||'null'));
  assert.equal(await history.readCustom(async k=>JSON.parse(h.store.get(k)||'null'),'aggregate',range,['last_7d']),null);
 }
 for(const bad of [null,[],{since:'2026-02-30',until:range.until},{since:range.until,until:range.since},{since:['2026-11-19'],until:range.until}])await assert.rejects(()=>history.readCustom(async()=>null,'aggregate',bad,['last_7d']));
}));
test('V1 native daily rollup preserves signed creator residuals, child identity and missing dates',()=>environment(async h=>{
 const p=pieces();p.daily.rows=p.daily.rows.filter(r=>r.date_start!=='2026-11-21');
 const {attachCreatorFacts}=require('../lib/glv-wl-creators.cjs');
 p.daily.rows=p.daily.rows.map(r=>attachCreatorFacts([{...r,name:'TUC_001_CZSK_WL'}],[{...r,name:'TUC_001_CZSK_WL',adset_id:'11',adset_name:'WL',ad_id:'22',ad_name:'Kristyna_PAC001_V1',amount_spent:12}])[0]);
 await history.savePublished(async(k,v)=>h.store.set(k,JSON.stringify(v)),'last_7d',p,async k=>JSON.parse(h.store.get(k)||'null'));
 h.failSource=true;
 const daily=await request(require('../api/glv-meta-ads/fb-data.js'),{type:'daily',time_range:JSON.stringify(range)});
 const aggregate=await request(require('../api/glv-meta-ads/fb-data.js'),{type:'aggregate',time_range:JSON.stringify(range)});
 assert.equal(daily.body.rows.length,5);assert.ok(daily.body.rows.every(r=>r.date_start!=='2026-11-21'));
 const row=aggregate.body.rows[0];assert.equal(row.amount_spent,50);assert.equal(row.reach,null);assert.equal(row.creator_rows.find(r=>r.ad_id==='22').amount_spent,60);assert.equal(row.creator_rows.find(r=>r.is_ghost).amount_spent,-10);assert.equal(row.creator_rows.find(r=>r.is_ghost).reach,null);
 assert.equal(aggregate.body.generated_at,stamp);assert.equal(h.calls.filter(c=>c[0]==='GRAPH').length,0);
}));
module.exports={range,wide,pieces,seed};
