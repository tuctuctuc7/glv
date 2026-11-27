const test=require('node:test');
const assert=require('node:assert/strict');
const {concept,summarize,fetchReport}=require('../lib/glv-bfcm.cjs');
const row=(extra={})=>({ad_id:'a',ad_name:'Shared_AI-UGC_01',adset_name:'Private_AI-UGC_04',campaign_id:'c',campaign_name:'Promo-BFCM_AI-UGC',spend:'10',impressions:'100',clicks:'4',actions:[{action_type:'purchase',value:'1'},{action_type:'landing_page_view',value:'2'}],action_values:[{action_type:'purchase',value:'30'}],...extra});
test('AI UGC first number groups live naming variants, not audience or CTA',()=>{
 for(const ad_name of ['2026-11-15_V_Black Friday_Shared_AI-UGC_01','2026-11-15_V_Black Friday_Shared_AI-UGC_01_no-CTA','Private_AI-UGC_01_04','Public_ai ugc 1-99','AI_UGC_001_02'])assert.equal(concept(row({ad_name})),'AI UGC 01');
 const result=summarize([row(),row({ad_id:'b',ad_name:'Private_AI-UGC_01_no-CTA',spend:'90',actions:[]}),row({ad_id:'c',ad_name:'Shared_AI-UGC_02'})]);
 assert.equal(result.rows.length,2);const one=result.rows.find(r=>r.concept==='AI UGC 01');assert.equal(one.ad_count,2);assert.equal(one.spend,100);assert.equal(one.purchases,1);assert.equal(one.roas,.6);assert.equal(result.source_ad_count,3);
});
test('families, precedence, boundaries and ambiguous identifiers fail closed',()=>{
 for(const [ad_name,adset_name,expected] of [
  ['AI UGC 2_03','CC13','AI UGC 02'],['CC13','AI UGC 02','CC13'],['PAC484','AI UGC 02','PAC484'],
  ['unlabelled','AI UGC 03','AI UGC 03'],['AI EGC 01','AI UGC 01','AI EGC 01'],
  ['AI UGC 01_AI UGC 001','mixed','AI UGC 01'],
 ])assert.equal(concept(row({ad_name,adset_name})),expected);
 for(const ad_name of ['XAI-UGC_01','AI-UGC_01x','AI-UGCX_01','AI-UGC','AI UGC no number','AI UGC 01_AI UGC 02','AI UGC 01_CC13','AI UGC 01_PAC484','AI UGC 01_AI EGC 01'])assert.match(concept(row({ad_name,adset_name:'mixed'})),/^Unmapped/);
 assert.match(concept(row({ad_name:'AI UGC 01_AI UGC 02',adset_name:'AI UGC 03'})),/^Unmapped/);
 assert.match(concept(row({ad_name:'unlabelled',adset_name:'AI UGC 01_AI UGC 02'})),/^Unmapped/);
 assert.equal(concept(row({ad_name:'AI UGC 01_CC13',campaign_name:'Promo-BFCM_AnimatedBanners'})),'Animated banners');
});
test('daily extraction retains repeated ads, aggregates variants and derives ratios from sums',async()=>{
 const source=['2026-11-25','2026-11-26'].flatMap(date=>[row({date_start:date,date_stop:date}),row({ad_id:'b',ad_name:'Private_AI-UGC_01_04',spend:'90',actions:[],date_start:date,date_stop:date}),row({ad_id:'c',ad_name:'AI EGC 01',date_start:date,date_stop:date})]);
 const fetcher=async url=>({ok:true,json:async()=>url.includes('/insights?')?{data:source}:url.includes('/campaigns?')?{data:[]}:{id:'act_359758259164738',currency:'CZK',timezone_name:'Europe/Prague'}});
 const result=await fetchReport('synthetic',fetcher,new Date('2026-11-26T12:00:00Z'),{daily:true});
 assert.equal(result.source_ad_count,6);assert.equal(result.rows.length,2);assert.equal(result.daily_rows.length,4);
 const ugc=result.rows.find(r=>r.concept==='AI UGC 01');assert.equal(ugc.spend,200);assert.equal(ugc.ad_count,4);assert.equal(ugc.roas,.6);
 for(const key of ['spend','purchases','revenue','impressions','clicks','lpv','ad_count'])assert.equal(result.totals[key],result.daily_rows.reduce((n,r)=>n+r[key],0));
 assert.deepEqual([...new Set(result.daily_rows.map(r=>r.date))],['2026-11-25','2026-11-26']);
});
