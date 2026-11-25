const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const loadDateRuntime=require('./helpers/mad-browser-runtime.cjs');
const range={since:'2026-10-12',until:'2026-11-10'};
function harness(version,source){
 const html=fs.readFileSync(require('node:path').join(__dirname,'../public',version,'index.html'),'utf8');
 const code=html.slice(html.indexOf('async function loadData('),html.indexOf('function resumeUtcDay('));
 const nodes=new Map(); const node=id=>{if(!nodes.has(id))nodes.set(id,{style:{},classList:{add(){},remove(){},toggle(){}},dataset:{},textContent:''});return nodes.get(id);};
 const calls=[],cache=new Map();let clears=0;
 const c={browserExtract:require('../public/glv-meta-ads/browser-extract.js').create(),extractScope:()=> 'TUC/CZK',extractEpoch:0,loadSequence:0,renderedScope:'',sourceErrors:{},lastGoodSources:null,lastGoodSelection:'',lastGoodLabel:'',datePreset:'last_30d',requestedDay:'',aggregateCampaigns:[],dailyCampaigns:[],adCreatives:[],reportCurrency:'CZK',reportAccount:'TUC',
 document:{getElementById:node,querySelector:()=>null},responseCache:{clear(){clears++;cache.clear();}},requestScope(){return {datePreset:c.datePreset};},scopeIdentity:s=>s.datePreset,historySelection:s=>s.datePreset,historyExpected:()=>({range,currency:'CZK',account:'TUC',available:true,custom:false}),MadPresentation:{namingWarnings:()=>[]},
 apiFetch(type,scope){const key=scope.datePreset+type;if(cache.has(key))return cache.get(key);calls.push({type,scope:{...scope}});const p=Promise.resolve().then(()=>source(type,scope,calls.length));cache.set(key,p);return p;},fetchUsdRate:async()=>.04,
 processAggregateRows:x=>x,processDaily:x=>x,processCreatives:x=>x};
 for(const k of ['showAvailableRange','syncLoadingPanels','setStatus','loadPromoFormats','loadPromoConcepts','buildAllFilters','buildCreativeFilters','buildTriageFilters','renderKPIs','refreshChart','renderDailyTable','renderCreatives','refreshTriageCharts','renderPromoKPIs','refreshPromoCharts','renderPromoTable','renderLeadgenKPIs','refreshLeadgenCharts','renderLeadgenTable','syncPromoFilterVisibility'])c[k]=()=>{};
 vm.createContext(c);loadDateRuntime(html,c);vm.runInContext(code,c);return {c,calls,node,get clears(){return clears;}};
}
function payload(generation,extra={}){return {rows:[{generation,id:'campaign',date_start:range.since,date_stop:range.since}],range,generated_at:'2026-11-11T08:00:00Z',generation_id:generation,complete:true,report_currency:'CZK',account_filter:'TUC',...extra};}
for(const version of ['glv-meta-ads','glv-meta-ads-v2']){
 test(version+' offline refresh keeps retained facts visible with a note, even across generations',async()=>{
  const h=harness(version,()=>Promise.reject(new Error('offline')));
  h.c.lastGoodSources=[payload(undefined),payload(undefined,{generated_at:'2026-11-10T08:00:00Z'}),payload(undefined)];h.c.lastGoodSelection='last_30d';
  await h.c.loadData();await new Promise(r=>setImmediate(r));assert.equal(h.c.renderedScope,'last_30d');assert.equal(h.calls.length,2);
  assert.match(h.node('error').textContent,/Stale last-good retained/);assert.match(h.node('error').textContent,/different times/);
 });
 test(version+' persistent mismatch retries once, then shows the data with a note instead of a blank dashboard',async()=>{
  const h=harness(version,type=>payload(type==='ads'?'old':'new'));
  await h.c.loadData();await new Promise(r=>setImmediate(r));assert.equal(h.calls.length,3);assert.equal(h.clears,0);
  assert.equal(h.c.aggregateCampaigns.length,1);assert.equal(h.c.adCreatives.length,0);assert.equal(h.c.renderedScope,'last_30d');
  assert.match(h.node('error').textContent,/Creative source unavailable/);
 });
 test(version+' mixed source ranges recover without mixing snapshots',async()=>{
  const h=harness(version,(type,scope,n)=>payload('same',n<=2&&type==='daily'?{range:{since:'2026-10-11',until:'2026-11-09'}}:{}));
  await h.c.loadData();await new Promise(r=>setImmediate(r));assert.equal(h.calls.length,5);assert.equal(h.c.aggregateCampaigns.length,1);
 });
 test(version+' identity errors never retry',async()=>{
  const h=harness(version,type=>payload('same',type==='ads'?{account_filter:'OTHER'}:{}));
  await h.c.loadData();await new Promise(r=>setImmediate(r));assert.equal(h.calls.length,3);assert.equal(h.c.aggregateCampaigns.length,1);assert.equal(h.c.adCreatives.length,0);
 });
 test(version+' newer scope supersedes pending retry while prior facts remain intact',async()=>{
  let release,started;const pending=new Promise(r=>release=r),retryStarted=new Promise(r=>started=r);
  const h=harness(version,async(type,scope,n)=>{
   if(scope.datePreset==='last_30d'&&n>2){started();await pending;}
   return payload(scope.datePreset==='last_7d'?'latest':n<=2&&type==='aggregate'?'old':'new');
  });
  h.c.lastGoodSources=[payload('prior'),payload('prior'),payload('prior')];h.c.lastGoodSelection='last_30d';h.c.aggregateCampaigns=[{generation:'prior'}];
  const first=h.c.loadData();await retryStarted;assert.equal(h.c.aggregateCampaigns[0].generation,'prior');assert.equal(h.c.renderedScope,'last_30d');
  h.c.datePreset='last_7d';await h.c.loadData();await new Promise(r=>setImmediate(r));release();await first;
  assert.equal(h.c.aggregateCampaigns[0].generation,'latest');assert.equal(h.c.renderedScope,'last_7d');assert.equal(h.calls.length,7);
 });
 test(version+' persistent race shows the newest facts with a note rather than freezing on old ones',async()=>{
  const h=harness(version,type=>payload(type==='daily'?'old':'new'));
  h.c.lastGoodSources=[payload('prior'),payload('prior'),payload('prior')];h.c.lastGoodSelection='last_30d';h.c.aggregateCampaigns=[{generation:'prior'}];
  await h.c.loadData();await new Promise(r=>setImmediate(r));assert.equal(h.calls.length,5);assert.equal(h.c.aggregateCampaigns[0].generation,'new');assert.equal(h.c.renderedScope,'last_30d');assert.match(h.node('error').textContent,/refreshed at different times/);
 });
 test(version+' generationless co-temporal scheduled fixtures remain valid',async()=>{
  const h=harness(version,()=>payload(undefined));await h.c.loadData();await new Promise(r=>setImmediate(r));assert.equal(h.calls.length,3);assert.equal(h.c.aggregateCampaigns.length,1);assert.equal(h.c.adCreatives.length,1);
 });
 test(version+' cold publication race retries the whole cached triplet',async()=>{
  const h=harness(version,(type,scope,n)=>payload(n<=2&&type==='aggregate'?'old':'new'));
  await h.c.loadData();await new Promise(r=>setImmediate(r));assert.equal(h.calls.length,5);assert.equal(h.clears,1);assert.equal(h.c.aggregateCampaigns[0]?.generation,'new');assert.equal(h.c.adCreatives[0]?.generation,'new');
 });
}

for(const version of ['glv-meta-ads','glv-meta-ads-v2'])test(version+' pending creative detail never gates campaigns or overwrites a newer scope',async()=>{
 let release;const pending=new Promise(r=>release=r);
 const h=harness(version,(type,scope)=>type==='ads'&&scope.datePreset==='last_30d'?pending:payload(scope.datePreset));
 await h.c.loadData();assert.equal(h.c.aggregateCampaigns[0].generation,'last_30d');assert.equal(h.node('loading').style.display,'none');
 h.c.datePreset='last_7d';h.c.browserExtract.clear();await h.c.loadData();await new Promise(r=>setImmediate(r));
 release(payload('last_30d'));await new Promise(r=>setImmediate(r));
 assert.equal(h.c.aggregateCampaigns[0].generation,'last_7d');assert.equal(h.c.adCreatives[0].generation,'last_7d');
});

for(const version of ['glv-meta-ads','glv-meta-ads-v2']){
 test(version+' manual refresh never publishes old creatives with new campaigns',async()=>{
  let release;const pending=new Promise(r=>release=r);
  const h=harness(version,type=>type==='ads'?pending:payload('new'));
  h.c.lastGoodSources=[payload('old'),payload('old'),payload('old')];h.c.lastGoodSelection='last_30d';
  await h.c.loadData({force:true});
  assert.equal(h.c.aggregateCampaigns[0].generation,'new');assert.equal(h.c.adCreatives.length,0);assert.equal(h.c.lastGoodSources[2],null);
  release(payload('new'));await new Promise(r=>setImmediate(r));assert.equal(h.c.adCreatives[0].generation,'new');
 });
 test(version+' creative completion rebuilds creative filters after detail arrives',async()=>{
  const h=harness(version,()=>payload('same')),built=[];h.c.buildCreativeFilters=seg=>built.push([seg,h.c.adCreatives.length]);
  await h.c.loadData();await new Promise(r=>setImmediate(r));assert.deepEqual(built,[['czsk',1],['us',1]]);
 });
 test(version+' superseded detail attaches to its retained extract, never the current view',async()=>{
  let release;const pending=new Promise(r=>release=r),narrow={since:'2026-10-12',until:'2026-10-15'};
  const h=harness(version,type=>type==='ads'?pending:payload('same'));
  h.c.historyExpected=s=>({range:s.datePreset==='last_7d'?narrow:range,currency:'CZK',account:'TUC',available:true,custom:false});
  await h.c.loadData();h.c.datePreset='last_7d';await h.c.loadData();const count=h.calls.length;
  release(payload('same'));await new Promise(r=>setImmediate(r));assert.equal(h.c.adCreatives.length,0);
  h.c.datePreset='last_30d';await h.c.loadData();assert.equal(h.c.adCreatives[0]?.generation,'same');assert.equal(h.calls.length,count);
 });
 test(version+' force refresh fences old deferred detail from memory and UI',async()=>{
  let release;const pending=new Promise(r=>release=r);let fresh=false;
  const h=harness(version,type=>!fresh&&type==='ads'?pending:payload(fresh?'new':'old'));
  await h.c.loadData();fresh=true;await h.c.loadData({force:true});await new Promise(r=>setImmediate(r));
  release(payload('old'));await new Promise(r=>setImmediate(r));
  assert.equal(h.c.lastGoodSources[2].generation_id,'new');assert.equal(h.c.browserExtract.get('TUC/CZK',range)[2].generation_id,'new');
 });
}
