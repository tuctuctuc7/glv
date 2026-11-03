const test=require('node:test');
const assert=require('node:assert/strict');
const wl=require('../public/glv-meta-ads/wl-report.js');
const ad=(campaign,adset)=>({campaign_name:campaign,adset_name:adset,name:'PAC462_ActionKate',amount_spent:'10','action_values:omni_purchase':'30','actions:omni_purchase':'2'});
test('global creator hierarchy: campaign first, only absent campaign creator permits adset fallback',()=>{
 const rows=wl.normalize([ad('GLV_035_CZ_WL','Set_Kristyna'),ad('GLV_035_CZ_WL','Set_ActionKate'),ad('GLV_001_CZ_WL_Kristyna','Set_ActionKate'),ad('GLV_001_CZ_WL_Kristyna_ActionKate','Set_Kristyna'),ad('GLV_035_CZ_WL','Set_Unknown'),ad('GLV_035_CZ_WL','Set_Kristyna_ActionKate')]);
 assert.deepEqual(rows.map(r=>r.creator),['Kristyna','ActionKate','Kristyna',null,null,null]);
 const report=wl.report(rows);assert.equal(report.total.actual,60);assert.equal(report.total.reported,50);assert.equal(report.total.revenue,180);assert.equal(report.total.purchases,12);
 assert.ok(report.issues.some(n=>n.includes('Set_Unknown')));
});
test('mixed WL campaign gets reconciled child facts, never duplicate parent totals or reach',()=>{
 const {attachCreatorFacts}=require('../lib/glv-wl-creators.cjs');
 const parent={id:'35',name:'GLV_035_CZ_WL',amount_spent:'30',impressions:'300',reach:'150'};
 const children=[{...parent,adset_id:'k',adset_name:'Set_Kristyna',amount_spent:'10',impressions:'100',reach:'80'},{...parent,adset_id:'a',adset_name:'Set_ActionKate',amount_spent:'20',impressions:'200',reach:'100'}];
 const result=attachCreatorFacts([parent],children);
 assert.equal(result.length,1);assert.equal(result[0].reach,'150');assert.equal(result[0].amount_spent,'30');
 assert.deepEqual(result[0].creator_rows.map(r=>r.adset_id),['k','a']);
 const mismatch=attachCreatorFacts([parent],[children[0]]);
 assert.equal(mismatch[0].creator_rows.length,0);assert.match(mismatch[0].creator_issue,/reconcile/);assert.equal(mismatch[0].amount_spent,'30');
});
test('Promo consumes mixed adsets while all unsplit tabs retain original campaign facts',()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 const html=fs.readFileSync(require('node:path').join(__dirname,'../public/glv-meta-ads/index.html'),'utf8');
 const slice=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b));
 const ctx=vm.createContext({GlvWlReport:wl});
 vm.runInContext(`let wlInfluencerBreakdown=true;${slice('const PROMO_GROUPS','function getCampaignColor')}${slice('function aggregate(','function calcMetrics')}${slice('function byPromoGroup','function byDate(rows')}`,ctx);
 const result=vm.runInContext(`(()=>{const row={...emptyAgg(),id:'35',name:'GLV_035_CZ_WL',segment:'czsk',group:'wl',spend:30,reach:150,creatorRows:[{...emptyAgg(),name:'GLV_035_CZ_WL',segment:'czsk',group:'wl',adsetName:'Set_Kristyna',spend:10,reach:80},{...emptyAgg(),name:'GLV_035_CZ_WL',segment:'czsk',group:'wl',adsetName:'Set_ActionKate',spend:20,reach:100}]};return {issues:getWlNamingIssues([row]),split:byPromoGroup([row]),parent:row};})()`,ctx);
 assert.equal(result.issues.length,0);
 assert.equal(result.split.find(r=>r.group==='wl-kristyna').spend,10);
 assert.equal(result.split.find(r=>r.group==='wl-actionkate').spend,20);
 assert.equal(result.parent.reach,150);
});
test('preset refresh reads back every exact cache key and fails on mismatched readback',async()=>{
 const cron=require('../api/glv-meta-ads/cron.js')._test,old={...process.env};
 Object.assign(process.env,{KV_REST_API_URL:'https://redis.test',KV_REST_API_TOKEN:'synthetic'});delete process.env.UPSTASH_REDIS_REST_URL;delete process.env.UPSTASH_REDIS_REST_TOKEN;
 const values=new Map();let mismatch=false;
 const fetcher=async(url,opts={})=>{
  let result;if(opts.body){const [op,key,value]=JSON.parse(opts.body);if(op==='SET'){values.set(key,value);result='OK';}else if(op==='GET')result=mismatch?'{}':values.get(key);return {ok:true,json:async()=>({result})};}
  return {ok:true,json:async()=>({data:[]})};
 };
 try{const good=await cron.fetchAndCache('synthetic','last_month',false,fetcher);assert.deepEqual(good.errors,[]);for(const type of ['aggregate','daily','ads'])assert.equal(good.stats[type].readback_verified,true);mismatch=true;const bad=await cron.fetchAndCache('synthetic','last_month',false,fetcher);assert.equal(bad.errors.length,3);}finally{process.env=old;}
});
test('both live and cron ad producers preserve adset identity and invalidate old caches',()=>{
 const live=require('../api/glv-meta-ads/fb-data.js')._test;
 const cron=require('../api/glv-meta-ads/cron.js')._test;
 for(const producer of [live,cron]){
  const row=producer.normalizeAd({ad_id:'a',campaign_name:'GLV_035_CZ_WL',adset_id:'s',adset_name:'Set_Kristyna'},{});
  assert.equal(row.adset_id,'s');assert.equal(row.adset_name,'Set_Kristyna');
 }
 assert.equal(live.cachedPayloadUsable('ads',{rows:[]}),false);
 assert.equal(live.cachedPayloadUsable('aggregate',{rows:[]}),false);
});
