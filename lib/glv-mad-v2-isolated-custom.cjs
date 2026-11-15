'use strict';
const runtime=require('./glv-mad-v2-isolated.cjs'),cache=require('./glv-mad-v2-cache.cjs'),reader=require('./glv-mad-v2-isolated-reader.cjs');
const slot=range=>'custom:'+parseInt(require('./glv-history-publication.cjs').digest(range).slice(0,8),16)%8;
function connection(fetcher=fetch,deadline=Date.now()+45000){
 const config=require('../api/glv-meta-ads/fb-data.js')._test.resolveRedisConfig();if(!config)throw Error('Redis unavailable');
 const transport=cache.boundedTransport(fetcher,deadline,10000);
 return async(...args)=>{const r=await transport(config.url,{method:'POST',headers:{Authorization:`Bearer ${config.token}`,'Content-Type':'application/json'},body:JSON.stringify(args)});const b=await r.json();if(!r.ok||b.error)throw Error('Redis unavailable');return b;};
}
async function get({scope,redis,fetcher=fetch,deadline=Date.now()+45000,now=new Date(),token,tokenFor,...options}){
 redis ||= connection(fetcher,deadline);
 const preset=slot(scope.range),key=runtime.PREFIX+'custom-lease:'+preset,owner=require('node:crypto').randomUUID();
 const read=async()=>{try{const b=await runtime.readPreset(redis,preset);return b&&b.daily.range.since===scope.range.since&&b.daily.range.until===scope.range.until?reader.render(b,scope):null;}catch{return null;}};
 const prior=await read();if(prior?.coverage_complete&&Date.now()-Date.parse(prior.generated_at)<90000000)return prior;
 if((await redis('SET',key,owner,'NX','PX',Math.max(1000,Math.floor(deadline-Date.now()+2000)))).result!=='OK'){
  if(prior)return prior;
  while(Date.now()<deadline-1000){const result=await read();if(result)return result;if(!(await redis('GET',key)).result)break;await new Promise(r=>setTimeout(r,200));}return null;
 }
 try{
  const credentialFor=tokenFor||(a=>token||(a.label==='TGLV'?process.env.GLV_MAD_V2_FB_ACCESS_TOKEN:null)||process.env.GLV_META_FB_ACCESS_TOKEN||process.env.FB_ACCESS_TOKEN);
  await runtime.refresh({...options,redis,fetcher,deadline,now,token,tokenFor:credentialFor,mode:'morning',presets:[preset],ranges:{[preset]:scope.range},includePromo:false});
  return await read()||prior;
 }finally{try{await redis('EVAL',"if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0",1,key,owner);}catch{}}
}
module.exports={slot,get,connection};
