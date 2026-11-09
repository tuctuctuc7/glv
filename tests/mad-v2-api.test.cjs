const test=require('node:test'),assert=require('node:assert/strict');
const handler=require('../api/glv-meta-ads-v2/fb-data.js');
function response(){return {code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(value){this.body=value;return this;}};}
test('V2 handler enforces beta cookie before any source access',async()=>{
 const original=process.env.GLV_META_BETA_AUTH_TOKEN;process.env.GLV_META_BETA_AUTH_TOKEN='synthetic-auth';
 try{const res=response();await handler({method:'GET',headers:{},query:{}},res);assert.equal(res.code,401);assert.equal(res.headers['Cache-Control'],'private, no-store');}
 finally{if(original===undefined)delete process.env.GLV_META_BETA_AUTH_TOKEN;else process.env.GLV_META_BETA_AUTH_TOKEN=original;}
});
test('beta authentication alone does not activate V2 source reads',async()=>{
 const saved={...process.env},originalFetch=global.fetch;let calls=0;
 process.env.GLV_META_BETA_AUTH_TOKEN='synthetic-auth';delete process.env.GLV_MAD_V2_ENABLED;
 global.fetch=async()=>{calls++;throw Error('must not read');};
 try{const res=response();await handler({method:'GET',headers:{cookie:'glv_meta_beta=synthetic-auth'},query:{type:'daily'}},res);assert.equal(res.code,503);assert.equal(res.body.error,'V2 rollout is disabled');assert.equal(calls,0);}
 finally{global.fetch=originalFetch;for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);}
});
test('V2 rejects invalid type, future/inverted dates, currency and filter without Meta',async()=>{
 const original=process.env.GLV_META_BETA_AUTH_TOKEN;process.env.GLV_META_BETA_AUTH_TOKEN='synthetic-auth';
 try{for(const query of [{type:'bad'},{type:'daily',currency:'EUR'},{type:'daily',account:'invalid'},{type:'daily',time_range:'{"since":"2025-01-05","until":"2025-01-01"}'},{type:'daily',time_range:'{"since":"2099-01-01","until":"2099-01-02"}'}]){const res=response();await handler({method:'GET',headers:{cookie:'glv_meta_beta=synthetic-auth'},query},res);assert.equal(res.code,400);}}
 finally{if(original===undefined)delete process.env.GLV_META_BETA_AUTH_TOKEN;else process.env.GLV_META_BETA_AUTH_TOKEN=original;}
});
