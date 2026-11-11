const test=require('node:test'),assert=require('node:assert/strict');
const facts=require('../lib/glv-wl-creators.cjs');
const parent={id:'35',name:'TUC_035_CZSK_WL_Kristyna',date_start:'2026-11-01',date_stop:'2026-11-02',amount_spent:'30',impressions:'300',reach:'150',creator_rows:[],creator_issue:'Ad-level creator facts unavailable; refresh to resolve creator attribution.'};
const range={since:parent.date_start,until:parent.date_stop};
const ads=['Kristyna_PAC419_v6','ActionKate_PAC462_V2'].map((name,i)=>({id:String(i+1),name,campaign_id:'35',campaign_name:parent.name,adset_id:'13',adset_name:'Mixed',amount_spent:'15',impressions:'150'}));
test('successful same-scope ads recover mixed creator facts without changing totals or reach',()=>{
 const rows=facts.recoverCreatorFacts([parent],{rows:ads,range,generated_at:'2026-11-03T00:00:00Z'},range,'aggregate');
 assert.equal(facts.creatorFactsComplete(rows),true);assert.equal(rows[0].creator_issue,undefined);
 assert.deepEqual(rows[0].creator_rows.map(r=>r.ad_name),ads.map(r=>r.name));assert.equal(rows[0].reach,'150');assert.equal(rows[0].amount_spent,'30');
 assert.equal(rows[0].creator_source_generated_at,'2026-11-03T00:00:00Z');
});
test('V2 source repairs retained historical holes without re-fetching campaign history',async()=>{
 const source=require('../lib/glv-mad-v2-source.cjs'),v2=require('../lib/glv-mad-v2.cjs');
 const range={since:'2026-10-01',until:'2026-11-08'},now=new Date('2026-11-09T12:00:00Z');
 const old={...parent,date_start:range.since,date_stop:range.since,'action_values:omni_purchase':'90'};
 const history={schema_version:1,creator_ad_version:1,complete:true,type:'daily',range,generated_at:'2026-11-08T12:00:00Z',accounts:v2.ACCOUNTS.map(a=>({...a,rows:[old],reach:[]}))};
 const calls=[],fetcher=async url=>{const u=new URL(url),a=v2.ACCOUNTS.find(a=>u.pathname.includes(a.id));let data;
  if(!u.pathname.endsWith('/insights'))data={account_id:a.id,currency:a.currency,timezone_name:a.timezone,account_status:1};
  else {const r=JSON.parse(u.searchParams.get('time_range'));calls.push({level:u.searchParams.get('level'),range:r});data={data:u.searchParams.get('level')==='campaign'?[]:ads.map(ad=>({campaign_id:'35',campaign_name:old.name,ad_id:ad.id,ad_name:ad.name,adset_id:ad.adset_id,adset_name:ad.adset_name,date_start:r.since,date_stop:r.since,spend:'15',impressions:'150',reach:'75'}))};}
  return {ok:true,status:200,json:async()=>data};
 };
 const fx={[range.since]:{date:range.since,czk_per_usd:25}};
 const s=await source.buildSnapshot({type:'daily',range,now,fx,token:'synthetic',fetcher,reuse:{token:'synthetic',accounts:new Map(),snapshots:[],history:[history]}});
 assert.ok(s.accounts.every(a=>facts.creatorFactsComplete(a.rows)));assert.ok(calls.filter(c=>c.level==='campaign').every(c=>c.range.since==='2026-11-02'));
 assert.ok(calls.some(c=>c.level==='ad'&&c.range.since===range.since&&c.range.until===range.since));assert.ok(s.accounts.every(a=>a.rows[0].amount_spent==='30'));
});
test('period ads cannot populate daily attribution; wrong scope and empty sources stay incomplete',()=>{
 const daily=[{...parent,date_stop:parent.date_start}];
 for(const [source,r,type] of [[{rows:ads,range},range,'daily'],[{rows:ads,range:{...range,since:'2026-10-01'}},range,'aggregate'],[{rows:[],range},range,'aggregate']])assert.equal(facts.creatorFactsComplete(facts.recoverCreatorFacts(type==='daily'?daily:[parent],{generated_at:'2026-11-03T00:00:00Z',...source},r,type)),false);
});
