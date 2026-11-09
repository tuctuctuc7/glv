const test=require('node:test'),assert=require('node:assert/strict');
const {buildSnapshot,renderSnapshot}=require('../lib/glv-mad-v2-source.cjs');
const range={since:'2025-01-03',until:'2025-01-05'};
const fx={'2025-01-03':{date:'2025-01-03',czk_per_usd:25,source:'synthetic'}};
function source(fail=false,wrongCurrency=false){return async url=>{
 const u=new URL(url),tglv=u.pathname.includes('1021777267558882');
 if(fail&&tglv)return {ok:false,status:403,json:async()=>({error:{message:'do not leak this'}})};
 if(!u.pathname.endsWith('/insights'))return {ok:true,json:async()=>({id:tglv?'act_1021777267558882':'act_359758259164738',account_id:tglv?'1021777267558882':'359758259164738',currency:wrongCurrency?'EUR':tglv?'USD':'CZK',timezone_name:tglv?'America/Los_Angeles':'Europe/Prague',account_status:1})};
 const name=tglv?'TGLV_001_US_Sales':'TUC_001_US_Sales';
 return {ok:true,json:async()=>({data:[{campaign_id:'001',campaign_name:name,spend:'25',reach:'12',impressions:'20',actions:[],action_values:[],date_start:'2025-01-05',date_stop:'2025-01-05'}]})};
};}
test('complete dual account native snapshot renders isolated IDs and currency totals',async()=>{
 const snapshot=await buildSnapshot({range,type:'daily',token:'synthetic',fetcher:source(),fx});
 assert.equal(snapshot.accounts.length,2);assert.equal(snapshot.complete,true);
 const result=renderSnapshot(snapshot,'USD');
 assert.equal(result.rows.length,2);assert.equal(result.rows.reduce((n,r)=>n+r.amount_spent,0),26);
 assert.equal(renderSnapshot(snapshot,'CZK').rows.reduce((n,r)=>n+r.amount_spent,0),650);
 assert.equal(renderSnapshot(snapshot,'USD','TGLV').rows.length,1);
});
test('one-account failure or metadata mismatch never produces success-shaped partial totals',async()=>{
 await assert.rejects(buildSnapshot({range,type:'daily',token:'synthetic',fetcher:source(true),fx}),/Meta/);
 await assert.rejects(buildSnapshot({range,type:'daily',token:'synthetic',fetcher:source(false,true),fx}),/identity/);
});
test('fractional shared budget does not prevent real transport invocation',async()=>{
 let calls=0;const fetcher=source();
 const snapshot=await buildSnapshot({range,type:'daily',token:'synthetic',fx,deadline:Date.now()+10000.5,fetcher:async(...args)=>{calls++;return fetcher(...args);}});
 assert.equal(snapshot.complete,true);assert.equal(calls,4);
});
