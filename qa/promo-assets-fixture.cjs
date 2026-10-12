// Offline validation only. Private source fixture stays outside the repository.
// Optional browser payload uses synthetic performance values, NOT observed spend.
const fs=require('node:fs'), assert=require('node:assert/strict');
const {parseCreative}=require('../lib/glv-promo-assets.cjs');
const {monthlyMix,validPayload}=require('../public/glv-meta-ads/promo-format.js');
const input=process.argv[2];
if(!input) throw Error('Usage: node qa/promo-assets-fixture.cjs /private/implementation-fixture.json [private-browser-payload.json]');
const fixture=JSON.parse(fs.readFileSync(input,'utf8'));
const inventory=new Map();
const ids=value=>value.assets.map(a=>`${a.kind}:${a.id}`).sort();
for(const ad of fixture.ads){
  const parsed=parseCreative(ad.creative,'private-fixture-account');
  assert.deepEqual(ids(parsed),ids(ad.expected));
  assert.deepEqual(parsed.alternate_video_ids_not_counted,ad.expected.alternate_video_ids_not_counted);
  assert.equal(parsed.configured_media_complete,ad.expected.configured_media_complete);
  inventory.set(ad.ad_id,parsed);
}
assert.equal(inventory.size,fixture.summary.inventory.ads);
const rows=fixture.monthly_presence.filter(r=>r.delivery_positive).map(r=>({
  ad_id:r.ad_id,ad_name:'Private fixture media — synthetic performance',adset_id:'synthetic',adset_name:'Video',
  campaign_id:'synthetic',campaign_name:'TUC_999_CZSK_Sales_Promo',date:r.month+'-01',
  format:'Video',reason:'synthetic_performance_classification',spend:1,purchases:1,revenue:1,impressions:1,
  asset_inventory:inventory.get(r.ad_id),
}));
const months=monthlyMix(rows);
for(const month of months){
  const expected=fixture.summary.months.find(m=>m.month===month.month).delivery_positive_ads;
  assert.deepEqual([month.total.ads,month.formats.Banner.assets,month.formats.Video.assets,month.total.assets],[expected.ads,expected.images,expected.videos,expected.assets]);
  assert.equal(month.total.asset_status,expected.unresolved_ads?'partial':'configured');
}
// Explicit live multiasset cases, without storing client IDs in the repository.
const marchImages=new Set(rows.filter(r=>r.date.startsWith('2026-03')).flatMap(r=>r.asset_inventory.assets.filter(a=>a.kind==='image').map(a=>a.key)));
assert.equal(marchImages.size,20);
const carousels=fixture.ads.filter(a=>a.creative.object_story_spec?.link_data?.child_attachments?.length===6);
assert.ok(carousels.length>=2);
const reused=carousels.filter(a=>a.creative.id===carousels[0].creative.id);
assert.ok(reused.length>=2);
assert.equal(new Set(reused.flatMap(a=>inventory.get(a.ad_id).assets.map(a=>a.key))).size,6);
const payload={schema_version:1,classification_version:2,inventory_version:1,reconciled:true,generated_at:fixture.summary.generated_at,range:fixture.summary.range,rows};
assert.equal(validPayload(payload),true);
if(process.argv[3]) fs.writeFileSync(process.argv[3],JSON.stringify(payload),{mode:0o600});
console.log(JSON.stringify({verifiedAds:inventory.size,monthlyRows:rows.length,months:months.map(m=>({month:m.month,images:m.formats.Banner.assets,videos:m.formats.Video.assets,known:m.total.assets,status:m.total.asset_status})),performance:'synthetic QA only; not live performance evidence'},null,2));
