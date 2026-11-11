'use strict';
// Eight bounded slots, one global owner lease, one exact range policy in both APIs.
// Custom reads never force scheduled histories or certify scheduled completion.
const shared=require('./glv-mad-shared.cjs'),v2=require('./glv-mad-v2.cjs'),cache=require('./glv-mad-v2-cache.cjs'),storage=require('./glv-mad-v2-storage.cjs');
const slot=range=>'custom:'+parseInt(require('./glv-history-publication.cjs').digest(range).slice(0,8),16)%8;
async function get({scope,version,metadata}){
 const {range,type,currency,account}=scope,preset=slot(range),deadline=Date.now()+45000;
 const fetcher=cache.boundedTransport(fetch,deadline,10000);
 const config=require('../api/glv-meta-ads/fb-data.js')._test.resolveRedisConfig();
 if(!config)throw Error('Redis unavailable');
 const command=transport=>async(...args)=>{const r=await transport(config.url,{method:'POST',headers:{Authorization:`Bearer ${config.token}`,'Content-Type':'application/json'},body:JSON.stringify(args)});const b=await r.json();if(!r.ok||b.error)throw Error('Redis unavailable');return b;};
 const redis=command(fetcher);
 const read=async k=>{const raw=(await redis('GET',k)).result;return raw?storage.decode(raw):null;};
 const exact=b=>b&&b.range.since===range.since&&b.range.until===range.until;
 let prior;try{prior=await shared.read(read,preset);}catch{}
 const render=b=>shared.render(b,type,version,currency,account,metadata);
 if(exact(prior)&&Date.now()-Date.parse(prior.pieces.ads.v1.generated_at)<90000000)return render(prior);
 const owner=require('./glv-refresh-owner.cjs'),family=`custom:${range.since}:${range.until}:`,id=family+require('node:crypto').randomUUID();
 if((await redis('SET',owner.LOCK_KEY,id,'NX','EX','60')).result!=='OK'){
  if(exact(prior))return render(prior);
  // Coordinate through Redis, not process-local promises. Never acquire a
  // second lease/pull here, or consume another range sharing this cache slot.
  try{
   while(Date.now()<deadline){
    const holder=(await redis('GET',owner.LOCK_KEY)).result;
    const published=await shared.read(read,preset);
    if(exact(published))return render(published);
    if(typeof holder!=='string'||!holder.startsWith(family))break;
    await new Promise(resolve=>setTimeout(resolve,Math.min(250,Math.max(0,deadline-Date.now()))));
   }
  }catch{}
  return null;
 }
 try{
  const token=process.env.GLV_META_FB_ACCESS_TOKEN||process.env.FB_ACCESS_TOKEN;
  if(!token)throw Error('Meta unavailable');
  const result=await require('../api/glv-meta-ads/cron.js')._test.fetchAndCache(token,preset,false,fetcher,{rangeOverride:range,fullHistory:true});
  if(result.errors.length)throw Error('Incomplete legacy source');
  const legacy=await require('./glv-history-v1.cjs').readPublished(read,preset);
  const native={},nativeToken=process.env.GLV_MAD_V2_FB_ACCESS_TOKEN||token,fx=await v2.loadFixings(range,fetcher),reuse={token:nativeToken,accounts:new Map(),snapshots:[]};
  for(const t of cache.TYPES)native[t]=await require('./glv-mad-v2-source.cjs').buildSnapshot({range,type:t,token:nativeToken,fx,fetcher,reuse,deadline:deadline-5000});
  const b=shared.compose({legacy,native});await shared.save(redis,preset,b);
  return render(b);
 }catch(error){if(exact(prior))return render(prior);throw error;}
 finally{
  // The extraction transport may be exhausted. Cleanup gets its own small
  // budget and must preserve both a valid fallback and the primary exception.
  try{await command(cache.boundedTransport(fetch,Date.now()+2000,2000))('EVAL',"if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end",1,owner.LOCK_KEY,id);}catch{}
 }
}
module.exports={slot,get};
