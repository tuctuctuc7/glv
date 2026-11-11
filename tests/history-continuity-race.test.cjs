const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const freshness=require('../public/glv-meta-ads-v2/freshness.js');
const range={since:'2026-10-12',until:'2026-11-10'};
function harness(version,source){
 const html=fs.readFileSync(require('node:path').join(__dirname,'../public',version,'index.html'),'utf8');
 const code=html.slice(html.indexOf('async function loadData('),html.indexOf('function resumeUtcDay('));
 const nodes=new Map(); const node=id=>{if(!nodes.has(id))nodes.set(id,{style:{},classList:{add(){}},dataset:{},textContent:''});return nodes.get(id);};
 const calls=[],cache=new Map();let clears=0;
 const c={loadSequence:0,renderedScope:'',sourceErrors:{},lastGoodSources:null,lastGoodSelection:'',lastGoodLabel:'',datePreset:'last_30d',requestedDay:'',aggregateCampaigns:[],dailyCampaigns:[],adCreatives:[],reportCurrency:'CZK',reportAccount:'TUC',
 document:{getElementById:node,querySelector:()=>null},responseCache:{clear(){clears++;cache.clear();}},requestScope(){return {datePreset:c.datePreset};},scopeIdentity:s=>s.datePreset,historySelection:s=>s.datePreset,historyExpected:()=>({range,currency:'CZK',account:'TUC',available:true,custom:false}),MadV2Freshness:freshness,MadV2Dates:{commonCutoff:()=>range.until},
 apiFetch(type,scope){const key=scope.datePreset+type;if(cache.has(key))return cache.get(key);calls.push({type,scope:{...scope}});const p=Promise.resolve().then(()=>source(type,scope,calls.length));cache.set(key,p);return p;},fetchUsdRate:async()=>.04,
 processAggregateRows:x=>x,processDaily:x=>x,processCreatives:x=>x};
 for(const k of ['showAvailableRange','syncLoadingPanels','setStatus','loadPromoFormats','loadPromoConcepts','buildAllFilters','buildTriageFilters','renderKPIs','refreshChart','renderDailyTable','renderCreatives','refreshTriageCharts','renderPromoKPIs','refreshPromoCharts','renderPromoTable','renderLeadgenKPIs','refreshLeadgenCharts','renderLeadgenTable','syncPromoFilterVisibility'])c[k]=()=>{};
 vm.createContext(c);vm.runInContext(code,c);return {c,calls,node,get clears(){return clears;}};
}
function payload(generation,extra={}){return {rows:[{generation}],range,generated_at:'2026-11-11T08:00:00Z',generation_id:generation,complete:true,report_currency:'CZK',account_filter:'TUC',...extra};}
for(const version of ['glv-meta-ads','glv-meta-ads-v2']){
 test(version+' generationless scheduled retained facts must not bypass coherence',async()=>{
  const h=harness(version,()=>Promise.reject(new Error('offline')));
  h.c.lastGoodSources=[payload(undefined),payload(undefined,{generated_at:'2026-11-10T08:00:00Z'}),payload(undefined)];h.c.lastGoodSelection='last_30d';
  await h.c.loadData();assert.equal(h.c.renderedScope,'');assert.equal(h.calls.length,3);
 });
 test(version+' persistent mismatch is bounded and fails closed including ads-only mismatch',async()=>{
  const h=harness(version,type=>payload(type==='ads'?'old':'new'));
  await h.c.loadData();assert.equal(h.calls.length,6);assert.equal(h.clears,1);assert.equal(h.c.aggregateCampaigns.length,0);assert.match(h.node('error').textContent,/Mixed source generations/);
 });
 test(version+' mixed source ranges recover without mixing snapshots',async()=>{
  const h=harness(version,(type,scope,n)=>payload('same',n<=3&&type==='daily'?{range:{since:'2026-10-11',until:'2026-11-09'}}:{}));
  await h.c.loadData();assert.equal(h.calls.length,6);assert.equal(h.c.aggregateCampaigns.length,1);
 });
 test(version+' identity errors never retry',async()=>{
  const h=harness(version,type=>payload('same',type==='ads'?{account_filter:'OTHER'}:{}));
  await h.c.loadData();assert.equal(h.calls.length,3);assert.equal(h.c.aggregateCampaigns.length,0);
 });
 test(version+' newer scope supersedes pending retry while prior facts remain intact',async()=>{
  let release,started;const pending=new Promise(r=>release=r),retryStarted=new Promise(r=>started=r);
  const h=harness(version,async(type,scope,n)=>{
   if(scope.datePreset==='last_30d'&&n>3){started();await pending;}
   return payload(scope.datePreset==='last_7d'?'latest':n<=3&&type==='aggregate'?'old':'new');
  });
  h.c.lastGoodSources=[payload('prior'),payload('prior'),payload('prior')];h.c.lastGoodSelection='last_30d';h.c.aggregateCampaigns=[{generation:'prior'}];
  const first=h.c.loadData();await retryStarted;assert.equal(h.c.aggregateCampaigns[0].generation,'prior');assert.equal(h.c.renderedScope,'last_30d');
  h.c.datePreset='last_7d';await h.c.loadData();release();await first;
  assert.equal(h.c.aggregateCampaigns[0].generation,'latest');assert.equal(h.c.renderedScope,'last_7d');assert.equal(h.calls.length,9);
 });
 test(version+' persistent race preserves coherent visible prior facts',async()=>{
  const h=harness(version,type=>payload(type==='daily'?'old':'new'));
  h.c.lastGoodSources=[payload('prior'),payload('prior'),payload('prior')];h.c.lastGoodSelection='last_30d';h.c.aggregateCampaigns=[{generation:'prior'}];
  await h.c.loadData();assert.equal(h.calls.length,6);assert.equal(h.c.aggregateCampaigns[0].generation,'prior');assert.equal(h.c.renderedScope,'last_30d');assert.match(h.node('error').textContent,/Stale last-good retained/);
 });
 test(version+' generationless co-temporal scheduled fixtures remain valid',async()=>{
  const h=harness(version,()=>payload(undefined));await h.c.loadData();assert.equal(h.calls.length,3);assert.equal(h.c.aggregateCampaigns.length,1);assert.equal(h.c.adCreatives.length,1);
 });
 test(version+' cold publication race retries the whole cached triplet',async()=>{
  const h=harness(version,(type,scope,n)=>payload(n<=3&&type==='aggregate'?'old':'new'));
  await h.c.loadData();assert.equal(h.calls.length,6);assert.equal(h.clears,1);assert.equal(h.c.aggregateCampaigns[0]?.generation,'new');assert.equal(h.c.adCreatives[0]?.generation,'new');
 });
}
