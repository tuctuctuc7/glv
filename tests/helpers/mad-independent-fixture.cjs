'use strict';
const assert=require('node:assert/strict');
const v2=require('../../lib/glv-mad-v2.cjs');
function harness(){
 const store=new Map(),calls=[];let failSource=false,failWrite=false;
 const redis=async(cmd,key,value,...args)=>{
  calls.push([cmd,key]);let result=null;
  if(cmd==='GET')result=store.get(key)||null;
  else if(cmd==='SET'){if(failWrite&&key.includes(':piece:aggregate:'))throw Error('interrupted publication');if(!args.includes('NX')||!store.has(key)){store.set(key,value);result='OK';}}
  else if(cmd==='TTL')result=store.has(key)?-1:-2;
  else if(cmd==='PERSIST')result=store.has(key)?1:0;
  else if(cmd==='EVAL'){if(store.get(args[0])===args[1])store.delete(args[0]);result=1;}
  else throw Error('unexpected Redis command '+cmd);
  return {result};
 };
 const response=body=>({ok:true,status:200,json:async()=>body,text:async()=>JSON.stringify(body)});
 const fetcher=async(url,options={})=>{
  const u=new URL(url);
  if(u.hostname==='redis.test')return response(await redis(...(options.body?JSON.parse(options.body):['GET',decodeURIComponent(u.pathname.slice(5))])));
  if(u.hostname==='www.cnb.cz'){const year=u.searchParams.get('year');let text='Date|1 USD\n';for(let d=year+'-01-01';d<=year+'-12-31';d=v2.shift(d,1))text+=d.split('-').reverse().join('.')+'|25\n';return {ok:true,status:200,text:async()=>text};}
  assert.equal(u.hostname,'graph.facebook.com');calls.push(['GRAPH',u.pathname]);
  if(failSource)return {ok:false,status:403,json:async()=>({error:{code:190}})};
  const a=v2.ACCOUNTS.find(a=>u.pathname.includes(a.id));
  return response(u.searchParams.get('fields')==='account_id,currency,timezone_name,account_status'?{account_id:a.id,currency:a.currency,timezone_name:a.timezone,account_status:1}:{data:[]});
 };
 return {store,calls,redis,fetcher,set failSource(value){failSource=value;},set failWrite(value){failWrite=value;}};
}
async function environment(fn){
 const saved={...process.env},fetcher=global.fetch,log=console.log,error=console.error;
 const h=harness();
 Object.assign(process.env,{GLV_MAD_V2_ENABLED:'1',GLV_META_BETA_AUTH_TOKEN:'test',CRON_SECRET:'test',GLV_META_FB_ACCESS_TOKEN:'test',GLV_MAD_V2_FB_ACCESS_TOKEN:'test',KV_REST_API_URL:'https://redis.test',KV_REST_API_TOKEN:'test'});
 delete process.env.UPSTASH_REDIS_REST_URL;delete process.env.UPSTASH_REDIS_REST_TOKEN;
 global.fetch=h.fetcher;console.log=()=>{};console.error=()=>{};
 try{return await fn(h);}finally{global.fetch=fetcher;console.log=log;console.error=error;process.env=saved;}
}
async function request(handler,query={},headers={cookie:'glv_meta_beta=test'}){
 const res={code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
 await handler({method:'GET',headers,query},res);return res;
}
module.exports={harness,environment,request};
