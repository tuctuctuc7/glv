const test=require('node:test');
const assert=require('node:assert/strict');
const wl=require('../public/glv-meta-ads/wl-report.js');
test('metadata collection batches IDs, distinguishes missing evidence from failure, and never uses delivery or names',async()=>{
 const {fetchAdMetadata}=require('../lib/glv-partnership.cjs');
 const ids=Array.from({length:103},(_,i)=>String(i+1));const calls=[];
 const metadata=await fetchAdMetadata(ids,'test-token',async url=>{
  const u=new URL(url),batch=u.searchParams.get('ids').split(',');calls.push(batch);
  assert.match(u.searchParams.get('fields'),/creative\{id,facebook_branded_content,instagram_branded_content\}/);
  if(batch.includes('101'))throw new Error('network failure');
  return {ok:true,json:async()=>Object.fromEntries(batch.filter(id=>id!=='4').map(id=>[id,id==='3'?{error:{code:100}}:{effective_status:'PAUSED',creative:id==='1'?{facebook_branded_content:{sponsor_page_id:'123'}}:id==='2'?{instagram_branded_content:{sponsor_id:'456'}}:{}}]))};
 });
 assert.deepEqual(calls.map(c=>c.length),[50,50,3]);
 for(const id of ['1','2'])assert.equal(metadata[id].partnership.status,'verified_positive');
 for(const id of ['3','4','101'])assert.equal(metadata[id].partnership.reason,'metadata_unavailable');
 assert.equal(metadata['5'].partnership.reason,'no_positive_metadata');
 assert.equal(metadata['1'].status,'PAUSED');assert.equal(Object.keys(metadata).length,103);
});
test('verification gaps are not disabled; named exclusions and positive ordinary campaigns are explicit',()=>{
 const positive={status:'verified_positive',reason:'sponsor_metadata',evidence:['instagram_branded_content.sponsor_id']};
 const rows=[{...row('ok',positive),adset_name:'ActionKate'},row('named',{status:'unverified',reason:'no_positive_metadata',evidence:[]}),{...row('failed',{status:'unverified',reason:'metadata_unavailable',evidence:[]}),adset_name:'plain'},row('legacy')];
 const d=wl.verification(rows);
 assert.equal(d.verified,1);assert.equal(d.noPositive,1);assert.equal(d.unavailable,2);
 assert.equal(d.naming.length,3);assert.match(d.naming.join(' '),/WL-named.*unverified/);assert.match(d.naming.join(' '),/Verified partnership.*without WL/);
 assert.doesNotMatch(JSON.stringify(d),/disabled/);
 assert.equal(wl.validPartnership({status:'verified_positive',reason:'sponsor_metadata',evidence:[]}),false);
});
test('missing creative metadata never discards verified delivery status or invents disabled',()=>{
 const {classify}=require('../lib/glv-partnership.cjs');
 assert.deepEqual(classify({effective_status:'ACTIVE'}),{status:'ACTIVE',partnership:{status:'unverified',reason:'metadata_unavailable',evidence:[]}});
 for(const sponsor of ['',0,'0',null,true,'not-an-id'])assert.equal(classify({creative:{facebook_branded_content:{sponsor_page_id:sponsor}}}).partnership.status,'unverified');
});
const row=(id,partnership)=>({id,campaign_id:'ordinary',campaign_name:'TUC_002_US_ABO_Sales',adset_name:'AS_WL_ActionKate',amount_spent:'10','actions:omni_purchase':'0','action_values:omni_purchase':'0',partnership});
test('WL includes only verified positive ads, not naming, in mixed ordinary US adsets',()=>{
 const raw=[row('positive',{status:'verified_positive',reason:'sponsor_metadata',evidence:['facebook_branded_content.sponsor_page_id']}),row('missing',{status:'unverified',reason:'no_positive_metadata'}),row('legacy'),row('failed',{status:'unverified',reason:'metadata_unavailable'})];
 const normalized=wl.normalize(raw);
 assert.deepEqual(normalized.map(r=>r.id),['positive']);
 assert.equal(normalized[0].creator,'ActionKate');assert.equal(normalized[0].market,'US');
 assert.equal(wl.report(normalized).total.actual,10);
 assert.equal(raw.length,4,'general reporting retains all ads');
});
