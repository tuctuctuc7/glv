const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname,'../public/glv-meta-ads/index.html'),'utf8');
function runtime() {
  const context = vm.createContext({});
  const slice=(start,end)=>html.slice(html.indexOf(start),html.indexOf(end));
  vm.runInContext(`let campaignMeta={};const CAMPAIGN_COLORS=['#123456'];
    ${slice('const parseAmt','function getCampaignColor')}
    ${slice('function getCampaignColor','function fmt(')}
    ${slice('function extractDate','function fmtDate')}
    ${slice('function processRow','function processCreatives')}
    ${html.match(/const campaignGroupKey=.*;/)[0]}
  `,context);
  return context;
}
test('US advertorials survive aggregate and daily normalization with canonical group identity',()=>{
  const context=runtime();
  const fixture={id:'u2',name:'GLV_202_US_AdVeRtOrIaL_Test',amount_spent:'7000',date_start:'2026-08-10'};
  context.fixture=fixture;
  for(const fn of ['processAggregateRows','processDaily']) {
    const result=vm.runInContext(`${fn}([fixture])`,context);
    assert.equal(result.length,1);
    assert.equal(result[0].group,'advertorial');
    assert.equal(result[0].spend,7000);
    assert.equal(result[0].segment,'us');
  }
  for(const producer of ['fb-data','cron']) {
    const {normalizeCampaign}=require(`../api/glv-meta-ads/${producer}.js`)._test;
    assert.equal(normalizeCampaign({campaign_id:fixture.id,campaign_name:fixture.name,spend:'7000'}).name,fixture.name);
  }
});
test('literal WL_befit_over40 and prefixed campaigns survive live/cache normalization without a rename',()=>{
 const context=runtime();
 for(const name of ['WL_befit_over40','WL_BeFiT_OvEr40_Launch','WL_befit_over40_Promo','GLV_401_CZ_WL_befit_over40','TUC_402_CZ_WL_BEFIT_OVER40']){
  for(const producer of ['fb-data','cron']){
   const {normalizeCampaign}=require(`../api/glv-meta-ads/${producer}.js`)._test;
   context.fixture={...normalizeCampaign({campaign_id:'befit',campaign_name:name,spend:'123',date_start:'2026-10-07'}),date_start:'2026-10-07'};
   for(const fn of ['processAggregateRows','processDaily']){
    const rows=vm.runInContext(`${fn}([fixture])`,context);
    assert.equal(rows.length,1,`${producer}/${fn}: ${name}`);
    assert.equal(rows[0].name,name);
    assert.equal(rows[0].group,name.includes('_Promo')?'promo':'wl');
    assert.equal(rows[0].spend,123);
   }
  }
 }
 for(const name of ['unrelated','befit_over40','wl_befit_over40','WL_Unknown','WL_befit_over400']){
  context.name=name;
  assert.equal(vm.runInContext('isValid(name)',context),false,name+' retains scope');
 }
});
test('CZSK exact marker classifier and US BAU fallback are independent',()=>{
  const context=runtime();
  for(const [name,segment,expected] of [
    ['GLV_1_CZ_Promo_Test','czsk','promo'],['GLV_2_CZ_Kristyna_Test','czsk','bau'],
    ['GLV_7_CZ_WL_Kristyna','czsk','wl'],['GLV_8_CZ_WL_ActionKate','czsk','wl'],
    ['GLV_9_CZ_Sales','czsk','bau'],['GLV_10_CZ_WL_Unknown','czsk','wl'],
    ['GLV_11_CZ_WL_Kristyna_Promo','czsk','promo'],
    ['GLV_3_CZ_Lead_Test','czsk','bau'],['GLV_4_CZ_promo_Test','czsk','bau'],
    ['GLV_5_US_Promo_Test','us','bau'],['GLV_6_US_advertorial_Test','us','advertorial'],
  ]) {
    context.name=name;context.segment=segment;
    assert.equal(vm.runInContext('campaignGroupKey(name,segment)',context),expected);
    context.fixture={id:'fixture',name,amount_spent:'10',date_start:'2026-08-10'};
    for(const fn of ['processAggregateRows','processDaily'])assert.equal(vm.runInContext(`${fn}([fixture])[0].group`,context),expected,`${fn}: ${name}`);
  }
});
