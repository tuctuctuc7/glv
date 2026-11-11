const test=require('node:test'),assert=require('node:assert/strict');
const facts=require('../lib/glv-wl-creators.cjs');
test('V1 and V2 cannot drift in their ad-name-first creator rule',()=>{
 const v1=require('../public/glv-meta-ads/wl-report.js'),v2=require('../public/glv-meta-ads-v2/wl-report.js');
 assert.equal(v2.resolveCreator.toString(),v1.resolveCreator.toString(),'change the creator rule in BOTH versions');
 for(const creator of ['Kristyna','ActionKate','befit_over40']){
  const input=['TUC_035_CZSK_WL_Kristyna','Set_ActionKate',creator+'_PAC462_V2'];
  assert.deepEqual(v2.resolveCreator(...input),v1.resolveCreator(...input));
  assert.equal(v2.resolveCreator(...input).creator,creator);
  assert.equal(v2.resolveCreator(...input).source,'ad');
 }
});
test('creator diagnostics verify actual ad-name-first outcomes, not only source presence',()=>{
 const parent={id:'35',name:'TUC_035_CZSK_WL_Kristyna',creator_rows:[
  {ad_id:'1',ad_name:'ActionKate_PAC462_V2',adset_id:'set',adset_name:'Set_befit_over40'},
  {ad_id:'2',ad_name:'Kristyna_PAC419_V1',adset_id:'set',adset_name:'Mixed'},
  {is_ghost:true}
 ]};
 assert.deepEqual(facts.creatorAttributionDiagnostics([parent]),{ad_name_facts:2,legacy_fallback_facts:0,unresolved_facts:0,creators:['ActionKate','Kristyna']});
 const ambiguous={...parent,name:'TUC_035_CZSK_WL',creator_rows:[{ad_id:'3',ad_name:'unknown',adset_id:'set',adset_name:'Mixed'}]};
 assert.equal(facts.creatorAttributionDiagnostics([ambiguous]).unresolved_facts,1);
 assert.equal(facts.creatorAttributionDiagnostics([{...parent,creator_rows:parent.creator_rows.map(r=>r.ad_id?{...r,ad_name:'legacy'}:r)}]).legacy_fallback_facts,2);
});
