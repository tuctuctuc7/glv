'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const source=require('../lib/glv-mad-v2-source.cjs'),v2=require('../lib/glv-mad-v2.cjs');
const TUC=v2.ACCOUNTS.find(a=>a.label==='TUC');
const range={since:'2026-11-12',until:'2026-11-13'},now=new Date('2026-11-14T10:00:00Z');
const fx={'2026-11-12':{date:'2026-11-12',czk_per_usd:20},'2026-11-13':{date:'2026-11-13',czk_per_usd:25}};
const actions=n=>[{action_type:'omni_purchase',value:String(n)},{action_type:'link_click',value:String(n*3)}];
function graph({ghost='period',badRange=false}={}){
 const calls=[];
 const campaign=(period,date,child=false)=>({campaign_id:'101',campaign_name:'TUC_101_US_WL_Test',date_start:period?range.since:date,date_stop:period?range.until:date,spend:period?(child?'100.01':ghost==='period'?'100.02':'100.01'):(child?(date===range.since?'40':'60'):(ghost==='daily'?(date===range.since?'41':'59'):(date===range.since?'40':'60'))),impressions:period?'151':'80',reach:period?'111':'70',actions:[...actions(period?'3.5':'2'),{action_type:'video_view',value:period?'9':'6'}],video_thruplay_watched_actions:[{action_type:'video_view',value:period?'7':'5'}],video_p100_watched_actions:[{action_type:'video_view',value:period?'5':'3'}],action_values:[{action_type:'omni_purchase',value:period?'300.03':'160'}],...(child?{ad_id:'201',ad_name:'Jana_Test',adset_id:'301',adset_name:'Jana_Set'}:{})});
 const fetcher=async url=>{
  const u=new URL(url);calls.push(u);
  const account=v2.ACCOUNTS.find(a=>u.pathname.includes('act_'+a.id));
  if(u.searchParams.has('ids'))return {ok:true,json:async()=>Object.fromEntries(u.searchParams.get('ids').split(',').map(id=>[id,{effective_status:'ACTIVE',creative:{instagram_branded_content:{sponsor_id:'123'}}}]))};
  assert.ok(account,'requests must be rooted in selected account');
  if(!u.pathname.endsWith('/insights'))return {ok:true,json:async()=>({account_id:account.id,currency:account.currency,timezone_name:account.timezone,account_status:1})};
  if(account.id!==TUC.id)return {ok:true,json:async()=>({data:[]})};
  const period=!u.searchParams.has('time_increment'),child=u.searchParams.get('level')==='ad';
  const rows=period?[campaign(true,null,child)]:[campaign(false,range.since,child),campaign(false,range.until,child)];
  if(period&&badRange)rows[0].date_stop=range.since;
  return {ok:true,json:async()=>({data:rows})};
 };
 return {calls,fetcher};
}
test('isolated ad observations preserve V1 period status, partnership, video and counts',async()=>{
 const {s}=await build('ads');const czk=source.renderSnapshot(s,'CZK'),usd=source.renderSnapshot(s,'USD');
 assert.equal(Number(czk.rows[0].amount_spent),100.01);
 assert.equal(Number(czk.rows[0].impressions),151);
 assert.equal(Number(usd.rows[0]['actions:omni_purchase']),3.5);
 assert.equal(usd.rows[0].amount_spent,40/20+60/25);
 assert.equal(czk.rows[0].partnership.status,'verified_positive');
 assert.equal(czk.rows[0].status,'ACTIVE');
 for(const [key,value] of Object.entries({video_thruplay_watched_actions:7,video_3_sec_watched_actions:9,video_p100_watched_actions:5,'actions:link_click':10.5})){
  assert.equal(Number(czk.rows[0][key]),value);assert.equal(Number(usd.rows[0][key]),value);
 }
 assert.equal(Number(czk.rows[0]['action_values:omni_purchase']),300.03);
 assert.equal(usd.rows[0]['action_values:omni_purchase'],160/20+160/25);
 assert.deepEqual(population(czk.rows),population(usd.rows));
 assert.equal(s.accounts[0].direct_observation.range.since,range.since);
 assert.equal(s.accounts[0].direct_observation.rows[0].date_start,undefined,'V1 period ads have no fabricated date');
});
test('daily-only creator residual is unioned without changing native or nonmoney facts',async()=>{
 const {s}=await build('aggregate',{ghost:'daily'});const czk=source.renderSnapshot(s,'CZK'),usd=source.renderSnapshot(s,'USD');
 const ng=czk.rows[0].creator_rows.find(r=>r.is_ghost),ug=usd.rows[0].creator_rows.find(r=>r.is_ghost);
 assert.equal(ng.amount_spent,0);assert.equal(ng.derived_reconciliation.basis,'native_direct_observation');
 assert.ok(Math.abs(ug.amount_spent-(1/20-1/25))<1e-12);
 assert.deepEqual(population(czk.rows),population(usd.rows));
});
test('declared observation contract cannot lose its period data or exact scope',async()=>{
 const {s}=await build('aggregate');
 assert.equal(s.observation_contract,'account-local-direct-v1');
 const missing=structuredClone(s);delete missing.accounts[0].direct_observation;
 assert.throws(()=>source.renderSnapshot(missing,'CZK'),/observation/i);
 for(const mutate of [o=>o.range.until=range.since,o=>o.account_id=v2.ACCOUNTS[1].id,o=>o.rows[0].creator_rows[0].account_id=v2.ACCOUNTS[1].id,o=>o.rows[0].reach=null,o=>o.rows[0]['actions:omni_purchase']=null,o=>o.rows[0].creator_rows[0].date_stop=range.since,o=>o.generated_at='invalid']){
  const bad=structuredClone(s);mutate(bad.accounts[0].direct_observation);
  assert.throws(()=>source.renderSnapshot(bad,'USD'),/observation|ownership/i);
 }
});
test('upstream wrong-range campaign and ad observations fail closed',async()=>{
 for(const type of ['aggregate','ads'])await assert.rejects(build(type,{badRange:true}),/dates/);
});
test('real coordinator persists direct observations and late performs zero TUC work',async()=>{
 const runtime=require('../lib/glv-mad-v2-isolated.cjs'),reader=require('../lib/glv-mad-v2-isolated-reader.cjs');
 const store=require('./fixtures/mad-v2-isolated.cjs').memory(),g=graph();
 const redis=async(cmd,key,...args)=>{if(cmd==='GET')assert.ok(key.startsWith('glv:mad:v2:'),'no V1/shared reads');return store.redis(cmd,key,...args);};
 const opts={redis,fetcher:g.fetcher,token:'fixture',presets:['last_7d'],ranges:{last_7d:range},includePromo:false,loadFx:async()=>fx};
 const early=await runtime.refresh({...opts,now:new Date('2026-11-14T05:00:00Z')});assert.equal(early.verified,true,JSON.stringify(early.errors));
 const before=await runtime.readPreset(redis,'last_7d'),tuc=JSON.stringify(before.aggregate.account_bundles[TUC.id]);
 const payload=reader.render(before,{type:'aggregate',range,currency:'CZK',account:'TUC'});
 assert.equal(Number(payload.rows[0].amount_spent),100.02);
 assert.equal(payload.observation_provenance[0].monetary_basis,'native_direct_period');
 g.calls.length=0;
 const late=await runtime.refresh({...opts,mode:'late',now});assert.equal(late.verified,true,JSON.stringify(late.errors));
 assert.ok(g.calls.length>0);assert.ok(g.calls.every(u=>!u.pathname.includes(TUC.id)&&!u.searchParams.has('ids')));
 const after=await runtime.readPreset(redis,'last_7d');assert.equal(JSON.stringify(after.aggregate.account_bundles[TUC.id]),tuc);
 for(const currency of ['USD','CZK'])assert.equal(reader.render(after,{type:'aggregate',range,currency,account:'TUC'}).observation_provenance[0].direct_period.generated_at,'2026-11-14T05:00:00.000Z');
});
test('normal continuation cannot reuse pre-contract TUC work as direct observations',async()=>{
 const runtime=require('../lib/glv-mad-v2-isolated.cjs'),reader=require('../lib/glv-mad-v2-isolated-reader.cjs');
 const store=require('./fixtures/mad-v2-isolated.cjs').memory(),g=graph();
 const opts={redis:store.redis,fetcher:g.fetcher,token:'fixture',presets:['last_7d'],ranges:{last_7d:range},includePromo:false,loadFx:async()=>fx,now};
 assert.equal((await runtime.refresh(opts)).verified,true);
 for(const type of ['aggregate','ads']){
  const key=`${runtime.PREFIX}work:${TUC.id}:morning:last_7d:${type}`,s=require('../lib/glv-mad-v2-storage.cjs').decode(store.data.get(key));
  delete s.observation_contract;delete s.accounts[0].direct_observation;store.data.set(key,JSON.stringify(s));
 }
 g.calls.length=0;
 const result=await runtime.refresh(opts);assert.equal(result.verified,true,JSON.stringify(result.errors));
 const p=await runtime.readPreset(store.redis,'last_7d');
 assert.equal(Number(reader.render(p,{type:'aggregate',range,currency:'CZK',account:'TUC'}).rows[0].amount_spent),100.02);
 assert.ok(g.calls.some(u=>u.pathname.includes(TUC.id)&&u.searchParams.get('level')==='ad'&&!u.searchParams.has('time_increment')));
});
test('aggregate reuse prefers its exact daily piece over an older wider snapshot',async()=>{
 const g=graph(),daily=await source.buildSnapshot({account:TUC,range,type:'daily',token:'fixture',fetcher:g.fetcher,fx,now});
 const wide=structuredClone(daily);wide.range.since='2026-11-01';wide.accounts[0].rows[0].source_generation='older-wide';
 const aggregate=await source.buildSnapshot({account:TUC,range,type:'aggregate',token:'fixture',fetcher:g.fetcher,fx,now,reuse:{token:'fixture',accounts:new Map(),snapshots:[wide,daily],history:[]}});
 assert.deepEqual(aggregate.accounts[0].rows,daily.accounts[0].rows);
});
test('normal continuation repairs cached aggregate facts incompatible with its daily piece',async()=>{
 const runtime=require('../lib/glv-mad-v2-isolated.cjs'),storage=require('../lib/glv-mad-v2-storage.cjs');
 const store=require('./fixtures/mad-v2-isolated.cjs').memory(),g=graph();
 const opts={redis:store.redis,fetcher:g.fetcher,token:'fixture',presets:['last_7d'],ranges:{last_7d:range},includePromo:false,loadFx:async()=>fx,now};
 assert.equal((await runtime.refresh(opts)).verified,true);
 const key=`${runtime.PREFIX}work:${TUC.id}:morning:last_7d:aggregate`,cached=storage.decode(store.data.get(key));
 cached.accounts[0].rows[0].source_generation='older-extraction';store.data.set(key,JSON.stringify(cached));
 g.calls.length=0;
 const recovered=await runtime.refresh(opts);assert.equal(recovered.verified,true,JSON.stringify(recovered.errors));
 assert.ok(g.calls.some(u=>u.pathname.includes(TUC.id)&&u.searchParams.get('level')==='campaign'&&!u.searchParams.has('time_increment')));
 assert.ok(!g.calls.some(u=>u.searchParams.has('time_increment')),'reuse coherent daily facts, do not refetch daily history');
 const b=await runtime.readPreset(store.redis,'last_7d');assert.deepEqual(b.aggregate.account_bundles[TUC.id].accounts[0].rows,b.daily.account_bundles[TUC.id].accounts[0].rows);
});
test('late cannot certify retained legacy TUC observations and never repairs them',async()=>{
 const runtime=require('../lib/glv-mad-v2-isolated.cjs'),store=require('./fixtures/mad-v2-isolated.cjs').memory(),g=graph();
 const opts={redis:store.redis,fetcher:g.fetcher,token:'fixture',presets:['last_7d'],ranges:{last_7d:range},includePromo:false,loadFx:async()=>fx,now};
 const legacyBuild=async options=>{const s=await source.buildSnapshot(options);delete s.observation_contract;for(const a of s.accounts)delete a.direct_observation;return s;};
 await runtime.refresh({...opts,build:legacyBuild});g.calls.length=0;
 const result=await runtime.refresh({...opts,mode:'late'});
 assert.equal(result.verified,false);
 assert.ok(result.errors.some(e=>e.reason==='consumed_direct_observations_incomplete'));
 assert.ok(g.calls.every(u=>!u.pathname.includes(TUC.id)&&!u.searchParams.has('ids')));
});
test('isolated pagination rejects cross-account pages before requesting them',async()=>{
 const g=graph();let first=true;
 const fetcher=async url=>{const response=await g.fetcher(url);if(first&&new URL(url).pathname.endsWith('/insights')){first=false;const body=await response.json();return {ok:true,json:async()=>({...body,paging:{next:`https://graph.facebook.com/v21.0/act_${v2.ACCOUNTS[1].id}/insights`}})};}return response;};
 await assert.rejects(source.buildSnapshot({account:TUC,range,type:'aggregate',token:'fixture',fetcher,fx,now}),/pagination.*account/i);
 assert.ok(g.calls.every(u=>!u.pathname.includes(v2.ACCOUNTS[1].id)));
});
test('real-entity/creator gaps and invalid reconciliation fail closed in both currencies',async()=>{
 const {s}=await build('aggregate');
 for(const mutate of [s=>s.accounts[0].direct_observation.rows[0].id='999',s=>s.accounts[0].direct_observation.rows[0].creator_rows[0].ad_id='999',s=>s.accounts[0].direct_observation.rows[0].creator_rows.push(s.accounts[0].direct_observation.rows[0].creator_rows.find(r=>r.is_ghost)),s=>delete s.accounts[0].rows[0].creator_rows[0].impressions]){
  const bad=structuredClone(s);mutate(bad);
  for(const currency of ['USD','CZK'])assert.throws(()=>source.renderSnapshot(bad,currency),/coverage|reconciliation/i);
 }
 const original=JSON.stringify(s);source.renderSnapshot(s,'CZK');source.renderSnapshot(s,'USD');assert.equal(JSON.stringify(s),original);
});
test('raw daily Ghost multiplicity is checked before aggregation can hide it',async()=>{
 const {s}=await build('aggregate',{ghost:'daily'});
 const children=s.accounts[0].rows[0].creator_rows;children.push(structuredClone(children.find(r=>r.is_ghost)));
 for(const currency of ['USD','CZK'])assert.throws(()=>source.renderSnapshot(s,currency),/reconciliation/i);
});
async function build(type,options={}){const g=graph(options);return {g,s:await source.buildSnapshot({account:TUC,range,type,token:'fixture',fetcher:g.fetcher,fx,now})};}
function population(rows){return rows.map(r=>({id:r.id,impressions:Number(r.impressions),purchases:Number(r['actions:omni_purchase']),reach:r.reach??null,creator_rows:population(r.creator_rows||[])}));}
test('isolated TUC aggregate retains V1 direct observations while USD uses daily FX',async()=>{
 const {s,g}=await build('aggregate');const czk=source.renderSnapshot(s,'CZK'),usd=source.renderSnapshot(s,'USD');
 assert.equal(Number(czk.rows[0].amount_spent),100.02);
 assert.equal(Number(czk.rows[0].impressions),151);
 assert.equal(Number(czk.rows[0]['actions:omni_purchase']),3.5);
 assert.equal(Number(czk.rows[0].reach),111);
 assert.equal(usd.rows[0].amount_spent,40/20+60/25);
 assert.deepEqual(population(usd.rows),population(czk.rows));
 assert.equal(czk.rows[0].creator_rows.filter(r=>!r.is_ghost).length,1);
 assert.equal(usd.rows[0].creator_rows.find(r=>r.is_ghost).amount_spent,0);
 assert.equal(usd.rows[0].creator_rows.find(r=>r.is_ghost).derived_reconciliation.basis,'converted_daily_observation');
 assert.ok(g.calls.every(u=>!u.pathname.includes(v2.ACCOUNTS[1].id)));
 assert.equal(s.accounts[0].direct_observation.range.until,range.until);
 assert.equal(s.accounts[0].direct_observation.generated_at,now.toISOString());
 assert.equal(s.accounts[0].direct_observation.basis,'native_direct_period');
});
