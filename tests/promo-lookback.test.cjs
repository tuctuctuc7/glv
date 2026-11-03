const test=require('node:test');const assert=require('node:assert/strict');
const {refreshPromoFormatCache}=require('../api/glv-meta-ads/cron.js')._test;
const {fetchPromoFormats,CACHE_KEY}=require('../lib/glv-promo-format.cjs');
const {fixture,range}=require('./helpers/promo-ghost-fixture.cjs');
test('rolling seven completed UTC days replaces ghosts, preserves older history, is idempotent and supports full rebuild',async()=>{
 const now=new Date('2026-11-03T00:00:00Z');
 const prior=await fetchPromoFormats('test',range,fixture());prior.range.since='2026-03-01';prior.generated_at=now.toISOString();
 const old={...prior.rows[0],date:'2026-03-01'};prior.rows.unshift(old);
 let stored=JSON.stringify(prior),windows=[];const base=fixture({campaign:10});
 const fetcher=async(url,options)=>{
  if(url==='https://redis.test'){const [cmd,key,value]=JSON.parse(options.body);assert.equal(key,CACHE_KEY);if(cmd==='SET')stored=value;return {ok:true,json:async()=>({result:cmd==='GET'?stored:cmd==='TTL'?-1:'OK'})};}
  const u=new URL(url);if(u.searchParams.get('level')==='campaign')windows.push(JSON.parse(u.searchParams.get('time_range')));
  return base(url,options);
 };
 const env={...process.env};process.env.KV_REST_API_URL='https://redis.test';process.env.KV_REST_API_TOKEN='test';delete process.env.UPSTASH_REDIS_REST_URL;delete process.env.UPSTASH_REDIS_REST_TOKEN;
 try{
  const options={now};
  const summary=await refreshPromoFormatCache('test',false,fetcher,options);
  assert.deepEqual(windows,[{since:'2026-10-27',until:'2026-11-02'}]);assert.equal(summary.refresh_mode,'rolling_7d');
  let p=JSON.parse(stored);assert.deepEqual(p.rows[0],old);assert.equal(p.rows.some(r=>r.is_ghost),false);assert.equal(p.range.since,'2026-03-01');
  const rows=p.rows;await refreshPromoFormatCache('test',false,fetcher,options);assert.deepEqual(JSON.parse(stored).rows,rows);
  const good=stored;await assert.rejects(()=>refreshPromoFormatCache('test',false,async(url,opts)=>url==='https://redis.test'?fetcher(url,opts):{ok:false,status:500,json:async()=>({error:{code:1}})},options));assert.equal(stored,good);
  await refreshPromoFormatCache('test',false,fetcher,{now,fullHistory:true});assert.deepEqual(windows.at(-1),{since:'2026-03-01',until:'2026-11-02'});assert.equal(JSON.parse(stored).rows.some(r=>r.date==='2026-03-01'),false);
 }finally{process.env=env;}
});
test('lookback fills outages without claiming an unqueried gap; future/legacy caches bootstrap full history',()=>{
 const {refreshWindow}=require('../lib/glv-promo-format.cjs');assert.equal(typeof refreshWindow,'function');
 const full={since:'2026-03-01',until:'2026-11-02'};
 const p={schema_version:1,classification_version:2,funnel_version:1,inventory_version:2,reconciled:true,generated_at:'2026-10-20T00:00:00Z',range:{since:'2026-03-01',until:'2026-10-19'},rows:[]};
 assert.deepEqual(refreshWindow(p,full),{since:'2026-10-20',until:full.until});
 assert.deepEqual(refreshWindow({...p,range:{...p.range,until:'2026-11-03'}},full),full);
 assert.deepEqual(refreshWindow({...p,funnel_version:undefined},full),full);
 assert.deepEqual(refreshWindow(p,{since:'2026-03-01',until:'2026-03-03'}),{since:'2026-03-01',until:'2026-03-03'});
});
