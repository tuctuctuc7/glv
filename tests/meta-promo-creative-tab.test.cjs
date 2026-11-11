const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('public/glv-meta-ads/index.html','utf8');
test('Promo Format Mix belongs exclusively to the independent Creative tab',()=>{
 const panel=html.slice(html.indexOf('id="panel-czsk-promo-creative"'),html.indexOf('<!-- ═══ CZSK LEAD-GEN PANEL'));
 assert.match(panel,/id="promo-format-section"/);
 assert.match(html,/aria-label="CZSK Promo Creative"/);
 assert.doesNotMatch(html.slice(html.indexOf('id="panel-czsk-promo"'),html.indexOf('id="panel-czsk-promo-creative"')),/id="promo-format-section"/);
});
test('Promo group campaign options cannot be expanded by independent Creative history',()=>{
 const fn=html.match(/function buildTabFilters\(tab\)\{[\s\S]*?\n\}/)[0];
 assert.doesNotMatch(fn,/promoFormatPayload/);
});
test('format API always requests rolling history independently of global dates',async()=>{
 const fn=html.slice(html.indexOf('function utcIsoDate('),html.indexOf('function presetRange('))+html.slice(html.indexOf('function historyExpected('),html.indexOf('function historySelection('))+html.slice(html.indexOf('const responseCache='),html.indexOf('function setStatus('));
 for(const customRange of [null,{since:'2026-09-01',until:'2026-09-10'}]){
  let url;const ctx={MadV2Freshness:require('../public/glv-meta-ads-v2/freshness.js'),URLSearchParams,customRange,datePreset:'last_30d',MetaSessionCache:require('../public/glv-meta-ads/session-cache.js'),PromoFormat:{validPayload:()=>true},fetch:async u=>{url=u;return{ok:true,json:async()=>({rows:[],range:customRange||ctx.presetBounds('last_30d'),generated_at:new Date().toISOString()})}}};vm.createContext(ctx);
  for(const asset of ['../public/glv-meta-ads-v2/dates.js','../public/glv-meta-ads/date-policy.js'])vm.runInContext(fs.readFileSync(require.resolve(asset),'utf8'),ctx);
  vm.runInContext(fn,ctx);
  await ctx.apiFetch('promo_formats');assert.equal(new URL(url,'https://test').searchParams.get('date_preset'),'promo_history');assert.equal(new URL(url,'https://test').searchParams.has('time_range'),false);
  await ctx.apiFetch('daily');assert.equal(new URL(url,'https://test').searchParams.get(customRange?'time_range':'date_preset'),customRange?JSON.stringify(customRange):'last_30d');
 }
});
