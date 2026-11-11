'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{createRequire}=require('node:module');
const shared=require('../lib/glv-mad-shared.cjs'),v2=require('../lib/glv-mad-v2.cjs'),custom=require('../lib/glv-mad-shared-custom.cjs');
// Load the synthetic fixture without registering another file's tests.
const text=fs.readFileSync(require.resolve('./mad-shared-publication.test.cjs'),'utf8');
const fixture=vm.runInNewContext(text.slice(text.indexOf('const range='),text.indexOf("test('one"))+';fixture',{v2});
test('native renderer and publication reject contradictory top-level and nested ownership before account filtering',()=>{
 const source=require('../lib/glv-mad-v2-source.cjs');
 for(const type of ['daily','aggregate','ads'])for(const ai of [0,1])for(const nested of [false,true]){
  const f=fixture(),s=f.native[type],a=s.accounts[ai];
  a.rows=structuredClone(s.accounts[0].rows);
  const bad=a.rows[0],other=v2.ACCOUNTS[1-ai].id;
  if(nested)bad.creator_rows=[{...bad,id:'child',ad_id:'9',adset_id:'3',adset_name:'Banner',ad_name:'Creator',account_id:other}];else bad.account_id=other;
  for(const filter of ['All','TUC','TGLV'])for(const currency of ['CZK','USD'])assert.throws(()=>source.renderSnapshot(s,currency,filter),/ownership/i);
  assert.throws(()=>shared.compose(f),/ownership/i);
  assert.throws(()=>v2.convertRow(bad,a,'USD',s.fx),/ownership/i);
 }
 for(const ai of [0,1]){
  const s=fixture().native.daily,a=s.accounts[ai];a.rows=structuredClone(s.accounts[0].rows);
  assert.doesNotThrow(()=>source.renderSnapshot(s));
  for(const row of a.rows)row.account_id=a.id;
  assert.doesNotThrow(()=>source.renderSnapshot(s));
 }
});
test('current campaign classification matches CZK/USD including nested creators without changing money',()=>{
 const f=fixture();
 for(const payload of Object.values(f.legacy))for(const row of payload.rows)row.creator_rows=[{...row,id:'child',ad_id:'9',adset_id:'3',adset_name:'Banner',ad_name:'Creator',creator_rows:undefined}];
 for(const snapshot of Object.values(f.native)){
  for(const row of snapshot.accounts[0].rows)row.creator_rows=[{...row,id:'child',ad_id:'9',adset_id:'3',adset_name:'Banner',ad_name:'Creator',creator_rows:undefined}];
  snapshot.accounts[1].rows=snapshot.accounts[0].rows.map(r=>({...r,name:'TGLV_001_US_BAU',campaign_name:'TGLV_001_US_BAU'}));
 }
 const b=shared.compose(f),metadata={schema_version:1,source:'Meta campaign objects',generated_at:'2026-11-03T13:00:00Z',accounts:[{id:v2.ACCOUNTS[0].id,campaigns:[{id:'1',account_id:v2.ACCOUNTS[0].id,name:'TUC_001_US_BAU'}]}]};
 const dimensions=rows=>rows.map(r=>({id:r.id,account_id:r.account_id,name:r.name,campaign_name:r.campaign_name,market:r.market,creator_rows:dimensions(r.creator_rows||[])}));
 const amounts=rows=>rows.map(r=>({spend:r.amount_spent,revenue:r['action_values:omni_purchase'],creator_rows:amounts(r.creator_rows||[])}));
 for(const type of ['daily','aggregate','ads']){
  const cz=shared.render(b,type,'v2','CZK','All',metadata),us=shared.render(b,type,'v2','USD','All',metadata);
  assert.deepEqual(dimensions(us.rows),dimensions(cz.rows));assert.equal(us.rows[0].market,'US');assert.equal(us.rows[0].creator_rows[0].market,'US');
  for(const currency of ['CZK','USD'])assert.deepEqual(amounts(shared.render(b,type,'v2',currency,'All',metadata).rows),amounts(shared.render(b,type,'v2',currency,'All').rows));
  assert.equal(us.rows.find(r=>r.account_id===v2.ACCOUNTS[1].id).campaign_name,'TGLV_001_US_BAU');
 }
});
const range={since:'2026-11-01',until:'2026-11-02'};
function instance(version){
 // Separate module globals for every handler/reader/custom invocation. Only the
 // simulated Redis transport is shared, as with separate serverless instances.
 const modules=new Map();
 function load(file){if(modules.has(file))return modules.get(file).exports;const m={exports:{}};modules.set(file,m);const req=createRequire(file);const local=id=>{const p=req.resolve(id);return /glv-mad-shared-(reader|custom)\.cjs$/.test(p)?load(p):req(id);};
 vm.runInThisContext('(function(require,module,exports){'+fs.readFileSync(file,'utf8')+'\n})',{filename:file})(local,m,m.exports);return m.exports;}
 return load(require.resolve(version===1?'../api/glv-meta-ads/fb-data.js':'../api/glv-meta-ads-v2/fb-data.js'));
}
async function request(handler,type='ads',r=range){const res={code:200,setHeader(){},status(c){this.code=c;return this;},json(b){this.body=b;return this;}};await handler({method:'GET',headers:{cookie:'glv_meta_beta=synthetic'},query:{type,time_range:JSON.stringify(r),currency:'CZK',account:'TUC'}},res);return res;}
async function sandbox(run){
 const env={...process.env},fetcher=global.fetch,values=new Map();let pulls=0,wins=0;
 Object.assign(process.env,{GLV_MAD_V2_ENABLED:'1',GLV_META_BETA_AUTH_TOKEN:'synthetic',GLV_META_FB_ACCESS_TOKEN:'synthetic',KV_REST_API_URL:'https://redis.invalid',KV_REST_API_TOKEN:'synthetic'});
 const owner=require('../lib/glv-refresh-owner.cjs');
 const state={values,get pulls(){return pulls;},get wins(){return wins;},cleanupError:false};
 state.redis=async(c,k,v,...args)=>{
  if(c==='GET')return {result:values.get(k)||null};
  if(c==='SET'){if(args.includes('NX')&&values.has(k))return {result:null};if(k===owner.LOCK_KEY)wins++;values.set(k,v);return {result:'OK'};}
  if(c==='TTL')return {result:values.has(k)?-1:-2};
  if(c==='EVAL'){if(k.includes("redis.call('DEL'")){if(state.cleanupError)throw Error('cleanup failed');const [key,id]=args;if(values.get(key)===id)values.delete(key);}return {result:1};}
  if(c==='PERSIST')return {result:1};throw Error(c);
 };
 global.fetch=async(url,options={})=>{const u=new URL(url);let body;
  if(u.hostname==='redis.invalid')body=u.pathname.startsWith('/get/')?{result:values.get(decodeURIComponent(u.pathname.slice(5)))||null}:await state.redis(...JSON.parse(options.body));
  else if(u.hostname==='www.cnb.cz')return {ok:true,status:200,text:async()=> 'Date|1 USD\n01.11.2026|25\n02.11.2026|25\n'};
  else if(u.hostname==='graph.facebook.com'){pulls++;await new Promise(r=>setTimeout(r,5));const a=v2.ACCOUNTS.find(a=>u.pathname.includes(a.id));body=u.searchParams.get('fields')==='account_id,currency,timezone_name,account_status'?{account_id:a.id,currency:a.currency,timezone_name:a.timezone,account_status:1}:{data:[]};}
  else throw Error('Network prohibited');
  return {ok:true,status:200,json:async()=>body,text:async()=>JSON.stringify(body)};
 };
 try{await run(state);}finally{global.fetch=fetcher;process.env=env;}
}
test('expired extraction budget preserves exact last-good in both actual APIs despite cleanup failure',async()=>{
 for(const version of [1,2])for(const cleanupError of [false,true])await sandbox(async s=>{
  const b=shared.compose(fixture());await shared.save(s.redis,custom.slot(range),b);s.cleanupError=cleanupError;
  const cron=require('../api/glv-meta-ads/cron.js')._test,original=cron.fetchAndCache,now=Date.now;
  cron.fetchAndCache=async()=>{Date.now=()=>now()+46000;throw Error('primary extraction failure');};
  try{const r=await request(instance(version));assert.equal(r.code,200);assert.equal(r.body.shared_generation_id,b.generation_id);assert.equal(s.values.has(require('../lib/glv-refresh-owner.cjs').LOCK_KEY),cleanupError);}
  finally{cron.fetchAndCache=original;Date.now=now;}
 });
});
test('cleanup failure cannot replace the primary failure when no last-good exists',async()=>sandbox(async s=>{
 s.cleanupError=true;const cron=require('../api/glv-meta-ads/cron.js')._test,original=cron.fetchAndCache;
 cron.fetchAndCache=async()=>{throw Error('primary extraction failure');};
 try{await assert.rejects(custom.get({scope:{range,type:'ads',currency:'CZK',account:'TUC'},version:'v1'}),/primary extraction failure/);}
 finally{cron.fetchAndCache=original;}
}));
test('owner exclusivity and colliding custom slots never leak another range or pull',async()=>{
 const owner=require('../lib/glv-refresh-owner.cjs');
 let collision;for(let d=1;d<60;d++){const r={since:v2.shift(range.since,-d),until:v2.shift(range.until,-d)};if(custom.slot(r)===custom.slot(range)){collision=r;break;}}
 assert.ok(collision);
 for(const lock of ['scheduled-owner',`custom:${range.since}:${range.until}:other`])await sandbox(async s=>{
  // A verified publication for a different range in the same slot is not a hit.
  const b=shared.compose(fixture());await shared.save(s.redis,custom.slot(range),b);
  s.values.set(owner.LOCK_KEY,lock);
  for(const version of [1,2])assert.equal((await request(instance(version),'ads',collision)).code,503);
  assert.equal(s.pulls,0);assert.equal(s.wins,0);assert.equal(s.values.get(owner.LOCK_KEY),lock);
 });
});
test('parallel failed cold extraction returns unavailable without duplicate pulls then recovers',async()=>sandbox(async s=>{
 const cron=require('../api/glv-meta-ads/cron.js')._test,original=cron.fetchAndCache;let attempts=0;
 cron.fetchAndCache=async()=>{attempts++;await new Promise(r=>setTimeout(r,20));throw Error('primary failure');};
 try{const replies=await Promise.all(['aggregate','daily','ads'].map((t,i)=>request(instance(i===1?2:1),t)));assert.deepEqual(replies.map(r=>r.code),[503,503,503]);assert.equal(attempts,1);assert.equal(s.wins,1);}
 finally{cron.fetchAndCache=original;}
 assert.equal((await request(instance(2))).code,200);assert.equal(s.wins,2);
}));
test('same-range wait is bounded and does not steal a stuck lease',async()=>sandbox(async s=>{
 const owner=require('../lib/glv-refresh-owner.cjs'),lock=`custom:${range.since}:${range.until}:stuck`,now=Date.now,redis=s.redis;let reads=0;
 s.values.set(owner.LOCK_KEY,lock);
 s.redis=async(...args)=>{if(args[0]==='GET'&&args[1]===owner.LOCK_KEY){reads++;Date.now=()=>now()+46000;}return redis(...args);};
 try{assert.equal((await request(instance(1))).code,503);assert.equal(reads,1);assert.equal(s.wins,0);assert.equal(s.pulls,0);assert.equal(s.values.get(owner.LOCK_KEY),lock);}
 finally{Date.now=now;}
}));
test('cold actual APIs coalesce aggregate/daily/ads across isolated module instances',async()=>{
 for(const versions of [[1,1,1],[2,2,2],[1,2,1]])await sandbox(async s=>{
  const replies=await Promise.all(['aggregate','daily','ads'].map((t,i)=>request(instance(versions[i]),t)));
  assert.deepEqual(replies.map(r=>r.code),[200,200,200]);assert.equal(new Set(replies.map(r=>r.body.shared_generation_id)).size,1);assert.equal(s.wins,1);assert.ok(s.pulls>0);
  const pulls=s.pulls;assert.equal((await request(instance(2))).code,200);assert.equal(s.pulls,pulls);
 });
});
