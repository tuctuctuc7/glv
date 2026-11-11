'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'../public');
const html=v=>fs.readFileSync(path.join(root,v,'index.html'),'utf8');
const a=html('glv-meta-ads'),b=html('glv-meta-ads-v2');
test('V1 reference stylesheet and introduction are shared, no alternate skin',()=>{
 assert.ok(!b.includes('quiet-precision.css'));
 assert.equal(a.match(/<style>([\s\S]*?)<\/style>/)[1],b.match(/<style>([\s\S]*?)<\/style>/)[1]);
 for(const cls of ['dashboard-kicker','dashboard-title','dashboard-sub'])assert.equal(a.match(new RegExp('class="'+cls+'"[^>]*>([^<]+)'))[1],b.match(new RegExp('class="'+cls+'"[^>]*>([^<]+)'))[1]);
});
test('both consumers use shared indicative FX and scope-aware campaign formatter',()=>{
 for(const s of [a,b]){assert.match(s,/MadPresentation\.usdEquivalent/);assert.match(s,/MadPresentation\.campaignCode/);assert.match(s,/MadPresentation\.fetchUsdRate/);assert.doesNotMatch(s,/usdRate\s*=\s*0\.044/);}
});
test('verified account ownership retains wrong-prefix facts and warns, without accepting unknown ownership',()=>{
 const p=require('../public/glv-meta-ads/presentation.js');
 const row={account_id:'359758259164738',name:'OTHER_002_US_BAU_Parity'};
 assert.equal(p.ownedTuc(row),true);assert.equal(p.ownedTuc({...row,account_id:'other'}),false);
 assert.equal(p.accountMarket(row),'us');assert.match(p.namingWarnings([{rows:[row]}])[0],/prefix mismatch; retained/);
 assert.deepEqual(p.namingWarnings([{rows:[{...row,name:'WL_befit_over40'}]}]),[]);
 assert.equal(p.usdEquivalent(100,.04),'≈ $4');assert.equal(p.usdEquivalent(100,null),'USD estimate unavailable');assert.equal(p.usdEquivalent(100,.04,'USD'),'');
 assert.equal(p.campaignCode('TUC_002_CZSK'), '002');assert.equal(p.campaignCode('TUC_002_CZSK',true),'TUC_002');assert.equal(p.campaignCode('TGLV_002_CZSK',true,'TUC'),'TUC_002');
});
test('restored sort directions update visible arrows without changing sort state',()=>{
 const p=require('../public/glv-meta-ads/presentation.js');const nodes={'daily-sort-dir-czsk':{},'creative-sort-dir-us':{}};
 const state={daily:{czsk:{key:'date',dir:'asc'}},creative:{us:{key:'spend',dir:'desc'}}};
 p.syncSortIndicators(state,{getElementById:id=>nodes[id]});assert.equal(nodes['daily-sort-dir-czsk'].textContent,'↑');assert.equal(nodes['creative-sort-dir-us'].textContent,'↓');assert.equal(state.daily.czsk.dir,'asc');
});
test('WL verified TUC ownership uses the same market fallback as V2',()=>{
 const legacy=require('../public/glv-meta-ads/wl-report.js');
 const row={id:'ad',account_id:'359758259164738',campaign_id:'wrong',campaign_name:'UNRECOGNIZED_099',name:'Kristyna_PAC419_v6-9',partnership:{status:'verified_positive',reason:'sponsor_metadata',evidence:['facebook_branded_content.sponsor_page_id']},amount_spent:37};
 assert.equal(legacy.normalize([row])[0].market,'CZSK');
});
test('all explicit chart legends bottom-left and filter None precedes All',()=>{
 for(const version of ['glv-meta-ads','glv-meta-ads-v2'])for(const file of ['index.html','promo-format-ui.js']){
 const s=fs.readFileSync(path.join(root,version,file),'utf8');assert.doesNotMatch(s,/position:'top'/);assert.doesNotMatch(s,/position:'bottom',labels/);assert.doesNotMatch(s,/>Clear<\/button>/);
 for(const m of s.matchAll(/<div class="filter-actions">([\s\S]*?)<\/div>/g))assert.ok(m[1].indexOf('clearAll')<m[1].indexOf('selectAll'));
 }
});
