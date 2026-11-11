const {createHash,randomUUID}=require('node:crypto');
const LOCK_KEY='glv:refresh:lease:v1',STATE_KEY='glv:refresh:complete:v1';
const hash=value=>createHash('sha256').update(value).digest('hex');
const RELEASE="if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end";
async function scheduledRefresh({redis,refresh,keys,through,force=false,beforeVerify}){
 const owner=randomUUID();
 // Lease exceeds Vercel's hard 300s invocation cap; a killed owner expires.
 const acquired=await redis('SET',LOCK_KEY,owner,'NX','EX','330');
 if(acquired.result===null)return {allErrors:[],summaries:[],skipped:'refresh_in_progress',freshness:{through,all_tabs_verified:false}};
 if(acquired.result!=='OK')throw new Error('Refresh lease was not acknowledged');
 const verify=async hashes=>{
  if(!hashes||keys.some(key=>typeof hashes[key]!=='string'))return false;
  for(const key of new Set([...keys,...Object.keys(hashes)])){const {result}=await redis('GET',key);if(typeof result!=='string'||hash(result)!==hashes[key])return false;}
  return true;
 };
 try{
  // Independently fresh dimensions run under the same lease even when all
  // performance bytes already match a completed-day receipt.
  if(beforeVerify)await beforeVerify();
  let previous;try{previous=JSON.parse((await redis('GET',STATE_KEY)).result);}catch(error){if(!(error instanceof SyntaxError))throw error;}
  if(!force&&previous?.creator_completeness_version===1&&previous?.through===through&&previous?.freshness?.all_tabs_verified===true&&await verify(previous.hashes)){
   return {allErrors:[],summaries:previous.summaries||[],freshness:previous.freshness,skipped:'already_verified'};
  }
  // A failed force must not leave the previous successful receipt eligible
  // for the normal owner's fast path, even if no source key was written.
  if(force&&previous?.freshness?.all_tabs_verified===true){
   const invalid=JSON.stringify({through,freshness:{all_tabs_verified:false}});
   if((await redis('SET',STATE_KEY,invalid,'EX','90000')).result!=='OK'||(await redis('GET',STATE_KEY)).result!==invalid)throw Error('Force receipt invalidation not verified');
  }
  const result=await refresh();
  if(!force&&result.allErrors.length===0&&result.freshness?.all_tabs_verified===true){
   if(!await verify(result.hashes))throw new Error('Completed refresh cache verification mismatch');
   // No large ad ID inventories in the durable completion receipt.
   const summaries=JSON.parse(JSON.stringify(result.summaries||[],(key,value)=>['eligible_ad_ids','unverified_ad_ids'].includes(key)?undefined:value));
   const serialized=JSON.stringify({creator_completeness_version:1,through,hashes:result.hashes,freshness:result.freshness,summaries});
   await redis('SET',STATE_KEY,serialized,'EX','90000');
   if((await redis('GET',STATE_KEY)).result!==serialized)throw new Error('Refresh completion readback mismatch');
  }
  return result;
 }finally{
  // Never delete another invocation's lease, even after an unexpected expiry.
  await redis('EVAL',RELEASE,'1',LOCK_KEY,owner);
 }
}
module.exports={scheduledRefresh,LOCK_KEY,STATE_KEY,hash};
