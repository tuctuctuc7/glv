const test=require('node:test'),assert=require('node:assert/strict');
const {attachCreatorFacts}=require('../lib/glv-wl-creators.cjs');
const fs=require('node:fs'),vm=require('node:vm');
function ui(){const html=fs.readFileSync(require('node:path').join(__dirname,'../public/glv-meta-ads-v2/index.html'),'utf8');const slice=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b));const ctx=vm.createContext({GlvWlReport:require('../public/glv-meta-ads-v2/wl-report.js'),PromoFormat:require('../public/glv-meta-ads/promo-format.js')});vm.runInContext(`let wlInfluencerBreakdown=true;${slice('const PROMO_GROUPS','function getCampaignColor')}${slice('function aggregate(','function metricForSort')}${slice('function byPromoGroup','function byDate(rows')}`,ctx);return ctx;}
test('Ghost keeps naming resolution available, signed totals and explicit unattributed group',()=>{
 const ctx=ui();const result=vm.runInContext(`(()=>{const row={...emptyAgg(),id:'35',name:'GLV_035_CZSK_WL',segment:'czsk',group:'wl',spend:30,reach:150,creatorRows:[{...emptyAgg(),name:'GLV_035_CZSK_WL',segment:'czsk',group:'wl',adsetName:'Set_Kristyna',spend:40,revenue:100,reach:null},{...emptyAgg(),name:'GLV_035_CZSK_WL',segment:'czsk',group:'wl',isGhost:true,spend:-10,revenue:-10,reach:null}]};return {issues:getWlNamingIssues([row]),split:byPromoGroup([row]),parent:aggregate([row])};})()`,ctx);
 assert.equal(result.issues.length,0);assert.equal(result.split.find(r=>r.group==='wl-kristyna').spend,40);assert.equal(result.split.find(r=>r.group==='wl-ghost').spend,-10);assert.equal(result.split.reduce((s,r)=>s+r.spend,0),30);assert.equal(result.parent.reach,150);assert.equal(result.split.find(r=>r.group==='wl-ghost').reach,null);
});
test('wire Ghost survives normalizers and cache validation without claiming a creator or reach',()=>{
 const result=attachCreatorFacts([parent],[child])[0];
 const live=require('../api/glv-meta-ads/fb-data.js')._test;
 assert.equal(live.cachedPayloadUsable('aggregate',{creator_version:2,creator_reconciliation_version:1,creator_ad_version:1,rows:[result]}),true);
 const html=fs.readFileSync(require('node:path').join(__dirname,'../public/glv-meta-ads-v2/index.html'),'utf8');
 const ctx=ui();vm.runInContext(`const campaignGroupKey=()=> 'wl';${html.slice(html.indexOf('function processRow('),html.indexOf('function processAggregateRows('))};var wire=${JSON.stringify(result)};`,ctx);
 const actual=vm.runInContext("creatorMetadata(wire,'czsk','2026-11-01')",ctx);assert.equal(actual.creatorRows[1].isGhost,true);assert.equal(actual.creatorRows[1].reach,null);assert.equal(actual.creatorRows[0].reach,null);
});
test('duplicate and malformed real inputs remain explicit validation failures, not Ghost',()=>{
 for(const children of [[child,child],[{...child,amount_spent:NaN}],[{...child,amount_spent:null}],[{...child,amount_spent:''}],[{...child,amount_spent:-1}],[{...child,adset_id:''}]]){
 const row=attachCreatorFacts([parent],children)[0];assert.deepEqual(row.creator_rows,[]);assert.match(row.creator_issue,/invalid|missing/);assert.equal(row.amount_spent,'30');
 }
});
test('global warnings keep actionable exact names but never reconciliation information',()=>{
 const ctx=ui(),warning={hidden:false,innerHTML:''};
 Object.assign(ctx,{document:{getElementById:()=>({querySelector:()=>warning})},adCreatives:[],escapeHtml:s=>s,filterTabRows:(_tab,rows)=>rows,getTabBaseRows:()=>[
 {name:'TUC_035_CZSK_CBO_Sales_WL',adsetName:'AS13_Purchase_Videos_WL_KPI'},
 {name:'TUC_035_CZSK_CBO_Sales_WL',isGhost:true,spend:-10,revenue:-10}
 ]});
 vm.runInContext("renderCreatorWarning('czsk')",ctx);
 assert.equal(warning.hidden,false);assert.match(warning.innerHTML,/TUC_035_CZSK_CBO_Sales_WL \/ AS13_Purchase_Videos_WL_KPI/);
 assert.match(warning.innerHTML,/check campaign name first, then ad-set name/);
 assert.doesNotMatch(warning.innerHTML,/Ghost|Meta reconciliation pending/);
 ctx.getTabBaseRows=()=>[{name:'TUC_035_CZSK_CBO_Sales_WL',isGhost:true,spend:-10,revenue:-10}];
 vm.runInContext("renderCreatorWarning('czsk')",ctx);assert.equal(warning.hidden,true);assert.equal(warning.innerHTML,'');
});
test('creator visibility includes non-financial residuals only in a valid requested split',()=>{
 const ctx=ui();Object.assign(ctx,{document:{getElementById:()=>({})},escapeHtml:s=>s,getPromoDailyRows:()=>[],periodRows:rows=>rows,byDateGroup:()=>[]});
 for(const metric of ['spend','revenue','purchases','impressions','linkClicks','lp','checkouts','leads']){
  vm.runInContext(`var facts=[{...emptyAgg(),name:'TUC_035_CZSK_WL',segment:'czsk',group:'wl',creatorRows:[{...emptyAgg(),name:'TUC_035_CZSK_WL',segment:'czsk',group:'wl',adsetName:'Set_Kristyna'},{...emptyAgg(),name:'TUC_035_CZSK_WL',segment:'czsk',group:'wl',isGhost:true,${metric}:-.003}]}];getPromoKpiRows=()=>facts;validateWlBreakdown();`,ctx);
  assert.equal(vm.runInContext('wlGhostVisible',ctx),true,metric);
 }
 vm.runInContext('wlInfluencerBreakdown=false;validateWlBreakdown()',ctx);assert.equal(vm.runInContext('wlGhostVisible',ctx),false);
});
test('Ghost is not a naming issue and all-zero residuals stay hidden',()=>{
 const ctx=ui();assert.equal(vm.runInContext("getWlNamingIssues([{name:'TUC_035_US_WL',isGhost:true}]).length",ctx),0);
 assert.equal(vm.runInContext('hasCreatorResidual(emptyAgg())',ctx),false);
 assert.equal(vm.runInContext('hasCreatorResidual({...emptyAgg(),spend:1e-12})',ctx),false);
 assert.equal(vm.runInContext("getWlNamingIssues([{name:'TUC_035_US_WL',adsetName:'Set_Kristyna_ActionKate'}]).length",ctx),1);
});
test('unavailable creator reach cannot become a zero frequency proxy',()=>{const ctx=ui();assert.equal(vm.runInContext('calcMetrics({...emptyAgg(),reach:null,impressions:10}).frequency',ctx),null);assert.equal(vm.runInContext('aggregate([{...emptyAgg(),reach:null}]).reach',ctx),null);});
test('fractional signed creator actions survive wire normalization',()=>{
 const html=fs.readFileSync(require('node:path').join(__dirname,'../public/glv-meta-ads-v2/index.html'),'utf8');const ctx=ui();vm.runInContext(html.slice(html.indexOf('function processRow('),html.indexOf('function processAggregateRows(')),ctx);
 assert.equal(vm.runInContext("processRow({'actions:omni_purchase':-0.75}).purchases",ctx),-0.75);
});
test('legacy accepted cent discrepancy requires a new creator reconciliation extraction',()=>{const live=require('../api/glv-meta-ads/fb-data.js')._test;const row={...parent,creator_rows:[{...child,amount_spent:parent.amount_spent,'action_values:omni_purchase':'90.01'}]};assert.equal(live.cachedPayloadUsable('aggregate',{creator_version:2,rows:[row]}),false);});
test('old discarded-child cache is rejected rather than invented attribution',()=>{
 const live=require('../api/glv-meta-ads/fb-data.js')._test;
 assert.equal(live.cachedPayloadUsable('daily',{creator_version:2,rows:[{...parent,creator_rows:[],creator_issue:'Ad-set facts do not reconcile with campaign totals; refresh and check source naming.'}]}),false);
});
const parent={id:'35',name:'GLV_035_CZSK_WL',date_start:'2026-11-01',date_stop:'2026-11-01',amount_spent:'30',impressions:'300',reach:'150','action_values:omni_purchase':'90'};
const child={...parent,ad_id:'ad-k',ad_name:'Kristyna_PAC419_V1',adset_id:'k',adset_name:'Set_Kristyna',amount_spent:'40',impressions:'400',reach:'180','action_values:omni_purchase':'100'};
test('signed creator residual retains real source facts and authoritative campaign totals',()=>{
 const result=attachCreatorFacts([parent],[child])[0];
 assert.equal(result.creator_rows.length,2);
 assert.deepEqual(result.creator_rows[0],child);
 const ghost=result.creator_rows[1];assert.equal(ghost.is_ghost,true);assert.equal(ghost.creator,null);assert.equal(ghost.adset_name,undefined);assert.equal(ghost.reach,null);
 assert.equal(ghost.amount_spent,-10);assert.equal(ghost.impressions,-100);assert.equal(ghost['action_values:omni_purchase'],-10);
 assert.equal(result.creator_issue,undefined);assert.equal(result.creator_rows.reduce((s,r)=>s+Number(r.amount_spent),0),30);assert.equal(result.reach,'150');
});
