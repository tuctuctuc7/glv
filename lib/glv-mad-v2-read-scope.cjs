'use strict';
const storage=require('./glv-mad-v2-storage.cjs');
const {digest}=require('./glv-history-publication.cjs');
// Invocation-local transport reuse, never a process/global cache. Only exact
// content-addressed isolated publication pieces qualify; manifests, work,
// checkpoints, intents, leases and absent/invalid responses always hit Redis.
function createReadScope(redis,{maxBytes=32*1024*1024}={}){
 const entries=new Map();let bytes=0;
 const forget=key=>{const e=entries.get(key);if(e){bytes-=e.bytes||0;entries.delete(key);}};
 return async function scopedRedis(command,...args){
  const key=args[0];
  if(command!=='GET'){
   // SET must still receive a real remote readback. Unknown mutations/scripts
   // conservatively invalidate everything, including pending reads.
   const invalidate=()=>{if(command==='SET')forget(key);else if(command!=='TTL'){entries.clear();bytes=0;}};
   invalidate();
   try{return await redis(command,...args);}finally{invalidate();}
  }
  const match=typeof key==='string'&&key.match(/^glv:mad:v2:isolated:1:.+:piece:(?:daily|aggregate|ads):([a-f0-9]{64})$/);
  if(!match)return redis(command,...args);
  let entry=entries.get(key);
  if(!entry){
   entry={bytes:0};entries.set(key,entry);
   entry.pending=(async()=>{
    try{
     const response=await redis(command,...args),raw=response?.result;
     // Cache raw immutable strings, not decoded mutable objects or responses.
     // Publication readers still decode/hash/schema-check on every use.
     let valid=false;
     try{valid=typeof raw==='string'&&digest(storage.decode(raw))===match[1];}catch{/* Let the ordinary consumer reject malformed storage. */}
     if(!valid){if(entries.get(key)===entry)forget(key);return raw;}
     const size=Buffer.byteLength(raw);
     if(entries.get(key)===entry){
      if(size>maxBytes-bytes)forget(key);
      else {entry.bytes=size;bytes+=size;}
     }
     return raw;
    }catch(error){if(entries.get(key)===entry)forget(key);throw error;}
   })();
  }
  return {result:await entry.pending};
 };
}
module.exports={createReadScope};
