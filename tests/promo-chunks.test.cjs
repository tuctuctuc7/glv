const test=require('node:test');
const assert=require('node:assert/strict');
const {fetchPromoFormats}=require('../lib/glv-promo-format.cjs');
const shared=require('../public/glv-meta-ads/promo-format.js');
const campaign='120247470134450687';
const range={since:'2026-03-01',until:'2026-10-28'};
function fixture({failMonth}={}) {
  const windows=[];
  const facts=Array.from({length:8},(_,i)=>({campaign_id:campaign,date_start:`2026-${String(i+3).padStart(2,'0')}-01`,spend:i===7?'0':'10',impressions:i===7?'0':'100',actions:[{action_type:'omni_purchase',value:'1'}],action_values:[{action_type:'omni_purchase',value:'20'}]}));
  const fetcher=async url=>{
    const u=new URL(url),p=u.searchParams;
    let data;
    if(u.pathname.endsWith('/insights')) {
      if(p.get('level')==='campaign') data={data:facts};
      else {
        const r=JSON.parse(p.get('time_range'));windows.push(r);
        if(r.since.slice(0,7)!==r.until.slice(0,7)||r.since.slice(5,7)===failMonth) return {ok:false,status:500,json:async()=>({error:{code:1,error_subcode:99,message:'private upstream detail'}})};
        data={data:facts.filter(f=>f.date_start>=r.since&&f.date_start<=r.until).map(f=>({...f,ad_id:'a',adset_id:'s'}))};
      }
    } else if(p.get('fields').includes('creative')) data={a:{id:'a'}};
    else if(p.get('fields').includes('adset_id')) data={a:{id:'a',name:'CC10',campaign_id:campaign,adset_id:'s'}};
    else if(p.get('fields').includes('campaign_id')) data={s:{id:'s',name:'Banner',campaign_id:campaign}};
    else data={[campaign]:{id:campaign,name:'TUC_008_CZSK_Promo'}};
    return {ok:true,json:async()=>data};
  };
  return {fetcher,windows};
}
test('full history uses disjoint bounded ad insight windows and reconciles carryover',async()=>{
  const {fetcher,windows}=fixture();
  const result=await fetchPromoFormats('fixture-token',range,fetcher);
  assert.equal(shared.validConceptPayload(result),true);
  assert.equal(result.rows.length,8);
  assert.equal(result.rows.reduce((s,r)=>s+r.spend,0),70);
  assert.equal(result.rows.reduce((s,r)=>s+r.purchases,0),8);
  assert.equal(result.rows.at(-1).spend,0);
  assert.equal(windows.length,8);
  assert.equal(windows[0].since,range.since);assert.equal(windows.at(-1).until,range.until);
  windows.forEach((r,i)=>{assert.equal(r.since.slice(0,7),r.until.slice(0,7));if(i)assert.equal(Date.parse(r.since)-Date.parse(windows[i-1].until),86400000);});
});
test('failed middle chunk rejects all facts with sanitized request class',async()=>{
  const {fetcher,windows}=fixture({failMonth:'06'});
  await assert.rejects(()=>fetchPromoFormats('fixture-token',range,fetcher),e=>/ad insights/.test(e.message)&&/code 1/.test(e.message)&&!e.message.includes('private'));
  assert.equal(windows.length,4);
});
