const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const model=require('../public/glv-meta-ads/wl-report.js');
// Minimal DOM seam; execute the actual UI load/resume handlers with a controlled clock.
function harness(){
 let now=Date.parse('2026-11-02T08:00:00Z'),generated='2026-11-01T07:30:00Z',calls=0;
 const nodes=new Map(),events={};
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'__all',innerHTML:'',textContent:'',hidden:false,addEventListener(){},classList:{contains:()=>true}});return nodes.get(id);};
 node('wl-date').value='last_month';
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const window={GlvWlReport:model,addEventListener:(name,fn)=>events[name]=fn};
 vm.runInNewContext(['../public/glv-meta-ads-v2/dates.js','../public/glv-meta-ads/date-policy.js','../public/glv-meta-ads-v2/freshness.js','../public/glv-meta-ads/wl-report-ui.js'].map(asset=>fs.readFileSync(require.resolve(asset),'utf8')).join('\n'),{
  window,document:{getElementById:node,visibilityState:'visible',addEventListener:(name,fn)=>events[name]=fn},
  Date:Clock,Intl,AbortController,URLSearchParams,setTimeout,clearTimeout,setInterval:fn=>events.interval=fn,
  fetch:async()=>{calls++;return {ok:true,json:async()=>({wl_version:3,rows:[],range:model.lastMonth(new Date(now)),generated_at:generated})};}
 });
 return {load:window.GlvWlUI.load,node,events,get calls(){return calls;},advance:ms=>now+=ms,stamp:s=>generated=s};
}
test('same Prague day reuse expires by source age, not browser load time',async()=>{
 const h=harness();await h.load();assert.equal(h.calls,1);assert.match(h.node('wl-status').textContent,/Source refreshed/);
 await h.load();assert.equal(h.calls,1);
 h.advance(31*60*1000);h.stamp('2026-11-02T08:31:00Z');
 h.events.focus();await new Promise(setImmediate);
 assert.equal(h.calls,2,'focus must refetch a source older than 25h on the same Prague day');
 await h.load();assert.equal(h.calls,2);
});
test('expired valid history renders with its source and explicit stale disclosure',async()=>{
 const h=harness();h.stamp('2026-11-01T06:59:59Z');await h.load();
 assert.match(h.node('wl-status').textContent,/Source refreshed/);
 assert.match(h.node('wl-status').textContent,/Stale last-good.*actual range 2026-10-01 → 2026-10-31.*2026-11-01T06:59:59Z/);
 await h.load();assert.equal(h.calls,2,'stale available history does not suppress recovery');
});
test('future and invalid response timestamps never render results',async()=>{
 for(const stamp of ['2026-11-02T08:00:01Z','invalid',null]){
  const h=harness();h.stamp(stamp);await h.load();
  assert.match(h.node('wl-status').innerHTML,/WL data unavailable/,String(stamp));
  assert.equal(h.node('wl-results').innerHTML,'');
  await h.load();assert.equal(h.calls,2,'invalid source must not be cached');
 }
});
