'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHandler}=require('../api/glv-meta-ads-v2/cron.js')._test;
const env={CRON_SECRET:'test-only',FB_ACCESS_TOKEN:'tuc-test',GLV_MAD_V2_FB_ACCESS_TOKEN:'tglv-test',GLV_MAD_V2_ENABLED:'1',KV_REST_API_URL:'https://redis.test',KV_REST_API_TOKEN:'redis-test'};
async function invoke(handler,query={},headers={authorization:'Bearer test-only'},method='GET'){
 let status,body;await handler({method,query,headers},{setHeader(){},status(s){status=s;return this;},json(b){body=b;}});return {status,body};
}
test('V2 cron authenticates and rejects unscoped or current-day work before refresh',async()=>{
 let calls=0;const handler=createHandler({env,refresh:async()=>{calls++;return {verified:true};}});
 assert.equal((await invoke(handler,{mode:'morning'},{})).status,401);
 for(const query of [{},{mode:'other'},{mode:'late',include_today:'1'},{mode:'late',full_history:'1'}])assert.equal((await invoke(handler,query)).status,400);
 assert.equal((await invoke(handler,{mode:'late'},undefined,'POST')).status,405);
 assert.equal(calls,0);
});
test('morning and late reach the isolated coordinator with explicit account credential routing',async()=>{
 const seen=[];const handler=createHandler({env,refresh:async options=>{seen.push(options);return {verified:true,mode:options.mode,through:'2026-11-14',summaries:[],errors:[]};}});
 for(const mode of ['morning','late']){const result=await invoke(handler,{mode});assert.equal(result.status,200);assert.equal(result.body.ok,true);assert.equal(result.body.mode,mode);}
 assert.deepEqual(seen.map(o=>o.mode),['morning','late']);
 for(const o of seen){assert.equal(o.tokenFor({id:'359758259164738'}),'tuc-test');assert.equal(o.tokenFor({id:'1021777267558882'}),'tglv-test');assert.throws(()=>o.tokenFor({id:'invalid'}));assert.equal(typeof o.redis,'function');assert.equal(o.force,false);}
});
test('failed or incomplete V2 completion never claims success and returns no internal exception',async()=>{
 const failed=createHandler({env,refresh:async()=>({verified:false,errors:['budget'],summaries:[]})});assert.equal((await invoke(failed,{mode:'late'})).status,503);
 const thrown=createHandler({env,refresh:async()=>{throw Error('sensitive internal detail');}});const result=await invoke(thrown,{mode:'late'});assert.equal(result.status,500);assert.doesNotMatch(JSON.stringify(result.body),/sensitive internal/);
});
test('bearer-protected audit reads published consumers without source refresh',async()=>{
 let reads=0,refreshes=0;const handler=createHandler({env,refresh:async()=>{refreshes++;},audit:async options=>{reads++;assert.equal(options.includePayload,true);assert.deepEqual(options.presets,['last_7d']);return {verified:true,presets:[{preset:'last_7d',payloads:{CZK:{daily:{rows:[]},ads:{rows:['excluded']}},USD:{daily:{rows:['excluded']}}}}]};}});
 const query={mode:'audit',include_payload:'1',preset:'last_7d',type:'daily',currency:'CZK'};
 assert.equal((await invoke(handler,query,{})).status,401);
 const result=await invoke(handler,query);
 assert.equal(result.status,200);assert.equal(result.body.read_only,true);assert.equal(reads,1);assert.equal(refreshes,0);
 assert.deepEqual(result.body.presets[0].payload,{rows:[]});assert.equal(result.body.presets[0].payloads,undefined);
 assert.equal((await invoke(handler,{mode:'audit',include_payload:'1'})).status,400);
 assert.equal((await invoke(handler,{mode:'morning',include_payload:'1'})).status,400);
});
test('two V2 scheduled paths separate morning and LA-completion passes',()=>{
 const config=require('../vercel.json'),jobs=config.crons.filter(j=>j.path.startsWith('/api/glv-meta-ads-v2/cron'));
 assert.equal(jobs.length,2);assert.ok(jobs.some(j=>j.path==='/api/glv-meta-ads-v2/cron?mode=morning'));assert.ok(jobs.some(j=>j.path==='/api/glv-meta-ads-v2/cron?mode=late'));
 assert.equal(config.functions['api/glv-meta-ads-v2/cron.js'].maxDuration,300);
 assert.ok(config.crons.some(j=>j.path==='/api/glv-meta-ads/cron'));
});
