'use strict';
const publication=require('./glv-history-publication.cjs'),storage=require('./glv-mad-v2-storage.cjs'),cache=require('./glv-mad-v2-cache.cjs'),promo=require('./glv-mad-v2-promo.cjs'),names=require('./glv-campaign-metadata.cjs');
const KEY='glv:mad:shared:1:promo';
function semantic(payload){
 const rows=payload.rows.map(r=>{const out={...r};for(const k of ['campaign_id','adset_id','ad_id']){if(out['source_'+k])out[k]=out['source_'+k];delete out['source_'+k];}for(const k of ['account_id','account_label','native_currency','account_timezone','report_currency','market','native','fx'])delete out[k];return out;});
 // Stable deep keys, not a totals-only projection; includes inventory and signed ghosts.
 const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,stable(v[k])])):v;
 return publication.digest(rows.map(stable).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
}
function validate(pieces){
 const snapshot=pieces.daily.snapshot,generation=publication.digest(snapshot);
 for(const t of publication.TYPES)if(pieces[t].generation_id!==generation)throw Error('Invalid shared Promo generation');
 promo.renderPromo(snapshot,'USD');promo.renderPromo(snapshot,'CZK');
}
async function save(redis,snapshot){
 const generation_id=publication.digest(snapshot),range=snapshot.payload.range;
 const pieces={daily:{range,generation_id,snapshot},aggregate:{range,generation_id},ads:{range,generation_id}};
 const read=async k=>{const b=(await redis('GET',k)).result;return b?storage.decode(b):null;};
 await publication.publishBundle({key:KEY,pieces,validate,read,write:(k,v)=>cache.publish(redis,k,v),retire:publication.retireRedis(redis,storage.decode)});
 const actual=await publication.readBundle({key:KEY,read,validate});
 if(actual.daily.generation_id!==generation_id)throw Error('Shared Promo readback mismatch');
 const manifest=await read(KEY),storage_hashes={};
 for(const k of [KEY,...Object.values(manifest.refs).map(r=>r.key)])storage_hashes[k]=require('./glv-refresh-owner.cjs').hash((await redis('GET',k)).result);
 return {storage_hashes,key:KEY,sha256:require('./glv-refresh-owner.cjs').hash((await redis('GET',KEY)).result),generation_id,semantic_sha256:semantic(snapshot.payload)};
}
async function readRender(read,{version,type,currency='CZK',account='TUC',range},metadata){
 const pieces=await publication.readBundle({key:KEY,read,validate});if(!pieces)return null;
 const snapshot=pieces.daily.snapshot;
 const payload=require('./glv-promo-format.cjs').sliceCachedFormats(snapshot.payload,range||snapshot.payload.range,new Date(),{allowStale:true});
 if(!payload)throw Error('Unsupported Promo range');
 if(type==='promo_concepts'&&!require('../public/glv-meta-ads/promo-format.js').validConceptPayload(payload))throw Error('Incomplete Promo concepts');
 const generation_id=pieces.daily.generation_id;
 const result=version==='v1'?names.applyPayload(payload,require('./glv-mad-v2.cjs').ACCOUNTS[0].id,type,metadata):promo.renderPromo({...snapshot,payload},currency,account,new Date(),metadata);
 return {...result,generation_id,...names.bindGeneration({generation_id},metadata?names.digest(metadata):undefined),shared_generation_id:generation_id};
}
module.exports={KEY,save,readRender,semantic};
