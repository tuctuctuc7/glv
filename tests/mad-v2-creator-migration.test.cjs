const test=require('node:test'),assert=require('node:assert/strict');
const v2=require('../lib/glv-mad-v2.cjs'),source=require('../lib/glv-mad-v2-source.cjs');
const wl=require('../public/glv-meta-ads-v2/wl-report.js');
const {attachCreatorFacts}=require('../lib/glv-wl-creators.cjs');
const day='2026-11-01',range={since:day,until:day},fx={[day]:{date:day,czk_per_usd:25,provider:'test'}};
const parent={id:'35',name:'TUC_035_CZSK_WL',date_start:day,date_stop:day,amount_spent:25,impressions:300,reach:99,'action_values:omni_purchase':100};
const kids=['Kristyna_PAC419_v6-9','ActionKate_PAC462_V2'].map((ad_name,i)=>({...parent,ad_id:String(i+1),ad_name,adset_id:'13',adset_name:'AS13_Purchase_Videos_WL_KPI',amount_spent:15,impressions:150,'action_values:omni_purchase':60}));
const snapshot=()=>({schema_version:1,creator_ad_version:1,complete:true,type:'aggregate',range,generated_at:'2026-11-02T12:00:00Z',fx,accounts:v2.ACCOUNTS.map(a=>({...a,reach:[[`${a.id}:35`,99]],rows:attachCreatorFacts([parent],kids)}))});
test('V2 ad-first resolver matches V1 and retains eligibility gate',()=>{
 for(const name of ['Kristyna_PAC419_v6-9','ActionKate_PAC462_V2','PAC419_V1','Kristyna_ActionKate_PAC419_V1'])assert.deepEqual(wl.resolveCreator('WL','AS13',name),require('../public/glv-meta-ads/wl-report.js').resolveCreator('WL','AS13',name));
 const rows=kids.map(r=>({...r,id:r.ad_id,name:r.ad_name,campaign_name:r.name,account_id:v2.ACCOUNTS[1].id,partnership:{status:'verified_positive',reason:'sponsor_metadata',evidence:['instagram_branded_content.sponsor_id']}}));
 assert.deepEqual(wl.normalize(rows).map(r=>[r.creator,r.market]),[['Kristyna','US'],['ActionKate','US']]);
 assert.equal(wl.normalize([{...rows[0],partnership:{status:'unverified',reason:'no_positive_metadata',evidence:[]}}]).length,0);
});
test('V2 preserves individual mixed-AS13 ads through currency conversion and aggregation',()=>{
 for(const currency of ['USD','CZK']){
 const out=source.renderSnapshot(snapshot(),currency);assert.equal(out.rows.length,2);
 for(const row of out.rows){assert.equal(row.creator_rows.length,3);assert.deepEqual(row.creator_rows.filter(r=>!r.is_ghost).map(r=>r.ad_name),kids.map(r=>r.ad_name));assert.equal(new Set(row.creator_rows.filter(r=>!r.is_ghost).map(r=>r.ad_id)).size,2);for(const child of row.creator_rows.filter(r=>!r.is_ghost))assert.ok(child.ad_id.startsWith(row.account_id+':'));assert.equal(row.reach,99);assert.equal(row.creator_rows.reduce((n,r)=>n+r.amount_spent,0),row.amount_spent);assert.equal(row.creator_rows.at(-1).native.amount_spent,-5);assert.ok(row.creator_rows.every(r=>r.daily_provenance.length===1));}
 assert.equal(out.creator_ad_version,1);
 }
});
test('V2 refuses old adset-only native WL facts without relabeling freshness',()=>{
 const s=snapshot();delete s.creator_ad_version;for(const a of s.accounts)for(const c of a.rows[0].creator_rows){delete c.ad_id;delete c.ad_name;}assert.throws(()=>source.renderSnapshot(s),/creator/i);
});
