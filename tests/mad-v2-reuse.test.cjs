const test=require('node:test'),assert=require('node:assert/strict');
const cache=require('../lib/glv-mad-v2-cache.cjs'),v2=require('../lib/glv-mad-v2.cjs');
test('expired source budget never reuses facts as a newly successful pull',async()=>{
 const {buildSnapshot}=require('../lib/glv-mad-v2-source.cjs');
 const range={since:'2026-11-08',until:'2026-11-08'},reuse={token:'synthetic',accounts:new Map(v2.ACCOUNTS.map(a=>[a.id,{account_id:a.id,currency:a.currency,timezone_name:a.timezone,account_status:1}])),snapshots:[{type:'daily',range,accounts:v2.ACCOUNTS.map(a=>({...a,rows:[]}))}]};
 let calls=0;await assert.rejects(buildSnapshot({type:'daily',range,token:'synthetic',reuse,fx:{},deadline:Date.now()-1,fetcher:async()=>{calls++;throw Error();}}),/budget/);assert.equal(calls,0);
});
const now=new Date('2026-11-09T12:00:00Z');
test('one refresh validates two accounts once, slices daily facts safely, and fetches exact period reach per preset',async()=>{
 const counts={metadata:0,daily:0,ads:0,period:0},store=new Map();
 const fx=Object.fromEntries(Array.from({length:100},(_,i)=>{const date=v2.shift('2026-11-08',-i);return [date,{date,czk_per_usd:25}];}));
 const fetcher=async(url,opts)=>{
  assert.ok(opts.signal);assert.equal(opts.method,'GET');const u=new URL(url),a=v2.ACCOUNTS.find(a=>u.pathname.includes(a.id));
  let body;if(!u.pathname.endsWith('/insights')){counts.metadata++;body={account_id:a.id,currency:a.currency,timezone_name:a.timezone,account_status:1};}
  else {const range=JSON.parse(u.searchParams.get('time_range')),daily=u.searchParams.has('time_increment');
   const ads=u.searchParams.get('level')==='ad';counts[ads?'ads':daily?'daily':'period']++;
   const dates=[];if(daily){for(let d=range.since;d<=range.until;d=v2.shift(d,1))dates.push(d);}else dates.push(range.since);
   body={data:ads?[]:[...new Set(dates)].map(date=>({campaign_id:'1',campaign_name:'TUC_001_US_Sales',date_start:date,date_stop:daily?date:range.until,spend:'25',impressions:'10',reach:daily?'8':'11'}))};
  }return {ok:true,json:async()=>body};
 };
 const result=await cache.refreshV2({token:'synthetic',now,clock:()=>+now,fetcher,loadFx:async()=>fx,redis:async(cmd,key,value)=>{if(cmd==='SET'){store.set(key,value);return {result:'OK'};}return {result:cmd==='TTL'?-1:store.get(key)||null};},promoPayload:async()=>({schema_version:1,classification_version:2,reconciled:true,generated_at:now.toISOString(),range:{since:'2026-03-01',until:'2026-11-08'},rows:[]})});
 assert.equal(result.verified,true);assert.deepEqual(counts,{metadata:2,daily:2,ads:require('../lib/glv-mad-v2-chunks.cjs').windows(v2.rangeFor('last_90d',now)).length*2,period:12});
 for(const preset of cache.PRESETS){const range=v2.rangeFor(preset,now),daily=require('../lib/glv-mad-v2-storage.cjs').decode(store.get(cache.presetKey('daily',preset))),agg=require('../lib/glv-mad-v2-storage.cjs').decode(store.get(cache.presetKey('aggregate',preset)));
  assert.deepEqual(daily.range,range);assert.ok(daily.accounts.every(a=>a.rows.every(r=>r.date_start>=range.since&&r.date_stop<=range.until)));
  assert.equal(daily.accounts[0].rows.length,(Date.parse(range.until)-Date.parse(range.since))/86400000+1);
  const rendered=require('../lib/glv-mad-v2-source.cjs').renderSnapshot(agg,'USD');
  assert.ok(rendered.rows.every(r=>r.reach===11));
  assert.equal(rendered.rows[0].amount_spent,daily.accounts[0].rows.length);
  for(const a of agg.accounts)assert.ok(a.reach.every(([,n])=>n===11));
 }
});
