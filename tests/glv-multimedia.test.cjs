const test=require('node:test'),assert=require('node:assert/strict');
const {parseCreative,CREATIVE_FIELDS}=require('../lib/glv-promo-assets.cjs');
const {monthlyMix}=require('../public/glv-meta-ads/promo-format.js');

test('synthetic multi-media reuse reproduces 76 images and 19 videos without inflating repeated ads',()=>{
  const rows=[];
  const add=(creative,format)=>rows.push({ad_id:`synthetic-${rows.length}`,date:'2026-10-01',format,spend:1,impressions:1,purchases:1,revenue:2,asset_inventory:parseCreative(creative,'synthetic-account')});
  for(const [i,count] of [8,5,5,6,4,7,5,5,6,8,5,4,8].entries()) {
    const images=Array.from({length:count},(_,j)=>({hash:`synthetic-image-${i}-${j}`}));
    const creative={media_sourcing_spec:{images},object_story_spec:{link_data:{image_hash:images[0].hash}}};
    add(creative,'Banner');
    if([5,7,8,9,10,12].includes(i)) add(creative,'Banner');
  }
  for(const [i,count] of [6,4,4,5].entries()) {
    const videos=Array.from({length:count},(_,j)=>({video_id:`synthetic-video-${i}-${j}`}));
    const creative={media_sourcing_spec:{videos},object_story_spec:{video_data:{video_id:videos[0].video_id,image_hash:'thumbnail'}},video_id:`synthetic-alias-${i}`};
    add(creative,'Video');
    if(i===3) {add({...creative,media_sourcing_spec:{videos:videos.slice(0,2)}},'Video');add({...creative,media_sourcing_spec:{videos:videos.slice(0,2)}},'Video');}
  }
  assert.equal(rows.length,25);
  const month=monthlyMix([...rows,...rows.map(r=>({...r,date:'2026-10-02'}))])[0];
  assert.deepEqual([month.formats.Banner.assets,month.formats.Video.assets,month.total.assets],[76,19,95]);
  assert.equal(month.total.asset_status,'partial');
  assert.equal(month.total.spend,50);
  assert.equal(month.total.revenue,100);
});

test('cron inventory publication reads back exact revision and content before success',async()=>{
  const {refreshPromoFormatCache}=require('../api/glv-meta-ads/cron.js')._test;
  const original={...process.env};
  process.env.KV_REST_API_URL='https://redis.test';process.env.KV_REST_API_TOKEN='test';
  delete process.env.UPSTASH_REDIS_REST_URL;delete process.env.UPSTASH_REDIS_REST_TOKEN;
  try {
    for(const stale of [false,true]) {
      let written,read=false;
      const fetcher=async(url,options={})=>{
        let data={data:[]};
        if(url==='https://redis.test') {
          const command=JSON.parse(options.body);
          if(command[0]==='SET'){written=command[2];data={result:'OK'};}
          else {assert.equal(command[0],'GET');read=Boolean(written);data={result:written?(stale?JSON.stringify({...JSON.parse(written),inventory_version:1}):written):null};}
        }
        return {ok:true,json:async()=>data};
      };
      if(stale) await assert.rejects(()=>refreshPromoFormatCache('test',false,fetcher),/readback/);
      else {const summary=await refreshPromoFormatCache('test',false,fetcher);assert.equal(summary.inventory_version,2);assert.equal(summary.readback_verified,true);}
      assert.equal(read,true);
    }
  } finally {process.env=original;}
});

test('obsolete normalized inventories cannot remain current in browser or server cache',()=>{
  const {validPayload}=require('../public/glv-meta-ads/promo-format.js');
  const {sliceCachedFormats}=require('../lib/glv-promo-format.cjs');
  const row={ad_id:'ad',ad_name:'CC01',adset_id:'set',adset_name:'Banner',campaign_id:'campaign',campaign_name:'TUC_999_CZSK_Promo',reason:'current_adset_label',date:'2026-10-01',format:'Banner',spend:1,impressions:1,purchases:0,revenue:0,asset_inventory:{...parseCreative({image_hash:'a'},'account'),version:1}};
  const old={schema_version:1,classification_version:2,inventory_version:1,reconciled:true,range:{since:'2026-10-01',until:'2026-10-14'},generated_at:'2026-10-15T00:00:00Z',rows:[row]};
  assert.equal(validPayload(old),false);
  assert.equal(sliceCachedFormats(old,old.range,new Date(old.generated_at)),null);
  assert.equal(monthlyMix(old.rows)[0].total.assets,null);
  const current={...old,inventory_version:2,rows:[{...row,asset_inventory:parseCreative({image_hash:'a'},'account')}]};
  assert.equal(current.rows[0].asset_inventory.version,2);
  assert.equal(validPayload(current),true);
  assert.equal(sliceCachedFormats(current,current.range,new Date(old.generated_at)).rows[0].spend,1);
});

test('malformed multi-media keeps known sources partial and never promotes video thumbnails',()=>{
  for(const media of [null,[],42,'invalid',{images:{}},{images:[null,{hash:{toString:null}}]},{videos:[{}]}]) {
    const value=parseCreative({media_sourcing_spec:media,object_story_spec:{link_data:{image_hash:'known'}}},'account');
    assert.equal(value.configured_media_complete,false,JSON.stringify(media));
    assert.deepEqual(value.assets.map(a=>a.id),['known']);
  }
  for(const videos of [[{}],[{video_id:''}],{},null]) {
    const value=parseCreative({image_hash:'thumbnail',media_sourcing_spec:{videos}},'account');
    assert.equal(value.assets.length,0);
    assert.equal(value.configured_media_complete,false);
  }
  assert.equal(parseCreative({image_hash:'static'},'account').configured_media_complete,true);
  const mixed=parseCreative({image_hash:'thumbnail',media_sourcing_spec:{images:[{hash:'static'}],videos:[{}]}},'account');
  assert.deepEqual(mixed.assets.map(a=>a.id),['static']);
});

test('multi-media configured sources union with primary/feed references, not aliases or thumbnails',()=>{
  const creative={media_sourcing_spec:{images:[{hash:'a'},{hash:'b'}],videos:[{video_id:'v',original_video_id:'v',image_hash:'thumb'}]},object_story_spec:{link_data:{image_hash:'a'}},asset_feed_spec:{images:[{hash:'b'}]},video_id:'alias'};
  const value=parseCreative(creative,'account');
  assert.deepEqual(value.assets.map(a=>a.key).sort(),['image:account:a','image:account:b','video:v']);
  assert.match(CREATIVE_FIELDS,/media_sourcing_spec/);
  assert.deepEqual(value.alternate_video_ids_not_counted,['alias']);
  assert.equal(value.configured_media_complete,false);
  assert.ok(value.assets.find(a=>a.id==='a').source_paths.includes('media_sourcing_spec.images.hash'));
  const row={date:'2026-10-01',ad_id:'one',format:'Banner',spend:1,impressions:1,purchases:2,revenue:3,asset_inventory:value};
  const month=monthlyMix([row,{...row,ad_id:'two'}])[0];
  assert.deepEqual([month.formats.Banner.assets,month.formats.Video.assets,month.total.assets],[2,1,3]);
  assert.equal(month.total.asset_status,'partial');
  assert.equal(month.total.revenue,6);
});
