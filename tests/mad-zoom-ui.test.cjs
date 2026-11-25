'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
for(const version of ['glv-meta-ads','glv-meta-ads-v2'])test(version+' preserves unavailable reach/frequency in reducers, chart values and formatters',()=>{
 const html=fs.readFileSync(require('node:path').join(__dirname,'../public',version,'index.html'),'utf8');
 const slice=(start,end)=>html.slice(html.indexOf(start),html.indexOf(end));
 const ctx=vm.createContext({window:{matchMedia:()=>({matches:true})}});
 vm.runInContext(`const parseNum=x=>Number(x)||0,parseAmt=parseNum;${slice('function processRow(','function processAggregateRows(')}${slice('function aggregate(','function metricForSort(')}${slice('function byDate(','function fmtChartDate(')}${slice('function formatChartVal(','function wholeNumberTickPrecision(')}`,ctx);
 assert.equal(vm.runInContext('processRow({reach:null}).reach',ctx),null);
 assert.equal(vm.runInContext('processRow({reach:0}).reach',ctx),0);
 assert.equal(vm.runInContext('aggregate([processRow({reach:null})]).reach',ctx),null);
 assert.equal(vm.runInContext('calcMetrics(aggregate([processRow({reach:null})])).frequency',ctx),null);
 assert.equal(vm.runInContext("byDate([{...processRow({reach:null}),date:'2026-11-19'}])[0].reach",ctx),null);
 assert.equal(vm.runInContext("byPeriod([{...processRow({reach:null}),date:'2026-11-19'}],null,'week')[0].reach",ctx),null);
 assert.equal(vm.runInContext("computeChartMetric('frequency',{}, {frequency:null})",ctx),null);
 assert.equal(vm.runInContext("formatChartVal('frequency',null)",ctx),'—');
 assert.equal(vm.runInContext("formatChartTick('frequency',null)",ctx),'—');
});
