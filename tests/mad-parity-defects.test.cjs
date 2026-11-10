const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const campaign='TUC_035_CZSK_WL_Kristyna',adset='Set_befit_over40',ad='ActionKate_PAC462_V2';
function ui(version){
 const html=fs.readFileSync(path.join(__dirname,`../public/${version}/index.html`),'utf8');
 const slice=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b));
 const warning={hidden:true,innerHTML:''};
 const ctx=vm.createContext({GlvWlReport:require(`../public/${version}/wl-report.js`),PromoFormat:require('../public/glv-meta-ads/promo-format.js'),document:{getElementById:()=>({querySelector:()=>warning})},escapeHtml:s=>s,adCreatives:[],filterTabRows:(_t,rows)=>rows,getPromoDailyRows:()=>[],periodRows:r=>r,byDateGroup:()=>[]});
 vm.runInContext(`let wlInfluencerBreakdown=true;${slice('const PROMO_GROUPS','function getCampaignColor')}${slice('function aggregate(','function metricForSort')}${slice('function byPromoGroup','function byDate(rows')}`,ctx);
 return {ctx,warning,html};
}
for(const version of ['glv-meta-ads','glv-meta-ads-v2']){
 test(`${version}: valid ad prefix retains split and exposes exact parent conflicts`,()=>{
  const report=require(`../public/${version}/wl-report.js`),r=report.resolveCreator(campaign,adset,ad);
  assert.equal(r.creator,'ActionKate');assert.equal(r.status,'resolved');
  assert.deepEqual(r.conflicts,[{source:'campaign',name:campaign,creators:['Kristyna']},{source:'adset',name:adset,creators:['befit_over40']}]);
  const {ctx,warning}=ui(version);
  ctx.facts=[{name:campaign,segment:'czsk',group:'wl',adsetName:adset,adName:ad}];ctx.getPromoKpiRows=()=>ctx.facts;ctx.getTabBaseRows=()=>ctx.facts;
  vm.runInContext("validateWlBreakdown();renderCreatorWarning('czsk')",ctx);
  assert.equal(vm.runInContext('wlBreakdownActive()',ctx),true);
  assert.equal(vm.runInContext('promoPresentationKey(facts[0])',ctx),'wl-actionkate');
  assert.equal(warning.hidden,false);
  for(const s of [campaign,adset,ad,'Kristyna','befit_over40','ActionKate'])assert.ok(warning.innerHTML.includes(s),s);
  assert.match(warning.innerHTML,/correct|align/i);assert.doesNotMatch(warning.innerHTML,/No creator assumed/);
  const rows=report.normalize([{id:'synthetic',campaign_id:'35',campaign_name:campaign,adset_name:adset,name:ad,partnership:{status:'verified_positive',reason:'sponsor_metadata',evidence:['facebook_branded_content.sponsor_page_id']},amount_spent:1,'action_values:omni_purchase':2,'actions:omni_purchase':1}]);
  assert.equal(rows[0].creator,'ActionKate');assert.ok(report.report(rows).issues.some(s=>s.includes(campaign)&&s.includes(adset)&&s.includes(ad)));
 });
 test(`${version}: outbound-only signed Ghost survives normalization and aggregation, then cancels`,()=>{
  const {ctx,html}=ui(version);
  vm.runInContext(html.slice(html.indexOf('function processRow('),html.indexOf('function processAggregateRows(')),ctx);
  for(const [values,expected] of [[[1],1],[[-1],-1],[[.003,.003],.006],[[1,-1],0],[[0],0]]){
   ctx.values=values;
   const result=vm.runInContext(`(()=>{const facts=values.map(value=>({...emptyAgg(),name:'TUC_035_CZSK_WL',group:'wl',segment:'czsk',creatorRows:[{...processRow({'actions:outbound_click':value}),name:'TUC_035_CZSK_WL',group:'wl',segment:'czsk',isGhost:true},{...emptyAgg(),name:'TUC_035_CZSK_WL',adName:'Kristyna_PAC419_V1',group:'wl',segment:'czsk'}]}));getPromoKpiRows=()=>facts;validateWlBreakdown();const ghost=byPromoGroup(facts).find(r=>r.group==='wl-ghost');return {visible:wlGhostVisible,outbound:ghost?.outboundClicks||0};})()`,ctx);
   assert.equal(result.visible,expected!==0);assert.equal(result.outbound,expected);
  }
  vm.runInContext('wlInfluencerBreakdown=false;validateWlBreakdown()',ctx);assert.equal(vm.runInContext('wlGhostVisible',ctx),false);
 });
 test(`${version}: matching and unlabeled parents are not conflicts; ambiguous ads still fail closed`,()=>{
  const report=require(`../public/${version}/wl-report.js`);
  for(const parents of [['TUC_035_CZSK_WL','AS13'],['TUC_035_CZSK_WL_ActionKate','Set_ActionKate']])assert.equal(report.resolveCreator(...parents,ad).conflicts?.length||0,0);
  assert.equal(report.resolveCreator(campaign,adset,'ActionKate_PAC462_Kristyna').creator,null);
 });
}
