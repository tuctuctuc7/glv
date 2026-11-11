'use strict';
// Independent source-row oracle: every identity and metric, never a balanced total.
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,aggregateNative,canonical}=require('../qa/mad-full-parity.cjs');
const {renderSnapshot}=require('../lib/glv-mad-v2-source.cjs');
const range={since:'2026-10-01',until:'2026-10-03'};
const additive=['amount_spent','impressions','actions:link_click','actions:landing_page_view','actions:omni_purchase','actions:initiate_checkout','actions:outbound_click','actions:lead','action_values:omni_purchase','video_thruplay_watched_actions','video_3_sec_watched_actions','video_p100_watched_actions'];
const identity=['id','name','campaign_id','campaign_name','adset_id','adset_name','ad_id','ad_name','status','partnership','is_ghost','creator_issue'];
function projection(row){return Object.fromEntries([...identity,...additive,'creator_rows'].filter(k=>row[k]!==undefined&&!(k==='creator_rows'&&!row[k].length)).map(k=>[k,k==='creator_rows'?row[k].map(projection):row[k]]));}
function convertExpected(row,rate){const result={...row};for(const k of ['amount_spent','action_values:omni_purchase'])result[k]=row[k]*rate;if(row.creator_rows)result.creator_rows=row.creator_rows.map(c=>convertExpected(c,rate));return result;}
for(const type of ['daily','aggregate','ads'])for(const account of ['TUC','TGLV','All'])for(const currency of ['CZK','USD'])test(`per-row identity/metrics/status/partnership/creator joins ${type} ${account} ${currency}`,()=>{
 const source=fixture(range,type);source.accounts.forEach(a=>a.rows.forEach((r,i)=>{r.status=i%2?'PAUSED':'ACTIVE';}));
 const expected=source.accounts.filter(a=>account==='All'||a.label===account).flatMap(a=>{
 const rate=a.currency===currency?1:a.currency==='CZK'?1/25:25;
 const converted=a.rows.map(r=>convertExpected(r,rate));
 const rows=type==='daily'?converted:aggregateNative(converted,range);
 return rows.map(projection);
 });
 const result=canonical(renderSnapshot(source,currency,account).rows).map(projection);
 assert.equal(result.length,expected.length,'every row must survive');
 assert.deepEqual(result,expected);
});
for(const type of ['daily','aggregate','ads'])test(`true TUC-owned current wrong-prefix retained ${type}`,()=>{
 const s=fixture(range,type,'current-wrong-prefix'),r=renderSnapshot(s,'CZK','TUC');
 const expected=s.accounts[0].rows.filter(x=>(x.campaign_name||x.name)==='TGLV_002_CZSK_BAU_TrueTUCAccount');
 const actual=r.rows.filter(x=>(x.campaign_name||x.name)==='TGLV_002_CZSK_BAU_TrueTUCAccount');
 assert.ok(actual.length);assert.equal(actual.reduce((n,x)=>n+x.amount_spent,0),expected.reduce((n,x)=>n+x.amount_spent,0));
 assert.ok(r.warnings.some(w=>w.includes('TGLV_002_CZSK_BAU_TrueTUCAccount')),'wrong prefix must warn, not erase account-owned facts');
});
test('production shared-publication save/read/render through offline adapter',async()=>{const t=require('../qa/mad-shared-transport.cjs').create();for(const type of ['daily','aggregate','ads']){const q=new URLSearchParams({type,time_range:JSON.stringify(range),account:'TUC',currency:'CZK'});const [v1,v2]=await Promise.all([t.payload(q,false),t.payload(q,true)]);assert.equal(v1.generation_id,v2.generation_id);assert.deepEqual(canonical(v2.rows).map(projection),v1.rows.map(projection));}assert.ok(t.audit.some(a=>a.cmd==='SET'));assert.ok(t.audit.some(a=>a.readGeneration));});
test('per-row oracle detects balanced metric corruption and swapped join IDs',()=>{const x=[{id:'one',amount_spent:25,campaign_id:'A'},{id:'two',amount_spent:25,campaign_id:'B'}],y=[{id:'one',amount_spent:30,campaign_id:'B'},{id:'two',amount_spent:20,campaign_id:'A'}];assert.equal(x.reduce((s,r)=>s+r.amount_spent,0),y.reduce((s,r)=>s+r.amount_spent,0));assert.notDeepEqual(x.map(projection),y.map(projection));});
