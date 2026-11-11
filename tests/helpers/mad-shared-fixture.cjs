'use strict';
// Synthetic test-fixture migration only. Never imported by production code.
const storage=require('../../lib/glv-mad-v2-storage.cjs'),source=require('../../lib/glv-mad-v2-source.cjs'),shared=require('../../lib/glv-mad-shared.cjs'),cache=require('../../lib/glv-mad-v2-cache.cjs');
const redisFor=store=>async(cmd,key,value)=>{if(cmd==='SET'){store.set(key,value);return {result:'OK'};}if(cmd==='EVAL')return {result:1};return {result:cmd==='TTL'?-1:store.get(key)||null};};
async function publishSyntheticShared(store,preset,native){
 const read=async k=>{const b=store.get(k);return b?storage.decode(b):null;};
 native ||= await cache.readPublished(read,preset);
 const raw=r=>{
  const out={...r,id:r.source_id||r.id};
  for(const k of ['campaign_id','adset_id','ad_id'])if(r['source_'+k])out[k]=r['source_'+k];
  for(const k of Object.keys(out))if(k.startsWith('source_')||['account_id','account_label','account_timezone','report_currency','native_currency','native','fx','market','naming_warning','daily_provenance'].includes(k))delete out[k];
  if(r.creator_rows)out.creator_rows=r.creator_rows.map(raw);
  return out;
 };
 const legacy=Object.fromEntries(cache.TYPES.map(type=>{const p=source.renderSnapshot(native[type],'CZK','TUC');return [type,{...p,rows:p.rows.map(r=>({...raw(r),...(type==='aggregate'?{date_start:p.range.since,date_stop:p.range.until}:{})}))}];}));
 // The synthetic fixture explicitly declares its direct-period observations;
 // these tests use equal period/daily monetary inputs, unlike production.
 const b=shared.compose({legacy,native});await shared.save(redisFor(store),preset,b);return b;
}
module.exports={publishSyntheticShared,redisFor};
