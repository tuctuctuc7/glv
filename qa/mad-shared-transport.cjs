'use strict';
// Offline only: actual API authorization/scope/cache routing over in-memory Redis.
// No environment files are loaded; every network destination is denied except this fake Redis.
const shared=require('../lib/glv-mad-shared.cjs'),promo=require('../lib/glv-mad-shared-promo.cjs');
const storage=require('../lib/glv-mad-v2-storage.cjs'),legacy=require('./mad-full-parity.cjs');
const dates=require('../public/glv-meta-ads-v2/dates.js'),reader=require('../lib/glv-mad-shared-reader.cjs');
function create({clock='2026-11-11T12:00:00Z'}={}){
 const values=new Map(),bundles=new Map(),audit=[];let failWrite=false,hold=false,now=clock;
 const previous={env:{...process.env},fetch:global.fetch,Date:global.Date};
 class Clock extends previous.Date{constructor(...a){super(...(a.length?a:[now]));}static now(){return +new previous.Date(now);}}
 global.Date=Clock;
 Object.assign(process.env,{GLV_MAD_V2_ENABLED:'1',GLV_META_BETA_AUTH_TOKEN:'offline-qa-only',KV_REST_API_URL:'https://redis.invalid',KV_REST_API_TOKEN:'offline-qa-only'});
 const redis=async(cmd,k,val)=>{audit.push({cmd,key:k});if(cmd==='GET')return {result:values.get(k)||null};if(cmd==='TTL')return {result:values.has(k)?-1:-2};if(cmd==='EVAL')return {result:1};if(cmd==='SET'){if(failWrite&&k.includes(':piece:aggregate:'))throw Error('Injected partial publication failure');values.set(k,val);return {result:'OK'};}throw Error('Unexpected offline command '+cmd);};
 global.fetch=async(url,options={})=>{const u=new URL(url);if(u.hostname!=='redis.invalid')throw Error('Offline network denied: '+u.origin);const body=u.pathname.startsWith('/get/')?await redis('GET',decodeURIComponent(u.pathname.slice(5))):await redis(...JSON.parse(options.body));return {ok:true,status:200,json:async()=>body,text:async()=>JSON.stringify(body)};};
 const read=k=>Promise.resolve(values.has(k)?storage.decode(values.get(k)):null);
 async function seed(s){
  const key=s.promo?'promo':s.custom?require('../lib/glv-mad-shared-custom.cjs').slot(s.range):s.preset;
  const identity=key+':'+JSON.stringify(s.range);
  if(hold||bundles.has(identity))return;
  bundles.set(identity,(async()=>{
   // Timestamp is explicitly synthetic source extraction, fixed at publication time.
   const stamp=new Date(Date.now()-3*3600000).toISOString();
   if(s.promo){const payload={...legacy.promoPayload(),range:s.range,generated_at:stamp};await promo.save(redis,{payload,fx:{'2026-10-20':{date:'2026-10-20',czk_per_usd:25,provider:'SYNTHETIC QA ONLY'}}});}
   else{const native=Object.fromEntries(['daily','aggregate','ads'].map(type=>[type,{...legacy.fixture(s.range,type),generated_at:stamp}]));const originals=Object.fromEntries(Object.entries(native).map(([type,n])=>[type,{...legacy.legacyPayload(n,type,s.range),generated_at:stamp}]));await shared.save(redis,key,shared.compose({legacy:originals,native}));}
  })());await bundles.get(identity);
 }
 async function request(q,v2,{authorized=true,method='GET'}={}){
  let s;try{s=reader.scope(Object.fromEntries(q),new Date());}catch{}
  if(s&&authorized&&method==='GET')await seed(s);
  const res={code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(body){this.body=body;return this;}};
  await require(v2?'../api/glv-meta-ads-v2/fb-data.js':'../api/glv-meta-ads/fb-data.js')({method,headers:{cookie:authorized?'glv_meta_beta=offline-qa-only':''},query:Object.fromEntries(q)},res);
  audit.push({handler:v2?'v2':'v1',status:res.code,type:q.get('type'),requestedRange:res.body?.requested_range,readGeneration:res.body?.shared_generation_id,range:res.body?.range});return res;
 }
 async function payload(q,v2){const r=await request(q,v2);if(r.code!==200)throw Error('Handler '+r.code+': '+JSON.stringify(r.body));return r.body;}
 return {payload,request,audit,redis,read,values,reset(){values.clear();bundles.clear();hold=false;},setFailure:x=>{failWrite=x;},hold:x=>{hold=x;},setClock:x=>{now=x;},close(){global.fetch=previous.fetch;global.Date=previous.Date;process.env=previous.env;}};
}
module.exports={create};
