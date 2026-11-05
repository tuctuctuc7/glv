// GLV Meta Ads Dashboard — FB Graph API proxy with Upstash Redis cache
// Requires env vars: GLV_META_FB_ACCESS_TOKEN, KV_REST_API_URL, KV_REST_API_TOKEN

const { formatRange, sliceCachedFormats, CACHE_KEY } = require('../../lib/glv-promo-format.cjs');
const { validPayload, validConceptPayload } = require('../../public/glv-meta-ads/promo-format.js');
const { campaignFacts, needsAdsets, validCreatorGhost } = require('../../lib/glv-wl-creators.cjs');
const {fetchAdMetadata} = require('../../lib/glv-partnership.cjs');
const AD_ACCOUNT = '359758259164738';
const FB_API = 'https://graph.facebook.com/v21.0';
// Presets the cron pre-warms; everything else hits Meta live
const CACHED_PRESETS = new Set(['last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month']);
const { monthRange } = require('../../lib/glv-meta-dates.cjs');
function cacheFreshForRange(payload, range, now = new Date()) {
  const age = now - Date.parse(payload?.generated_at);
  return Boolean(range && payload?.range?.since === range.since && payload?.range?.until === range.until && Number.isFinite(age) && age >= 0 && age <= 90000000);
}
const { validPartnership } = require('../../public/glv-meta-ads/wl-report.js');
const { lastMonth } = require('../../public/glv-meta-ads/wl-report.js');
function wlCacheUsable(payload, range, now = new Date()) {
  const age = now - new Date(payload?.generated_at);
  return Boolean(payload?.wl_version === 3 && Array.isArray(payload.rows)
    && payload.range?.since === range.since && payload.range?.until === range.until
    && age >= 0 && age <= 90000000
    && payload.rows.every(row => typeof row.campaign_name === 'string' && row.campaign_name && validPartnership(row.partnership)));
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

async function redisGet(key) {
  const controller = new AbortController();
  let timer;
  try {
    const redis = resolveRedisConfig();
    if (!redis) return null;
    return await Promise.race([
      new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve(null);},5000);}),
      (async()=>{
        const r = await fetch(`${redis.url}/get/${encodeURIComponent(key)}`, {
          headers: { Authorization: `Bearer ${redis.token}` }, signal:controller.signal,
        });
        if(!r.ok)return null;
        const { result } = await r.json();
        return result ? JSON.parse(result) : null;
      })(),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function cachedPayloadUsable(type, payload) {
  if (type === 'promo_concepts') return validConceptPayload(payload);
  if (type === 'promo_formats') return validPayload(payload);
  if (!payload || payload.creator_version !== 2 || !Array.isArray(payload.rows)) return false;
  if (type === 'ads') return payload.wl_version === 3 && payload.rows.every(row => typeof row.adset_name === 'string' && typeof row.adset_id === 'string' && validPartnership(row.partnership));
  if (type !== 'aggregate' && type !== 'daily') return true;
  if (payload.rows.some(needsAdsets) && payload.creator_reconciliation_version !== 1) return false;
  return payload.rows.every(row => {
    if (needsAdsets(row) && (!Array.isArray(row.creator_rows) || (!row.creator_rows.length && !row.creator_issue))) return false;
    // Legacy failed reconciliation discarded its children: require a new read.
    if (row.creator_issue?.includes('do not reconcile')) return false;
    if (row.creator_rows?.some(child => child.is_ghost===true ? !validCreatorGhost(child) : typeof child.adset_name !== 'string' || !child.adset_id)) return false;
    if (!Object.prototype.hasOwnProperty.call(row, 'reach')) return false;
    if (typeof row.reach !== 'number' && typeof row.reach !== 'string') return false;
    if (typeof row.reach === 'string' && row.reach.trim() === '') return false;
    const reach = Number(row.reach);
    return Number.isFinite(reach) && reach >= 0;
  });
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
    id:   row.campaign_id || '',
    name: row.campaign_name || '',
    amount_spent:                  row.spend || '0',
    impressions:                   row.impressions || '0',
    reach:                         row.reach || '0',
    'actions:link_click':          getAction(row.actions, 'link_click'),
    'actions:landing_page_view':   getAction(row.actions, 'landing_page_view'),
    'actions:omni_purchase':       getAction(row.actions, 'omni_purchase'),
    'actions:initiate_checkout':   getAction(row.actions, 'initiate_checkout'),
    'actions:outbound_click':      getAction(row.actions, 'outbound_click'),
    'actions:lead':                getFirstAction(row.actions, LEAD_ACTION_TYPES),
    'action_values:omni_purchase': getActionValue(row.action_values, 'omni_purchase'),
    date_start: row.date_start || null,
    date_stop:  row.date_stop  || null,
  };
}

function normalizeAd(row, statusMap) {
  const adId = row.ad_id || row.id || '';
  return {
    id:   adId,
    name: row.ad_name || '',
    status: statusMap[adId] || 'UNKNOWN',
    campaign_id: row.campaign_id || '',
    campaign_name: row.campaign_name || '',
    adset_id: row.adset_id || '',
    adset_name: row.adset_name || '',
    amount_spent:                  row.spend ?? null,
    impressions:                   row.impressions || '0',
    'actions:link_click':          getAction(row.actions, 'link_click'),
    'actions:landing_page_view':   getAction(row.actions, 'landing_page_view'),
    'actions:omni_purchase':       getAction(row.actions, 'omni_purchase'),
    'actions:initiate_checkout':   getAction(row.actions, 'initiate_checkout'),
    'actions:outbound_click':      getAction(row.actions, 'outbound_click'),
    'actions:lead':                getFirstAction(row.actions, LEAD_ACTION_TYPES),
    'action_values:omni_purchase': getActionValue(row.action_values, 'omni_purchase'),
    video_thruplay_watched_actions: getVideoMetric(row.video_thruplay_watched_actions),
    video_3_sec_watched_actions:    getAction(row.actions, 'video_view'),
    video_p100_watched_actions:     getVideoMetric(row.video_p100_watched_actions),
  };
}

async function paginate(url) {
  let rows = [];
  let next = url;
  while (next) {
    const r = await fetch(next);
    const data = await r.json();
    if (!r.ok || data.error || !Array.isArray(data.data)) throw new Error('Meta insights unavailable or incomplete');
    rows = rows.concat(data.data || []);
    next = data.paging?.next || null;
  }
  return rows;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const token = process.env.GLV_META_FB_ACCESS_TOKEN || process.env.FB_ACCESS_TOKEN;
  const redis = resolveRedisConfig();
  if (!token || !redis) {
    return res.status(500).json({
      error: 'GLV Meta Ads API is not configured. Add FB_ACCESS_TOKEN plus KV_REST_API_URL and KV_REST_API_TOKEN to agenthic-lab.',
    });
  }

  const { type, date_preset, time_range } = req.query;
  const preset = date_preset || 'last_30d';
  const wl = req.query.wl === '1';
  let wlRange;
  if (wl) {
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      wlRange = time_range ? JSON.parse(time_range) : lastMonth();
      const valid = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d).toISOString().slice(0,10) === d;
      if (type !== 'ads' || (!time_range && preset !== 'last_month') || !valid(wlRange.since) || !valid(wlRange.until) || wlRange.since > wlRange.until) throw new Error();
    } catch { return res.status(400).json({error:'Invalid WL date range'}); }
  }

  if (type === 'promo_formats' || type === 'promo_concepts') {
    res.setHeader('Cache-Control', 'private, no-store');
    let range;
    try { range = formatRange(req.query); }
    catch { return res.status(400).json({error:'Invalid Promo date range or preset'}); }
    try {
      let cached = sliceCachedFormats(await redisGet(CACHE_KEY), range, new Date(), {allowStale:true});
      if(type === 'promo_concepts' && !validConceptPayload(cached)) cached=null;
      res.setHeader('X-Cache', cached ? (cached.freshness.status==='stale'?'STALE':'HIT') : 'MISS');
      // Only the existing shared cron produces history. Page views must never
      // multiply multi-minute Meta pulls when a refresh has failed.
      if (!cached) return res.status(503).json({status:'unavailable',error:'Promo history cache unavailable. Awaiting the scheduled shared refresh; no live history rebuild was started.'});
      const payload = cached;
      if (!cachedPayloadUsable(type,payload)) throw new Error('Invalid Promo data');
      return res.json(payload);
    } catch (error) {
      // Never log token-bearing URLs or return a success-shaped empty split.
      return res.status(502).json({error:error.message});
    }
  }

  res.setHeader('Cache-Control', 'private, no-store');
  let range = wlRange || (CACHED_PRESETS.has(preset) ? monthRange(preset, false) : null);
  if (time_range && !wl) {
    try {
      range = JSON.parse(time_range);
      const {validDate} = require('../../public/glv-meta-ads/promo-format.js');
      if (!validDate(range.since) || !validDate(range.until) || range.since > range.until) throw new Error();
    } catch { return res.status(400).json({error:'Invalid date range'}); }
  }
  const provenance = () => ({...(range ? {range} : {}), generated_at:new Date().toISOString()});

  // Serve from cache for standard presets (no time_range = custom date)
  if (!time_range && CACHED_PRESETS.has(preset)) {
    const cached = await redisGet(`glv:${type}:${preset}`);
    if (cachedPayloadUsable(type, cached) && cacheFreshForRange(cached, range) && (!wl || wlCacheUsable(cached, wlRange))) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(cached);
    }
  }

  // Cache miss or custom range — hit Meta API live
  res.setHeader('X-Cache', 'MISS');
  const dateParam = range ? `time_range=${encodeURIComponent(JSON.stringify(range))}` : time_range
    ? `time_range=${encodeURIComponent(time_range)}`
    : `date_preset=${preset}`;
  const auth = `access_token=${token}`;

  try {
    if (type === 'aggregate') {
      const fields = 'campaign_id,campaign_name,spend,impressions,reach,actions,action_values';
      const url = `${FB_API}/act_${AD_ACCOUNT}/insights?level=campaign&fields=${fields}&${dateParam}&limit=500&${auth}`;
      const rows = await campaignFacts(url,paginate,normalizeCampaign);
      res.json({ rows, creator_version:2, creator_reconciliation_version:1, ...provenance() });

    } else if (type === 'daily') {
      const fields = 'campaign_id,campaign_name,spend,impressions,reach,actions,action_values';
      const url = `${FB_API}/act_${AD_ACCOUNT}/insights?level=campaign&fields=${fields}&${dateParam}&time_increment=1&limit=500&${auth}`;
      const rows = await campaignFacts(url,paginate,normalizeCampaign);
      res.json({ rows, creator_version:2, creator_reconciliation_version:1, ...provenance() });

    } else if (type === 'ads') {
      const fields = 'ad_id,ad_name,campaign_id,campaign_name,adset_id,adset_name,spend,impressions,actions,action_values,video_p100_watched_actions,video_thruplay_watched_actions';
      const url = `${FB_API}/act_${AD_ACCOUNT}/insights?level=ad&fields=${fields}&${dateParam}&sort=spend_descending&limit=50&${auth}`;
      const raw = await paginate(url);

      const metadata = await fetchAdMetadata(raw.map(r=>r.ad_id||r.id),token,fetch);
      const statusMap = Object.fromEntries(Object.entries(metadata).map(([id,m])=>[id,m.status]));
      res.json({ creator_version:2, rows: raw.map(r => ({...normalizeAd(r, statusMap),partnership:metadata[r.ad_id||r.id]?.partnership||{status:'unverified',reason:'metadata_unavailable',evidence:[]}})), ...provenance(), wl_version:3 });

    } else {
      res.status(400).json({ error: 'Invalid type. Use: aggregate, daily, or ads.' });
    }
  } catch (err) {
    // Do not expose upstream URLs, tokens or source text through diagnostics.
    console.error('fb-data request failed');
    res.status(500).json({ error: 'Meta data unavailable. Please retry.' });
  }
};
module.exports._test = { normalizeAd, wlCacheUsable, normalizeCampaign, cachedPayloadUsable, resolveRedisConfig };
