const test=require('node:test'),assert=require('node:assert/strict');
const handler=require('../api/glv-meta-ads/cron.js');
test('authenticated scheduled handler recovers failed Nov3 history then skips without Meta and shares one lease',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-11-04T16:00:00Z')});
 const env={...process.env},oldFetch=global.fetch;Object.assign(process.env,{CRON_SECRET:'test',GLV_META_FB_ACCESS_TOKEN:'test',KV_REST_API_URL:'https://redis.test',KV_REST_API_TOKEN:'test'});delete process.env.UPSTASH_REDIS_REST_URL;delete process.env.UPSTASH_REDIS_REST_TOKEN;
 const store=new Map();let fail=true,meta=0,transients=2;
 global.fetch=async(url,options={})=>{
 let data,status=200;
 if(url==='https://redis.test'){
 const [cmd,key,value,...args]=JSON.parse(options.body);let result='OK';
 if(cmd==='SET'){if(args.includes('NX')&&store.has(key))result=null;else store.set(key,value);}
 if(cmd==='GET')result=store.get(key)||null;
 if(cmd==='TTL')result=-1;
 if(cmd==='EVAL'){if(store.get(args[0])===args[1]){store.delete(args[0]);result=1}else result=0;}
 data={result};
 }else{meta++;if(fail&&options.headers?.Authorization){status=400;data={error:{code:190}}}else if(!fail&&options.headers?.Authorization&&transients>0){status=transients--===2?503:429;return {ok:false,status,json:async()=>{throw new SyntaxError('non-JSON provider body')}}}else data={data:[]};}
 return {ok:status===200,status,json:async()=>data};
 };
 const run=async()=>{let status,body;await handler({headers:{authorization:'Bearer test'},query:{}},{status(s){status=s;return this},json(b){body=b}});return {status,body}};
 try{
 assert.equal((await run()).status,500);fail=false;
 const success=await run();assert.equal(success.status,200);assert.equal(success.body.freshness.through,'2026-11-03');assert.equal(success.body.freshness.all_tabs_verified,true);
 assert.equal(transients,0);const before=meta,skip=await run();assert.equal(skip.body.skipped,'already_verified');assert.equal(meta,before);
 for(const preset of ['last_7d','last_14d','last_30d','last_90d','this_month','last_month'])for(const type of ['aggregate','daily','ads'])assert.equal(JSON.parse(store.get(`glv:${type}:${preset}`)).range.until,preset==='last_month'?'2026-10-31':'2026-11-03');
 assert.equal(JSON.parse(store.get('glv:promo_formats:history:v1')).range.until,'2026-11-03');
 }finally{global.fetch=oldFetch;process.env=env;}
});
