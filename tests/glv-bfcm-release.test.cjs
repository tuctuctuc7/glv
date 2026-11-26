const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=p=>fs.readFileSync(p,'utf8');
test('BFCM route and assets ship from Git and remain behind GLV login',async()=>{
 assert.ok(fs.existsSync('public/glv-bfcm/index.html'),'BFCM route missing from release source');
 assert.ok(fs.existsSync('api/glv-bfcm/data.js'),'BFCM API missing from release source');
 const source=read('middleware.js').replace('export default async function middleware','async function middleware').replace('export const config','const config')+'\nthis.middleware=middleware;this.config=config;';
 const context={URL,Response,process:{env:{GLV_META_BETA_AUTH_TOKEN:'synthetic-release-token'}}};vm.createContext(context);vm.runInContext(source,context);
 for(const path of ['/glv-bfcm','/glv-bfcm/','/glv-bfcm/index.html','/glv-bfcm/app.js','/glv-bfcm/style.css','/glv-meta-ads/','/glv-meta-ads-v2/']){
  const response=await context.middleware(new Request('https://lab.agenthic.com'+path));assert.equal(response?.status,302,path);assert.match(response.headers.get('location'),/\/glv-meta-ads\/login\?next=/);
  assert.equal(await context.middleware(new Request('https://lab.agenthic.com'+path,{headers:{cookie:'glv_meta_beta=synthetic-release-token'}})),undefined);
 }
 assert.ok(context.config.matcher.includes('/glv-bfcm'));assert.ok(context.config.matcher.includes('/glv-bfcm/:path*'));
 assert.equal(await context.middleware(new Request('https://lab.agenthic.com/glv/')),undefined);
 assert.ok(JSON.parse(read('vercel.json')).functions['api/glv-bfcm/data.js'].includeFiles.includes('lib/glv-bfcm.cjs'));
});
test('login returns to BFCM only for bounded local paths',()=>{
 const fn=read('public/glv-meta-ads/login.html').match(/function nextPath\(\)\{[\s\S]*?\n\}/)[0];
 for(const next of ['/glv-bfcm','/glv-bfcm/','/glv-bfcm?x=1','https://evil.invalid','//evil.invalid','/glv-bfcmevil']){
  const context={URLSearchParams,window:{location:{search:'?next='+encodeURIComponent(next)}}};vm.createContext(context);vm.runInContext(fn+';this.result=nextPath()',context);
  assert.equal(context.result,/^\/glv-bfcm(?:[/?#]|$)/.test(next)?next:'/glv-meta-ads/');
 }
});
