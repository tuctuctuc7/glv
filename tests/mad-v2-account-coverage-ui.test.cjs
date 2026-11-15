'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const dates=require('../public/glv-meta-ads-v2/dates.js'),F=require('../public/glv-meta-ads-v2/freshness.js');
const early=Date.parse('2026-11-15T00:30:00Z'),late=Date.parse('2026-11-15T09:00:00Z');
const range={since:'2026-11-08',until:'2026-11-14'};
const ids=dates.ACCOUNTS.map(a=>a.id);
function payload(now=early,account='All') {return {rows:[{account_id:ids[0],date:'2026-11-14',amount_spent:25}],complete:true,range,requested_range:range,cached_range:range,report_currency:'USD',account_filter:account,generated_at:new Date(now).toISOString(),generation_id:'bundle-1',date_policy:'account-isolated',account_coverage:ids.filter((id,i)=>account==='All'||dates.ACCOUNTS[i].label===account).map((account_id,i)=>({account_id,range:{...range},complete_through:i===0||now===late?range.until:'2026-11-13',partial:i!==0&&now!==late,generated_at:new Date(now).toISOString()}))};}
const expected=(now=early,account='All')=>({range,currency:'USD',account,now});
const fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../public/glv-meta-ads-v2/index.html'),'utf8');
test('missing market day renders a chart gap rather than a manufactured zero',()=>{
 const fn=html.match(/function refreshTrendsChart\(\)\{[\s\S]*?\n\}/)[0];
 const c={document:{getElementById:()=>({value:'spend',getContext:()=>({})})},byDate:r=>r,getSegmentRows:s=>s==='czsk'?[{date:'2026-11-14',spend:25}]:[{date:'2026-11-13',spend:0}],fmtDate:x=>x,calcMetrics:r=>r,computeChartMetric:(k,r)=>r[k],charts:{},Chart:function(ctx,config){this.data=config.data;},sortLegendByAxis(){},wholeNumberTickPrecision(){}};
 vm.createContext(c);vm.runInContext(fn+';refreshTrendsChart()',c);
 assert.deepEqual(Array.from(c.charts.trends.data.datasets[1].data),[0,null]);
});
test('actual V2 loadData renders TUC-only, combined partial, and late complete facts',async()=>{
 for(const [now,account] of [[early,'TUC'],[early,'All'],[late,'All']]){
  const p=payload(now,account),nodes=new Map();
  const node=id=>{if(!nodes.has(id))nodes.set(id,{style:{},classList:{add(){},toggle(){}},textContent:''});return nodes.get(id);};
  const c={Date:class extends Date{static now(){return now;}},loadSequence:0,renderedScope:'',lastGoodSources:null,lastGoodSelection:'',lastGoodLabel:'',requestedDay:'',sourceErrors:{},reportCurrency:'USD',reportAccount:account,document:{getElementById:node,querySelector:()=>null},responseCache:{clear(){}},requestScope:()=>({datePreset:'last_7d'}),scopeIdentity:()=>account,historySelection:()=>account,historyExpected:()=>expected(now,account),MadV2Freshness:F,MadV2Dates:dates,MadPresentation:{namingWarnings:()=>[]},apiFetch:async()=>p,fetchUsdRate:async()=>.04,processAggregateRows:x=>x,processDaily:x=>x,processCreatives:x=>x};
  for(const k of ['showAvailableRange','syncLoadingPanels','setStatus','loadPromoFormats','loadPromoConcepts','buildAllFilters','buildTriageFilters','renderKPIs','refreshChart','renderDailyTable','renderCreatives','refreshTriageCharts','renderPromoKPIs','refreshPromoCharts','renderPromoTable','renderLeadgenKPIs','refreshLeadgenCharts','renderLeadgenTable','syncPromoFilterVisibility'])c[k]=()=>{};
  vm.createContext(c);vm.runInContext(html.slice(html.indexOf('async function loadData('),html.indexOf('function resumeUtcDay(')),c);
  await c.loadData();assert.equal(c.renderedScope,account);assert.equal(c.dailyCampaigns[0].amount_spent,25);assert.equal(node('loading').style.display,'none');
  if(account==='All'&&now===early)assert.match(node('error').textContent,/TGLV: partial/);else assert.equal(node('error').style.display,'none');
 }
});
test('Prague yesterday is visible before and after LA midnight including DST and month boundary',()=>{
 for(const instant of [early,late])assert.deepEqual(dates.rangeFor('last_7d',new Date(instant)),range);
 for(const [instant,until] of [['2026-03-29T06:30:00Z','2026-03-28'],['2026-11-02T07:30:00Z','2026-11-01'],['2026-11-01T00:30:00Z','2026-10-31']])assert.equal(dates.commonCutoff(new Date(instant)),until);
 assert.deepEqual(dates.rangeFor('last_month',new Date(early)),{since:'2026-10-01',until:'2026-10-31'});
});
test('real validator exposes TUC yesterday and partial combined coverage without changing facts',()=>{
 const p=payload(),before=JSON.stringify(p),s=F.bundle([p,p,p],expected());
 assert.equal(s.stale,true);assert.match(s.warning,/TGLV.*partial.*2026-11-14/i);assert.match(s.warning,/2026-11-13/);
 assert.equal(JSON.stringify(p),before);assert.deepEqual(s.range,range);
 const tuc=payload(early,'TUC');assert.equal(F.validate(tuc,expected(early,'TUC')).warning,'');
 assert.equal(F.validate({...p,account_filter:'TUC'},expected(early,'TUC')).warning,'','full publication metadata must not make TUC-only partial');
 const complete=payload(late);assert.equal(F.bundle([complete,complete],expected(late)).warning,'');
});
test('account-isolated bundles never accept mixed generations or ranges even after retry/custom',()=>{
 const p=payload();
 assert.throws(()=>F.validate({...p,generation_id:undefined},expected()),/generation/i);
 for(const custom of [false,true]){
  for(const change of [{generation_id:'other'},{range:{since:'2026-11-07',until:'2026-11-14'},cached_range:{since:'2026-11-07',until:'2026-11-14'}}])assert.throws(()=>F.bundle([p,{...p,...change}],{...expected(),custom}),/Mixed source/);
 }
 const q=structuredClone(p);q.account_coverage[1].range.until='2026-11-13';
 assert.throws(()=>F.bundle([p,q],expected()),/Mixed source/);
});
test('missing account remains visible, retained history and scope switches stay truthful',()=>{
 const p=payload();p.account_coverage[1]={account_id:ids[1],range:null,complete_through:null,partial:true,generated_at:null};
 assert.match(F.validate(p,expected()).warning,/TGLV: missing coverage/);
 for(const scope of [{account:'TUC'},{currency:'CZK'},{range:{since:'2026-10-01',until:'2026-10-31'}}])assert.throws(()=>F.validate(p,{...expected(),...scope}),/scope|range/);
 const tomorrow={since:'2026-11-09',until:'2026-11-15'};
 const retained=F.validate({...p,requested_range:tomorrow},{...expected(late),range:tomorrow});
 assert.deepEqual(retained.range,range);assert.match(retained.warning,/later days not refreshed/);
});
test('account coverage rejects missing identity, malformed dates, future stamps and false completeness',()=>{
 for(const mutate of [p=>p.account_coverage.pop(),p=>p.account_coverage.push(p.account_coverage[0]),p=>p.account_coverage[1].account_id='unknown',p=>p.account_coverage[1].generated_at='2027-01-01',p=>p.account_coverage[1].range.until='bad',p=>p.account_coverage[1].partial=false,p=>p.account_coverage[1].complete_through='2026-11-15']){
  const p=payload();mutate(p);assert.throws(()=>F.validate(p,expected()),/coverage/i);
 }
});
