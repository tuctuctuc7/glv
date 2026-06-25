const DAILY_KEY = 'glv:daily:last_90d';
const ADS_KEY = 'glv:ads:last_90d';
const GLITCH_START = '2026-06-09';
const GLITCH_END = '2026-06-19';

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
  if (!url || !token) throw new Error('Redis env is missing');
  const r = await fetch(`${url.replace(/\/$/, '')}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await r.json();
  return body.result ? JSON.parse(body.result) : null;
}

function num(value) {
  const parsed = Number.parseFloat(String(value || '0').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dateRange(start, end) {
  const dates = [];
  for (let d = start; d <= end; d = addDays(d, 1)) dates.push(d);
  return dates;
}

function segmentFor(name) {
  if (!name) return 'unknown';
  if (name.includes('_US_')) {
    return name.toLowerCase().includes('advertorial') ? 'excluded_us_advertorial' : 'us';
  }
  if (name.startsWith('TUC_') || name.startsWith('GLV_')) return 'czsk';
  return 'unknown';
}

function metrics(row) {
  const spend = num(row.amount_spent || row.spend);
  const revenue = num(row['action_values:omni_purchase']);
  const purchases = num(row['actions:omni_purchase']);
  const checkouts = num(row['actions:initiate_checkout']);
  const outbound = num(row['actions:outbound_click']);
  const linkClicks = num(row['actions:link_click']);
  return { spend, revenue, purchases, checkouts, outbound, linkClicks };
}

function empty() {
  return {
    spend: 0,
    revenue: 0,
    purchases: 0,
    checkouts: 0,
    outbound: 0,
    linkClicks: 0,
    rows: 0,
    active_days: 0,
  };
}

function add(into, rowMetrics) {
  for (const key of ['spend', 'revenue', 'purchases', 'checkouts', 'outbound', 'linkClicks']) {
    into[key] += rowMetrics[key] || 0;
  }
  into.rows += 1;
}

function finish(total, dayCount = total.active_days || 0) {
  return {
    ...total,
    roas: ratio(total.revenue, total.spend),
    cost_per_checkout: ratio(total.spend, total.checkouts),
    cost_per_purchase: ratio(total.spend, total.purchases),
    checkout_rate_per_outbound: ratio(total.checkouts, total.outbound),
    purchase_rate_per_outbound: ratio(total.purchases, total.outbound),
    checkouts_per_day: dayCount > 0 ? total.checkouts / dayCount : 0,
    purchases_per_day: dayCount > 0 ? total.purchases / dayCount : 0,
    spend_per_day: dayCount > 0 ? total.spend / dayCount : 0,
  };
}

function summarizeRows(rows, dates) {
  const dateSet = new Set(dates);
  const totals = empty();
  const activeDays = new Set();
  for (const row of rows) {
    const date = row.date_start || row.date_stop;
    if (!dateSet.has(date)) continue;
    const m = metrics(row);
    add(totals, m);
    if (m.spend > 0 || m.checkouts > 0 || m.purchases > 0) activeDays.add(date);
  }
  totals.active_days = activeDays.size;
  return finish(totals, dates.length);
}

function dailyTotals(rows, dates) {
  const byDate = new Map(dates.map(date => [date, empty()]));
  for (const row of rows) {
    const date = row.date_start || row.date_stop;
    if (!byDate.has(date)) continue;
    add(byDate.get(date), metrics(row));
  }
  return dates.map(date => finish({ date, ...byDate.get(date), active_days: byDate.get(date).spend > 0 ? 1 : 0 }, 1));
}

function groupBy(rows, dates, keyFn, labelFn) {
  const dateSet = new Set(dates);
  const map = new Map();
  for (const row of rows) {
    const date = row.date_start || row.date_stop;
    if (!dateSet.has(date)) continue;
    const key = keyFn(row);
    if (!key) continue;
    if (!map.has(key)) map.set(key, { key, name: labelFn(row), ...empty(), dates: new Set() });
    const item = map.get(key);
    const m = metrics(row);
    add(item, m);
    if (m.spend > 0 || m.checkouts > 0 || m.purchases > 0) item.dates.add(date);
  }
  return [...map.values()].map(item => {
    const { dates: activeSet, ...rest } = item;
    return finish({ ...rest, active_days: activeSet.size }, dates.length);
  });
}

function trailing(daily, endDate, days) {
  const wanted = new Set(dateRange(addDays(endDate, 1 - days), endDate));
  const total = empty();
  for (const day of daily) {
    if (!wanted.has(day.date)) continue;
    add(total, day);
  }
  total.active_days = [...wanted].filter(date => daily.find(day => day.date === date && day.spend > 0)).length;
  return finish(total, days);
}

function findOrigin(daily, baseline) {
  const candidates = [];
  for (const day of daily) {
    const roll = trailing(daily, day.date, 7);
    const checkoutLift = baseline.checkouts_per_day > 0 ? roll.checkouts_per_day / baseline.checkouts_per_day : 0;
    const purchaseLift = baseline.purchases_per_day > 0 ? roll.purchases_per_day / baseline.purchases_per_day : 0;
    if (
      roll.checkouts >= 8
      && roll.purchases >= 2
      && (checkoutLift >= 1.35 || purchaseLift >= 1.35)
    ) {
      candidates.push({ date: day.date, trailing_7d: roll, checkout_lift: checkoutLift, purchase_lift: purchaseLift });
    }
  }
  return candidates[0] || null;
}

function topDeltas(groupsA, groupsB, metric, limit = 8) {
  const byKey = new Map(groupsA.map(item => [item.key, item]));
  return groupsB
    .map(item => {
      const prev = byKey.get(item.key) || empty();
      return {
        key: item.key,
        name: item.name,
        previous: prev[metric] || 0,
        current: item[metric] || 0,
        delta: (item[metric] || 0) - (prev[metric] || 0),
        current_spend: item.spend,
        current_revenue: item.revenue,
        current_purchases: item.purchases,
        current_checkouts: item.checkouts,
        current_roas: item.roas,
      };
    })
    .sort((a, b) => b.delta - a.delta)
    .slice(0, limit);
}

function adRows(rows, campaignNameById) {
  return rows
    .filter(row => segmentFor(campaignNameById.get(row.campaign_id) || row.campaign_name || '') === 'us')
    .map(row => {
      const m = metrics(row);
      return {
        id: row.id,
        name: row.name,
        campaign_id: row.campaign_id,
        campaign_name: campaignNameById.get(row.campaign_id) || row.campaign_name || '',
        status: row.status,
        ...finish({ ...empty(), ...m, rows: 1, active_days: 1 }, 1),
      };
    })
    .sort((a, b) => (b.purchases - a.purchases) || (b.checkouts - a.checkouts) || (b.spend - a.spend));
}

module.exports = async (req, res) => {
  const secret = process.env.GLV_META_SUMMARY_SECRET;
  if (!secret) return res.status(202).json({ ok: false, error: 'GLV_META_SUMMARY_SECRET is not configured' });
  if (req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const [dailyPayload, adsPayload] = await Promise.all([redisGet(DAILY_KEY), redisGet(ADS_KEY)]);
    const rawDailyRows = dailyPayload?.rows || [];
    const allDates = [...new Set(rawDailyRows.map(row => row.date_start || row.date_stop).filter(Boolean))].sort();
    const end = allDates.at(-1);
    const start60 = addDays(end, -59);
    const dates60 = allDates.filter(date => date >= start60 && date <= end);
    const usRows = rawDailyRows.filter(row => segmentFor(row.name || row.campaign_name || '') === 'us');
    const excludedUsRows = rawDailyRows.filter(row => segmentFor(row.name || row.campaign_name || '') === 'excluded_us_advertorial');
    const campaignNameById = new Map(rawDailyRows.map(row => [row.id || row.campaign_id, row.name || row.campaign_name || '']));
    const daily = dailyTotals(usRows, dates60);

    const preAllDates = dates60.filter(date => date < GLITCH_START);
    const pre14Dates = dateRange(addDays(GLITCH_START, -14), addDays(GLITCH_START, -1));
    const glitchDates = dateRange(GLITCH_START, GLITCH_END);
    const postDates = dates60.filter(date => date > GLITCH_END);
    const recent7Dates = dates60.slice(-7);

    const periods = {
      full_60d: summarizeRows(usRows, dates60),
      pre_glitch_all: summarizeRows(usRows, preAllDates),
      pre_glitch_14d: summarizeRows(usRows, pre14Dates),
      glitch: summarizeRows(usRows, glitchDates),
      post_glitch: summarizeRows(usRows, postDates),
      recent_7d: summarizeRows(usRows, recent7Dates),
      excluded_us_advertorial_60d: summarizeRows(excludedUsRows, dates60),
    };

    const campaignPre14 = groupBy(usRows, pre14Dates, row => row.id || row.campaign_id, row => row.name || row.campaign_name);
    const campaignGlitch = groupBy(usRows, glitchDates, row => row.id || row.campaign_id, row => row.name || row.campaign_name);
    const campaignPost = groupBy(usRows, postDates, row => row.id || row.campaign_id, row => row.name || row.campaign_name);
    const campaignRecent7 = groupBy(usRows, recent7Dates, row => row.id || row.campaign_id, row => row.name || row.campaign_name);

    const origin = findOrigin(daily, periods.pre_glitch_14d);
    const topAds = adRows(adsPayload?.rows || [], campaignNameById);

    res.json({
      ok: true,
      source: {
        daily_key: DAILY_KEY,
        ads_key: ADS_KEY,
        raw_daily_rows: rawDailyRows.length,
        raw_ads_rows: adsPayload?.rows?.length || 0,
        full_cache_range: { since: allDates[0], until: end },
        analyzed_range: { since: dates60[0], until: dates60.at(-1), days: dates60.length },
        offer_glitch: { since: GLITCH_START, until: GLITCH_END },
        market_rule: 'US = campaign name contains _US_; advertorial campaigns excluded from decision-scope US and reported separately.',
      },
      periods,
      origin,
      daily,
      campaign_deltas: {
        glitch_vs_pre14_checkouts: topDeltas(campaignPre14, campaignGlitch, 'checkouts'),
        glitch_vs_pre14_purchases: topDeltas(campaignPre14, campaignGlitch, 'purchases'),
        post_vs_glitch_checkouts: topDeltas(campaignGlitch, campaignPost, 'checkouts'),
        recent7_vs_pre14_checkouts: topDeltas(campaignPre14, campaignRecent7, 'checkouts'),
      },
      top_us_ads_90d: topAds.slice(0, 12),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};
