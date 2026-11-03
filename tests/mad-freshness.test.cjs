const test=require('node:test'),assert=require('node:assert/strict');
const {runRefresh,monthRange}=require('../api/glv-meta-ads/cron.js')._test;
const tabs=['czsk','czsk-triage','czsk-promo','czsk-promo-creative','czsk-leadgen','us','wl'];
test('shared job verifies every consumer and exact cache readback, including independent history and WL',async()=>{
 const env={...process.env},oldFetch=global.fetch;process.env.KV_REST_API_URL='https://redis.test';process.env.KV_REST_API_TOKEN='test';delete process.env.UPSTASH_REDIS_REST_URL;delete process.env.UPSTASH_REDIS_REST_TOKEN;
 try{for(const broken of [null,'glv:daily:last_7d','glv:ads:last_month','glv:promo_formats:history:v1']){
 const store=new Map();let history=0;
 global.fetch=async(url,options={})=>{if(url==='https://redis.test'){const [cmd,key,value]=JSON.parse(options.body);if(cmd==='SET')store.set(key,value);return {ok:true,json:async()=>({result:cmd==='GET'?(key===broken?'{}':store.get(key)):cmd==='TTL'?-1:'OK'})};}if(options.headers?.Authorization&&new URL(url).searchParams.get('level')==='campaign')history++;return {ok:true,json:async()=>({data:[]})};};
 const result=await runRefresh('test',false);
 assert.ok(result.freshness,'per-tab verification is mandatory');assert.deepEqual(Object.keys(result.freshness.tabs).sort(),tabs.sort());assert.equal(history,1);
 if(!broken){assert.equal(result.allErrors.length,0);assert.equal(result.freshness.all_tabs_verified,true);for(const tab of tabs)assert.equal(result.freshness.tabs[tab].verified,true);for(const type of ['aggregate','daily','ads']){const p=JSON.parse(store.get(`glv:${type}:last_7d`));assert.deepEqual(p.range,monthRange('last_7d',false));assert.ok(p.generated_at);}}
 else{assert.ok(result.allErrors.length);assert.equal(result.freshness.all_tabs_verified,false);const tab=broken.includes('promo_formats')?'czsk-promo-creative':broken.includes('ads')?'wl':'czsk';assert.equal(result.freshness.tabs[tab].verified,false);}
 }}finally{global.fetch=oldFetch;process.env=env;}
});
