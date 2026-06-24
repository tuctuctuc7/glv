// GLV Media Buyer OS decision input
// Protected server-side export of normalized Meta Ads data for analysis/Decision API.

const AD_ACCOUNT = '359758259164738';
const FB_API = 'https://graph.facebook.com/v21.0';
const TTL = 90000; // 25 hours
const PRESET_DAYS = { last_7d: 6, last_14d: 13, last_30d: 29 };
const CACHED_PRESETS = new Set(['last_7d', 'last_14d', 'last_30d', 'this_month', 'last_month']);
const SUPPORTED_PRESETS = new Set([...Object.keys(PRESET_DAYS), 'this_month', 'last_month']);

function yesterday() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function rangeForPreset(preset) {
  const now = new Date();
  if (preset === 'this_month') {
    const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return { since: since.toISOString().slice(0, 10), until: yesterday() };
  }
  if (preset === 'last_month') {
    const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const until = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
    return { since: since.toISOString().slice(0, 10), until: until.toISOString().slice(0, 10) };
  }
  const days = PRESET_DAYS[preset] ?? PRESET_DAYS.last_30d;
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 1 - days);
  return { since: since.toISOString().slice(0, 10), until: yesterday() };
}

function redisConfig() {
  return {
    url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
    token: (
      process.env.KV_REST_API_READ_ONLY_TOKEN
      || process.env.KV_REST_API_TOKEN
      || process.env.UPSTASH_REDIS_REST_TOKEN
    ),
  };
}

async function redisGet(key) {
  const { url, token } = redisConfig();
  if (!url || !token) return null;
  const r = await fetch(`${url.replace(/\/$/, '')}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await r.json();
  return body.result ? JSON.parse(body.result) : null;
}

async function redisSet(key, value) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return;
  await fetch(url.replace(/\/$/, ''), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(['SET', key, JSON.stringify(value), 'EX', String(TTL)]),
  });
}

function getAction(actions, type) {
  if (!Array.isArray(actions)) return '0';
  const item = actions.find(a => a.action_type === type);
  return item ? item.value : '0';
}

function getActionValue(values, type) {
  if (!Array.isArray(values)) return '0';
  const item = values.find(a => a.action_type === type);
  return item ? item.value : '0';
}

function metric(row, key) {
  const n = Number.parseFloat(String(row[key] || '0').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function roas(row) {
  const spend = metric(row, 'amount_spent');
  const revenue = metric(row, 'purchase_value');
  return spend > 0 ? revenue / spend : 0;
}

function normalize(row, level, statusMap = {}) {
  const id = row[`${level}_id`] || row.id || '';
  return {
    level,
    id,
    name: row[`${level}_name`] || row.name || '',
    status: statusMap[id] || 'UNKNOWN',
    campaign_id: row.campaign_id || '',
    campaign_name: row.campaign_name || '',
    adset_id: row.adset_id || '',
    adset_name: row.adset_name || '',
    date_start: row.date_start || null,
    date_stop: row.date_stop || null,
    amount_spent: row.spend || '0',
    impressions: row.impressions || '0',
    cpm: row.cpm || '0',
    ctr: row.ctr || '0',
    frequency: row.frequency || '0',
    link_clicks: getAction(row.actions, 'link_click'),
    outbound_clicks: getAction(row.actions, 'outbound_click'),
    landing_page_views: getAction(row.actions, 'landing_page_view'),
    checkouts: getAction(row.actions, 'initiate_checkout'),
    purchases: getAction(row.actions, 'omni_purchase'),
    purchase_value: getActionValue(row.action_values, 'omni_purchase'),
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

async function statusMap(ids, token) {
  const out = {};
  const clean = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < clean.length; i += 50) {
    const chunk = clean.slice(i, i + 50);
    try {
      const r = await fetch(`${FB_API}/?ids=${chunk.join(',')}&fields=effective_status,status&access_token=${token}`);
      const data = await r.json();
      if (!data.error) {
        for (const [id, value] of Object.entries(data)) {
          out[id] = value.effective_status || value.status || 'UNKNOWN';
        }
      }
    } catch (e) {}
  }
  return out;
}

async function insightRows({ token, level, range, daily }) {
  const ids = {
    campaign: 'campaign_id,campaign_name',
    adset: 'campaign_id,campaign_name,adset_id,adset_name',
    ad: 'campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name',
  }[level];
  const fields = [
    ids,
    'spend',
    'impressions',
    'cpm',
    'ctr',
    'frequency',
    'actions',
    'action_values',
  ].join(',');
  const dateParam = `time_range=${encodeURIComponent(JSON.stringify(range))}`;
  const increment = daily ? '&time_increment=1' : '';
  const url = `${FB_API}/act_${AD_ACCOUNT}/insights?level=${level}&fields=${fields}&${dateParam}${increment}&limit=500&access_token=${token}`;
  const raw = await paginate(url);
  const idsForStatus = raw.map(row => row[`${level}_id`] || row.id).filter(Boolean);
  const statuses = level === 'campaign' ? {} : await statusMap(idsForStatus, token);
  return raw.map(row => normalize(row, level, statuses));
}

function segmentFor(name) {
  if (!name) return 'unknown';
  if (name.includes('_US_')) {
    return name.toLowerCase().includes('advertorial') ? 'excluded_us_advertorial' : 'us';
  }
  if (name.startsWith('TUC_') || name.startsWith('GLV_')) return 'czsk';
  return 'unknown';
}

function withDerived(row) {
  const spend = metric(row, 'amount_spent');
  const revenue = metric(row, 'purchase_value');
  const lpv = metric(row, 'landing_page_views');
  const checkouts = metric(row, 'checkouts');
  const purchases = metric(row, 'purchases');
  return {
    ...row,
    market: segmentFor(row.campaign_name || row.name),
    roas: roas(row),
    cpa: purchases > 0 ? spend / purchases : 0,
    cost_per_checkout: checkouts > 0 ? spend / checkouts : 0,
    cost_per_lpv: lpv > 0 ? spend / lpv : 0,
    lpv_to_checkout_rate: lpv > 0 ? checkouts / lpv : 0,
    lpv_to_purchase_rate: lpv > 0 ? purchases / lpv : 0,
    checkout_to_purchase_rate: checkouts > 0 ? purchases / checkouts : 0,
    revenue,
    spend,
    purchases,
    checkouts,
    landing_page_views: lpv,
  };
}

function summarize(rows) {
  const totals = {};
  for (const row of rows) {
    const market = row.market || 'unknown';
    totals[market] ||= { spend: 0, revenue: 0, purchases: 0, checkouts: 0, landing_page_views: 0, rows: 0 };
    totals[market].spend += row.spend;
    totals[market].revenue += row.revenue;
    totals[market].purchases += row.purchases;
    totals[market].checkouts += row.checkouts;
    totals[market].landing_page_views += row.landing_page_views;
    totals[market].rows += 1;
  }
  for (const value of Object.values(totals)) {
    value.roas = value.spend > 0 ? value.revenue / value.spend : 0;
    value.cpa = value.purchases > 0 ? value.spend / value.purchases : 0;
  }
  return totals;
}

function daysInRange(range) {
  const since = new Date(`${range.since}T00:00:00Z`);
  const until = new Date(`${range.until}T00:00:00Z`);
  const ms = until.getTime() - since.getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 86400000) + 1 : Infinity;
}

async function buildDecisionInput({ token, preset, timeRange }) {
  const range = timeRange || rangeForPreset(preset);
  const [
    campaignAggregate,
    campaignDaily,
    adsetAggregate,
    adsetDaily,
    adAggregate,
    adDaily,
  ] = await Promise.all([
    insightRows({ token, level: 'campaign', range, daily: false }),
    insightRows({ token, level: 'campaign', range, daily: true }),
    insightRows({ token, level: 'adset', range, daily: false }),
    insightRows({ token, level: 'adset', range, daily: true }),
    insightRows({ token, level: 'ad', range, daily: false }),
    insightRows({ token, level: 'ad', range, daily: true }),
  ]);

  const datasets = {
    campaign_aggregate: campaignAggregate.map(withDerived),
    campaign_daily: campaignDaily.map(withDerived),
    adset_aggregate: adsetAggregate.map(withDerived),
    adset_daily: adsetDaily.map(withDerived),
    ad_aggregate: adAggregate.map(withDerived),
    ad_daily: adDaily.map(withDerived),
  };

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    ad_account_id: `act_${AD_ACCOUNT}`,
    preset,
    range,
    currency_note: 'Meta Ads values are returned in the ad account currency.',
    row_counts: Object.fromEntries(Object.entries(datasets).map(([key, rows]) => [key, rows.length])),
    market_summary: summarize(datasets.campaign_daily),
    datasets,
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const secret = process.env.GLV_META_DECISION_SECRET || process.env.GLV_META_SUMMARY_SECRET;
  if (!secret) {
    return res.status(202).json({ ok: false, error: 'GLV_META_DECISION_SECRET or GLV_META_SUMMARY_SECRET is not configured' });
  }
  if (req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = process.env.GLV_META_FB_ACCESS_TOKEN || process.env.FB_ACCESS_TOKEN;
  if (!token) {
    return res.status(202).json({ ok: false, error: 'GLV Meta token is missing in Vercel env' });
  }

  const preset = String(req.query.date_preset || req.query.preset || 'last_30d');
  const refresh = String(req.query.refresh || '') === '1';
  let timeRange = null;
  if (req.query.time_range) {
    try {
      timeRange = JSON.parse(req.query.time_range);
    } catch {
      return res.status(400).json({ ok: false, error: 'time_range must be JSON like {"since":"YYYY-MM-DD","until":"YYYY-MM-DD"}' });
    }
  }
  if (!timeRange && !SUPPORTED_PRESETS.has(preset)) {
    return res.status(400).json({
      ok: false,
      error: 'Unsupported date_preset. Use last_7d, last_14d, last_30d, this_month, last_month, or a custom time_range up to 31 days.',
    });
  }
  if (timeRange && (!timeRange.since || !timeRange.until || daysInRange(timeRange) > 31)) {
    return res.status(400).json({
      ok: false,
      error: 'time_range must include since/until and be 31 days or less for the interactive decision-input endpoint.',
    });
  }

  const cacheable = !timeRange && CACHED_PRESETS.has(preset);
  const cacheKey = `glv:decision-input:${preset}`;

  try {
    if (cacheable && !refresh) {
      const cached = await redisGet(cacheKey);
      if (cached) {
        res.setHeader('X-Cache', 'HIT');
        return res.json(cached);
      }
    }

    const payload = await buildDecisionInput({ token, preset, timeRange });
    if (cacheable) await redisSet(cacheKey, payload);
    res.setHeader('X-Cache', 'MISS');
    res.json(payload);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};
