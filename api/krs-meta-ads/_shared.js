const AD_ACCOUNT = '903309897610642';
const ACCOUNT_CURRENCY = 'CZK';
const ACCOUNT_TIMEZONE = 'Europe/Prague';
const CACHE_PREFIX = 'krs';
const FB_API = 'https://graph.facebook.com/v22.0';
const CACHED_PRESETS = new Set(['last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month']);
const PRESET_DAYS = { last_7d: 6, last_14d: 13, last_30d: 29, last_90d: 89 };
const TTL = 90000;

const EVENT_TYPES = {
  landingPageView: ['landing_page_view', 'omni_landing_page_view'],
  checkout: ['initiate_checkout', 'offsite_conversion.fb_pixel_initiate_checkout'],
  purchase: ['purchase', 'offsite_conversion.fb_pixel_purchase', 'omni_purchase'],
};

function envToken() {
  return process.env.KRS_META_FB_ACCESS_TOKEN
    || process.env.AGENTHIC_META_ACCESS_TOKEN
    || process.env.FB_ACCESS_TOKEN;
}

function redisCredentials() {
  return {
    url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
  };
}

function firstMetric(items, types) {
  if (!Array.isArray(items)) return '0';
  for (const type of types) {
    const item = items.find(candidate => candidate.action_type === type);
    if (item && Number(item.value) > 0) return String(item.value);
  }
  return '0';
}

function videoMetric(items) {
  if (!Array.isArray(items) || !items.length) return '0';
  return String(items[0].value || '0');
}

function normalizeCampaign(row) {
  return {
    id: row.campaign_id || '',
    name: row.campaign_name || '',
    amount_spent: String(row.spend || '0'),
    impressions: String(row.impressions || '0'),
    inline_link_clicks: String(row.inline_link_clicks || '0'),
    'actions:landing_page_view': firstMetric(row.actions, EVENT_TYPES.landingPageView),
    'actions:initiate_checkout': firstMetric(row.actions, EVENT_TYPES.checkout),
    'actions:purchase': firstMetric(row.actions, EVENT_TYPES.purchase),
    'action_values:purchase': firstMetric(row.action_values, EVENT_TYPES.purchase),
    date_start: row.date_start || null,
    date_stop: row.date_stop || null,
  };
}

function normalizeAd(row, statusMap = {}) {
  const adId = row.ad_id || row.id || '';
  return {
    ...normalizeCampaign(row),
    id: adId,
    name: row.ad_name || '',
    campaign_id: row.campaign_id || '',
    campaign_name: row.campaign_name || '',
    status: statusMap[adId] || 'UNKNOWN',
    video_thruplay_watched_actions: videoMetric(row.video_thruplay_watched_actions),
    video_3_sec_watched_actions: firstMetric(row.actions, ['video_view']),
  };
}

function accountContract() {
  return { id: AD_ACCOUNT, currency: ACCOUNT_CURRENCY, timezone: ACCOUNT_TIMEZONE, cachePrefix: CACHE_PREFIX };
}

function zonedIsoDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ACCOUNT_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

function shiftIsoDate(iso, days) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function cutoffDate(includeToday = false, now = new Date()) {
  const today = zonedIsoDate(now);
  return includeToday ? today : shiftIsoDate(today, -1);
}

function monthRange(preset, includeToday = false, now = new Date()) {
  const until = cutoffDate(includeToday, now);
  if (preset === 'this_month') {
    const since = `${zonedIsoDate(now).slice(0, 7)}-01`;
    return until < since ? { since, until: since, empty: true } : { since, until };
  }
  if (preset === 'last_month') {
    const currentStart = new Date(`${zonedIsoDate(now).slice(0, 7)}-01T12:00:00Z`);
    currentStart.setUTCMonth(currentStart.getUTCMonth() - 1);
    const since = currentStart.toISOString().slice(0, 10);
    currentStart.setUTCMonth(currentStart.getUTCMonth() + 1);
    currentStart.setUTCDate(currentStart.getUTCDate() - 1);
    return { since, until: currentStart.toISOString().slice(0, 10) };
  }
  return { since: shiftIsoDate(until, -(PRESET_DAYS[preset] || PRESET_DAYS.last_30d)), until };
}

function presetRange(preset, now = new Date()) {
  return monthRange(preset, false, now);
}

function cacheKey(preset) {
  return `${CACHE_PREFIX}:preset:${preset}`;
}

async function paginate(url) {
  const rows = [];
  let next = url;
  while (next) {
    const response = await fetch(next);
    const payload = await response.json();
    if (!response.ok || payload.error) {
      const error = payload.error || {};
      throw new Error(`Meta API: ${error.message || `HTTP ${response.status}`} (code ${error.code || 'unknown'})`);
    }
    rows.push(...(payload.data || []));
    next = payload.paging?.next || null;
  }
  return rows;
}

function insightUrl({ type, token, range, preset }) {
  const isAds = type === 'ads';
  const level = isAds ? 'ad' : 'campaign';
  const fields = isAds
    ? 'ad_id,ad_name,campaign_id,campaign_name,spend,impressions,inline_link_clicks,actions,action_values,video_thruplay_watched_actions'
    : 'campaign_id,campaign_name,spend,impressions,inline_link_clicks,actions,action_values';
  const dateParam = range
    ? `time_range=${encodeURIComponent(JSON.stringify(range))}`
    : `date_preset=${encodeURIComponent(preset || 'last_30d')}`;
  const increment = type === 'daily' ? '&time_increment=1' : '';
  const sort = isAds ? '&sort=spend_descending' : '';
  return `${FB_API}/act_${AD_ACCOUNT}/insights?level=${level}&fields=${fields}&${dateParam}${increment}${sort}&limit=500&access_token=${encodeURIComponent(token)}`;
}

async function statusMapFor(rows, token) {
  const ids = [...new Set(rows.map(row => row.ad_id || row.id).filter(Boolean))];
  if (!ids.length) return {};
  const response = await fetch(`${FB_API}/?ids=${ids.join(',')}&fields=effective_status&access_token=${encodeURIComponent(token)}`);
  const payload = await response.json();
  if (!response.ok || payload.error) return {};
  return Object.fromEntries(Object.entries(payload).map(([id, value]) => [id, value.effective_status || 'UNKNOWN']));
}

async function fetchNormalized(type, token, { range = null, preset = 'last_30d' } = {}) {
  if (!['aggregate', 'daily', 'ads'].includes(type)) throw new Error('Invalid type. Use aggregate, daily, or ads.');
  if (range?.empty) return [];
  const raw = await paginate(insightUrl({ type, token, range, preset }));
  if (type === 'ads') {
    const statusMap = await statusMapFor(raw, token);
    return raw.map(row => normalizeAd(row, statusMap));
  }
  return raw.map(normalizeCampaign);
}

async function redisGet(key) {
  const credentials = redisCredentials();
  if (!credentials.url || !credentials.token) return null;
  const response = await fetch(`${credentials.url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${credentials.token}` },
  });
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(`Redis read failed (${response.status})`);
  return payload.result ? JSON.parse(payload.result) : null;
}

async function redisCommand(command) {
  const credentials = redisCredentials();
  if (!credentials.url || !credentials.token) throw new Error('Redis is not configured');
  const response = await fetch(credentials.url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + credentials.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`Redis HTTP ${response.status}`);
  if (payload.error) throw new Error(`Redis: ${payload.error}`);
  return payload.result;
}

async function redisSet(key, value) {
  return redisCommand(['SET', key, JSON.stringify(value), 'EX', String(TTL)]);
}

function summarizeRows(rows) {
  return rows.reduce((summary, row) => {
    summary.rows += 1;
    summary.spend += Number(row.amount_spent) || 0;
    summary.landingPageViews += Number(row['actions:landing_page_view']) || 0;
    summary.checkouts += Number(row['actions:initiate_checkout']) || 0;
    summary.purchases += Number(row['actions:purchase']) || 0;
    return summary;
  }, { rows: 0, spend: 0, landingPageViews: 0, checkouts: 0, purchases: 0 });
}

module.exports = {
  AD_ACCOUNT, ACCOUNT_CURRENCY, ACCOUNT_TIMEZONE, CACHE_PREFIX, CACHED_PRESETS, TTL,
  accountContract, cacheKey, cutoffDate, envToken, fetchNormalized, monthRange, normalizeAd,
  normalizeCampaign, presetRange, redisCommand, redisCredentials, redisGet, redisSet, summarizeRows,
};
