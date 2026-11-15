'use strict';
// Promo remains the established TUC/CZSK product, not invented TGLV history.
const runtime=require('./glv-mad-v2-isolated.cjs'),v2=require('./glv-mad-v2.cjs'),cache=require('./glv-mad-v2-cache.cjs'),format=require('./glv-promo-format.cjs'),converter=require('./glv-mad-v2-promo.cjs'),publication=require('./glv-history-publication.cjs');
const KEY=runtime.PREFIX+'promo';
function validate(p){const s=p.daily.snapshot;for(const t of publication.TYPES)if(p[t].generation_id!==publication.digest(s))throw Error('Invalid Promo generation');converter.renderPromo(s,'USD');converter.renderPromo(s,'CZK');if(!require('../public/glv-meta-ads/promo-format.js').validConceptPayload(s.payload))throw Error('Incomplete Promo concepts');}
const read=readValue=>publication.readBundle({key:KEY,read:readValue,validate});
async function refresh({redis,token,through,now=new Date(),deadline=Date.now()+240000,fetcher=fetch,loadFx=v2.loadFixings,fetchPromo=format.fetchPromoFormats}){
 const value=runtime.readValue(redis),range={since:'2026-03-01',until:through};let prior=(await read(value))?.daily.snapshot;
 if(prior?.payload.range.until===through)return prior;
 if(!prior){try{const old=await value(converter.CACHE_KEY);if(old){converter.renderPromo(old,'USD');prior=old;}}catch{}}
 if(!prior){try{const payload=await value(format.CACHE_KEY);if(format.sliceCachedFormats(payload,payload.range,now,{allowStale:true}))prior={payload};}catch{}}
 if(prior?.payload.range.until>through)return prior;
 const pull=format.refreshWindow(prior?.payload,range),transport=cache.boundedTransport(fetcher,deadline);
 const fresh=await fetchPromo(token,pull,transport,{timeoutMs:Math.max(1,Math.floor(deadline-Date.now()-3000))});
 const payload={...fresh,range,rows:[...(prior?.payload.rows||[]).filter(r=>r.date<pull.since),...fresh.rows],source_extractions:[...(prior?.payload.source_extractions|| (prior?[{range:prior.payload.range,generated_at:prior.payload.generated_at}]:[])),{range:pull,generated_at:fresh.generated_at}]};
 const snapshot={payload,fx:await loadFx(range,transport)},generation_id=publication.digest(snapshot);
 const pieces={daily:{range,generation_id,snapshot},aggregate:{range,generation_id},ads:{range,generation_id}};
 await publication.publishBundle({key:KEY,pieces,validate,read:value,write:(k,v)=>cache.publish(redis,k,v),retire:publication.retireRedis(redis,require('./glv-mad-v2-storage.cjs').decode)});
 const actual=await read(value);if(actual.daily.generation_id!==generation_id)throw Error('Promo readback mismatch');return actual.daily.snapshot;
}
async function readRender(value,s,now=new Date()){
 const b=await read(value);if(!b)return null;
 const original=b.daily.snapshot,payload=format.sliceCachedFormats(original.payload,s.range,now,{allowStale:true});if(!payload)return null;
 if(s.type==='promo_concepts'&&!require('../public/glv-meta-ads/promo-format.js').validConceptPayload(payload))throw Error('Incomplete concepts');
 const rendered=converter.renderPromo({...original,payload},s.currency,s.account,now);
 const coverage_complete=payload.range.since===s.range.since&&payload.range.until===s.range.until;
 return {...rendered,generation_id:b.daily.generation_id,date_policy:'account-isolated',requested_range:s.range,cached_range:payload.range,coverage_complete,stale:!coverage_complete,account_coverage:[{account_id:v2.ACCOUNTS[0].id,range:payload.range,complete_through:payload.range.until,partial:false,generated_at:payload.generated_at}],promo_account_scope:'TUC/CZSK only; TGLV is not part of the Promo dataset'};
}
module.exports={KEY,validate,read,refresh,readRender};
