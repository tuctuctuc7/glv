// GLV Meta Ads daily cron — runs at 00:00 UTC (07:00 GMT+7)
// Scheduled runs end yesterday; authorized manual runs may include today's partial data.

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

async function redisCmd(...args) {
  const redis = resolveRedisConfig();
  if (!redis) throw new Error('Redis is not configured with one complete credential pair');
  const r = await fetch(redis.url, {
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

async function paginate(url) {
  let rows = [];
  let next = url;
  while (next) {
    const r = await fetch(next);
    const data = await r.json();
    if (data.error) throw new Error(`FB API: ${data.error.message} (code ${data.error.code})`);
    rows = rows.concat(data.data || []);
    next = data.paging?.next || null;
  }
  return rows;
}

async function fetchAndCache(token, preset, includeToday = false) {
  const { since, until } = monthRange(preset, includeToday);
  const dateParam = `time_range=${encodeURIComponent(JSON.stringify({ since, until }))}`;
  const auth = `access_token=${token}`;
  const errors = [];
  const stats = { preset, since, until };

  // aggregate
  try {
    const fields = 'campaign_id,campaign_name,spend,impressions,reach,actions,action_values';
    const url = `${FB_API}/act_${AD_ACCOUNT}/insights?level=campaign&fields=${fields}&${dateParam}&limit=500&${auth}`;
    const raw = await paginate(url);
    const rows = raw.map(normalizeCampaign);
    await redisCmd('SET', `glv:aggregate:${preset}`, JSON.stringify({ rows }), 'EX', String(TTL));
    stats.aggregate = summarizeRows(rows);
  } catch (e) {
    errors.push(`aggregate/${preset}: ${e.message}`);
  }

  // daily
  try {
    const fields = 'campaign_id,campaign_name,spend,impressions,reach,actions,action_values';
    const url = `${FB_API}/act_${AD_ACCOUNT}/insights?level=campaign&fields=${fields}&${dateParam}&time_increment=1&limit=500&${auth}`;
    const raw = await paginate(url);
    const rows = raw.map(normalizeCampaign);
    await redisCmd('SET', `glv:daily:${preset}`, JSON.stringify({ rows }), 'EX', String(TTL));
    stats.daily = summarizeRows(rows);
  } catch (e) {
    errors.push(`daily/${preset}: ${e.message}`);
  }

  // ads
  try {
    const fields = 'ad_id,ad_name,campaign_id,spend,impressions,actions,action_values,video_p100_watched_actions,video_thruplay_watched_actions';
    const url = `${FB_API}/act_${AD_ACCOUNT}/insights?level=ad&fields=${fields}&${dateParam}&sort=spend_descending&limit=50&${auth}`;
    const raw = await paginate(url);

    const adIds = [...new Set(raw.map(r => r.ad_id || r.id).filter(Boolean))];
    let statusMap = {};
    if (adIds.length) {
      try {
        const sr = await fetch(`${FB_API}/?ids=${adIds.join(',')}&fields=effective_status&${auth}`);
        const sd = await sr.json();
        if (!sd.error) {
          for (const [id, d] of Object.entries(sd)) statusMap[id] = d.effective_status || 'UNKNOWN';
        }
      } catch (e) {}
    }

    const rows = raw.map(r => normalizeAd(r, statusMap));
    await redisCmd('SET', `glv:ads:${preset}`, JSON.stringify({ rows }), 'EX', String(TTL));
    stats.ads = summarizeRows(rows);
  } catch (e) {
    errors.push(`ads/${preset}: ${e.message}`);
  }

  return { errors, stats };
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
  const allErrors = [];
  const summaries = [];
  for (const preset of PRESETS) {
    const result = await fetchAndCache(token, preset, includeToday);
    allErrors.push(...result.errors);
    summaries.push(result.stats);
  }

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
module.exports._test = { cutoffDate, sinceDate, monthRange, redisCmd, summarizeRows, normalizeCampaign, resolveRedisConfig };
