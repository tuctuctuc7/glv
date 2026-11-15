/* Native V1 reporting calendar. No rollout flags or other-account cutoffs. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MadV1Dates=api;})(globalThis,function(){
 'use strict';
 const shift=(date,days)=>new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
 const day=(now=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const cutoffDate=(includeToday=false,now=new Date())=>shift(day(now),includeToday?0:-1);
 function monthRange(preset,includeToday=false,now=new Date()){
  const until=cutoffDate(includeToday,now);
  if(preset==='this_month')return {since:until.slice(0,7)+'-01',until};
  if(preset==='last_month'){
   const end=shift(day(now).slice(0,7)+'-01',-1);
   return {since:end.slice(0,7)+'-01',until:end};
  }
  const days={last_7d:7,last_14d:14,last_30d:30,last_90d:90}[preset];
  return days?{since:shift(until,1-days),until}:null;
 }
 const sinceDate=(preset,includeToday=false,now=new Date())=>monthRange(preset,includeToday,now)?.since;
 return {day,shift,cutoffDate,monthRange,sinceDate,range:preset=>monthRange(preset)};
});
