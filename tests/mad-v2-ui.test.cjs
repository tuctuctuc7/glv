const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=p=>fs.readFileSync(p,'utf8');
test('V2 history refresh uses the exact currency/account-scoped request key',()=>{
 for(const file of ['promo-concepts-ui.js','promo-format-ui.js'])assert.ok(read('public/glv-meta-ads-v2/'+file).includes("responseCache.invalidate(apiUrl('promo_formats'))"));
});
test('existing login accepts V2 without any original asset edits',()=>{
 const html=read('public/glv-meta-ads/login.html'),fn=html.match(/function nextPath\(\)\{[\s\S]*?\n\}/)[0];
 for(const next of ['/glv-meta-ads-v2/','/glv-meta-ads-v2/?currency=CZK&account=TGLV']){
  const context={URLSearchParams,window:{location:{search:'?next='+encodeURIComponent(next)}}};vm.createContext(context);vm.runInContext(fn+';this.result=nextPath()',context);assert.equal(context.result,next);
 }
});
test('V2 full UI retains original tabs with isolated loaders and dynamic currency',()=>{
 const html=read('public/glv-meta-ads-v2/index.html');
 for(const tab of ['czsk','us','czsk-triage','czsk-promo','czsk-promo-creative','czsk-leadgen','wl'])assert.ok(html.includes(`panel-${tab}`),tab);
 assert.ok(html.includes('id="v2-currency"'));assert.ok(html.includes('id="v2-account"'));
 assert.ok(html.includes('/api/glv-meta-ads-v2/fb-data'));
 assert.ok(!html.includes('/api/glv-meta-ads/fb-data'));
 assert.ok(!html.includes('api.frankfurter.dev'));
 assert.ok(html.includes('MadV2Dates.rangeFor(p)'));
});
test('middleware protects V2 page and every V2 API and preserves neighboring route behavior',async()=>{
 const source=read('middleware.js').replace('export default async function middleware','async function middleware').replace('export const config','const config')+'\nthis.middleware=middleware;this.config=config;';
 const context={URL,Response,process:{env:{GLV_META_BETA_AUTH_TOKEN:'synthetic-auth'}}};vm.createContext(context);vm.runInContext(source,context);
 for(const path of ['/glv-meta-ads-v2/','/glv-meta-ads-v2/index.html','/glv-meta-ads/'])assert.equal((await context.middleware(new Request('https://lab.agenthic.com'+path))).status,302);
 for(const path of ['/api/glv-meta-ads-v2/fb-data','/api/glv-meta-ads-v2/future-api'])assert.equal((await context.middleware(new Request('https://lab.agenthic.com'+path))).status,401);
 assert.equal(await context.middleware(new Request('https://lab.agenthic.com/glv-meta-ads-v2/',{headers:{cookie:'glv_meta_beta=synthetic-auth'}})),undefined);
 assert.equal(await context.middleware(new Request('https://lab.agenthic.com/glv/')),undefined);
 assert.ok(context.config.matcher.includes('/api/glv-meta-ads-v2/:path*'));
});
