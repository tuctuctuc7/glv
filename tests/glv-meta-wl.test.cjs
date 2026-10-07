const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../public/glv-meta-ads/index.html'),'utf8');
function runtime(){
 const slice=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b));
 const ctx=vm.createContext({});
 vm.runInContext(`let wlInfluencerBreakdown=false;${slice('const PROMO_GROUPS','function getCampaignColor')}${slice('function aggregate(','function calcMetrics')}`,ctx);
 vm.runInContext(slice('function byPromoGroup','function byDate(rows'),ctx);
 return ctx;
}
test('WL breakdown has exactly three creators and no catch-all group',()=>{
 const ctx=runtime();
 assert.deepEqual(Array.from(vm.runInContext('WL_INFLUENCER_GROUPS.map(g=>g.key)',ctx)),['wl-kristyna','wl-actionkate','wl-befit-over40']);
});
test('creator detection is exclusive, case-insensitive and preserves phase precedence',()=>{
 const ctx=runtime();
 for(const [name,expected] of [
  ['GLV_401_CZ_WL_befit_over40','wl-befit-over40'],
  ['TUC_402_CZ_WL_BeFiT_OvEr40_Launch','wl-befit-over40'],
  ['GLV_403_CZ_befit_over40','bau'],['GLV_404_CZ_wl_befit_over40','bau'],
  ['GLV_405_CZ_WL_befit_over40_Promo','promo'],
  ['GLV_406_CZ_WL_befit_over40_promo','wl-befit-over40'],
 ]){
  ctx.name=name;
  assert.equal(vm.runInContext('wlInfluencerBreakdown=true;promoPresentationKey({name})',ctx),expected,name);
  assert.equal(vm.runInContext('wlInfluencerBreakdown=false;promoPresentationKey({name})',ctx),expected.startsWith('wl-')?'wl':expected,name+' combined');
 }
});
test('missing and every ambiguous creator combination block the split without losing totals',()=>{
 const ctx=runtime();
 const result=vm.runInContext(`(()=>{
 const names=['X_WL_Unknown','X_WL_Kristyna_ActionKate','X_WL_befit_over40_Kristyna','X_WL_ActionKate_BEFIT_OVER40','X_WL_Kristyna_ActionKate_befit_over40'];
 const rows=[...names,'X_WL_Kristyna','X_WL_Unknown_Promo'].map((name,i)=>({...emptyAgg('2026-08-10'),name,segment:'czsk',group:promoGroupKey(name),spend:i+1,revenue:(i+1)*5}));
 const combined=byPromoGroup(rows);
 wlInfluencerBreakdown=true;wlNamingIssues=getWlNamingIssues([...rows,...rows]);
 return {issues:wlNamingIssues,groups:activePromoGroups().map(g=>g.key),combined,split:byPromoGroup(rows),daily:byDateGroup(rows),preference:wlInfluencerBreakdown};
 })()`,ctx);
 assert.equal(result.issues.length,5);
 assert.deepEqual(Array.from(result.groups),['promo','wl','bau']);
 assert.deepEqual(result.split,result.combined);
 assert.equal(result.preference,true);
 assert.equal(result.daily.reduce((s,r)=>s+r.spend,0),28);
});
test('valid WL split conserves every additive total without mutating raw phases',()=>{
 const ctx=runtime();
 ctx.names=['X_WL_kRiStYnA','X_WL_ACTIONKATE','X_Kristyna','X_Sales','X_WL_Kristyna_Promo','WL_befit_over40','GLV_401_CZ_WL_BEFIT_OVER40'];
 const result=vm.runInContext(`(()=>{
 const rows=names.map((name,i)=>({...emptyAgg('2026-08-10'),id:String(i),name,segment:'czsk',group:promoGroupKey(name),spend:i+1,revenue:(i+1)*11,lp:20+i,purchases:i+2,checkouts:i+4,leads:i,linkClicks:30+i,impressions:100+i,reach:70+i}));
 const before=JSON.stringify(rows),combined=byPromoGroup(rows);
 wlInfluencerBreakdown=true;
 const split=byPromoGroup(rows),daily=byDateGroup(rows);
 return {combined,split,daily,keys:rows.map(promoPresentationKey),unchanged:before===JSON.stringify(rows),colors:activePromoGroups().map(g=>g.color)};
 })()`,ctx);
 assert.deepEqual(Array.from(result.keys),['wl-kristyna','wl-actionkate','bau','bau','promo','wl-befit-over40','wl-befit-over40']);
 assert.equal(result.unchanged,true);
 assert.equal(result.split.find(r=>r.group==='wl-befit-over40').spend,13);
 assert.equal(result.combined.find(r=>r.group==='wl').spend,16);
 assert.equal(new Set(result.colors).size,5);
 for(const key of ['spend','revenue','lp','purchases','checkouts','leads','linkClicks','impressions','reach']){
  const sum=rows=>rows.reduce((s,r)=>s+r[key],0);
  assert.equal(sum(result.split),sum(result.combined),key);
  assert.equal(sum(result.daily),sum(result.combined),key+' daily');
 }
});
