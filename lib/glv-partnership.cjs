// Conservative current-configuration evidence, not historical enablement.
const FIELDS='effective_status,creative{id,facebook_branded_content,instagram_branded_content}';
const unavailable=()=>({status:'UNKNOWN',partnership:{status:'unverified',reason:'metadata_unavailable',evidence:[]}});
function classify(ad){
 if(!ad||ad.error)return unavailable();
 if(!ad.creative||ad.creative.error)return {...unavailable(),status:ad.effective_status||'UNKNOWN'};
 const c=ad.creative,evidence=[];
 for(const [field,key] of [['facebook_branded_content','sponsor_page_id'],['instagram_branded_content','sponsor_id']]){
  const value=c[field]?.[key];
  if(typeof value==='string'&&/^[1-9]\d*$/.test(value))evidence.push(`${field}.${key}`);
 }
 return {status:ad.effective_status||'UNKNOWN',partnership:{status:evidence.length?'verified_positive':'unverified',reason:evidence.length?'sponsor_metadata':'no_positive_metadata',evidence}};
}
async function fetchAdMetadata(ids,token,fetcher=fetch){
 const out={},unique=[...new Set(ids.filter(Boolean))];
 for(let i=0;i<unique.length;i+=50){
  const batch=unique.slice(i,i+50);for(const id of batch)out[id]=unavailable();
  try{
   const url=new URL('https://graph.facebook.com/v21.0/');
   url.search=new URLSearchParams({ids:batch.join(','),fields:FIELDS,access_token:token});
   const response=await fetcher(url.toString(),{signal:AbortSignal.timeout(15000)}),data=await response.json();
   if(!response.ok||!data||data.error)continue;
   for(const id of batch)out[id]=classify(data[id]);
  }catch{/* Safe explicit gap; never leak token-bearing upstream errors. */}
 }
 return out;
}
module.exports={fetchAdMetadata,classify};
