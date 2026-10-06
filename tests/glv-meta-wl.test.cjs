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
test('befit_over40 is an exclusive WL presentation group with case-insensitive creator detection',()=>{
 const ctx=runtime();
 for(const [name,expected] of [
  ['GLV_401_CZ_WL_befit_over40','wl-befit-over40'],
  ['TUC_402_CZ_WL_BeFiT_OvEr40_Launch','wl-befit-over40'],
  ['GLV_403_CZ_befit_over40','bau'],
  ['GLV_404_CZ_wl_befit_over40','bau'],
  ['GLV_405_CZ_WL_befit_over40_Promo','promo'],
  ['GLV_406_CZ_WL_befit_over40_promo','wl-befit-over40'],
  ['GLV_407_CZ_WL_befit_over40_Kristyna','wl-other'],
  ['GLV_408_CZ_WL_ActionKate_BEFIT_OVER40','wl-other'],
  ['GLV_409_CZ_WL_Kristyna_ActionKate_befit_over40','wl-other'],
 ]){
  ctx.name=name;
  assert.equal(vm.runInContext('wlInfluencerBreakdown=true;promoPresentationKey({name})',ctx),expected,name);
  assert.equal(vm.runInContext('wlInfluencerBreakdown=false;promoPresentationKey({name})',ctx),expected.startsWith('wl-')?'wl':expected,name+' combined');
 }
});
test('WL presentation splits exclusively and conserves every additive total without mutating raw phases',()=>{
 const ctx=runtime();
 ctx.names=['X_WL_kRiStYnA','X_WL_ACTIONKATE','X_WL_Unknown','X_WL_Kristyna_ActionKate','X_Kristyna','X_Sales','X_WL_Kristyna_Promo','WL_befit_over40','GLV_401_CZ_WL_BEFIT_OVER40','GLV_402_CZ_WL_befit_over40_Kristyna','GLV_403_CZ_WL_befit_over40_ActionKate'];
 const result=vm.runInContext(`(()=>{
 const rows=names.map((name,i)=>({...emptyAgg('2026-08-10'),id:String(i),name,segment:'czsk',group:promoGroupKey(name),spend:i+1,revenue:(i+1)*11,lp:20+i,purchases:i+2,checkouts:i+4,leads:i,linkClicks:30+i,impressions:100+i,reach:70+i}));
 const before=JSON.stringify(rows),combined=byPromoGroup(rows);
 wlInfluencerBreakdown=true;
 const split=byPromoGroup(rows),daily=byDateGroup(rows);
 return {combined,split,daily,keys:rows.map(promoPresentationKey),unchanged:before===JSON.stringify(rows),colors:activePromoGroups().map(g=>g.color)};
 })()`,ctx);
 assert.deepEqual(Array.from(result.keys),['wl-kristyna','wl-actionkate','wl-other','wl-other','bau','bau','promo','wl-befit-over40','wl-befit-over40','wl-other','wl-other']);
 assert.equal(result.unchanged,true);
 assert.equal(result.split.find(r=>r.group==='wl-befit-over40').spend,17);
 assert.equal(result.combined.find(r=>r.group==='wl').spend,48);
 assert.equal(new Set(result.colors).size,6);
 for(const key of ['spend','revenue','lp','purchases','checkouts','leads','linkClicks','impressions','reach']){
  const sum=rows=>rows.reduce((s,r)=>s+r[key],0);
  assert.equal(sum(result.split),sum(result.combined),key);
  assert.equal(sum(result.daily),sum(result.combined),key+' daily');
 }
 assert.equal(result.split.find(r=>r.group==='wl-other').spend,28);
});
