const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const backendPath = '../lib/glv-promo-format.cjs';
const api = () => fs.existsSync(require('node:path').join(__dirname, backendPath)) ? require(backendPath) : {};
const march = '120241268747040687';
const range = { since:'2026-09-01', until:'2026-09-20' };
const sharedPath = '../public/glv-meta-ads/promo-format.js';
const shared = () => fs.existsSync(require('node:path').join(__dirname,sharedPath)) ? require(sharedPath) : {};
const fact = (overrides={}) => ({ad_id:'a',ad_name:'PAC403',adset_id:'s',adset_name:'Video',campaign_id:march,campaign_name:'TUC_008_CZSK_Promo',date:'2026-09-02',format:'Video',reason:'current_adset_label',spend:100,purchases:2,revenue:400,impressions:50,...overrides});
const payload = rows => ({schema_version:1,classification_version:2,range,generated_at:new Date().toISOString(),reconciled:true,rows});

test('strict schema rejects legacy/invalid facts instead of invented zeros; month shares include Unknown', () => {
  const { validPayload, monthlyMix } = shared();
  assert.equal(typeof validPayload,'function');
  assert.equal(validPayload({rows:[]}),false);
  assert.equal(validPayload(payload([fact()])),true);
  for (const value of [undefined,null,'',-1,NaN]) assert.equal(validPayload(payload([fact({spend:value})])),false);
  assert.equal(validPayload(payload([fact({date:'2026-08-31'})])),false);
  assert.equal(validPayload(payload([fact(),fact()])),false);
  const rows=[fact(),fact({ad_id:'b',format:'Banner',spend:300,purchases:0}),fact({ad_id:'u',format:'Unknown',spend:0,purchases:2})];
  const mix=monthlyMix(rows);
  assert.equal(mix.length,1);
  assert.deepEqual([mix[0].formats.Video.spendShare,mix[0].formats.Video.purchaseShare,mix[0].formats.Unknown.purchaseShare],[25,50,50]);
  assert.equal(mix[0].formats.Banner.cpa,null);
  assert.equal(monthlyMix([fact({spend:0,purchases:0})])[0].formats.Video.spendShare,null);
});

test('refresh discovers current campaign scope, reads archived ad daily facts, and retains carryover purchases', async () => {
  const { fetchPromoFormats } = api();
  assert.equal(typeof fetchPromoFormats, 'function');
  const calls = [];
  const fetcher = async (url, options) => {
    const u = new URL(url); calls.push(u);
    assert.equal(u.searchParams.has('access_token'), false);
    assert.equal(options.headers.Authorization, 'Bearer private-test-token');
    if (u.pathname.endsWith('/insights')) {
      assert.equal(u.searchParams.get('time_increment'), '1');
      assert.equal(u.searchParams.has('action_attribution_windows'), false);
      assert.equal(u.searchParams.has('use_unified_attribution_setting'), false);
      const filters = JSON.parse(u.searchParams.get('filtering'));
      assert.ok(filters.some(f => f.value.includes('ARCHIVED') && f.value.includes('DELETED')));
      const common = { campaign_id:march, campaign_name:'obsolete name', date_start:'2026-09-02', spend:'0', impressions:'0', actions:[{action_type:'omni_purchase',value:'2'},{action_type:'purchase',value:'999'},{action_type:'link_click',value:'12'},{action_type:'landing_page_view',value:'8'},{action_type:'initiate_checkout',value:'3'},{action_type:'omni_initiated_checkout',value:'999'}], action_values:[{action_type:'omni_purchase',value:'400'}] };
      return {ok:true,json:async () => ({data:[u.searchParams.get('level') === 'ad' ? {...common,ad_id:'a',adset_id:'s',ad_name:'obsolete'} : common]})};
    }
    const fields = u.searchParams.get('fields');
    return {ok:true,json:async () => fields.includes('adset_id') ? {a:{id:'a',name:'PAC403',campaign_id:march,adset_id:'s',effective_status:'ARCHIVED'}} : fields.includes('campaign_id') ? {s:{id:'s',name:'EGC',campaign_id:march}} : {[march]:{id:march,name:'TUC_008_CZSK_Sales_Promo_6y-bday'}}};
  };
  const result = await fetchPromoFormats('private-test-token', range, fetcher);
  assert.equal(result.funnel_version,1);
  assert.deepEqual([result.rows[0].link_clicks,result.rows[0].landing_page_views,result.rows[0].checkouts],[12,8,3]);
  assert.equal(result.schema_version, 1);
  assert.equal(result.rows.length, 1);
  assert.deepEqual([result.rows[0].format,result.rows[0].spend,result.rows[0].purchases], ['Video',0,2]);
  assert.equal(result.rows[0].date, '2026-09-02');
  assert.equal(result.reconciled, true);
  assert.equal(calls.filter(u=>u.pathname.endsWith('/insights')).length, 2);
  // Synthetic campaign/ad mismatches must fail before any success-shaped payload.
  for(const type of ['link_click','landing_page_view','initiate_checkout']){
    const mismatched=async (url,options)=>{
      const response=await fetcher(url,options),data=await response.json(),u=new URL(url);
      if(u.searchParams.get('level')==='campaign')data.data[0].actions.find(a=>a.action_type===type).value='9999';
      return {...response,json:async()=>data};
    };
    await assert.rejects(()=>fetchPromoFormats('private-test-token',range,mismatched),/reconciliation failed/);
  }
});

test('history refresh has an overall deadline rather than a fresh budget per page', async () => {
  let calls=0;
  const fetcher=async()=>{
    calls++;
    await new Promise(resolve=>setTimeout(resolve,10));
    return {ok:true,json:async()=>({data:[{campaign_id:march}]})};
  };
  await assert.rejects(()=>api().fetchPromoFormats('private-test-token',range,fetcher,{timeoutMs:1}),/Promo refresh time budget exceeded/);
  assert.equal(calls,1,'must not start another Meta request after the budget');
});

test('format API rejects legacy caches, slices fresh history, and enforces completed-day cutoff', async () => {
  const handler=require('../api/glv-meta-ads/fb-data.js');
  const { cachedPayloadUsable }=handler._test;
  assert.equal(cachedPayloadUsable('promo_formats',{rows:[]}),false);
  const { formatRange, sliceCachedFormats }=api();
  const now=new Date('2026-09-21T10:00:00Z');
  assert.deepEqual(formatRange({date_preset:'last_7d'},now),{since:'2026-09-14',until:'2026-09-20'});
  assert.deepEqual(formatRange({time_range:JSON.stringify({since:'2026-09-14',until:'2026-09-21'})},now),{since:'2026-09-14',until:'2026-09-20'});
  assert.throws(()=>formatRange({time_range:'invalid'},now));
  assert.throws(()=>formatRange({time_range:JSON.stringify({since:'2026-02-30',until:'2026-09-20'})},now));
  const cached=payload([fact(),fact({date:'2026-09-19'})]); cached.generated_at=now.toISOString();
  assert.equal(sliceCachedFormats(cached,{since:'2026-09-14',until:'2026-09-20'},now).rows.length,1);
  assert.equal(sliceCachedFormats(cached,{since:'2026-08-01',until:'2026-09-20'},now),null);
  cached.generated_at='2026-09-19T00:00:00Z';
  assert.equal(sliceCachedFormats(cached,range,now),null);
});

test('authenticated shared data handler serves versioned format cache; cron adds one refresh without a new schedule', async () => {
  const handler=require('../api/glv-meta-ads/fb-data.js');
  const cron=require('../api/glv-meta-ads/cron.js');
  const oldFetch=global.fetch, oldEnv={...process.env};
  const today=new Date().toISOString().slice(0,10);
  const cached={...payload([fact({ad_name:'CC10',adset_name:'AS_Promo',campaign_id:'120247470134450687',format:'Unknown',reason:'no_approved_mapping'})]),classification_version:1}; cached.range={since:'2026-03-01',until:today};
  process.env.GLV_META_FB_ACCESS_TOKEN='private-test-token';process.env.KV_REST_API_URL='https://redis.test';process.env.KV_REST_API_TOKEN='cache-test-token';
  delete process.env.UPSTASH_REDIS_REST_URL;delete process.env.UPSTASH_REDIS_REST_TOKEN;
  global.fetch=async url=>{assert.match(url,/redis\.test\/get\/glv%3Apromo_formats%3Ahistory%3Av1/);return {ok:true,json:async()=>({result:JSON.stringify(cached)})};};
  let body, status=200; const headers={};
  try {
    await handler({method:'GET',query:{type:'promo_formats',time_range:JSON.stringify(range)}},{setHeader:(k,v)=>headers[k]=v,status:n=>{status=n;return {json:v=>body=v};},json:v=>body=v});
    assert.equal(status,200);assert.equal(headers['X-Cache'],'HIT');assert.equal(body.rows.length,1);
    assert.equal(body.classification_version,2);assert.equal(body.rows[0].format,'Banner');
    assert.equal(body.generated_at,cached.generated_at);assert.equal(body.rows[0].spend,cached.rows[0].spend);
    const response={setHeader:(k,v)=>headers[k]=v,status:n=>{status=n;return {json:v=>body=v};},json:v=>body=v};
    await handler({method:'GET',query:{type:'promo_concepts',time_range:JSON.stringify(range)}},response);
    assert.equal(headers['X-Cache'],'MISS');assert.equal(status,503,'legacy facts cannot fabricate zero funnel inputs');
    cached.funnel_version=1;for(const row of cached.rows)Object.assign(row,{link_clicks:12,landing_page_views:8,checkouts:3});
    status=200;
    await handler({method:'GET',query:{type:'promo_concepts',time_range:JSON.stringify(range)}},response);
    assert.equal(status,200);assert.equal(headers['X-Cache'],'HIT');assert.equal(body.funnel_version,1);
    assert.equal(headers['Cache-Control'],'private, no-store');assert.equal(body.rows[0].checkouts,3);
    assert.equal(body.generated_at,cached.generated_at,'shared facts keep original extraction freshness');
    assert.equal(typeof cron._test.refreshPromoFormatCache,'function');
    const config=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'../vercel.json'),'utf8'));
    assert.deepEqual(config.crons,[{path:'/api/glv-meta-ads/cron',schedule:'0 0 * * *'}]);
  } finally { global.fetch=oldFetch;process.env=oldEnv; }
});

test('Redis SET requires an explicit OK acknowledgement', async () => {
  const {redisCmd}=require('../api/glv-meta-ads/cron.js')._test;
  const oldFetch=global.fetch, oldEnv={...process.env};
  process.env.KV_REST_API_URL='https://redis.test';process.env.KV_REST_API_TOKEN='test';
  delete process.env.UPSTASH_REDIS_REST_URL;delete process.env.UPSTASH_REDIS_REST_TOKEN;
  try {
    for(const body of [{result:null},null,{},[],{result:true},{result:'QUEUED'},{error:'denied'}]){
      global.fetch=async()=>({ok:true,json:async()=>body});
      await assert.rejects(()=>redisCmd('SET','test','value'),/Redis/);
    }
    global.fetch=async()=>({ok:true,json:async()=>{throw new SyntaxError('bad JSON');}});
    await assert.rejects(()=>redisCmd('SET','test','value'));
    global.fetch=async()=>({ok:false,status:503,json:async()=>({result:'OK'})});
    await assert.rejects(()=>redisCmd('SET','test','value'),/Redis HTTP 503/);
    global.fetch=async()=>({ok:true,json:async()=>({result:'OK'})});
    assert.deepEqual(await redisCmd('SET','test','value'),{result:'OK'});
  } finally {global.fetch=oldFetch;process.env=oldEnv;}
});

test('cron shares one deadline across history, legacy pagination/status, and Redis bodies', async () => {
  const {runRefresh}=require('../api/glv-meta-ads/cron.js')._test;
  assert.equal(typeof runRefresh,'function');
  const oldFetch=global.fetch, oldEnv={...process.env};
  process.env.KV_REST_API_URL='https://redis.test';process.env.KV_REST_API_TOKEN='test';
  delete process.env.UPSTASH_REDIS_REST_URL;delete process.env.UPSTASH_REDIS_REST_TOKEN;
  try {
    for(const stuck of ['history','legacy','pagination','status','redis','redis-body']){
      let calls=0, aborts=0;
      global.fetch=async(url,options={})=>{
        calls++;
        const redis=String(url).startsWith('https://redis.test');
        const history=Boolean(options.headers?.Authorization);
        const u=new URL(url);
        const hang=(stuck==='history'&&history&&!redis)||(stuck==='legacy'&&!history&&!redis)||(stuck==='pagination'&&u.searchParams.has('after'))||(stuck==='status'&&u.searchParams.has('ids'))||(stuck.startsWith('redis')&&redis);
        if(hang){
          options.signal?.addEventListener('abort',()=>aborts++,{once:true});
          if(stuck==='redis-body')return {ok:true,json:()=>new Promise(()=>{})};
          return new Promise(()=>{}); // Even a transport ignoring abort must not hold the job open.
        }
        const data=redis?{result:'OK'}:!history&&stuck==='pagination'?{data:[],paging:{next:'https://graph.facebook.com/v21.0/insights?after=next'}}:!history&&stuck==='status'&&u.searchParams.get('level')==='ad'?{data:[{ad_id:'a'}]}:{data:[]};
        return {ok:true,json:async()=>data};
      };
      const result=await Promise.race([runRefresh('test',false,{timeoutMs:30}),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('unbounded cron')),500);timer.unref();})]);
      assert.ok(result.allErrors.length,stuck);
      assert.ok(aborts>0,`abort pending ${stuck}`);
      const finishedCalls=calls;
      await new Promise(resolve=>setTimeout(resolve,10));
      assert.equal(calls,finishedCalls,'no work may continue after completion');
    }
  } finally {global.fetch=oldFetch;process.env=oldEnv;}
});

test('cron starts its bounded history refresh before the sequential presets', async () => {
  const cron=require('../api/glv-meta-ads/cron.js');
  const oldFetch=global.fetch, oldEnv={...process.env}, oldLog=console.log;
  let historyStarted=false, historyWritten=false, status, storedHistory;
  process.env.GLV_META_FB_ACCESS_TOKEN='private-test-token';process.env.GLV_META_CRON_SECRET='test-secret';
  delete process.env.CRON_SECRET;
  process.env.KV_REST_API_URL='https://redis.test';process.env.KV_REST_API_TOKEN='cache-test-token';
  global.fetch=async(url,options={})=>{
    if(String(url).startsWith('https://redis.test')){
      const command=JSON.parse(options.body);
      if(command[0]==='GET') {historyStarted=true;return {ok:true,json:async()=>({result:storedHistory})};}
      if(command[1]==='glv:promo_formats:history:v1') {historyWritten=true;storedHistory=command[2];}
      return {ok:true,json:async()=>({result:'OK'})};
    }
    if(options.headers?.Authorization==='Bearer private-test-token')historyStarted=true;
    else assert.equal(historyStarted,true,'history must start before preset network calls');
    return {ok:true,json:async()=>({data:[]})};
  };
  console.log=()=>{};
  try {
    await cron({headers:{authorization:'Bearer test-secret'},query:{}},{status:n=>{status=n;return {json:()=>{}};}});
    assert.equal(status,200);assert.equal(historyWritten,true);
  } finally {global.fetch=oldFetch;process.env=oldEnv;console.log=oldLog;}
});

test('partial Meta responses, paging faults, and reconciliation errors fail closed without leaking credentials', async () => {
  const row={campaign_id:march,date_start:'2026-09-02',spend:'100',impressions:'50',actions:[{action_type:'omni_purchase',value:'2'}],action_values:[{action_type:'omni_purchase',value:'400'}]};
  const responses=()=>[
    {data:[row]}, {[march]:{id:march,name:'TUC_008_CZSK_Sales_Promo'}},
    {data:[{...row,ad_id:'a',adset_id:'s'}]},
    {a:{id:'a',name:'PAC403',campaign_id:march,adset_id:'s'}},
    {s:{id:'s',name:'Video',campaign_id:march}}
  ];
  async function run(values){return api().fetchPromoFormats('private-test-token',range,async()=>({ok:true,json:async()=>values.shift()}));}
  assert.equal((await run(responses())).reconciled,true);
  let values=responses();values[2]={data:[]};values.splice(3);
  await assert.rejects(()=>run(values),/reconciliation failed/);
  values=responses();values[3]={};
  await assert.rejects(()=>run(values),/Current Promo object unavailable/);
  values=responses();values[2].data[0].spend='invalid';
  await assert.rejects(()=>run(values),/Invalid Promo metric/);
  values=responses();values[0].paging={next:'https://untrusted.test/?access_token=private-test-token'};
  await assert.rejects(()=>run(values),/Incomplete Promo pagination/);
  values=responses();values[2].data.push({...values[2].data[0]});
  await assert.rejects(()=>run(values),/Duplicate Promo ad date/);
  await assert.rejects(()=>api().fetchPromoFormats('private-test-token',range,async()=>{throw Error('https://provider.test/?access_token=private-test-token');}),error=>error.message==='Promo Meta network request failed (campaign insights)');
});

test('provider configuration packages both shared dependencies and allows bounded history requests', () => {
  const config=require('../vercel.json');
  for(const file of ['api/glv-meta-ads/fb-data.js','api/glv-meta-ads/cron.js']){
    assert.equal(config.functions[file].maxDuration,300);
    for(const dep of ['lib/glv-promo-format.cjs','public/glv-meta-ads/promo-format.js'])assert.ok(config.functions[file].includeFiles.includes(dep));
  }
});

test('stored v1/v2 names reclassify immediately without changing metrics or freshness; browser requires v2', () => {
  const now=new Date('2026-10-12T16:00:00Z');
  const rows=['CC10','CC11','CC12','CC13','CC14','CC15','PAC 432','PAC 433','PAC 434','PAC 435'].flatMap((name,i)=>[
    fact({ad_id:String(i),ad_name:name,adset_name:'AS_Promo',campaign_id:'120247470134450687',date:'2026-06-10',format:'Unknown',reason:'no_approved_mapping'}),
    fact({ad_id:String(i),ad_name:name,adset_name:'AS_Promo',campaign_id:'120247470134450687',date:'2026-09-10',spend:0,impressions:0,format:'Unknown',reason:'no_approved_mapping'})
  ]);
  const old={...payload(rows),classification_version:1,range:{since:'2026-03-01',until:'2026-10-11'},generated_at:now.toISOString()};
  assert.equal(shared().validPayload(old),false,'old browser/session payload must be rejected');
  const before=JSON.stringify(old);
  const next=api().sliceCachedFormats(old,old.range,now);
  assert.ok(next);assert.equal(next.classification_version,2);
  assert.equal(next.generated_at,old.generated_at);assert.equal(shared().validPayload(next),true);
  assert.equal(next.rows.filter(r=>r.format==='Unknown').length,0);
  assert.equal(JSON.stringify(old),before,'do not mutate Redis source object');
  const raw=r=>{const {format,reason,...rest}=r;return rest;};
  assert.deepEqual(next.rows.map(raw),old.rows.map(raw),'all metrics, dates and provenance are identical');
  for(const month of shared().monthlyMix(next.rows))for(const key of ['spend','purchases','revenue','impressions'])assert.equal(month.total[key],month.formats.Banner[key]+month.formats.Video[key]);
  const staleLabels={...next,rows:next.rows.map(r=>({...r,format:'Video',reason:'old_rule'}))};
  assert.deepEqual(api().sliceCachedFormats(staleLabels,old.range,now),next,'recompute even same-revision cached labels');
  for(const classification_version of [0,3,999])assert.equal(api().sliceCachedFormats({...old,classification_version},old.range,now),null);
  for(const change of [{campaign_name:'TUC_013_US_Sales_Promo'},{campaign_name:'TUC_013_CZSK_Sales'},{adset_name:''},{spend:null}])assert.equal(api().sliceCachedFormats({...old,rows:[{...rows[0],...change}]},old.range,now),null);
  assert.equal(api().sliceCachedFormats({...old,generated_at:'2026-10-10T00:00:00Z'},old.range,now),null);
  assert.equal(api().sliceCachedFormats({...old,rows:[rows[0],rows[0]]},old.range,now),null);
  const conflict=api().sliceCachedFormats({...old,rows:[{...rows[0],adset_name:'Banner Video'}]},old.range,now);
  assert.equal(conflict.rows[0].reason,'conflicting_adset_labels');
  const override=api().sliceCachedFormats({...old,rows:[{...rows[0],adset_name:'Video'}]},old.range,now);
  assert.equal(override.rows[0].format,'Video');
});

test('June approved codes are exact tokens scoped to original campaign, with current adset precedence', () => {
  const june='120247470134450687';
  const classify=(name,adset='AS_Promo',campaign_id=june)=>api().classifyFormat({name,campaign_id},{name:adset});
  for(const code of ['CC10','CC11','CC12','CC13','CC14','CC15','PAC433','PAC432','PAC434','PAC435']){
    const expected=['PAC432','PAC434','PAC435'].includes(code)?'Video':'Banner';
    for(const name of [code,`prefix_${code}_suffix`,code.replace('PAC','PAC '),code.replace('PAC','PAC_')]){
      assert.deepEqual(classify(name),{format:expected,reason:'approved_original_mapping'},name);
      for(const campaign of [march,'120244677479270687','new-campaign'])assert.equal(classify(name,'AS',campaign).format,'Unknown',name);
      assert.equal(classify(name,'AS_Video').format,'Video');
      assert.equal(classify(name,'AS_Banner').format,'Banner');
      assert.equal(classify(name,'AS_Banners_Videos').format,'Unknown');
    }
  }
  for(const name of ['CC100','CC150','XCC10','CC10x','PAC4330','XPAC433','PAC433x','433','432','CC 10','PAC-433','PAC432 PAC433'])assert.equal(classify(name).format,'Unknown',name);
});

test('current distinct adset labels dominate scoped original-campaign mappings; conflicts stay Unknown', () => {
  const { classifyFormat } = api();
  assert.equal(typeof classifyFormat, 'function');
  const classify = (name, adset, campaign_id = march) => classifyFormat({ name, campaign_id }, { name: adset });
  assert.equal(classify('PAC403', 'AS_Banners').format, 'Banner');
  assert.equal(classify('PAC404', 'AS_vIdEoS_EGC').format, 'Video');
  assert.equal(classify('PAC403', 'AS_Banners_Videos').format, 'Unknown');
  assert.equal(classify('PAC403', 'AS_EGC').format, 'Video');
  assert.equal(classify('PAC1403', 'AS_EGC').format, 'Unknown');
  assert.equal(classify('PAC403 404', 'AS').format, 'Unknown');
  assert.equal(classify('PAC403', 'AS', 'new-campaign').format, 'Unknown');
  for (const name of ['PAC317','PAC_317','PAC 317','prefix_PAC  317_suffix']) assert.equal(classify(name, 'AS', 'new-campaign').format, 'Video', name);
  for (const name of ['unrelated_317','317','PAC1317','PAC3170','XPAC317','PAC317x','PAC-317']) assert.equal(classify(name, 'AS', 'new-campaign').format, 'Unknown', name);
  assert.equal(classify('anything', 'Videostory').format, 'Unknown');
});
