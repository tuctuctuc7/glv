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
test('WL presentation splits exclusively and conserves every additive total without mutating raw phases',()=>{
 const ctx=runtime();
 ctx.names=['X_WL_kRiStYnA','X_WL_ACTIONKATE','X_WL_Unknown','X_WL_Kristyna_ActionKate','X_Kristyna','X_Sales','X_WL_Kristyna_Promo'];
 const result=vm.runInContext(`(()=>{
 const rows=names.map((name,i)=>({...emptyAgg('2026-08-10'),id:String(i),name,segment:'czsk',group:promoGroupKey(name),spend:i+1,revenue:(i+1)*11,lp:20+i,purchases:i+2,checkouts:i+4,leads:i,linkClicks:30+i,impressions:100+i,reach:70+i}));
 const before=JSON.stringify(rows),combined=byPromoGroup(rows);
 wlInfluencerBreakdown=true;
 const split=byPromoGroup(rows),daily=byDateGroup(rows);
 return {combined,split,daily,keys:rows.map(promoPresentationKey),unchanged:before===JSON.stringify(rows),colors:activePromoGroups().map(g=>g.color)};
 })()`,ctx);
 assert.deepEqual(Array.from(result.keys),['wl-kristyna','wl-actionkate','wl-other','wl-other','bau','bau','promo']);
 assert.equal(result.unchanged,true);
 assert.equal(new Set(result.colors).size,5);
 for(const key of ['spend','revenue','lp','purchases','checkouts','leads','linkClicks','impressions','reach']){
  const sum=rows=>rows.reduce((s,r)=>s+r[key],0);
  assert.equal(sum(result.split),sum(result.combined),key);
  assert.equal(sum(result.daily),sum(result.combined),key+' daily');
 }
 assert.equal(result.split.find(r=>r.group==='wl-other').spend,7);
});
