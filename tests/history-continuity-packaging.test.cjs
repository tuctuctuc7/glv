const test=require('node:test'),assert=require('node:assert/strict');
const config=require('../vercel.json');
test('both data readers and the shared refresh ship history publication dependencies',()=>{
 for(const route of ['api/glv-meta-ads/fb-data.js','api/glv-meta-ads-v2/fb-data.js','api/glv-meta-ads/cron.js']){
  assert.ok(config.functions[route].includeFiles.includes('lib/glv-history*.cjs'),route+' must bundle durable publication helpers');
 }
 assert.deepEqual(config.crons.map(job=>job.path),['/api/glv-meta-ads/cron']);
});
