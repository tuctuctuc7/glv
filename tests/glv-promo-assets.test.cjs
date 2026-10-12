const test = require('node:test');
const assert = require('node:assert/strict');
const { monthlyMix } = require('../public/glv-meta-ads/promo-format.js');

test('source extraction deduplicates placements and excludes thumbnails/text; aliases stay unresolved', () => {
  const {parseCreative} = require('../lib/glv-promo-assets.cjs');
  const result = parseCreative({asset_feed_spec:{images:[{hash:'image-a'},{hash:'image-b'},{hash:'image-a'}],bodies:[{text:'not media'}]},object_story_spec:{video_data:{video_id:'101',image_hash:'thumbnail'}},video_id:'202'}, 'account');
  assert.deepEqual(result.assets.map(a=>a.key).sort(), ['image:account:image-a','image:account:image-b','video:101']);
  assert.equal(result.configured_media_complete,false);
  assert.deepEqual(result.alternate_video_ids_not_counted,['202']);
  assert.equal(parseCreative(null,'account').assets.length,0);
  assert.equal(parseCreative({effective_object_story_id:'page_post'},'account').configured_media_complete,false);
  const carousel = parseCreative({image_hash:'preview',object_story_spec:{link_data:{child_attachments:[{image_hash:'a'},{image_hash:'b'},{image_hash:'a'}]}}},'account');
  assert.deepEqual(carousel.assets.map(a=>a.id),['a','b']);
  assert.equal(carousel.configured_media_complete,true);
});

test('missing story video identity never promotes its thumbnail through validation or month aggregation', () => {
  const {parseCreative}=require('../lib/glv-promo-assets.cjs');
  const inventory=parseCreative({image_hash:'thumb',object_story_spec:{video_data:{image_hash:'thumb'}}},'account');
  const row=fact({asset_inventory:inventory});
  const payload={schema_version:1,classification_version:2,inventory_version:1,reconciled:true,generated_at:'2026-06-12T00:00:00Z',range:{since:'2026-06-01',until:'2026-06-11'},rows:[row]};
  assert.equal(require('../public/glv-meta-ads/promo-format.js').validPayload(payload),true);
  const month=monthlyMix(payload.rows)[0];
  assert.equal(month.formats.Banner.assets,null);
  assert.equal(month.total.assets,null);
  assert.equal(month.total.asset_status,'unavailable');
  assert.equal(month.total.spend,100);
  assert.equal(month.formats.Video.revenue,400);
  assert.deepEqual(inventory.assets,[]);
  assert.equal(inventory.configured_media_complete,false);
  assert.ok(inventory.unknown_reasons.includes('unresolved_media_identity'));
  assert.ok(inventory.unknown_reasons.includes('media_unavailable'));
});

for (const [label,creative] of Object.entries({
  'feed video empty ID':{image_hash:'thumb',asset_feed_spec:{videos:[{video_id:'',image_hash:'thumb'}]}},
  'feed video missing ID':{image_hash:'thumb',asset_feed_spec:{videos:[{image_hash:'thumb'}]}},
  'malformed video feed':{image_hash:'thumb',asset_feed_spec:{videos:{}}},
  'carousel video empty ID':{object_story_spec:{link_data:{child_attachments:[{video_id:'',image_hash:'thumb'}]}}},
  'carousel video missing ID':{object_story_spec:{link_data:{child_attachments:[{video_data:{image_hash:'thumb'},image_hash:'thumb'}]}}},
  'carousel video type':{object_story_spec:{link_data:{child_attachments:[{type:'video',image_hash:'thumb'}]}}},
  'top video empty ID':{video_id:'',image_hash:'thumb'},
  'top video null ID':{video_id:null,image_hash:'thumb'},
  'top video type':{object_type:'VIDEO',image_hash:'thumb'},
  'top video data':{video_data:{image_hash:'thumb'},image_hash:'thumb'},
  'null story video':{object_story_spec:{video_data:null},image_hash:'thumb'},
  'link video hint':{object_story_spec:{link_data:{video_id:'',image_hash:'thumb'}},image_hash:'thumb'},
})) test(`thumbnail context fails closed: ${label}`, () => {
  const inventory=require('../lib/glv-promo-assets.cjs').parseCreative(creative,'account');
  assert.deepEqual(inventory.assets,[]);
  assert.equal(inventory.configured_media_complete,false);
  assert.ok(inventory.unknown_reasons.length);
  const payload={schema_version:1,classification_version:2,inventory_version:1,reconciled:true,generated_at:'2026-06-12T00:00:00Z',range:{since:'2026-06-01',until:'2026-06-11'},rows:[fact({asset_inventory:inventory})]};
  assert.equal(require('../public/glv-meta-ads/promo-format.js').validPayload(payload),true);
  const month=monthlyMix(payload.rows)[0];
  for(const target of [month.total,month.formats.Banner,month.formats.Video]) {
    assert.equal(target.assets,null);
    assert.equal(target.asset_status,'unavailable');
  }
  assert.equal(month.total.spend,100);
});

test('static fallback and explicit mixed-media images survive unresolved video metadata', () => {
  const {parseCreative}=require('../lib/glv-promo-assets.cjs');
  for(const creative of [{image_hash:'static'},{image_hash:'static',asset_feed_spec:{videos:[]}}]) {
    const parsed=parseCreative(creative,'account');
    assert.deepEqual(parsed.assets.map(a=>a.key),['image:account:static']);
    assert.equal(parsed.configured_media_complete,true);
  }
  const parsed=parseCreative({image_hash:'thumb',asset_feed_spec:{images:[{hash:'static'}],videos:[{video_id:''}]},object_story_spec:{link_data:{child_attachments:[{video_id:'',image_hash:'thumb'},{image_hash:'static'}]}}},'account');
  assert.deepEqual(parsed.assets.map(a=>a.key),['image:account:static']);
  const month=monthlyMix([fact({asset_inventory:parsed}),fact({ad_id:'reuse',asset_inventory:parsed})])[0];
  assert.equal(month.formats.Banner.assets,1);
  assert.equal(month.total.assets,1);
  assert.equal(month.total.asset_status,'partial');
  assert.equal(month.formats.Video.spend,200);
});

// Legacy reconciled performance facts intentionally contain no creative inventory.
// Inventory response fixtures must come from the parallel schema investigation;
// do not infer Meta media identity from ad IDs, names, thumbnails, or text.
const fact = (overrides = {}) => ({
  ad_id:'synthetic-ad', ad_name:'Synthetic creative', adset_id:'synthetic-adset',
  adset_name:'Video', campaign_id:'synthetic-campaign',
  campaign_name:'TUC_999_CZSK_Sales_Promo', date:'2026-06-10',
  format:'Video', reason:'current_adset_label',
  spend:100, purchases:2, revenue:400, impressions:50, ...overrides,
});

test('month unions actual media independently of performance classification and retains partial counts', () => {
  const {parseCreative} = require('../lib/glv-promo-assets.cjs');
  const inventory = parseCreative({asset_feed_spec:{images:[{hash:'a'},{hash:'b'}],videos:[{video_id:'101'}]},video_id:'202'},'account');
  const rows = [fact({asset_inventory:inventory}), fact({ad_id:'reuse',date:'2026-06-11',asset_inventory:inventory}),fact({date:'2026-07-01',asset_inventory:inventory})];
  const months = monthlyMix(rows);
  for (const month of months) {
    assert.equal(month.total.assets,3);
    assert.equal(month.total.asset_status,'partial');
    assert.equal(month.formats.Banner.assets,2);
    assert.equal(month.formats.Video.assets,1);
    assert.equal(month.formats.Banner.spend,0);
    assert.equal(month.formats.Video.spend,month.total.spend);
  }
  assert.equal(monthlyMix([fact({asset_inventory:parseCreative({image_hash:'a'},'account')}),fact({ad_id:'missing'})])[0].total.asset_status,'partial');
});

test('inventory contract rejects future revisions and legacy cache cannot smuggle counts', () => {
  const {validPayload} = require('../public/glv-meta-ads/promo-format.js');
  const {sliceCachedFormats} = require('../lib/glv-promo-format.cjs');
  const now=new Date('2026-06-12T00:00:00Z');
  const legacy={schema_version:1,classification_version:2,reconciled:true,range:{since:'2026-06-01',until:'2026-06-11'},generated_at:now.toISOString(),rows:[fact({asset_inventory:require('../lib/glv-promo-assets.cjs').parseCreative({image_hash:'a'},'account')})]};
  assert.equal(validPayload({...legacy,inventory_version:99}),false);
  const migrated=sliceCachedFormats(legacy,legacy.range,now);
  assert.equal(migrated.rows[0].asset_inventory,undefined);
  assert.equal(monthlyMix(migrated.rows)[0].total.assets,null);
});

test('refresh ingests bounded creative inventory and denied metadata never erases performance', async () => {
  const {fetchPromoFormats} = require('../lib/glv-promo-format.cjs');
  for (const denied of [false,true]) {
    let inventoryCalls=0;
    const fetcher=async(url,options)=>{
      assert.ok(options.signal);
      const u=new URL(url),fields=u.searchParams.get('fields')||'';
      let data;
      if (u.pathname.endsWith('/insights')) data={data:[{campaign_id:'campaign',ad_id:'ad',adset_id:'adset',date_start:'2026-06-10',spend:'10',impressions:'1'}]};
      else if (fields.includes('creative{')) {inventoryCalls++; if(denied) throw Error('denied secret'); data={ad:{id:'ad',creative:{image_hash:'image-a'}}};}
      else if(fields.includes('adset_id')) data={ad:{id:'ad',name:'Ad',campaign_id:'campaign',adset_id:'adset'}};
      else if(fields.includes('campaign_id')) data={adset:{id:'adset',name:'Video',campaign_id:'campaign'}};
      else data={campaign:{id:'campaign',name:'TUC_999_CZSK_Sales_Promo'}};
      return {ok:true,json:async()=>data};
    };
    const result=await fetchPromoFormats('test',{since:'2026-06-01',until:'2026-06-11'},fetcher);
    assert.equal(result.inventory_version,1);
    assert.equal(inventoryCalls,1);
    assert.equal(result.rows[0].spend,10);
    assert.equal(monthlyMix(result.rows)[0].formats.Banner.assets,denied?null:1);
    assert.equal(monthlyMix(result.rows)[0].formats.Video.spend,10);
  }
});

test('unsupported and URL-only branches keep known sources partial rather than complete', () => {
  const {parseCreative}=require('../lib/glv-promo-assets.cjs');
  for(const creative of [
    {image_hash:'a',object_story_spec:{link_data:{picture:'https://example.invalid/preview'}}},
    {image_hash:'a',asset_feed_spec:{images:[{url:'https://example.invalid/image'}]}},
    {image_hash:'a',object_story_spec:{template_data:{}}},
    {image_hash:'a',platform_customizations:{instagram:{}}},
    {image_hash:'a',degrees_of_freedom_spec:{creative_features_spec:{}}},
  ]) {
    const value=parseCreative(creative,'account');
    assert.equal(value.assets.length,1);
    assert.equal(value.configured_media_complete,false);
  }
});

test('metadata body stall is bounded and preserves reconciled facts', async () => {
  const {fetchPromoFormats}=require('../lib/glv-promo-format.cjs');
  let calls=0;
  const values=[{data:[{campaign_id:'c',date_start:'2026-06-10',spend:'1'}]},{c:{id:'c',name:'TUC_999_CZSK_Promo'}},{data:[{campaign_id:'c',ad_id:'a',adset_id:'s',date_start:'2026-06-10',spend:'1'}]},{a:{id:'a',name:'a',adset_id:'s',campaign_id:'c'}},{s:{id:'s',name:'Video',campaign_id:'c'}}];
  const fetcher=async()=>{calls++;return {ok:true,json:()=>values.length?Promise.resolve(values.shift()):new Promise(()=>{})};};
  const result=await Promise.race([fetchPromoFormats('test',{since:'2026-06-01',until:'2026-06-11'},fetcher,{timeoutMs:30}),new Promise((_,reject)=>{setTimeout(()=>reject(Error('unbounded metadata body')),300);})]);
  assert.equal(result.rows[0].spend,1);
  assert.equal(monthlyMix(result.rows)[0].total.assets,null);
  assert.equal(calls,6);
});

test('malformed cache and malformed carousel fail closed without throwing', () => {
  const {parseCreative}=require('../lib/glv-promo-assets.cjs');
  assert.equal(parseCreative({object_story_spec:{link_data:{child_attachments:[null,{image_hash:'a'}]}}},'account').configured_media_complete,false);
  assert.equal(parseCreative({image_hash:'preview',object_story_spec:{link_data:{child_attachments:[]}}},'account').configured_media_complete,false);
  assert.equal(require('../lib/glv-promo-format.cjs').sliceCachedFormats({classification_version:2,rows:{}},{}),null);
});

test('empty carousel previews are not source assets and malformed alternate IDs remain unavailable', () => {
  const {parseCreative}=require('../lib/glv-promo-assets.cjs');
  for (const children of [[],null,{},[null]]) {
    const parsed=parseCreative({image_hash:'preview',object_story_spec:{link_data:{child_attachments:children}}},'account');
    assert.equal(parsed.assets.length,0);
    assert.equal(parsed.configured_media_complete,false);
  }
  const parsed=parseCreative({image_hash:'a',video_id:{toString:null,hostile:'<img onerror=alert(1)>'},asset_feed_spec:{images:[{hash:'a'}]}},'account');
  assert.equal(require('../public/glv-meta-ads/promo-format.js').validPayload({schema_version:1,classification_version:2,inventory_version:1,reconciled:true,generated_at:'2026-06-12T00:00:00Z',range:{since:'2026-06-01',until:'2026-06-11'},rows:[fact({asset_inventory:parsed})]}),true);
  assert.equal(parsed.configured_media_complete,false);
  assert.equal(monthlyMix([fact({asset_inventory:parsed})])[0].total.spend,100);
});

test('only delivery-positive ad months add media; carryover metrics remain unchanged', () => {
  const {parseCreative}=require('../lib/glv-promo-assets.cjs');
  const rows=[fact({asset_inventory:parseCreative({image_hash:'a'},'account')}),fact({ad_id:'carryover',spend:0,impressions:0,asset_inventory:parseCreative({image_hash:'b'},'account')})];
  const month=monthlyMix(rows)[0];
  assert.equal(month.total.assets,1);
  assert.equal(month.total.purchases,4);
  assert.equal(month.total.revenue,800);
  assert.equal(month.total.ads,2);
});

test('legacy facts retain performance but cannot claim complete asset counts', () => {
  const rows = [fact(), fact({date:'2026-06-11', spend:0, impressions:0}),
    fact({ad_id:'synthetic-unknown', format:'Unknown', spend:50, purchases:1, revenue:100})];
  const month = monthlyMix(rows)[0];
  assert.deepEqual(
    [month.total.spend, month.total.purchases, month.total.revenue, month.total.roas],
    [150, 5, 900, 6],
  );
  assert.deepEqual(
    [month.formats.Video.spend, month.formats.Video.purchases, month.formats.Video.revenue, month.formats.Video.roas],
    [100, 4, 800, 8],
  );
  assert.equal(month.formats.Unknown.ads, 1, 'Unknown remains an ad-classification diagnostic');
  for (const target of [month.total, month.formats.Banner, month.formats.Video]) {
    assert.equal(target.assets, null, 'missing inventory is unavailable, never an ad count or an invented zero');
  }
});
