/* Shared mode is declared by the authenticated publication, never a browser env guess. */
(function(root){
 'use strict';
 let shared=false;
 const declares=data=>typeof data?.shared_generation_id==='string'&&/^[a-f0-9]{64}$/.test(data.shared_generation_id);
 root.MadDatePolicy={
  isShared:()=>shared,
  customError(range,v2=false){
   if(!shared&&!v2)return '';
   return MadV2Dates.validDate(range.since)&&MadV2Dates.validDate(range.until)&&range.since<=range.until&&range.until<=MadV2Dates.commonCutoff(new Date())&&Date.parse(range.until)-Date.parse(range.since)<=89*86400000?'':'Select at most 90 completed days.';
  },
  declared:declares,
  // Call only after the normal scope/schema/freshness validator succeeds.
  accept(data){if(declares(data))shared=true;},
  range(preset,data){return shared||declares(data)?MadV2Dates.rangeFor(preset,new Date()):null;},
  day(){return shared?MadV2Dates.commonCutoff(new Date()):new Date().toISOString().slice(0,10);}
 };
})(globalThis);
