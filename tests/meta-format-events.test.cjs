const test=require('node:test');
const assert=require('node:assert/strict');
const {promoMix,monthlyMix}=require('../public/glv-meta-ads/promo-format.js');
test('percentage annotations fit the actual bar width',()=>{
  const fs=require('node:fs'),vm=require('node:vm');
  const source=fs.readFileSync('public/glv-meta-ads/promo-format-ui.js','utf8');
  const code=source.slice(source.indexOf('const percentLabels='),source.indexOf('for(const [key,metric,title]'));
  const plugin=vm.runInNewContext(code+';percentLabels',{percent:n=>n.toFixed(1)+'%'});
  const drawn=[];
  const ctx={save(){},restore(){},measureText:s=>({width:s.length*7}),fillText:s=>drawn.push(s)};
  plugin.afterDatasetsDraw({ctx,data:{datasets:[{data:[100,25]}]},isDatasetVisible:()=>true,getDatasetMeta:()=>({data:[{width:31,base:100,y:0,x:0},{width:64,base:100,y:0,x:0}]})});
  assert.deepEqual(drawn,['25.0%']);
});
const fact=(date,overrides={})=>({date,ad_id:'synthetic-ad',campaign_name:'TUC_001_CZSK_Promo',format:'Video',spend:10,purchases:2,revenue:50,impressions:100,...overrides});

test('event aggregates union configured assets across months and retain summed-ratio/unavailable semantics',()=>{
  const inventory=(assets,complete=true)=>({version:2,assets:assets.map(id=>({id,key:'video:'+id,kind:'video'})),configured_media_complete:complete,unknown_reasons:complete?[]:['synthetic_missing'],alternate_video_ids_not_counted:[]});
  const rows=[fact('2026-10-28',{spend:10,purchases:1,revenue:20,asset_inventory:inventory(['shared'])}),fact('2026-11-01',{ad_id:'b',spend:90,purchases:9,revenue:900,asset_inventory:inventory(['shared','second'])}),fact('2026-11-04',{ad_id:'c',format:'Unknown',spend:0,impressions:0,purchases:2,revenue:80,asset_inventory:inventory(['carry-only'])})];
  const before=JSON.stringify(rows),[group]=promoMix(rows);
  assert.equal(group.total.assets,2);assert.equal(group.formats.Video.assets,2);assert.equal(group.formats.Banner.assets,0);
  assert.equal(group.total.ads,3);assert.equal(group.total.roas,1000/100);assert.equal(group.total.cpa,100/12);
  assert.equal(group.formats.Video.purchaseShare,10/12*100);assert.equal(group.formats.Unknown.purchaseShare,2/12*100);
  assert.equal(group.formats.Unknown.assets,null);assert.equal(group.formats.Unknown.roas,null);assert.equal(group.formats.Banner.cpa,null);
  assert.equal(JSON.stringify(rows),before);
  const [partial]=promoMix([...rows,fact('2026-10-31',{ad_id:'missing',asset_inventory:inventory([],false)})]);
  assert.equal(partial.total.assets,2);assert.equal(partial.total.asset_status,'partial');assert.equal(partial.formats.Banner.assets,null);
  const [unavailable]=promoMix([fact('2026-10-28'),fact('2026-11-04')]);
  assert.equal(unavailable.total.assets,null);assert.equal(unavailable.total.asset_status,'unavailable');
  const [carry]=promoMix([fact('2026-11-01',{spend:0,impressions:0})]);
  assert.equal(carry.total.spendShare,null);assert.equal(carry.total.roas,null);assert.equal(carry.total.assets,0);
});

test('native charts, accessible table and copy consume the same promo partition',()=>{
  const fs=require('node:fs');
  const ui=fs.readFileSync('public/glv-meta-ads/promo-format-ui.js','utf8');
  const html=fs.readFileSync('public/glv-meta-ads/index.html','utf8');
  assert.match(ui,/PromoFormat\.promoMix\(rows\)/);
  assert.doesNotMatch(ui,/PromoFormat\.monthlyMix|label\(month\.month\)|· Monthly/);
  assert.match(html,/aria-label="Promo event Banner and Video spend share"/);
  assert.match(html,/<th scope="col">Promo<\/th><th scope="col">Format/);
});

test('repeated June/August stages stay distinct, with residual dates retained',()=>{
  const dates=['2026-06-14','2026-06-15','2026-06-17','2026-06-18','2026-06-23','2026-06-24','2026-08-17','2026-08-18','2026-08-19','2026-08-20','2026-08-26','2026-08-27'];
  const groups=promoMix(dates.map(date=>fact(date)));
  assert.deepEqual(groups.map(g=>[g.label,g.total.spend]),[['Jun 2026',20],['Jun Private',20],['Jun Public',20],['Aug 2026',20],['Aug Private',20],['Aug Public',20]]);
});

test('future events are deferred; campaign names cannot create or override slots',()=>{
  assert.deepEqual(promoMix([]),[]);
  assert.deepEqual(promoMix([fact('2026-10-28',{campaign_name:'TUC_099_CZSK_Promo_BFCM'})]).map(g=>g.label),['Oct/Nov VB2']);
  const rows=[fact('2026-11-20',{campaign_name:'TUC_099_CZSK_Promo_BFCM'}),fact('2026-11-21')];
  assert.deepEqual(promoMix(rows).map(g=>[g.label,g.total.spend]),[['Nov 2026',20]]);
  assert.deepEqual(promoMix([fact('2026-11-20',{spend:0,purchases:0,revenue:0,impressions:0})]),[]);
});

test('format event boundaries partition October/November once, retaining out-of-window facts',()=>{
  assert.equal(typeof promoMix,'function');
  const dates=['2026-09-22','2026-10-06','2026-10-07','2026-10-14','2026-10-15','2026-10-27','2026-10-28','2026-10-31','2026-11-01','2026-11-04','2026-11-05'];
  const rows=dates.map(date=>fact(date));
  const groups=promoMix(rows);
  assert.deepEqual(groups.map(g=>[g.label,g.total.spend]),[['Sep 2026',10],['Oct 2026',30],['Oct Menopause',20],['Oct/Nov VB2',40],['Nov 2026',10]]);
  for(const key of ['spend','purchases','revenue','impressions']) assert.equal(groups.reduce((n,g)=>n+g.total[key],0),rows.reduce((n,r)=>n+r[key],0));
  assert.deepEqual(promoMix(rows.slice().reverse()),groups);
  assert.equal(monthlyMix(rows).length,3,'legacy diagnostic monthly aggregator remains monthly');
  assert.deepEqual(promoMix([fact('2027-10-28'),fact('2027-11-01')]).map(g=>g.label),['Oct 2027','Nov 2027'],'2026 schedule must not recur implicitly');
});
