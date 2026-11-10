// One daily refresh owner: midnight primary plus bounded recovery opportunities.
// Scheduled runs end yesterday; authorized manual runs may include today's partial data.

const { fetchPromoFormats, formatRange, sliceCachedFormats, refreshWindow, CACHE_KEY } = require('../../lib/glv-promo-format.cjs');
const { validPayload } = require('../../public/glv-meta-ads/promo-format.js');
const { campaignFacts } = require('../../lib/glv-wl-creators.cjs');
const {fetchAdMetadata} = require('../../lib/glv-partnership.cjs');
const {scheduledRefresh,hash} = require('../../lib/glv-refresh-owner.cjs');
const AD_ACCOUNT = '359758259164738';
const FB_API = 'https://graph.facebook.com/v21.0';

const PRESETS = ['last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'];
const TTL = 90000; // 25 hours
const {cutoffDate,sinceDate,monthRange} = require('../../lib/glv-meta-dates.cjs');

function resolveRedisConfig(env = process.env) {
  const kvUrl = env.KV_REST_API_URL;
  const kvToken = env.KV_REST_API_TOKEN;
  const upstashUrl = env.UPSTASH_REDIS_REST_URL;
  const upstashToken = env.UPSTASH_REDIS_REST_TOKEN;
  const kvPresent = Boolean(kvUrl || kvToken);
  const upstashPresent = Boolean(upstashUrl || upstashToken);
  if (kvPresent && !(kvUrl && kvToken)) return null;
  if (upstashPresent && !(upstashUrl && upstashToken)) return null;
  if (kvUrl && kvToken) return { url: kvUrl, token: kvToken };
  if (upstashUrl && upstashToken) return { url: upstashUrl, token: upstashToken };
  return null;
}

// One wall-clock budget for every network operation, including response bodies.
// Keep 30s below Vercel's 300s cap for final serialization/logging.
function boundedFetcher(deadline) {
  return async (url, options = {}) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Cron refresh time budget exceeded');
    const controller = new AbortController();
    let timer, rejectBudget;
    const budget = new Promise((_, reject) => { rejectBudget = reject; });
    const abort = () => {
      controller.abort();
      rejectBudget(new Error('Cron request time budget exceeded'));
    };
    const upstream = options.signal;
    upstream?.addEventListener('abort', abort, {once:true});
    timer = setTimeout(abort, Math.min(45000, remaining));
    if (upstream?.aborted) abort();
    try {
      const result = await Promise.race([budget, (async () => {
        if (controller.signal.aborted) throw new Error('Cron request time budget exceeded');
        const response = await fetch(url, {...options, signal:controller.signal});
        // Keep the HTTP status when a proxy/provider returns a non-JSON body.
        // Body consumption remains inside the abortable request budget.
        let data, bodyError;
        try { data = await response.json(); } catch (error) { bodyError = error; }
        return {ok:response.ok, status:response.status, json:async () => {
          if (bodyError) throw bodyError;
          return data;
        }};
      })()]);
      return result;
    } finally {
      clearTimeout(timer);
      upstream?.removeEventListener('abort', abort);
    }
  };
}

async function redisCmd(...args) {
  return redisCommand(boundedFetcher(Date.now() + 45000), ...args);
}

async function redisCommand(fetcher, ...args) {
  const redis = resolveRedisConfig();
  if (!redis) throw new Error('Redis is not configured with one complete credential pair');
  const r = await fetcher(redis.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${redis.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  const payload = await r.json();
  if (!r.ok) throw new Error(`Redis HTTP ${r.status}`);
  if (payload?.error) throw new Error(`Redis: ${payload.error}`);
  if (String(args[0]).toUpperCase() === 'SET' && payload?.result !== 'OK' && !(args.includes('NX') && payload?.result === null)) throw new Error('Redis SET was not acknowledged');
  return payload;
}

function getAction(actions, type) {
  if (!Array.isArray(actions)) return '0';
  const item = actions.find(a => a.action_type === type);
  return item ? item.value : '0';
}

function getFirstAction(actions, types) {
  for (const type of types) {
    const value = getAction(actions, type);
    if (Number(value) > 0) return value;
  }
  return '0';
}

const LEAD_ACTION_TYPES = ['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead'];

function summarizeRows(rows) {
  return rows.reduce((summary, row) => {
    summary.rows += 1;
    summary.leads += Number(row['actions:lead']) || 0;
    summary.landingPageViews += Number(row['actions:landing_page_view']) || 0;
    return summary;
  }, { rows: 0, leads: 0, landingPageViews: 0 });
}

function getActionValue(action_values, type) {
  if (!Array.isArray(action_values)) return '0';
  const item = action_values.find(a => a.action_type === type);
  return item ? item.value : '0';
}

function getVideoMetric(arr) {
  if (!Array.isArray(arr) || !arr.length) return '0';
  return arr[0].value || '0';
}

function normalizeCampaign(row) {
  return {
    id: row.campaign_id || '',
    name: row.campaign_name || '',
    amount_spent: row.spend || '0',
    impressions: row.impressions || '0',
    reach: row.reach || '0',
    'actions:link_click': getAction(row.actions, 'link_click'),
    'actions:landing_page_view': getAction(row.actions, 'landing_page_view'),
    'actions:omni_purchase': getAction(row.actions, 'omni_purchase'),
    'actions:initiate_checkout': getAction(row.actions, 'initiate_checkout'),
    'actions:outbound_click': getAction(row.actions, 'outbound_click'),
    'actions:lead': getFirstAction(row.actions, LEAD_ACTION_TYPES),
    'action_values:omni_purchase': getActionValue(row.action_values, 'omni_purchase'),
    date_start: row.date_start || null,
    date_stop: row.date_stop || null,
  };
}

function normalizeAd(row, statusMap) {
  const adId = row.ad_id || row.id || '';
  return {
    id: adId,
    name: row.ad_name || '',
    status: statusMap[adId] || 'UNKNOWN',
    campaign_id: row.campaign_id || '',
    campaign_name: row.campaign_name || '',
    adset_id: row.adset_id || '',
    adset_name: row.adset_name || '',
    amount_spent: row.spend ?? null,
    impressions: row.impressions || '0',
    'actions:link_click': getAction(row.actions, 'link_click'),
    'actions:landing_page_view': getAction(row.actions, 'landing_page_view'),
    'actions:omni_purchase': getAction(row.actions, 'omni_purchase'),
    'actions:initiate_checkout': getAction(row.actions, 'initiate_checkout'),
    'actions:outbound_click': getAction(row.actions, 'outbound_click'),
    'actions:lead': getFirstAction(row.actions, LEAD_ACTION_TYPES),
    'action_values:omni_purchase': getActionValue(row.action_values, 'omni_purchase'),
    video_thruplay_watched_actions: getVideoMetric(row.video_thruplay_watched_actions),
    video_3_sec_watched_actions: getAction(row.actions, 'video_view'),
    video_p100_watched_actions: getVideoMetric(row.video_p100_watched_actions),
  };
}

async function paginate(url, fetcher) {
  let rows = [];
  let next = url;
  while (next) {
    const r = await fetcher(next);
    const data = await r.json();
    if (!r.ok || data.error || !Array.isArray(data.data)) throw new Error('Meta insights unavailable or incomplete');
    rows = rows.concat(data.data || []);
    next = data.paging?.next || null;
  }
  return rows;
}

async function writeVerifiedCache(fetcher,key,payload) {
  const serialized=JSON.stringify(payload);
  await redisCommand(fetcher,'SET',key,serialized,'EX',String(TTL));
  const readback=await redisCommand(fetcher,'GET',key);
  if(readback?.result!==serialized)throw new Error('Preset cache readback mismatch');
  return hash(serialized);
}
function creatorIssues(rows) {
  const {resolveCreator}=require('../../public/glv-meta-ads/wl-report.js');
  return [...new Set(rows.flatMap(r=>r.creator_rows?.length?r.creator_rows:[r]).filter(r=>/(?:^|_)WL(?:_|$)/.test(r.campaign_name||r.name)&&!r.is_ghost&&(r.creator_issue||!resolveCreator(r.campaign_name||r.name,r.adset_name,r.ad_name||(r.campaign_name?r.name:undefined)).creator)).map(r=>`${r.campaign_name||r.name}${r.adset_name?' / '+r.adset_name:''}${r.ad_name?' / '+r.ad_name:''}${r.creator_issue?' — '+r.creator_issue:''}`))];
}
async function fetchAndCache(token, preset, includeToday, fetcher) {
  const { since, until } = monthRange(preset, includeToday);
  const dateParam = `time_range=${encodeURIComponent(JSON.stringify({ since, until }))}`;
  const auth = `access_token=${token}`;
  const errors = [];
  const stats = { preset, since, until };
  async function publish(type,rows,extra={}){
    const key=`glv:${type}:${preset}`,generated_at=new Date().toISOString();
    const cache_sha256=await writeVerifiedCache(fetcher,key,{rows,creator_version:2,...(type==='aggregate'||type==='daily'?{creator_reconciliation_version:1,creator_ad_version:1}:{}),range:{since,until},generated_at,...extra});
    const partnership=type==='ads'?require('../../public/glv-meta-ads/wl-report.js').verification(rows):null;
    if(partnership)delete partnership.naming;
    stats[type]={cache_sha256,...(partnership?{wl_version:3,partnership,eligible_ad_ids:rows.filter(r=>r.partnership.status==='verified_positive').map(r=>r.id),unverified_ad_ids:rows.filter(r=>r.partnership.status!=='verified_positive').map(r=>r.id)}:{}),...summarizeRows(rows),creator_version:2,creatorIssues:creatorIssues(rows),range:{since,until},generated_at,readback_verified:true};
  }

  // aggregate
  try {
    const fields = 'campaign_id,campaign_name,spend,impressions,reach,actions,action_values';
    const url = `${FB_API}/act_${AD_ACCOUNT}/insights?level=campaign&fields=${fields}&${dateParam}&limit=500&${auth}`;
    const rows = await campaignFacts(url,u=>paginate(u,fetcher),normalizeCampaign);
    await publish('aggregate',rows);
  } catch (e) {
    errors.push(`aggregate/${preset}: ${e.message}`);
  }

  // daily
  try {
    const fields = 'campaign_id,campaign_name,spend,impressions,reach,actions,action_values';
    const url = `${FB_API}/act_${AD_ACCOUNT}/insights?level=campaign&fields=${fields}&${dateParam}&time_increment=1&limit=500&${auth}`;
    const rows = await campaignFacts(url,u=>paginate(u,fetcher),normalizeCampaign);
    await publish('daily',rows);
  } catch (e) {
    errors.push(`daily/${preset}: ${e.message}`);
  }

  // ads
  try {
    const fields = 'ad_id,ad_name,campaign_id,campaign_name,adset_id,adset_name,spend,impressions,actions,action_values,video_p100_watched_actions,video_thruplay_watched_actions';
    const url = `${FB_API}/act_${AD_ACCOUNT}/insights?level=ad&fields=${fields}&${dateParam}&sort=spend_descending&limit=50&${auth}`;
    const raw = await paginate(url, fetcher);

      const metadata = await fetchAdMetadata(raw.map(r=>r.ad_id||r.id),token,fetcher);
      const statusMap = Object.fromEntries(Object.entries(metadata).map(([id,m])=>[id,m.status]));
    const rows = raw.map(r => ({...normalizeAd(r, statusMap),partnership:metadata[r.ad_id||r.id]?.partnership||{status:'unverified',reason:'metadata_unavailable',evidence:[]}}));
    await publish('ads',rows,{wl_version:3});
  } catch (e) {
    errors.push(`ads/${preset}: ${e.message}`);
  }

  return { errors, stats };
}

async function refreshPromoFormatCache(token, includeToday = false, fetcher = boundedFetcher(Date.now() + 270000), {now=new Date(),fullHistory=false}={}) {
  const range = formatRange({date_preset:'promo_history',include_today:includeToday ? '1' : '0'},now);
  // Migrate an existing last-good snapshot before a potentially failing pull.
  // SET without EX only fixes expiry after a successful replacement.
  const previous = await redisCommand(fetcher,'GET',CACHE_KEY);
  let prior;
  try { prior=JSON.parse(previous?.result); } catch {}
  if (prior?.range && sliceCachedFormats(prior,prior.range,new Date(),{allowStale:true})) {
    await redisCommand(fetcher,'PERSIST',CACHE_KEY);
    const ttl=await redisCommand(fetcher,'TTL',CACHE_KEY);
    if (ttl?.result !== -1) throw new Error('Promo last-good cache retention was not verified');
  }
  const window=fullHistory?range:refreshWindow(prior,range);
  const fresh=await fetchPromoFormats(token,window,fetcher);
  const payload={...fresh,range,refresh_window:window,refresh_mode:window.since===range.since?'full_history':'rolling_7d',rows:[...(window.since===range.since?[]:prior.rows.filter(r=>r.date<window.since)),...fresh.rows]};
  if (!validPayload(payload)) throw new Error('Invalid Promo format refresh');
  const serialized = JSON.stringify(payload);
  // Keep the last reconciled history through producer outages. Freshness is
  // explicit in the read API, not implemented by deleting the only good copy.
  await redisCommand(fetcher, 'SET',CACHE_KEY,serialized);
  // Same deadline and exact key: SET acknowledgement alone is not activation.
  const readback = await redisCommand(fetcher, 'GET',CACHE_KEY);
  if (readback?.result !== serialized) throw new Error('Promo inventory cache readback mismatch');
  const {monthlyMix} = require('../../public/glv-meta-ads/promo-format.js');
  return {type:'promo_formats',cache_sha256:hash(serialized),...range,rows:payload.rows.length,unknownAds:new Set(payload.rows.filter(r=>r.format==='Unknown').map(r=>r.ad_id)).size,
    inventory_version:payload.inventory_version,funnel_version:payload.funnel_version,generated_at:payload.generated_at,readback_verified:true,refresh_mode:payload.refresh_mode,refresh_window:window,
    months:monthlyMix(payload.rows).map(m=>({month:m.month,images:m.formats.Banner.assets,videos:m.formats.Video.assets,total:m.total.assets,status:m.total.asset_status}))};
}

async function runRefresh(token, includeToday, {timeoutMs = 270000,fullHistory=false} = {}) {
  const deadline=Date.now()+timeoutMs;
  const fetcher = require('../../lib/glv-meta-retry.cjs').metaRetryFetcher(boundedFetcher(deadline),deadline);
  const allErrors = [];
  const summaries = [];
  // Start the single bounded history pull alongside the old sequential preset
  // refreshes, so it does not add another full history budget at their end.
  // Attach both handlers immediately: failures must never become unhandled.
  const formatRefresh = refreshPromoFormatCache(token,includeToday,fetcher,{fullHistory}).then(
    stats=>({stats}), error=>({error:error.message})
  );
  const v2Enabled=require('../../lib/glv-mad-v2.cjs').rolloutEnabled();
  const v2Refresh=v2Enabled?require('../../lib/glv-mad-v2-cache.cjs').refreshV2({
    token:process.env.GLV_MAD_V2_FB_ACCESS_TOKEN||token,force:fullHistory,deadline:deadline-10000,redis:(...args)=>redisCommand(fetcher,...args),
    promoPayload:async()=>{const outcome=await formatRefresh;if(outcome.error)throw new Error('Promo refresh failed');return JSON.parse((await redisCommand(fetcher,'GET',CACHE_KEY)).result);}
  }).then(result=>result,()=>({errors:['v2: refresh failed'],summaries:[],hashes:{},verified:false})):null;
  for (const preset of PRESETS) {
    const result = await fetchAndCache(token, preset, includeToday,fetcher);
    allErrors.push(...result.errors);
    summaries.push(result.stats);
  }

  // One history pull per existing daily job, not one ad-level pull per preset.
  // Replace the rolling window; explicit full_history rebuilds older facts too.
  const formatResult = await formatRefresh;
  if (formatResult.error) allErrors.push(`promo_formats: ${formatResult.error}`);
  else summaries.push(formatResult.stats);
  const freshness=verifyTabFreshness(summaries,includeToday);
  if(!freshness.all_tabs_verified)allErrors.push('All-tabs freshness verification incomplete');
  const hashes={};
  for(const summary of summaries){
    if(summary.type==='promo_formats')hashes[CACHE_KEY]=summary.cache_sha256;
    else for(const type of ['aggregate','daily','ads'])if(summary[type]?.cache_sha256)hashes[`glv:${type}:${summary.preset}`]=summary[type].cache_sha256;
  }
  if(v2Refresh){
    const v2=await v2Refresh;
    allErrors.push(...v2.errors);Object.assign(hashes,v2.hashes);
    freshness.v2={through:require('../../lib/glv-mad-v2.cjs').commonCutoff(),all_tabs_verified:v2.verified,summaries:v2.summaries,failures:v2.failures||[]};
    freshness.all_tabs_verified=freshness.all_tabs_verified&&v2.verified;
  }
  return {allErrors, summaries, freshness, hashes};
}

function verifyTabFreshness(summaries,includeToday=false,now=new Date()){
  // Consumer inventory: ordinary tabs use the selected preset, independent
  // Promo Creative sections share history, WL defaults to last_month ads.
  // Historical selections stop at their own end, not an invented yesterday row.
  const byPreset=new Map(summaries.filter(s=>s.preset).map(s=>[s.preset,s]));
  const fresh=stamp=>{const age=now-Date.parse(stamp);return Number.isFinite(age)&&age>=-60000&&age<=90000000;};
  const presetOK=(preset,types)=>types.every(type=>{const source=byPreset.get(preset)?.[type],expected=monthRange(preset,includeToday,now);return source?.readback_verified===true&&source.range?.since===expected.since&&source.range?.until===expected.until&&fresh(source.generated_at);});
  const tabs={};
  for(const tab of ['czsk','czsk-triage','czsk-promo','czsk-leadgen','us']){
    const types=['aggregate','daily',...(['czsk','us'].includes(tab)?['ads']:[])];
    tabs[tab]={verified:PRESETS.every(p=>presetOK(p,types)),sources:types,presets:PRESETS};
  }
  const history=summaries.find(s=>s.type==='promo_formats');
  tabs['czsk-promo-creative']={verified:Boolean(history?.readback_verified&&history.since==='2026-03-01'&&history.until===cutoffDate(includeToday,now)&&history.funnel_version===1&&fresh(history.generated_at)),sources:['promo_formats','promo_concepts'],through:history?.until||null};
  tabs.wl={verified:presetOK('last_month',['ads']),sources:['ads'],presets:['last_month'],through:monthRange('last_month',includeToday,now).until,custom_ranges:'live; verified by WL reader, not scheduled history'};
  return {through:cutoffDate(includeToday,now),all_tabs_verified:Object.values(tabs).every(t=>t.verified),tabs};
}

async function handler(req, res) {
  // Vercel cron passes this header; block unauthorised calls
  const cronSecret = process.env.CRON_SECRET || process.env.GLV_META_CRON_SECRET;
  const token = process.env.GLV_META_FB_ACCESS_TOKEN || process.env.FB_ACCESS_TOKEN;
  const redis = resolveRedisConfig();
  if (!cronSecret || !token || !redis) {
    return res.status(500).json({
      ok: false,
      message: 'GLV Meta Ads cron is not configured in agenthic-lab yet. Add GLV_META_CRON_SECRET, GLV_META_FB_ACCESS_TOKEN, KV_REST_API_URL, and KV_REST_API_TOKEN.',
    });
  }

  if (req.headers['authorization'] !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const includeToday = ['1', 'true'].includes(String(req.query?.include_today || '').toLowerCase());
  const fullHistory=['1','true'].includes(String(req.query?.full_history||'').toLowerCase());
  const deadline=Date.now()+270000;
  const redisFetcher=boundedFetcher(deadline);
  let result;
  try{
    result=await scheduledRefresh({
      redis:(...args)=>redisCommand(redisFetcher,...args),
      refresh:()=>runRefresh(token,includeToday,{fullHistory,timeoutMs:Math.max(0,deadline-Date.now()-10000)}),
      keys:[...PRESETS.flatMap(p=>['aggregate','daily','ads'].map(t=>`glv:${t}:${p}`)),CACHE_KEY,...(require('../../lib/glv-mad-v2.cjs').rolloutEnabled()?require('../../lib/glv-mad-v2-cache.cjs').requiredKeys():[])],
      through:require('../../lib/glv-mad-v2.cjs').rolloutEnabled()?`${cutoffDate(includeToday)}:v2:${require('../../lib/glv-mad-v2.cjs').commonCutoff()}`:cutoffDate(includeToday),force:includeToday||fullHistory
    });
  }catch(error){
    console.error(JSON.stringify({event:'glv-meta-ads-cron',message:'Refresh coordination failed',error:error.message}));
    return res.status(500).json({ok:false,message:'Refresh coordination failed; next scheduled invocation can retry',freshness:{all_tabs_verified:false}});
  }
  const {allErrors,summaries,freshness,skipped}=result;
  const success = allErrors.length === 0;
  const through = cutoffDate(includeToday);
  const coverageNote = includeToday ? ' including partial current day' : '';
  const message = skipped ? `Cache refresh skipped: ${skipped} — target ${through}` : success
    ? `Cache refreshed for ${PRESETS.join(', ')} — data through ${through}${coverageNote}`
    : `Cache refresh completed with errors: ${allErrors.join('; ')}`;

  console.log(JSON.stringify({ event: 'glv-meta-ads-cron', message, skipped, freshness, summaries },(key,value)=>['eligible_ad_ids','unverified_ad_ids'].includes(key)?undefined:value));
  res.status(skipped==='refresh_in_progress'?202:success?200:500).json({ ok: success&&skipped!=='refresh_in_progress', message, skipped, summaries, freshness });
}

module.exports = handler;
module.exports._test = { normalizeAd, fetchAndCache, cutoffDate, sinceDate, monthRange, redisCmd, summarizeRows, normalizeCampaign, resolveRedisConfig, refreshPromoFormatCache, runRefresh };
