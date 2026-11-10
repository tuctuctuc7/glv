const test=require('node:test'),assert=require('node:assert/strict');
const {buildSnapshot}=require('../lib/glv-mad-v2-source.cjs'),v2=require('../lib/glv-mad-v2.cjs');
test('completed-day rollover retains historical ad coverage but refetches seven completed days',async()=>{
 let saved=null;const requests=[];
 const progress={load:async()=>saved,save:async state=>{saved=JSON.parse(JSON.stringify(state));}};
 const fetcher=async url=>{const u=new URL(url),a=v2.ACCOUNTS.find(a=>u.pathname.includes(a.id));let body;
  if(!u.pathname.endsWith('/insights'))body={account_id:a.id,currency:a.currency,timezone_name:a.timezone,account_status:1};
  else {const r=JSON.parse(u.searchParams.get('time_range'));requests.push(r);body={data:[]};}
  return {ok:true,status:200,json:async()=>body};
 };
 await buildSnapshot({range:{since:'2026-10-10',until:'2026-11-08'},type:'ads',token:'synthetic',fx:{},now:new Date('2026-11-09T08:00:00Z'),fetcher,progress});
 requests.length=0;
 const result=await buildSnapshot({range:{since:'2026-10-11',until:'2026-11-09'},type:'ads',token:'synthetic',fx:{},now:new Date('2026-11-10T09:00:00Z'),fetcher,progress});
 assert.ok(requests.every(r=>r.since>='2026-11-03'),'must not cold-fetch October at each cutoff');
 assert.ok(requests.some(r=>r.until==='2026-11-09'));
 assert.ok(requests.some(r=>r.since==='2026-11-03'),'replace rolling seven completed days');
 assert.deepEqual(result.range,{since:'2026-10-11',until:'2026-11-09'});
 assert.equal(result.generated_at,'2026-11-10T09:00:00.000Z');
 assert.ok(result.source_extractions.some(s=>s.generated_at==='2026-11-09T08:00:00.000Z'),'retain historical extraction provenance');
});
