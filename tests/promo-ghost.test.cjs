const test=require('node:test');
const assert=require('node:assert/strict');
const backend=require('../lib/glv-promo-format.cjs');
const shared=require('../public/glv-meta-ads/promo-format.js');
const concepts=require('../public/glv-meta-ads/promo-concepts.js');
const {fixture,range}=require('./helpers/promo-ghost-fixture.cjs');
test('financial Ghost visibility uses paired outcomes or absolute CZK spend without mutating facts',()=>{
 for(const [spend,revenue,visible] of [[0,0,false],[0.000000002,-0.000000002,false],[0.06,-0.06,true],[0.4999,-0.4999,true],[0.5,0,false],[-0.5,0,false],[0,0.5,true],[0,-0.5,true],[10,-10,true]]){
  const row={spend,revenue,purchases:3,link_clicks:5};const before={...row};
  assert.equal(shared.hasFinancialContribution(row),visible);
  assert.deepEqual(row,before);
 }
});
const metrics=['spend','purchases','revenue','impressions','link_clicks','landing_page_views','checkouts'];

test('signed campaign/day residuals preserve real facts and reconcile every additive input',async()=>{
 for(const campaign of [12,8,0]){
 const p=await backend.fetchPromoFormats('test',range,fixture({campaign}));
 assert.equal(shared.validConceptPayload(p),true);
 const real=p.rows.find(r=>!r.is_ghost),ghost=p.rows.find(r=>r.is_ghost);
 assert.equal(real.ad_name,'CC10');assert.equal(real.spend,10);
 assert.equal(ghost.label,'Ghost creative — pending Meta reconciliation');
 assert.equal(ghost.ad_id,undefined);assert.equal(ghost.format,'Ghost');assert.equal(ghost.asset_inventory,undefined);
 for(const k of metrics){assert.equal(ghost[k],campaign-10);assert.equal(p.rows.reduce((s,r)=>s+r[k],0),campaign);}
 const mix=shared.monthlyMix(p.rows)[0];assert.equal(mix.total.spend,campaign);assert.equal(mix.total.ads,1);assert.equal(mix.formats.Ghost.assets,null);assert.equal(mix.formats.Ghost.roas,null);
 const groups=concepts.aggregate(p.rows,['c']);assert.equal(groups.length,2);assert.equal(groups.find(r=>r.is_ghost).label,ghost.label);assert.equal(groups.find(r=>r.is_ghost).ctr,null);assert.equal(concepts.total(groups).spend,campaign);assert.equal(concepts.total(groups).roas,campaign?1:null);
 assert.equal(concepts.aggregate(p.rows,[]).length,0);
 assert.equal(backend.sliceCachedFormats(p,range,new Date(),{allowStale:true}).rows.find(r=>r.is_ghost).format,'Ghost');
 }
});
test('valid empty ad response produces residual, malformed response never does',async()=>{
 const p=await backend.fetchPromoFormats('test',range,fixture({empty:true}));assert.equal(p.rows.length,1);assert.equal(p.rows[0].is_ghost,true);
 await assert.rejects(()=>backend.fetchPromoFormats('test',range,fixture({malformed:true})),/Missing Promo insights data/);
 const exact=await backend.fetchPromoFormats('test',range,fixture({campaign:10}));assert.equal(exact.rows.length,1);
});

test('malformed campaign facts and action collections fail closed before reconciliation',async()=>{
 for(const change of [{date_start:'2026-02-30'},{spend:undefined},{impressions:null},{actions:null},{actions:[{action_type:'link_click',value:'bad'}]},{campaign_id:''}]){
  const base=fixture();const fetcher=async url=>{const res=await base(url),data=await res.json();if(new URL(url).searchParams.get('level')==='campaign'&&data.data.length)Object.assign(data.data[0],change);return {...res,json:async()=>data};};
  await assert.rejects(()=>backend.fetchPromoFormats('test',range,fetcher),/Invalid Promo/);
 }
});
test('duplicate campaign/day totals cannot create duplicate residuals',async()=>{
 const base=fixture();const fetcher=async url=>{const res=await base(url),data=await res.json();if(new URL(url).searchParams.get('level')==='campaign')data.data.push({...data.data[0]});return {...res,json:async()=>data};};
 await assert.rejects(()=>backend.fetchPromoFormats('test',range,fetcher),/Duplicate Promo campaign date/);
});
test('a campaign absent from every campaign insight day still retains real ads and a negative residual',async()=>{
 const base=fixture();const fetcher=async url=>{const res=await base(url),data=await res.json();if(new URL(url).searchParams.get('level')==='campaign')data.data=[];return {...res,json:async()=>data};};
 const p=await backend.fetchPromoFormats('test',range,fetcher);
 assert.equal(p.rows.filter(r=>!r.is_ghost).length,1);assert.equal(p.rows.find(r=>r.is_ghost).spend,-10);
 assert.equal(p.rows.reduce((s,r)=>s+r.spend,0),0);
});
test('valid omitted campaign day is zero authority, preserving unmatched real ad outcomes',async()=>{
 const base=fixture();const fetcher=async url=>{const res=await base(url),data=await res.json();if(new URL(url).searchParams.get('level')==='campaign')data.data[0].date_start='2026-10-31';return {...res,json:async()=>data};};
 const p=await backend.fetchPromoFormats('test',range,fetcher);
 assert.equal(shared.validConceptPayload(p),true);assert.equal(p.rows.filter(r=>r.date==='2026-11-01').reduce((s,r)=>s+r.spend,0),0);
});
