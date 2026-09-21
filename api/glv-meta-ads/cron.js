// GLV Meta Ads daily cron — runs at 00:00 UTC (07:00 GMT+7)
// Scheduled runs end yesterday; authorized manual runs may include today's partial data.

const { fetchPromoFormats, formatRange, CACHE_KEY } = require('../../lib/glv-promo-format.cjs');
const { validPayload } = require('../../public/glv-meta-ads/promo-format.js');
const AD_ACCOUNT = '359758259164738';
const FB_API = 'https://graph.facebook.com/v21.0';

const PRESETS = ['last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'];
const PRESET_DAYS = { last_7d: 6, last_14d: 13, last_30d: 29, last_90d: 89 };
const TTL = 90000; // 25 hours

function cutoffDate(includeToday = false, now = new Date()) {
  const d = new Date(now);
  if (!includeToday) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function sinceDate(preset, includeToday = false, now = new Date()) {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - (includeToday ? 0 : 1) - PRESET_DAYS[preset]);
  return d.toISOString().slice(0, 10);
}

function monthRange(preset, includeToday = false, now = new Date()) {
  if (preset === 'this_month') {
    const until = cutoffDate(includeToday, now);
    const cutoff = new Date(`${until}T00:00:00Z`);
    const since = new Date(Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth(), 1));
    return { since: since.toISOString().slice(0, 10), until };
  }
  if (preset === 'last_month') {
    const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const until = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
    return { since: since.toISOString().slice(0, 10), until: until.toISOString().slice(0, 10) };
  }
  return { since: sinceDate(preset, includeToday, now), until: cutoffDate(includeToday, now) };
}

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
        const data = await response.json();
        return {ok:response.ok, status:response.status, json:async () => data};
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
  if (String(args[0]).toUpperCase() === 'SET' && payload?.result !== 'OK') throw new Error('Redis SET was not acknowledged');
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
    amount_spent: row.spend || '0',
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
    if (data.error) throw new Error(`FB API: ${data.error.message} (code ${data.error.code})`);
    rows = rows.concat(data.data || []);
    next = data.paging?.next || null;
  }
  return rows;
}

async function fetchAndCache(token, preset, includeToday, fetcher) {
  const { since, until } = monthRange(preset, includeToday);
  const dateParam = `time_range=${encodeURIComponent(JSON.stringify({ since, until }))}`;
  const auth = `access_token=${token}`;
  const errors = [];
  const stats = { preset, since, until };

  // aggregate
  try {
    const fields = 'campaign_id,campaign_name,spend,impressions,reach,actions,action_values';
    const url = `${FB_API}/act_${AD_ACCOUNT}/insights?level=campaign&fields=${fields}&${dateParam}&limit=500&${auth}`;
    const raw = await paginate(url, fetcher);
    const rows = raw.map(normalizeCampaign);
    await redisCommand(fetcher, 'SET', `glv:aggregate:${preset}`, JSON.stringify({ rows }), 'EX', String(TTL));
    stats.aggregate = summarizeRows(rows);
  } catch (e) {
    errors.push(`aggregate/${preset}: ${e.message}`);
  }

  // daily
  try {
    const fields = 'campaign_id,campaign_name,spend,impressions,reach,actions,action_values';
    const url = `${FB_API}/act_${AD_ACCOUNT}/insights?level=campaign&fields=${fields}&${dateParam}&time_increment=1&limit=500&${auth}`;
    const raw = await paginate(url, fetcher);
    const rows = raw.map(normalizeCampaign);
    await redisCommand(fetcher, 'SET', `glv:daily:${preset}`, JSON.stringify({ rows }), 'EX', String(TTL));
    stats.daily = summarizeRows(rows);
  } catch (e) {
    errors.push(`daily/${preset}: ${e.message}`);
  }

  // ads
  try {
    const fields = 'ad_id,ad_name,campaign_id,spend,impressions,actions,action_values,video_p100_watched_actions,video_thruplay_watched_actions';
    const url = `${FB_API}/act_${AD_ACCOUNT}/insights?level=ad&fields=${fields}&${dateParam}&sort=spend_descending&limit=50&${auth}`;
    const raw = await paginate(url, fetcher);

    const adIds = [...new Set(raw.map(r => r.ad_id || r.id).filter(Boolean))];
    let statusMap = {};
    if (adIds.length) {
      try {
        const sr = await fetcher(`${FB_API}/?ids=${adIds.join(',')}&fields=effective_status&${auth}`);
        const sd = await sr.json();
        if (!sd.error) {
          for (const [id, d] of Object.entries(sd)) statusMap[id] = d.effective_status || 'UNKNOWN';
        }
      } catch (e) {}
    }

    const rows = raw.map(r => normalizeAd(r, statusMap));
    await redisCommand(fetcher, 'SET', `glv:ads:${preset}`, JSON.stringify({ rows }), 'EX', String(TTL));
    stats.ads = summarizeRows(rows);
  } catch (e) {
    errors.push(`ads/${preset}: ${e.message}`);
  }

  return { errors, stats };
}

async function refreshPromoFormatCache(token, includeToday = false, fetcher = boundedFetcher(Date.now() + 270000)) {
  const range = formatRange({date_preset:'promo_history',include_today:includeToday ? '1' : '0'});
  const payload = await fetchPromoFormats(token,range,fetcher);
  if (!validPayload(payload)) throw new Error('Invalid Promo format refresh');
  await redisCommand(fetcher, 'SET',CACHE_KEY,JSON.stringify(payload),'EX',String(TTL));
  return {type:'promo_formats',...range,rows:payload.rows.length,unknownAds:new Set(payload.rows.filter(r=>r.format==='Unknown').map(r=>r.ad_id)).size};
}

async function runRefresh(token, includeToday, {timeoutMs = 270000} = {}) {
  const fetcher = boundedFetcher(Date.now() + timeoutMs);
  const allErrors = [];
  const summaries = [];
  // Start the single bounded history pull alongside the old sequential preset
  // refreshes, so it does not add another full history budget at their end.
  // Attach both handlers immediately: failures must never become unhandled.
  const formatRefresh = refreshPromoFormatCache(token,includeToday,fetcher).then(
    stats=>({stats}), error=>({error:error.message})
  );
  for (const preset of PRESETS) {
    const result = await fetchAndCache(token, preset, includeToday,fetcher);
    allErrors.push(...result.errors);
    summaries.push(result.stats);
  }

  // One history pull per existing daily job, not one ad-level pull per preset.
  // Replace all historical facts so attribution backfill and label changes land.
  const formatResult = await formatRefresh;
  if (formatResult.error) allErrors.push(`promo_formats: ${formatResult.error}`);
  else summaries.push(formatResult.stats);
  return {allErrors, summaries};
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
  const {allErrors, summaries} = await runRefresh(token, includeToday);
  const success = allErrors.length === 0;
  const through = cutoffDate(includeToday);
  const coverageNote = includeToday ? ' including partial current day' : '';
  const message = success
    ? `Cache refreshed for ${PRESETS.join(', ')} — data through ${through}${coverageNote}`
    : `Cache refresh completed with errors: ${allErrors.join('; ')}`;

  console.log(JSON.stringify({ event: 'glv-meta-ads-cron', message, summaries }));
  res.status(success ? 200 : 500).json({ ok: success, message, summaries });
}

module.exports = handler;
module.exports._test = { cutoffDate, sinceDate, monthRange, redisCmd, summarizeRows, normalizeCampaign, resolveRedisConfig, refreshPromoFormatCache, runRefresh };
