const test = require('node:test');
const assert = require('node:assert/strict');
const { concept, summarize, fetchReport, today, isBfcm } = require('../lib/glv-bfcm.cjs');
const row = (extra = {}) => ({ad_id:'1',ad_name:'B_CC13_01',adset_name:'AS_CC13A',campaign_id:'c',campaign_name:'TUC_039_Promo-BFCM_Banners',spend:'100',impressions:'1000',clicks:'20',actions:[{action_type:'purchase',value:'2'},{action_type:'omni_purchase',value:'2'},{action_type:'landing_page_view',value:'10'}],action_values:[{action_type:'purchase',value:'300'}],...extra});
test('creative-level identifiers, not mixed adset labels; no fabricated AI codes',()=>{
 assert.equal(concept(row()),'CC13');
 assert.equal(concept(row({ad_name:'PAC_484 V1',adset_name:'Mixed'})),'PAC484');
 assert.equal(concept(row({ad_name:'Other',adset_name:'AS_PAC485'})),'PAC485');
 assert.equal(concept(row({ad_name:'XCC13foo',adset_name:'none'})),'Unmapped · XCC13foo [1]');
 assert.equal(concept(row({ad_name:'CC13A variant'})),'CC13A');
 assert.equal(concept(row({ad_name:'CC13_CC14'})),'Unmapped · CC13_CC14 [1]');
});
test('aggregates absolutes, deduplicates action aliases, null zero denominators',()=>{
 const r=summarize([row(),row({ad_id:'2',spend:'50',impressions:'500',clicks:'10'})]);
 assert.equal(r.rows.length,1);assert.equal(r.totals.spend,150);assert.equal(r.totals.purchases,4);
 assert.equal(r.totals.roas,4);assert.equal(r.totals.ctr,2);assert.equal(r.totals.cpm,100);assert.equal(r.totals.cost_lpv,7.5);assert.equal(r.totals.cvr,20);
 assert.equal(summarize([]).totals.roas,null);
 assert.throws(()=>summarize([row(),row()]),/Duplicate/);
 assert.throws(()=>summarize([row({spend:null})]),/Invalid/);
});
test('AI EGC first number is the concept; variants and audience labels are not',()=>{
 for(const name of ['2026-11-15_V_Black Friday_Shared_AI-EGC_01_01','2026-11-15_V_Black Friday_Private_AI-EGC_01_04','AI EGC 01 variant','ai_egc_01_02']){
  assert.equal(concept(row({ad_name:name,adset_name:'AS04_Purchase_V_Private_AI-EGC_04'})),'AI EGC 01');
 }
 assert.equal(concept(row({ad_name:'AI-EGC_02_04'})),'AI EGC 02');
 assert.equal(concept(row({ad_name:'AI-EGC_03_01'})),'AI EGC 03');
 assert.match(concept(row({ad_name:'XAI-EGC_01_01',adset_name:'Mixed'})),/^Unmapped/);
 assert.match(concept(row({ad_name:'AI-EGC_01x',adset_name:'Mixed'})),/^Unmapped/);
 assert.match(concept(row({ad_name:'AI-EGC_01_CC13',adset_name:'Mixed'})),/^Unmapped/);
 const r=summarize([row({ad_id:'a',ad_name:'Shared_AI-EGC_01_01'}),row({ad_id:'b',ad_name:'Private_AI-EGC_01_04'}),row({ad_id:'c',ad_name:'AI-EGC_02_01'})]);
 assert.equal(r.rows.length,2);assert.equal(r.rows[0].concept,'AI EGC 01');assert.equal(r.rows[0].ad_count,2);assert.equal(r.rows[0].purchases,4);assert.equal(r.totals.purchases,6);
});
test('purchase ordering and retained unmapped rows',()=>{
 const r=summarize([row({ad_id:'3',ad_name:'AI unclassified'}),row({actions:[{action_type:'purchase',value:'7'}]})]);
 assert.equal(r.rows[0].purchases,7);assert.equal(r.totals.purchases,9);assert.equal(r.source_ad_count,2);
});
test('Prague today handles UTC midnight boundary',()=>assert.equal(today(new Date('2026-11-24T23:30:00Z')),'2026-11-25'));
test('BFCM-only scope uses bounded campaign tokens',()=>{
 for(const name of ['TUC_042_Promo-BFCM_AnimatedBanners','Promo BFCM','promo_bfcm'])assert.equal(isBfcm(name),true);
 for(const name of ['TUC_037_Promo_Winners','TUC_036_Promo_Oct28-Nov04','Promo-BFCMish','NotPromo-BFCM'])assert.equal(isBfcm(name),false);
});
test('animated banner campaign combines CC codes without altering static concepts',()=>{
 const campaign_name='TUC_042_CZSK_ABO_Sales_Promo-BFCM_AnimatedBanners_Shared_G4';
 const r=summarize([row({campaign_name,ad_name:'V_CC22_01'}),row({campaign_name,ad_id:'2',ad_name:'V_CC41_01'}),row({campaign_id:'static',ad_id:'3',ad_name:'B_CC22_01'})]);
 assert.equal(r.rows.length,2);assert.equal(r.rows[0].concept,'Animated banners');assert.equal(r.rows[0].ad_count,2);assert.equal(r.rows[0].purchases,4);assert.equal(r.rows[0].roas,3);assert.equal(r.rows[1].concept,'CC22');assert.equal(r.totals.purchases,6);
 assert.equal(concept(row({campaign_name:'Promo-BFCM_NotAnimatedBanners',ad_name:'B_CC22_01'})),'CC22');
});
test('same-name unmapped ads stay distinct within and across campaigns',()=>{
 const r=summarize([row({ad_id:'1',ad_name:'AI',adset_name:'Mixed'}),row({ad_id:'2',ad_name:'AI',adset_name:'Mixed'}),row({ad_id:'3',ad_name:'AI',adset_name:'Mixed',campaign_id:'other'})]);
 assert.equal(r.rows.length,3);assert.equal(new Set(r.rows.map(r=>r.concept)).size,3);assert(r.rows.every(r=>r.ad_count===1));assert.equal(r.totals.purchases,6);
});
test('pagination is complete and safe; validates account and fixed date',async()=>{
 const calls=[];let page=0;
 const fetcher=async url=>{const u=new URL(url);calls.push(u);let data;
 if(u.pathname.endsWith('/insights')) { page++;data=page===1?{data:[row(),row({ad_id:'old',campaign_id:'old',campaign_name:'TUC_037_Promo_Winners'})],paging:{next:'https://attacker.invalid/?secret=bad',cursors:{after:'next'}}}:{data:[row({ad_id:'2'})]}; }
 else if(u.pathname.endsWith('/campaigns'))data={data:[{id:'c',name:'TUC_039_Promo-BFCM',status:'ACTIVE',effective_status:'ACTIVE'},{id:'old',name:'TUC_037_Promo_Winners'}]};
 else data={id:'act_359758259164738',name:'Gelavis Ads',currency:'CZK',timezone_name:'Europe/Prague'};
 return {ok:true,json:async()=>data};};
 const r=await fetchReport('test',fetcher,new Date('2026-11-25T10:00:00Z'));
 assert.equal(r.source_ad_count,2);assert.equal(r.date,'2026-11-25');assert.equal(r.campaigns.length,1);
 assert(calls.every(u=>u.hostname==='graph.facebook.com'));
 assert(calls.filter(u=>u.pathname.endsWith('/insights')).every(u=>JSON.parse(u.searchParams.get('time_range')).until==='2026-11-25'));
});
test('handler denies absent cookie before upstream access',async()=>{
 const handler=require('../api/glv-bfcm/data.js');let status,body;const res={setHeader(){},status(n){status=n;return this;},json(x){body=x;}};
 await handler({method:'GET',headers:{}},res);assert.equal(status,401);assert.equal(body.error,'Unauthorized');
});
test('handler only accepts exact existing server credential',async()=>{
 const handler=require('../api/glv-bfcm/data.js');const old=process.env.GLV_META_CRON_SECRET;const oldCron=process.env.CRON_SECRET;delete process.env.CRON_SECRET;process.env.GLV_META_CRON_SECRET='synthetic-unit-only';
 try{for(const [authorization,expected] of [['Bearer wrong',401],['Bearer synthetic-unit-only',405]]){
 let status;const res={setHeader(){},status(n){status=n;return this;},json(){}};
 await handler({method:'POST',headers:{authorization}},res);assert.equal(status,expected);
 }
 process.env.CRON_SECRET='primary-unit-only';
 for(const [authorization,expected] of [['Bearer synthetic-unit-only',401],['Bearer primary-unit-only',405]]){
 let status;const res={setHeader(){},status(n){status=n;return this;},json(){}};
 await handler({method:'POST',headers:{authorization}},res);assert.equal(status,expected);
 }
 }finally{if(old===undefined)delete process.env.GLV_META_CRON_SECRET;else process.env.GLV_META_CRON_SECRET=old;if(oldCron===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=oldCron;}
});
