const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchReport } = require('../lib/glv-bfcm.cjs');

// Synthetic daily facts only; the fake upstream sums exactly the requested range.
const days = {
  '2026-11-25': {spend:100,purchases:2,revenue:600,impressions:1000,clicks:30,lpv:20},
  '2026-11-26': {spend:40,purchases:1,revenue:200,impressions:500,clicks:10,lpv:5},
  '2026-11-27': {spend:10,purchases:0,revenue:0,impressions:100,clicks:2,lpv:1},
};
function source(calls) {
 return async url => {
  const u = new URL(url); let result;
  if (u.pathname.endsWith('/insights')) {
   const range = JSON.parse(u.searchParams.get('time_range')); calls.push(range);
   assert.equal(u.searchParams.get('level'),'ad');
   assert.equal(u.searchParams.get('time_increment'),null,'one aggregate row per ad, not daily duplicate ads');
   const totals = Object.fromEntries(Object.keys(days['2026-11-25']).map(k=>[k,0]));
   for (const [date,facts] of Object.entries(days)) if(date>=range.since && date<=range.until) for(const k in totals) totals[k]+=facts[k];
   result={data:[{ad_id:'1',ad_name:'CC13',campaign_id:'campaign',campaign_name:'TUC_Promo-BFCM',date_start:range.since,date_stop:range.until,spend:String(totals.spend),impressions:String(totals.impressions),clicks:String(totals.clicks),actions:[{action_type:'purchase',value:String(totals.purchases)},{action_type:'landing_page_view',value:String(totals.lpv)}],action_values:[{action_type:'purchase',value:String(totals.revenue)}]}]};
  } else if(u.pathname.endsWith('/campaigns')) result={data:[]};
  else result={id:'act_359758259164738',currency:'CZK',timezone_name:'Europe/Prague'};
  return {ok:true,json:async()=>result};
 };
}
test('campaign-to-date queries Nov 25 through Prague extraction day and sums historical plus partial current facts',async()=>{
 const calls=[];
 const report=await fetchReport('synthetic',source(calls),new Date('2026-11-26T04:00:00Z'));
 assert.deepEqual(calls,[{since:'2026-11-25',until:'2026-11-26'}]);
 assert.equal(report.schema_version,'glv-bfcm/v3');
 assert.equal(report.reporting_period,'campaign-to-date');
 assert.equal(report.since,'2026-11-25');assert.equal(report.until,'2026-11-26');
 assert.equal(report.date,report.until);assert.equal(report.partial_day,true);
 assert.equal(report.totals.spend,140);assert.equal(report.totals.purchases,3);
 assert.equal(report.totals.revenue,800);assert.equal(report.totals.impressions,1500);
 assert.equal(report.totals.clicks,40);assert.equal(report.totals.lpv,25);
 assert.equal(report.totals.roas,800/140);assert.equal(report.totals.ctr,40/1500*100);
 assert.equal(report.totals.cpm,140/1500*1000);assert.equal(report.totals.cost_lpv,140/25);assert.equal(report.totals.cvr,12);
 assert.equal(report.source_ad_count,1);
});
test('end advances at Prague midnight beyond release date; start remains Nov 25',async()=>{
 for(const [instant,until,spend] of [['2026-11-24T23:30:00Z','2026-11-25',100],['2026-11-26T22:59:59Z','2026-11-26',140],['2026-11-26T23:00:00Z','2026-11-27',150]]){
  const calls=[];const report=await fetchReport('synthetic',source(calls),new Date(instant));
  assert.deepEqual(calls,[{since:'2026-11-25',until}]);assert.equal(report.totals.spend,spend);
 }
});
test('every paginated Insights request uses the same cumulative range; rejects a daily response',async()=>{
 const calls=[];const base=source(calls);let pages=0;
 const paginated=async url=>{
  const response=await base(url);const data=await response.json();
  if(new URL(url).pathname.endsWith('/insights')){
   pages++;data.data[0].ad_id=String(pages);
   if(pages===1)data.paging={next:'https://ignored.invalid',cursors:{after:'page2'}};
  }
  return {ok:true,json:async()=>data};
 };
 const report=await fetchReport('synthetic',paginated,new Date('2026-11-26T04:00:00Z'));
 assert.equal(pages,2);assert(calls.every(r=>r.since==='2026-11-25'&&r.until==='2026-11-26'));
 assert.equal(report.totals.spend,280);assert.equal(report.source_ad_count,2);
 const daily=async url=>{const response=await base(url);const data=await response.json();if(new URL(url).pathname.endsWith('/insights'))data.data[0].date_start='2026-11-26';return {ok:true,json:async()=>data};};
 await assert.rejects(fetchReport('synthetic',daily,new Date('2026-11-26T04:00:00Z')),/Unexpected Meta reporting date/);
});
