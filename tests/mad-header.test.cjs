const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require.resolve('../public/glv-meta-ads/index.html'),'utf8');
const context=vm.createContext({});
const functionSource=name=>{const start=html.indexOf('function '+name+'(');assert.ok(start>=0,name+' exists');const end=html.indexOf('\nfunction ',start+1);return html.slice(start,end);};
test('main source label reports oldest extraction and actual coverage; never labels partial or missing source fresh',()=>{
 vm.runInContext(functionSource('mainSourceLabel'),context);
 const source=stamp=>({status:'fulfilled',value:{generated_at:stamp,range:{since:'2026-10-01',until:'2026-10-31'}}});
 assert.equal(context.mainSourceLabel([source('2026-11-03T02:00:00Z'),source('2026-11-03T00:00:00Z')]),'Source 2026-11-03T00:00:00Z · through 2026-10-31');
 assert.equal(context.mainSourceLabel([source('2026-11-03T00:00:00Z'),{status:'rejected'}]),'Partial sources · refresh unavailable');
 assert.equal(context.mainSourceLabel([{status:'fulfilled',value:{rows:[]}}]),'Source freshness unavailable');
});
test('this month on UTC first day matches shared completed-day producer, not a reversed range',()=>{
 const FakeDate=class extends Date{constructor(value){super(value===undefined?'2026-11-01T00:10:00Z':value)}};
 const c=vm.createContext({Date:FakeDate});
 for(const name of ['utcIsoDate','utcMonthStart','utcMonthEnd','shiftIsoDate','presetLabel','presetBounds'])vm.runInContext(functionSource(name),c);
 assert.equal(JSON.stringify(c.presetBounds('this_month')),JSON.stringify({since:'2026-10-01',until:'2026-10-31'}));
});
