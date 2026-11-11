'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {auditMetrics}=require('../lib/glv-campaign-metadata.cjs');
const [tuc,tglv]=require('../lib/glv-mad-v2.cjs').ACCOUNTS;
test('protected published parity summaries compare only TUC CZK, not merged TGLV or child allocations',()=>{
 const row={id:'42',amount_spent:'12.5','action_values:omni_purchase':'25','actions:omni_purchase':'2',creator_rows:[{amount_spent:12.5}]};
 const v1=auditMetrics({rows:[row]},'aggregate');
 const v2=auditMetrics({rows:[{...row,id:`${tuc.id}:42`,account_id:tuc.id},{...row,account_id:tglv.id,amount_spent:1000}]},'aggregate');
 assert.deepEqual(v2,v1);assert.equal(v2.currency,'CZK');assert.equal(v2.rows,1);assert.equal(v2.totals.amount_spent,12.5);
 assert.throws(()=>auditMetrics({rows:[{amount_spent:'broken'}]},'daily'),/Invalid parity audit metric/);
});
test('ordinary cron does not perform the heavy full-consumer audit after refresh',()=>{
 const source=fs.readFileSync(require.resolve('../api/glv-meta-ads/cron.js'),'utf8');
 const audit=source.slice(source.indexOf('const metadataAudit=async()=>{'),source.indexOf('if(namesOnly){'));
 assert.ok(audit.indexOf('if(!namesOnly&&!campaignId)return []')<audit.indexOf('await names.read'));
});
test('ordinary cron never calls consumer audit; explicit audit failure returns bounded diagnostics',async()=>{
 const vm=require('node:vm'),filename=require.resolve('../api/glv-meta-ads/cron.js'),localRequire=require('node:module').createRequire(filename);
 for(const explicit of [false,true]){
  let auditCalls=0;
  const metadata={refresh:async()=>({metadata:{accounts:[]},readback_verified:true}),read:async()=>({}),auditPublished:async()=>{auditCalls++;throw Error('synthetic audit failure');}};
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,exports:module.exports,require:id=>id.endsWith('/glv-campaign-metadata.cjs')?metadata:id.endsWith('/glv-mad-v2.cjs')?{...localRequire(id),rolloutEnabled:()=>true}:id.endsWith('/glv-refresh-owner.cjs')?{scheduledRefresh:async opts=>{await opts.beforeVerify?.();return {allErrors:[],summaries:[],freshness:{all_tabs_verified:true}};}}:localRequire(id),process:{env:{CRON_SECRET:'test-only',GLV_META_FB_ACCESS_TOKEN:'test-only',KV_REST_API_URL:'https://redis.test',KV_REST_API_TOKEN:'test-only',GLV_MAD_V2_ENABLED:'1'}},console:{log(){},error(){}},Buffer,URL,AbortController,AbortSignal,setTimeout,clearTimeout,fetch:async()=>{throw Error('Unexpected network');}}, {filename});
  const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
  await module.exports({headers:{authorization:'Bearer test-only'},query:explicit?{campaign_id:'42'}:{}},res);
  assert.equal(auditCalls,explicit?1:0);
  assert.equal(res.code,explicit?500:200);
  if(explicit)assert.equal(res.body.summaries.at(-1).consumers[0].status,'audit_unavailable');
 }
});
test('consumer audit stops before any reads when its deadline is exhausted',async()=>{
 const {auditPublished}=require('../lib/glv-campaign-metadata.cjs');let reads=0;
 const result=await auditPublished(async()=>{reads++;return null;},null,{v2Enabled:true,deadline:Date.now()-1});
 assert.equal(reads,0);assert.equal(result[0].status,'audit_unavailable');assert.equal(result[0].reason,'budget_exhausted');
});
