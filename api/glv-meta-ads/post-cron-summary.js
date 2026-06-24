const CACHED_KEY = 'glv:daily:last_7d';

function targetDate() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function redisGet(key) {
  const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = (
    process.env.KV_REST_API_READ_ONLY_TOKEN
    || process.env.KV_REST_API_TOKEN
    || process.env.UPSTASH_REDIS_REST_TOKEN
  );
  if (!redisUrl || !redisToken) throw new Error('Redis env is missing');

  const r = await fetch(`${redisUrl.replace(/\/$/, '')}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${redisToken}` },
  });
  const body = await r.json();
  return body.result ? JSON.parse(body.result) : null;
}

function num(value) {
  const parsed = Number.parseFloat(String(value || '0').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function actionValue(values, type) {
  if (!Array.isArray(values)) return 0;
  const item = values.find(v => v.action_type === type);
  return item ? num(item.value) : 0;
}

function validCampaign(name) {
  return name.startsWith('TUC_') || name.startsWith('GLV_');
}

function segmentFor(name) {
  if (name.includes('_US_')) {
    return name.toLowerCase().includes('advertorial') ? null : 'us';
  }
  return 'czsk';
}

function summarize(rows, date) {
  const totals = {
    czsk: { spend: 0, revenue: 0, rows: 0 },
    us: { spend: 0, revenue: 0, rows: 0 },
  };
  const campaigns = {
    czsk: [],
    us: [],
  };
  const dates = [];

  for (const row of rows) {
    const rowDate = String(row.date_start || row.date_stop || '').slice(0, 10);
    if (rowDate) dates.push(rowDate);
    const name = row.name || row.campaign_name || '';
    if (rowDate !== date || !validCampaign(name)) continue;
    const segment = segmentFor(name);
    if (!segment) continue;
    const spend = num(row.amount_spent || row.spend);
    const revenue = num(row['action_values:omni_purchase']) || actionValue(row.action_values, 'omni_purchase');
    totals[segment].spend += spend;
    totals[segment].revenue += revenue;
    totals[segment].rows += 1;
    campaigns[segment].push({
      id: row.id || row.campaign_id || '',
      name,
      spend,
      revenue,
      roas: spend > 0 ? revenue / spend : 0,
    });
  }

  for (const segment of Object.keys(campaigns)) {
    campaigns[segment].sort((a, b) => b.spend - a.spend);
  }

  return {
    maxDate: dates.length ? dates.sort().at(-1) : null,
    totals,
    campaigns,
  };
}

module.exports = async (req, res) => {
  const secret = process.env.GLV_META_SUMMARY_SECRET;
  if (!secret) {
    return res.status(202).json({ ok: false, error: 'GLV_META_SUMMARY_SECRET is not configured' });
  }
  if (req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const date = targetDate();
  try {
    const payload = await redisGet(CACHED_KEY);
    const rows = payload?.rows || [];
    const summary = summarize(rows, date);
    const ok = summary.maxDate === date && summary.totals.czsk.rows > 0 && summary.totals.us.rows > 0;
    res.json({
      ok,
      status: ok ? 'Pass ✅' : 'Needs check ❌',
      date,
      cache_key: CACHED_KEY,
      row_count: rows.length,
      ...summary,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      status: 'Needs check ❌',
      date,
      cache_key: CACHED_KEY,
      error: err.message,
    });
  }
};
