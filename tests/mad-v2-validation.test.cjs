const test=require('node:test'),assert=require('node:assert/strict');
const {buildSnapshot}=require('../lib/glv-mad-v2-source.cjs');
const v2=require('../lib/glv-mad-v2.cjs'),cache=require('../lib/glv-mad-v2-cache.cjs');
const now=new Date('2026-11-09T12:00:00Z'),range={since:'2026-11-08',until:'2026-11-08'};
const fx={'2026-11-08':{date:'2026-11-08',czk_per_usd:25}};
function transport(mutate=()=>{},stage='daily'){return async url=>{
 const u=new URL(url),a=v2.ACCOUNTS.find(a=>u.pathname.includes(a.id));
 if(!u.pathname.endsWith('/insights'))return {ok:true,json:async()=>({account_id:a.id,currency:a.currency,timezone_name:a.timezone,account_status:1})};
 const requested=JSON.parse(u.searchParams.get('time_range'));
 const r={campaign_id:'123',campaign_name:'TUC_001_US_Sales',spend:'25',impressions:'10',reach:'8',date_start:u.searchParams.has('time_increment')?requested.until:requested.since,date_stop:requested.until};
 if((u.searchParams.has('time_increment')?'daily':'aggregate')===stage)mutate(r);
 return {ok:true,json:async()=>({data:[r]})};
};}
for(const type of ['daily','aggregate'])test(`${type}: raw required campaign fields and action values fail before normalization`,async()=>{
 const mutations=[...['spend','impressions','reach','campaign_id','campaign_name','date_start','date_stop'].map(k=>r=>delete r[k]),...['spend','impressions','reach'].flatMap(k=>[null,'',true,{},'NaN','Infinity',-1].map(value=>r=>r[k]=value)),r=>r.date_stop='2026-11-09',r=>r.actions=null,r=>r.actions=[{action_type:'omni_purchase',value:'bad'}],r=>r.action_values=[{action_type:'omni_purchase'}],r=>r.actions=[{action_type:'lead',value:1},{action_type:'lead',value:2}]];
 for(const mutate of mutations)await assert.rejects(buildSnapshot({range,type,token:'synthetic',fx,fetcher:transport(mutate,type)}));
 const valid=await buildSnapshot({range,type,token:'synthetic',fx,fetcher:transport()});assert.equal(valid.complete,true);assert.equal(valid.accounts[0].rows[0]['actions:omni_purchase'],'0');
});
for(const stage of ['daily','aggregate'])test(`malformed ${stage} campaign cannot overwrite its last-good presets`,async()=>{
 const store=new Map(cache.requiredKeys().map(k=>[k,'last-good'])),sets=[];
 const result=await cache.refreshV2({now,clock:()=>+now,token:'synthetic',force:true,loadFx:async()=>Object.fromEntries(Array.from({length:100},(_,i)=>{const date=v2.shift(range.until,-i);return [date,{date,czk_per_usd:25}];})),fetcher:transport(r=>delete r.spend,stage),redis:async(cmd,key,value)=>{if(cmd==='SET'){sets.push(key);store.set(key,value);return {result:'OK'};}return {result:cmd==='TTL'?-1:store.get(key)};},promoPayload:async()=>{throw Error();}});
 assert.equal(result.verified,false);for(const preset of cache.PRESETS){assert.equal(store.get(cache.presetKey(stage,preset)),'last-good');assert.ok(!sets.includes(cache.presetKey(stage,preset)));}
});
