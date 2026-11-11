'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const dates=require('../public/glv-meta-ads-v2/dates.js'),fresh=require('../public/glv-meta-ads-v2/freshness.js');
function consumer(time){const html=fs.readFileSync(require.resolve('../public/glv-meta-ads/index.html'),'utf8');class Clock extends Date{constructor(...a){super(...(a.length?a:[time]));}static now(){return +new Date(time);}}
 const c=vm.createContext({Date:Clock,MadV2Dates:dates,MadV2Freshness:fresh});
 const policy=require('node:path').join(__dirname,'../public/glv-meta-ads/date-policy.js');if(fs.existsSync(policy))vm.runInContext(fs.readFileSync(policy,'utf8'),c);
 vm.runInContext(html.slice(html.indexOf('function utcIsoDate('),html.indexOf('function presetRange('))+html.slice(html.indexOf('function historyExpected('),html.indexOf('function historySelection(')),c);return c;}
test('V1 validates declared shared response against common cutoff, not UTC yesterday',()=>{
 const c=consumer('2026-11-11T01:00:00Z');const payload={shared_generation_id:'a'.repeat(64),generation_id:'a'.repeat(64),rows:[],range:{since:'2026-11-03',until:'2026-11-09'},requested_range:{since:'2026-11-03',until:'2026-11-09'},generated_at:'2026-11-11T00:00:00Z'};
 const expected=c.historyExpected({datePreset:'last_7d'},payload);assert.doesNotThrow(()=>fresh.validate(payload,{...expected,now:+new Date('2026-11-11T01:00:00Z')}));
 assert.throws(()=>fresh.validate({...payload,requested_range:{since:'2026-11-02',until:'2026-11-08'}},{...expected,now:+new Date('2026-11-11T01:00:00Z')}),/Incompatible requested range/);
});
test('shared custom policy accepts historical 90 days and rejects 91/future in both consumers',()=>{const c=consumer('2026-11-11T01:00:00Z');for(const v2 of [false,true]){c.MadDatePolicy.accept({shared_generation_id:'a'.repeat(64)});assert.equal(c.MadDatePolicy.customError({since:'2026-01-01',until:'2026-03-31'},v2),'');assert.match(c.MadDatePolicy.customError({since:'2026-01-01',until:'2026-04-01'},v2),/90 completed/);assert.match(c.MadDatePolicy.customError({since:'2026-11-09',until:'2026-11-10'},v2),/90 completed/);}});
test('undeclared V1 remains legacy UTC and explicit historical selection is exact',()=>{const c=consumer('2026-11-11T01:00:00Z');assert.equal(c.presetBounds('last_7d').until,'2026-11-10');const range={since:'2026-01-01',until:'2026-03-31'};assert.equal(JSON.stringify(c.historyExpected({customRange:range},{shared_generation_id:'a'.repeat(64)}).range),JSON.stringify(range));});
