'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('actual middleware admits only bearer-authorized V2 cron without a dashboard cookie',async()=>{
 const saved={CRON_SECRET:process.env.CRON_SECRET,GLV_META_CRON_SECRET:process.env.GLV_META_CRON_SECRET,GLV_META_BETA_AUTH_TOKEN:process.env.GLV_META_BETA_AUTH_TOKEN};
 Object.assign(process.env,{CRON_SECRET:'synthetic-scheduler',GLV_META_CRON_SECRET:'synthetic-fallback',GLV_META_BETA_AUTH_TOKEN:'synthetic-cookie'});
 try{
  const {default:middleware}=await import('data:text/javascript;base64,'+fs.readFileSync(require('node:path').join(__dirname,'../middleware.js')).toString('base64'));
  const call=(path,token)=>middleware(new Request('https://lab.agenthic.com'+path,{headers:token?{authorization:'Bearer '+token}:{}}));
  for(const mode of ['morning','late','audit'])assert.equal(await call('/api/glv-meta-ads-v2/cron?mode='+mode,'synthetic-scheduler'),undefined);
  for(const token of [undefined,'wrong','synthetic-fallback'])assert.equal((await call('/api/glv-meta-ads-v2/cron?mode=morning',token)).status,401);
  for(const path of ['/api/glv-meta-ads-v2/fb-data','/api/glv-meta-ads-v2/cron-extra','/api/glv-meta-ads-v2/cron/nested'])assert.equal((await call(path,'synthetic-scheduler')).status,401);
  assert.equal((await call('/glv-meta-ads-v2/','synthetic-scheduler')).status,302);
  delete process.env.CRON_SECRET;assert.equal(await call('/api/glv-meta-ads-v2/cron?mode=late','synthetic-fallback'),undefined);
 }finally{for(const [key,value] of Object.entries(saved))if(value===undefined)delete process.env[key];else process.env[key]=value;}
});
