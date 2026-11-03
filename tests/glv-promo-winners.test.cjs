const test=require('node:test');
const assert=require('node:assert/strict');
const {classifyFormat,sliceCachedFormats}=require('../lib/glv-promo-format.cjs');
const campaigns=['120250608228580687','120250692949130687'];
const names=[
 ['PAC480 V3 no-CTA','Video'],
 ['2026-10-21_B_Velvet-Beauty-Round02_CC01_03_1080x1080','Banner'],
 ['2026-10-21_B_Velvet-Beauty-Round02_CC01_04_1080x1080','Banner'],
 ['2026-10-21_V_AI UGC_01 no-CTA','Video'],
 ['2026-10-21_B_Velvet-Beauty-Round02_CC04_03_1080x1080','Banner'],
 ['PAC475 V3','Video'],
];
const classify=(name,campaign_id,adset='AS_Purchase_Promo_Winners')=>classifyFormat({name,campaign_id},{name:adset});
test('036 approved duplicate names retain their formats in 037 mixed winners adsets',()=>{
 for(const campaign of campaigns)for(const [name,format] of names){
  assert.deepEqual(classify(name,campaign),{format,reason:'approved_original_mapping'},`${campaign}: ${name}`);
 }
});
test('winners inheritance remains exact-name and campaign scoped with adset precedence',()=>{
 for(const campaign of campaigns)for(const [name] of names){
  assert.deepEqual(classify(name,campaign,'AS_Banners_Videos'),{format:'Unknown',reason:'conflicting_adset_labels'});
  for(const label of ['Banner','Video'])assert.deepEqual(classify(name,campaign,label),{format:label,reason:'current_adset_label'});
  for(const invalid of [`X${name}`,`${name}0`,name.toLowerCase(),name.replace('PAC','XPAC'),name.replace('CC01','CC010')].filter(x=>x!==name))assert.equal(classify(invalid,campaign).format,'Unknown',invalid);
  for(const other of ['new-campaign','120247470134450687'])assert.equal(classify(name,other).format,'Unknown');
 }
 for(const name of ['PAC480','PAC475','PAC480 V4','PAC4800 V3 no-CTA','2026-10-21_B_Unknown','2026-10-21_V_Unknown','unmapped'])assert.equal(classify(name,campaigns[1]).format,'Unknown');
});
test('cached 037 labels recompute without mutating facts, freshness, versions or scope',()=>{
 const range={since:'2026-10-28',until:'2026-11-02'},now=new Date('2026-11-03T01:00:00Z');
 const rows=names.flatMap(([ad_name],i)=>['2026-11-01','2026-11-02'].map(date=>({ad_id:String(i),ad_name,adset_id:'mixed',adset_name:'AS_Promo_Winners_PAC480_CC01',campaign_id:campaigns[1],campaign_name:'TUC_037_CZSK_CBO_Sales_Promo_Winners',date,format:'Unknown',reason:'no_approved_mapping',spend:date.endsWith('02')?0:100,purchases:1,revenue:200,impressions:date.endsWith('02')?0:50})));
 const source={schema_version:1,classification_version:2,reconciled:true,range,generated_at:now.toISOString(),rows};
 const original=JSON.stringify(source),raw=({format,reason,...rest})=>rest;
 for(const classification_version of [1,2]){
  const result=sliceCachedFormats({...source,classification_version},range,now);
  assert.ok(result);assert.equal(result.classification_version,2);assert.equal(result.generated_at,source.generated_at);
  assert.deepEqual(result.rows.map(raw),rows.map(raw));assert.deepEqual(result.rows.map(r=>r.format),names.flatMap(([,format])=>[format,format]));
 }
 assert.equal(JSON.stringify(source),original);
 for(const campaign_name of ['TUC_037_US_CBO_Sales_Promo_Winners','TUC_037_CZSK_CBO_Sales_Winners','Other_037_CZSK_Promo'])assert.equal(sliceCachedFormats({...source,rows:[{...rows[0],campaign_name}]},range,now),null);
 const unmapped={...rows[0],ad_name:'genuinely unmapped'};
 assert.equal(sliceCachedFormats({...source,rows:[unmapped]},range,now).rows[0].format,'Unknown');
});
