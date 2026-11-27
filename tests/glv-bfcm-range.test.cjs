const test=require('node:test'),assert=require('node:assert/strict');
const h=require('../lib/glv-bfcm.cjs');
const now=new Date('2026-11-27T12:00:00Z');
test('daily extraction retains repeated ad IDs across dates and reconciles parents from one paginated source',async()=>{
 const requests=[];
 const upstream=async url=>{const u=new URL(url);requests.push(u);let data;
 if(u.pathname.endsWith('/insights')){
  assert.equal(u.searchParams.get('time_increment'),'1');
  const date=u.searchParams.has('after')?'2026-11-26':'2026-11-25';
  data={data:[{ad_id:'a',ad_name:'CC01',campaign_id:'c',campaign_name:'Promo-BFCM',date_start:date,date_stop:date,spend:'10',impressions:'100',clicks:'5',actions:[{action_type:'purchase',value:'1'}],action_values:[{action_type:'purchase',value:'40'}]}]};
  if(!u.searchParams.has('after'))data.paging={next:'ignored',cursors:{after:'next'}};
 }else if(u.pathname.endsWith('/campaigns'))data={data:[{id:'zero',name:'Promo-BFCM_zero',effective_status:'PAUSED'}]};
 else data={id:'act_359758259164738',currency:'CZK',timezone_name:'Europe/Prague'};
 return {ok:true,json:async()=>data};};
 const result=await h.fetchReport('synthetic',upstream,now,{since:'2026-11-25',until:'2026-11-26',daily:true});
 assert.equal(result.daily_breakdown,true);assert.equal(result.partial_day,false);
 assert.equal(result.rows[0].spend,20);assert.equal(result.rows[0].purchases,2);assert.equal(result.rows[0].roas,4);
 assert.deepEqual(result.daily_rows.map(r=>r.date),['2026-11-25','2026-11-26']);
 for(const k of ['spend','purchases','revenue','impressions','clicks','lpv','ad_count']) assert.equal(result.rows[0][k],result.daily_rows.reduce((n,r)=>n+r[k],0));
 assert.equal(requests.filter(u=>u.pathname.endsWith('/insights')).length,2);
 assert.equal(result.campaigns.length,2);
});
test('strict selected date ranges are inclusive, bounded and real calendar dates',()=>{
 assert.deepEqual(h.reportWindow(now,{since:'2026-11-26',until:'2026-11-26'}),{since:'2026-11-26',until:'2026-11-26'});
 for(const q of [{since:'2026-02-30',until:'2026-11-26'},{since:'2026-11-26'},{since:'2026-11-27',until:'2026-11-26'},{since:'2026-11-25',until:'2026-11-28'},{since:['2026-11-25'],until:'2026-11-26'},{since:'2026-11-24',until:'2026-11-26'}]) assert.throws(()=>h.reportWindow(now,q),/Invalid reporting range/);
});
