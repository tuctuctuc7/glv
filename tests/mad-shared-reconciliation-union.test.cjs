'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const shared=require('../lib/glv-mad-shared.cjs'),v2=require('../lib/glv-mad-v2.cjs');
const {normalizeCampaign}=require('../api/glv-meta-ads/cron.js')._test;
const {attachCreatorFacts}=require('../lib/glv-wl-creators.cjs');
const range={since:'2026-11-01',until:'2026-11-02'},stamp='2026-11-03T12:33:00Z';
function observation(day,stop,parentSpend,childSpend,parentCount=10,childCount=10){
 const raw={campaign_id:'1',campaign_name:'TUC_001_CZSK_WL',date_start:day,date_stop:stop,spend:String(parentSpend),impressions:String(parentCount),reach:'7',actions:[],action_values:[]};
 const parent=normalizeCampaign(raw),child={...normalizeCampaign({...raw,spend:String(childSpend),impressions:String(childCount)}),ad_id:'21',ad_name:'TUC_001_WL_Kristyna',adset_id:'3',adset_name:'WL'};
 return attachCreatorFacts([parent],[child])[0];
}
function fixture({daily=[[11,10],[9,10]],period=[20,20],counts=[[10,10],[10,10]],periodCounts=[20,20]}={}){
 const rows=daily.map((v,i)=>observation(i?range.until:range.since,i?range.until:range.since,...v,...counts[i]));
 const envelope=rows=>({creator_version:2,creator_ad_version:1,creator_reconciliation_version:1,range,generated_at:stamp,rows});
 const ad={...rows[0],id:'21',name:'TUC_001_WL_Kristyna',campaign_id:'1',campaign_name:rows[0].name,adset_id:'3',adset_name:'WL',partnership:{status:'unverified',reason:'metadata_unavailable',evidence:[]}};delete ad.creator_rows;
 const legacy={daily:envelope(rows),aggregate:envelope([observation(range.since,range.until,...period,...periodCounts)]),ads:{...envelope([ad]),wl_version:3}};
 const fx=Object.fromEntries([range.since,range.until].map((date,i)=>[date,{date,czk_per_usd:i?25:20}]));
 const native=Object.fromEntries(['daily','aggregate','ads'].map(type=>[type,{schema_version:1,creator_ad_version:1,complete:true,type,range,generated_at:stamp,fx,accounts:v2.ACCOUNTS.map(a=>({...a,rows:a.label==='TUC'?(type==='ads'?[ad]:rows):[],reach:type==='aggregate'&&a.label==='TUC'?[[a.id+':1',7]]:[]}))}]));
 return {legacy,native};
}
const ghost=row=>row.creator_rows.find(r=>r.is_ghost);
function rendered(bundle,type='aggregate'){
 return [shared.render(bundle,type,'v1'),shared.render(bundle,type,'v2','CZK','TUC'),shared.render(bundle,type,'v2','USD','TUC')];
}
test('actual cron daily Ghost cancellation retains USD residual and derives canonical native zero without source mutation',()=>{
 const f=fixture(),before=structuredClone(f),bundle=shared.compose(f),[old,czk,usd]=rendered(bundle);
 assert.deepEqual(f,before);
 assert.deepEqual(shared.facts(old),shared.facts(czk));
 const nativeGhost=ghost(old.rows[0]),usdGhost=ghost(usd.rows[0]);
 assert.equal(nativeGhost.amount_spent,0);
 assert.equal(nativeGhost.impressions,0);
 assert.equal(nativeGhost.reach,null);assert.equal(usdGhost.reach,null);
 assert.equal(usdGhost.amount_spent,1/20-1/25);
 assert.equal(usdGhost.native.amount_spent,0);
 assert.equal(nativeGhost.derived_reconciliation.basis,'native_direct_observation');
 assert.deepEqual(usdGhost.daily_provenance.map(p=>p.native.amount_spent),[1,-1]);
 assert.equal(old.rows[0].amount_spent,'20');assert.equal(old.rows[0].reach,'7');
 assert.equal(old.generated_at,stamp);
 assert.equal(old.rows[0].creator_rows[0].amount_spent,'20');
 assert.deepEqual(czk.rows[0].creator_rows.map(r=>r.id),usd.rows[0].creator_rows.map(r=>r.id));
 shared.validate(Object.fromEntries(['daily','aggregate','ads'].map(type=>[type,{bundle}])));
});
test('actual cron period-only Ghost derives USD aggregate zero from daily parents and real children',()=>{
 const f=fixture({daily:[[10,10],[10,10]],period:[20.01,20]}),before=structuredClone(f),bundle=shared.compose(f),[old,czk,usd]=rendered(bundle);
 const a=ghost(old.rows[0]),b=ghost(usd.rows[0]);
 assert.deepEqual(a,f.legacy.aggregate.rows[0].creator_rows[1].account_id===undefined?{...f.legacy.aggregate.rows[0].creator_rows[1],account_id:v2.ACCOUNTS[0].id}:f.legacy.aggregate.rows[0].creator_rows[1]);
 assert.equal(b.amount_spent,0);assert.equal(b.derived_reconciliation.basis,'converted_daily_observation');
 assert.equal(b.native.amount_spent,a.amount_spent);
 assert.equal(b.monetary_provenance.native_daily.amount_spent,0);
 assert.equal(b.daily_provenance,undefined);assert.equal(b.fx,undefined);
 assert.equal(b.derived_reconciliation.parent_daily_inputs.length,2);
 assert.equal(b.derived_reconciliation.parent_metrics.amount_spent,10/20+10/25);
 assert.equal(b.derived_reconciliation.child_totals.amount_spent,10/20+10/25);
 assert.deepEqual(shared.facts(old),shared.facts(czk));assert.deepEqual(f,before);
 shared.validate(Object.fromEntries(['daily','aggregate','ads'].map(type=>[type,{bundle}])));
});
test('derived native count zero and nonzero residuals retain direct and daily observation provenance',()=>{
 for(const n of [0,2]){
  // A sub-epsilon count difference is intentionally not turned into source zero.
  const direct=n===0?20:20+1e-10;
  const f=fixture({counts:[[11,10],[11,10]],periodCounts:[direct,20]});
  const [old,czk,usd]=rendered(shared.compose(f)),a=ghost(old.rows[0]),b=ghost(usd.rows[0]);
  assert.equal(a.impressions,direct-20);
  assert.equal(b.impressions,a.impressions);
  assert.equal(b.reconciliation_observations.converted_daily.metrics.impressions,2);
  assert.equal(b.reconciliation_observations.native_direct.metrics.impressions,direct-20);
  assert.deepEqual(shared.facts(old),shared.facts(czk));
 }
 const f=fixture({daily:[[10,10],[10,10]],period:[20,20],periodCounts:[22,20]});
 const [old,,usd]=rendered(shared.compose(f));
 assert.equal(ghost(old.rows[0]).impressions,2);
 assert.equal(ghost(usd.rows[0]).derived_reconciliation.parent_metrics.impressions,20);
 assert.equal(ghost(usd.rows[0]).reconciliation_observations.converted_daily.metrics.impressions,0);
});
test('nested daily and aggregate creator paths preserve multiple ad IDs, ownership and real fields',()=>{
 const f=fixture();
 // Each real child becomes an independently normalized WL parent at depth 2.
 function nest(row){
  const nested=observation(row.date_start,row.date_stop,row.amount_spent,row.amount_spent);
  nested.creator_rows[0].ad_id='31';
  nested.creator_rows[0].amount_spent=String(Number(row.amount_spent)/2);
  const second={...nested.creator_rows[0],ad_id:'32',ad_name:'TUC_001_WL_ActionKate'};
  nested.creator_rows.push(second);
  row.creator_rows[0].creator_rows=nested.creator_rows;
 }
 for(const r of f.legacy.daily.rows)nest(r);nest(f.legacy.aggregate.rows[0]);
 // Force the same actual producer discrepancy one level deeper, daily only.
 for(const row of f.legacy.daily.rows){
  const child=row.creator_rows[0];
  const nested=observation(row.date_start,row.date_stop,Number(child.amount_spent)+(row.date_start===range.since?1:-1),Number(child.amount_spent));
  child.creator_rows.push(ghost(nested));
 }
 const before=structuredClone(f),bundle=shared.compose(f);
 for(const type of ['daily','aggregate']){
  const [old,czk,usd]=rendered(bundle,type);
  assert.deepEqual(shared.facts(old),shared.facts(czk));
  const shape=rows=>rows.map(r=>[r.source_ad_id||r.ad_id||r.source_id||r.id,!!r.is_ghost,r.creator_rows?.length?shape(r.creator_rows):[]]);
  assert.deepEqual(shape(czk.rows),shape(usd.rows));
  assert.equal(usd.rows[0].creator_rows[0].creator_rows[0].source_ad_id,'31');
  assert.equal(usd.rows[0].creator_rows[0].creator_rows[1].source_ad_id,'32');
 }
 assert.equal(ghost(rendered(bundle)[0].rows[0].creator_rows[0]).reach,null);
 assert.deepEqual(f,before);
});
test('multiple or malformed creator Ghosts reject before aggregation can merge them',()=>{
 for(const where of ['legacy','native'])for(const defect of ['duplicate','reach','identity','ad']){
  const f=fixture(),parent=where==='legacy'?f.legacy.daily.rows[0]:f.native.aggregate.accounts[0].rows[0];
  const g=ghost(parent);
  if(defect==='duplicate')parent.creator_rows.push({...g});
  if(defect==='reach')g.reach=0;
  if(defect==='identity')g.id='other';
  if(defect==='ad')g.ad_id='fake';
  assert.throws(()=>shared.compose(f),/Invalid|Unsupported/,where+':'+defect);
 }
});
test('unmatched reconciliation never excuses missing or duplicate real identities or ownership',()=>{
 for(const defect of ['missing','extra','duplicate','ownership']){
  const f=fixture(),rows=f.legacy.aggregate.rows[0].creator_rows;
  if(defect==='missing')rows[0].ad_id='missing';
  if(defect==='extra')rows.push({...rows[0],ad_id:'extra'});
  if(defect==='duplicate')rows.push({...rows[0]});
  if(defect==='ownership')f.legacy.daily.rows[0].creator_rows[1].account_id=v2.ACCOUNTS[1].id;
  assert.throws(()=>shared.compose(f),/Unsupported currency coverage|ownership|Invalid/);
 }
});
test('absent additive operands are unavailable, never manufactured zeros',()=>{
 const f=fixture();delete f.legacy.aggregate.rows[0].creator_rows[0]['actions:lead'];
 assert.throws(()=>shared.compose(f),/unavailable reconciliation metric/);
});
test('missing daily count operands cannot become calculated USD zero via the aggregate normalizer',()=>{
 const f=fixture({daily:[[10,10],[10,10]],period:[20.01,20]});
 delete f.legacy.daily.rows[0].creator_rows[0]['actions:lead'];
 assert.throws(()=>shared.compose(f),/unavailable reconciliation metric/);
});
test('union requires complete attribution on both observations, not only the derived side',()=>{
 const f=fixture({daily:[[10,10],[10,10]],period:[20.01,20]});
 f.legacy.aggregate.rows[0].creator_issue='Source attribution unavailable';
 assert.throws(()=>shared.compose(f),/incomplete reconciliation/);
});
test('calculated USD residual retains nonzero sub-threshold inputs without inventing a daily Ghost',()=>{
 const f=fixture({daily:[[10+1e-10,10],[10,10]],period:[20.01,20]});
 assert.ok(f.legacy.daily.rows.every(r=>!ghost(r)));
 const [,czk,usd]=rendered(shared.compose(f)),g=ghost(usd.rows[0]);
 const expected=(10+1e-10)/20+10/25-(10/20+10/25);
 assert.notEqual(expected,0);assert.equal(g.amount_spent,expected);
 assert.equal(g.derived_reconciliation.parent_metrics.amount_spent-g.derived_reconciliation.child_totals.amount_spent,expected);
 assert.equal(g.native.amount_spent,ghost(czk.rows[0]).native.amount_spent);
 assert.equal(g.video_thruplay_watched_actions,undefined);
 assert.equal(g.daily_provenance,undefined);
});
test('canonical augmentation and derivation provenance are integrity checked',()=>{
 for(const target of ['canonical','provenance']){
  const bundle=shared.compose(fixture());
  const g=ghost(bundle.pieces.aggregate.canonical_v1.rows[0]);
  if(target==='canonical')g.amount_spent=1;
  else g.derived_reconciliation.child_totals.amount_spent=1;
  assert.throws(()=>shared.validate(Object.fromEntries(['daily','aggregate','ads'].map(type=>[type,{bundle}]))),/content identity/);
 }
});
test('duplicate real source children fail before aggregation can disguise complete coverage',()=>{
 const f=fixture(),row=f.legacy.daily.rows[0];
 row.creator_rows.push({...row.creator_rows[0]});
 assert.throws(()=>shared.compose(f),/Unsupported currency coverage|Invalid creator/);
});
module.exports={fixture,observation,ghost,rendered};
