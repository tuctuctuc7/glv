const test=require('node:test'),assert=require('node:assert/strict');
const wl=require('../public/glv-meta-ads/wl-report.js');
const facts=require('../lib/glv-wl-creators.cjs');
const positive={status:'verified_positive',reason:'sponsor_metadata',evidence:['facebook_branded_content.sponsor_page_id']};
const parent={id:'35',name:'TUC_035_CZSK_CBO_Sales_WL',amount_spent:'35',reach:'99',impressions:'300'};
const ads=['Kristyna_PAC419_v6-9','ActionKate_PAC462_V2','befit_over40_PAC470_V8'].map((ad_name,i)=>({...parent,ad_id:String(i),ad_name,adset_id:'AS13',adset_name:'AS13_Purchase_Videos_WL_KPI',amount_spent:'10',impressions:'100'}));
test('report resolves each eligible AS13 ad and never promotes an unverified name',()=>{
 const rows=ads.map(r=>({...r,name:r.ad_name,campaign_name:r.name,partnership:positive}));
 const report=wl.report(wl.normalize([...rows,{...rows[0],partnership:{status:'unverified',reason:'no_positive_metadata',evidence:[]}}]));
 assert.deepEqual(report.rows.map(r=>r.creator),['Kristyna','ActionKate','befit_over40']);
 assert.equal(report.total.actual,30);assert.equal(report.total.reported,20);
});
test('campaign producer fetches ad-grain facts including named campaigns and retains signed totals',async()=>{
 const urls=[];const result=await facts.campaignFacts('https://example.test/insights?level=campaign&fields=spend',async url=>{urls.push(new URL(url));return urls.length===1?[parent]:ads;},r=>r);
 assert.equal(urls[1].searchParams.get('level'),'ad');
 assert.match(urls[1].searchParams.get('fields'),/ad_id,ad_name/);
 assert.deepEqual(result[0].creator_rows.filter(r=>!r.is_ghost).map(r=>r.ad_name),ads.map(r=>r.ad_name));
 assert.equal(result[0].creator_rows.at(-1).amount_spent,5);assert.equal(result[0].reach,'99');
 assert.equal(facts.needsAdsets({...parent,name:'TUC_035_CZSK_WL_Kristyna'}),true);
});
test('frontend splits AS13 ad facts and retains source warnings even on named parents',()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 const html=fs.readFileSync(require('node:path').join(__dirname,'../public/glv-meta-ads/index.html'),'utf8');
 const slice=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b));
 const ctx=vm.createContext({GlvWlReport:wl});
 vm.runInContext(`let wlInfluencerBreakdown=true;${slice('const PROMO_GROUPS','function getCampaignColor')}${slice('function aggregate(','function calcMetrics')}${slice('function byPromoGroup','function byDate(rows')}`,ctx);
 ctx.ads=ads;
 const result=vm.runInContext(`(()=>{const children=ads.map(r=>({...emptyAgg(),name:r.name,adName:r.ad_name,adsetName:r.adset_name,segment:'czsk',group:'wl',spend:10}));return {split:byPromoGroup(children),issues:getWlNamingIssues(children),blocked:getWlNamingIssues([{name:'TUC_035_CZSK_WL_Kristyna',creatorIssue:'Ad facts unavailable'}])};})()`,ctx);
 assert.equal(result.issues.length,0);assert.equal(result.blocked.length,1);
 assert.deepEqual(Array.from(result.split.filter(r=>r.spend),r=>r.spend),[10,10,10]);
});
test('cache refuses legacy adset aggregates while keeping ad-level schema and signed residuals',()=>{
 const live=require('../api/glv-meta-ads/fb-data.js')._test;
 const legacy=facts.attachCreatorFacts([parent],[{...parent,adset_id:'AS13',adset_name:'Set_Kristyna'}]);
 assert.equal(live.cachedPayloadUsable('aggregate',{creator_version:2,creator_reconciliation_version:1,rows:legacy}),false);
 const rows=facts.attachCreatorFacts([parent],ads);
 assert.equal(live.cachedPayloadUsable('aggregate',{creator_version:2,creator_reconciliation_version:1,creator_ad_version:1,rows}),true);
});
test('explicit strict ad prefix wins during migration without PAC inference',()=>{
 for(const [name,creator] of [['Kristyna_PAC419_v6-9','Kristyna'],['ActionKate_PAC460_V4','ActionKate'],['ActionKate_PAC462_V2','ActionKate'],['befit_over40_PAC470_V8','befit_over40']]){
  const resolved=wl.resolveCreator('TUC_035_CZSK_WL_ActionKate','AS13_Kristyna',name);
  assert.deepEqual({creator:resolved.creator,source:resolved.source,status:resolved.status},{creator,source:'ad',status:'resolved'});
  assert.ok(resolved.conflicts.length,'Explicit conflicting parents are notices, not attribution blockers');
 }
 for(const name of ['PAC419_V7','xKristyna_PAC419_V7','Kristyna2_PAC419_V7','Kristyna_PAC419','Kristyna_PAC419_','PAC462_ActionKate'])assert.equal(wl.resolveCreator('TUC_035_CZSK_WL','AS13',name).status,'missing');
 assert.equal(wl.resolveCreator('WL_Kristyna','AS13','PAC340_V1').creator,'Kristyna');
 assert.equal(wl.resolveCreator('WL','Set_ActionKate','PAC372_V1').creator,'ActionKate');
 assert.equal(wl.resolveCreator('WL','AS13','Kristyna_ActionKate_PAC419_V1').status,'ambiguous');
});
