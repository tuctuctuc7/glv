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
test('CZSK exact marker classifier and US BAU fallback are independent',()=>{
  const context=runtime();
  for(const [name,segment,expected] of [
    ['GLV_1_CZ_Promo_Test','czsk','promo'],['GLV_2_CZ_Kristyna_Test','czsk','wl'],
    ['GLV_3_CZ_Lead_Test','czsk','bau'],['GLV_4_CZ_promo_Test','czsk','bau'],
    ['GLV_5_US_Promo_Test','us','bau'],['GLV_6_US_advertorial_Test','us','advertorial'],
  ]) {
    context.name=name;context.segment=segment;
    assert.equal(vm.runInContext('campaignGroupKey(name,segment)',context),expected);
  }
});
