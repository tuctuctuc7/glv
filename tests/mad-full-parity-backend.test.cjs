'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const source=require('../lib/glv-mad-v2-source.cjs'),v2=require('../lib/glv-mad-v2.cjs');
const id='120250188581670687',account=v2.ACCOUNTS[0].id,old='CZSK | GRAVEYARD | CBO',current='TUC_037_CZSK_CBO_GRAVEYARD';
const observed='2026-11-11T10:00:00.000Z',extracted='2026-11-10T10:00:00.000Z';
function metadata(name=current){return {schema_version:1,generated_at:observed,source:'Meta campaign objects',accounts:[{id:account,campaigns:[{id,account_id:account,name}]}]};}
function snapshot(type){const row={id,name:old,date_start:'2026-11-09',date_stop:'2026-11-09',amount_spent:'25','action_values:omni_purchase':'50',impressions:'10',reach:'7'};if(type==='ads')Object.assign(row,{id:'444',name:'Creative unchanged',campaign_id:id,campaign_name:old});return {schema_version:1,creator_ad_version:1,complete:true,type,range:{since:'2026-11-09',until:'2026-11-09'},generated_at:extracted,source_extractions:[{generated_at:extracted}],accounts:v2.ACCOUNTS.map(a=>({...a,rows:a.id===account?[row]:[],reach:[[`${a.id}:${id}`,7]]})),fx:{'2026-11-09':{date:'2026-11-09',czk_per_usd:25}}};}
test('shared labels preserve current mismatches, same-number collisions, foreign accounts and creator IDs',()=>{
 const names=require('../lib/glv-campaign-metadata.cjs'),row=snapshot('daily').accounts[0].rows[0];
 row.creator_rows=[{id:'555',ad_id:'555',name:'Kristyna_PAC419_V1',campaign_id:id,campaign_name:old}];
 const v1=names.applyPayload({rows:[row],generated_at:extracted},account,'daily',metadata());
 assert.equal(v1.rows[0].name,current);assert.equal(v1.rows[0].creator_rows[0].name,'Kristyna_PAC419_V1');assert.equal(v1.rows[0].creator_rows[0].campaign_name,current);
 const mismatch=source.renderSnapshot(snapshot('daily'),'CZK','TUC',metadata('Wrong prefix still real'));
 assert.equal(mismatch.rows[0].source_id,id);assert.equal(mismatch.warnings.length,1);
 const other=metadata();other.accounts[0].campaigns=[{id:'120250692949130687',account_id:account,name:'TUC_037_CZSK_Promo'}];
 assert.equal(source.renderSnapshot(snapshot('daily'),'CZK','TUC',other).rows[0].name,old,'same 037 number is not identity');
 const foreign={...metadata(),accounts:[{id:v2.ACCOUNTS[1].id,campaigns:[{id,account_id:v2.ACCOUNTS[1].id,name:current}]}]};
 assert.equal(source.renderSnapshot(snapshot('daily'),'CZK','TUC',foreign).rows[0].name,old,'wrong account never relabels history');
 assert.equal(source.renderSnapshot(snapshot('daily'),'CZK','TUC',null).warnings.length,1);
});
test('metadata publication changes bind the served bundle identity without changing the performance generation',()=>{
 const s={...snapshot('daily'),generation_id:'performance-generation'};
 const first=source.renderSnapshot(s,'CZK','TUC',metadata());
 const second=source.renderSnapshot(s,'CZK','TUC',metadata('TUC_037_CZSK_CBO_GRAVEYARD renamed again'));
 assert.notEqual(first.generation_id,second.generation_id);
 assert.equal(first.performance_generation_id,s.generation_id);
 const names=require('../lib/glv-campaign-metadata.cjs'),v1={rows:s.accounts[0].rows,generation_id:'performance-generation'};
 assert.notEqual(names.applyPayload(v1,account,'daily',metadata()).generation_id,names.applyPayload(v1,account,'daily',metadata('different')).generation_id);
});
test('stale metadata is disclosed separately from available historical performance',()=>{
 const result=source.renderSnapshot(snapshot('daily'),'CZK','TUC',{...metadata(),generated_at:'2026-01-01T00:00:00.000Z'});
 assert.equal(result.campaign_metadata.accounts[0].status,'stale');
 assert.equal(result.generated_at,extracted);assert.equal(result.rows[0].amount_spent,25);
});
test('same-cutoff V2 old Graveyard name is repaired by current account+campaign ID without rewriting facts',()=>{
 const v1Current={id,name:current};assert.equal(v1Current.name,current);
 for(const type of ['daily','aggregate','ads']){
  const s=snapshot(type),before=JSON.stringify(s),result=source.renderSnapshot(s,'CZK','TUC',metadata()),row=result.rows[0];
  assert.equal(row.campaign_name||row.name,v1Current.name);
  assert.deepEqual(result.warnings,[]);assert.equal(row.amount_spent,25);
  assert.equal(row.source_id,type==='ads'?'444':id);assert.equal(row.account_id,account);
  assert.equal(result.generated_at,extracted);assert.deepEqual(result.source_extractions,s.source_extractions);
  assert.equal(JSON.stringify(s),before,'immutable performance snapshots retain extraction provenance');
  assert.equal(result.campaign_metadata.generated_at,observed);assert.equal(row.campaign_name_metadata.campaign_id,id);
 }
});
test('metadata-only refresh reads current objects, follows pages, verifies durable bytes and never requests insights',async()=>{
 const names=require('../lib/glv-campaign-metadata.cjs'),store=new Map(),calls=[];
 const redis=async(cmd,key,value)=>{if(cmd==='SET'){store.set(key,value);return {result:'OK'};}return {result:cmd==='TTL'?-1:store.get(key)||null};};
 const fetcher=async url=>{calls.push(url);assert.ok(!url.includes('/insights'));const next=url.includes('after=two');return {ok:true,json:async()=>({data:next?[{id:'120250692949130687',account_id:account,name:'TUC_037_CZSK_Promo'}]:[{id,account_id:account,name:current}],...(next?{}:{paging:{next:`https://graph.facebook.com/v21.0/act_${account}/campaigns?after=two`}})})};};
 const result=await names.refresh({accounts:[v2.ACCOUNTS[0]],tokenFor:()=> 'synthetic',redis,fetcher,now:new Date(observed)});
 assert.equal(calls.length,2);assert.equal(result.readback_verified,true);
 const saved=await names.read(async key=>JSON.parse(store.get(key)),new Date(observed));
 assert.equal(saved.accounts[0].campaigns.length,2);assert.equal(saved.accounts[0].campaigns[0].name,current);
 const before=store.get(names.KEY);
 await assert.rejects(names.refresh({accounts:[v2.ACCOUNTS[0]],tokenFor:()=> 'synthetic',redis,fetcher:async()=>({ok:true,json:async()=>({data:[{id,account_id:'999',name:current}]})}),now:new Date(observed)}),/identity/);
 assert.equal(store.get(names.KEY),before,'bad metadata cannot replace valid current names');
});
test('V2 protected cached reader consumes the shared metadata overlay at the same cutoff',async()=>{
 const handler=require('../api/glv-meta-ads-v2/fb-data.js'),names=require('../lib/glv-campaign-metadata.cjs');
 const now=new Date(),stamp=new Date(+now-1000).toISOString(),s=snapshot('daily'),m={...metadata(),generated_at:stamp};
 const saved={...process.env},original=global.fetch;
 try{
  process.env.GLV_MAD_V2_ENABLED='1';process.env.GLV_META_BETA_AUTH_TOKEN='synthetic';process.env.KV_REST_API_URL='https://redis.test';process.env.KV_REST_API_TOKEN='synthetic';delete process.env.UPSTASH_REDIS_REST_URL;delete process.env.UPSTASH_REDIS_REST_TOKEN;
  const range={since:'2026-11-09',until:'2026-11-09'};
  global.fetch=async url=>{const key=decodeURIComponent(String(url).split('/get/')[1]);return {ok:true,json:async()=>({result:JSON.stringify(key===names.KEY?m:s)})};};
  const res={code:200,setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
  await handler({method:'GET',headers:{cookie:'glv_meta_beta=synthetic'},query:{type:'daily',currency:'CZK',account:'TUC',time_range:JSON.stringify(range)}},res);
  assert.equal(res.code,200);assert.equal(res.body.rows[0].name,current);assert.equal(res.body.campaign_metadata.generated_at,stamp);
 }finally{global.fetch=original;for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
});
