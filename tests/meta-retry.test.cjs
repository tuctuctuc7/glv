const test=require('node:test'),assert=require('node:assert/strict');
const {metaRetryFetcher}=require('../lib/glv-meta-retry.cjs');
const reply=(status,data)=>({ok:status>=200&&status<300,status,json:async()=>data});
test('Nov 4 HTTP400 code2/subcode1504044 retries the same page before accepting it once',async()=>{
 let calls=0,delays=[];const fetcher=metaRetryFetcher(async()=>++calls<3?reply(400,{error:{code:2,error_subcode:1504044}}):reply(200,{data:[{id:'one'}]}),10000,{now:()=>0,sleep:async ms=>delays.push(ms)});
 const response=await fetcher('https://graph.facebook.com/v21.0/insights');assert.deepEqual((await response.json()).data,[{id:'one'}]);assert.equal(calls,3);assert.deepEqual(delays,[500,1000]);
});
test('direct wrapper retries non-JSON 503 and 429 on the same URL',async()=>{
 let calls=0;const urls=[],delays=[];
 const fetcher=metaRetryFetcher(async url=>{urls.push(url);const status=[503,429,200][calls++];return status===200?reply(200,{data:[{id:'ok'}]}):{ok:false,status,json:async()=>{throw new SyntaxError('private provider body')}}},10000,{now:()=>0,sleep:async ms=>delays.push(ms)});
 assert.deepEqual(await (await fetcher('https://graph.facebook.com/page2')).json(),{data:[{id:'ok'}]});assert.equal(calls,3);assert.equal(new Set(urls).size,1);assert.deepEqual(delays,[500,1000]);
});
test('non-JSON 200 fails closed without retry and exhausted 503 stays bounded',async()=>{
 for(const [status,expected] of [[200,1],[503,3]]){
  let calls=0;const fetcher=metaRetryFetcher(async()=>{calls++;return {ok:status===200,status,json:async()=>{throw new SyntaxError('private provider body')}}},10000,{now:()=>0,sleep:async()=>{}});
  await assert.rejects(fetcher('https://graph.facebook.com/page2'),/^Error: Meta response body invalid$/);assert.equal(calls,expected);
 }
});
test('runRefresh never publishes malformed HTTP200 as empty aggregate data',async()=>{
 const {runRefresh}=require('../api/glv-meta-ads/cron.js')._test;
 const env={...process.env},oldFetch=global.fetch;Object.assign(process.env,{KV_REST_API_URL:'https://redis.test',KV_REST_API_TOKEN:'test'});delete process.env.UPSTASH_REDIS_REST_URL;delete process.env.UPSTASH_REDIS_REST_TOKEN;
 const store=new Map([['glv:aggregate:last_7d','last-good']]);let attempts=0;
 global.fetch=async(url,options={})=>{
  if(url==='https://redis.test'){const [cmd,key,value]=JSON.parse(options.body);if(cmd==='SET')store.set(key,value);return reply(200,{result:cmd==='GET'?store.get(key):'OK'});}
  const u=new URL(url);
  if(u.searchParams.get('level')==='campaign'&&!u.searchParams.has('time_increment')&&JSON.parse(u.searchParams.get('time_range')||'{}').since===require('../lib/glv-meta-dates.cjs').monthRange('last_7d',false).since){attempts++;return {ok:true,status:200,json:async()=>{throw new SyntaxError('invalid')}};}
  return reply(200,{data:[]});
 };
 try{const result=await runRefresh('test',false);assert.equal(attempts,1);assert.equal(store.get('glv:aggregate:last_7d'),'last-good');assert.equal(result.freshness.all_tabs_verified,false);assert.ok(result.allErrors.some(e=>e.includes('Meta response body invalid')));}finally{global.fetch=oldFetch;process.env=env;}
});
test('network transport failures retry boundedly without leaking their URL',async()=>{
 let calls=0;const fetcher=metaRetryFetcher(async()=>{if(++calls<3)throw new TypeError('network failed');return reply(200,{data:[]})},10000,{now:()=>0,sleep:async()=>{}});
 assert.equal((await fetcher('https://graph.facebook.com')).ok,true);assert.equal(calls,3);
});
test('transient classes are bounded; auth/schema errors and Redis never retry',async()=>{
 for(const [status,error,expected] of [[429,{},3],[503,{},3],[400,{is_transient:true},3],[400,{code:190,is_transient:true},1],[500,{code:100},1],[400,{code:10},1],[400,{code:200},1],[400,{code:1},1]]){
  let calls=0;const result=await metaRetryFetcher(async()=>{calls++;return reply(status,{error})},10000,{now:()=>0,sleep:async()=>{}})('https://graph.facebook.com/v21.0/insights');assert.equal(calls,expected);assert.equal(result.ok,false);
 }
 let calls=0;await metaRetryFetcher(async()=>{calls++;return reply(500,{error:{code:2}})},10000)('https://redis.test');assert.equal(calls,1);
});
test('backoff cannot extend the shared absolute deadline or ignore upstream abort',async()=>{
 let calls=0,sleeps=0;const source=async()=>{calls++;return reply(400,{error:{code:2}})};
 await assert.rejects(metaRetryFetcher(source,500,{now:()=>0,sleep:async()=>{sleeps++}})('https://graph.facebook.com'),/budget/);assert.equal(calls,1);assert.equal(sleeps,0);
 const controller=new AbortController();controller.abort();await assert.rejects(metaRetryFetcher(source,10000,{now:()=>0})('https://graph.facebook.com',{signal:controller.signal}),/budget/);assert.equal(calls,1);
});
test('retrying a later page never duplicates earlier rows and exhausted pages never publish partial data',async()=>{
 const {fetchAndCache}=require('../api/glv-meta-ads/cron.js')._test;
 const env={...process.env};Object.assign(process.env,{KV_REST_API_URL:'https://redis.test',KV_REST_API_TOKEN:'test'});delete process.env.UPSTASH_REDIS_REST_URL;delete process.env.UPSTASH_REDIS_REST_TOKEN;
 try{for(const exhaust of [false,true]){
  const store=new Map([['glv:aggregate:last_7d','last-good']]);let attempts=0;
  const fetcher=metaRetryFetcher(async(url,options={})=>{
   if(url==='https://redis.test'){const [cmd,key,value]=JSON.parse(options.body);if(cmd==='SET')store.set(key,value);return reply(200,{result:cmd==='GET'?store.get(key):'OK'});}
   const u=new URL(url);if(u.pathname==='/page2'){attempts++;return exhaust||attempts<3?reply(400,{error:{code:2,error_subcode:1504044}}):reply(200,{data:[{campaign_id:'second',campaign_name:'BAU',spend:'2'}]});}
   if(u.searchParams.get('level')==='campaign'&&!u.searchParams.has('time_increment'))return reply(200,{data:[{campaign_id:'first',campaign_name:'BAU',spend:'1'}],paging:{next:'https://graph.facebook.com/page2'}});
   return reply(200,{data:[]});
  },Date.now()+10000,{sleep:async()=>{}});
  const result=await fetchAndCache('test','last_7d',false,fetcher);assert.equal(attempts,3);
  if(exhaust){assert.equal(store.get('glv:aggregate:last_7d'),'last-good');assert.equal(result.errors.length,1);}
  else{assert.deepEqual(JSON.parse(store.get('glv:aggregate:last_7d')).rows.map(r=>r.id),['first','second']);assert.equal(result.errors.length,0);}
 }}finally{process.env=env;}
});
test('history and presets share a bounded body deadline even when provider never finishes',async()=>{
 const {runRefresh}=require('../api/glv-meta-ads/cron.js')._test;const env={...process.env},oldFetch=global.fetch;Object.assign(process.env,{KV_REST_API_URL:'https://redis.test',KV_REST_API_TOKEN:'test'});delete process.env.UPSTASH_REDIS_REST_URL;delete process.env.UPSTASH_REDIS_REST_TOKEN;
 let aborted=0;global.fetch=async(url,options)=>{options.signal.addEventListener('abort',()=>aborted++);return {ok:true,status:200,json:()=>new Promise(()=>{})}};
 try{const start=Date.now(),result=await runRefresh('test',false,{timeoutMs:25});assert.ok(Date.now()-start<500);assert.ok(aborted>0);assert.equal(result.freshness.all_tabs_verified,false);assert.ok(result.allErrors.length>0);}finally{global.fetch=oldFetch;process.env=env;}
});
