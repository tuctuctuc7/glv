// GLV Media Buyer OS decision report
// Turns normalized Meta Ads rows into a daily account read for dashboard/Slack/Jarvis.

const DEFAULT_BASE_URL = 'https://lab.agenthic.com';
const DEFAULT_PRESET = 'last_30d';
const MARKETS = ['czsk', 'us'];

function num(value) {
  const parsed = Number.parseFloat(String(value ?? '0').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((num(value) + Number.EPSILON) * factor) / factor;
}

function czk(value) {
  return `CZK ${Math.round(num(value)).toLocaleString('en-US')}`;
}

function pct(value) {
  if (!Number.isFinite(value)) return null;
  return `${value >= 0 ? '+' : ''}${Math.round(value * 100)}%`;
}

function parseDate(date) {
  return new Date(`${date}T00:00:00Z`);
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const next = parseDate(date);
  next.setUTCDate(next.getUTCDate() + days);
  return dateKey(next);
}

function dateRange(endDate, days) {
  const dates = [];
  for (let i = days - 1; i >= 0; i -= 1) dates.push(addDays(endDate, -i));
  return new Set(dates);
}

function safeRoas(revenue, spend) {
  return spend > 0 ? revenue / spend : 0;
}

function safeCpa(spend, purchases) {
  return purchases > 0 ? spend / purchases : 0;
}

function safeRate(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function change(current, previous) {
  if (!previous) return null;
  return (current - previous) / previous;
}

function entityKey(row) {
  return row.id || row.ad_id || row.adset_id || row.campaign_id || row.name;
}

function entityName(row) {
  return row.name || row.ad_name || row.adset_name || row.campaign_name || 'Unnamed entity';
}

function entityParent(row) {
  const parts = [];
  if (row.campaign_name && row.level !== 'campaign') parts.push(row.campaign_name);
  if (row.adset_name && row.level === 'ad') parts.push(row.adset_name);
  return parts.join(' / ');
}

function emptyTotals() {
  return {
    spend: 0,
    revenue: 0,
    purchases: 0,
    checkouts: 0,
    landing_page_views: 0,
    impressions: 0,
    rows: 0,
  };
}

function addRow(totals, row) {
  totals.spend += num(row.spend ?? row.amount_spent);
  totals.revenue += num(row.revenue ?? row.purchase_value);
  totals.purchases += num(row.purchases);
  totals.checkouts += num(row.checkouts);
  totals.landing_page_views += num(row.landing_page_views);
  totals.impressions += num(row.impressions);
  totals.rows += 1;
}

function finalizeTotals(totals) {
  const out = { ...totals };
  out.roas = safeRoas(out.revenue, out.spend);
  out.cpa = safeCpa(out.spend, out.purchases);
  out.cost_per_checkout = safeCpa(out.spend, out.checkouts);
  out.cost_per_lpv = safeCpa(out.spend, out.landing_page_views);
  out.lpv_to_checkout_rate = safeRate(out.checkouts, out.landing_page_views);
  out.lpv_to_purchase_rate = safeRate(out.purchases, out.landing_page_views);
  return out;
}

function compactTotals(totals) {
  return {
    spend: round(totals.spend, 2),
    revenue: round(totals.revenue, 2),
    roas: round(totals.roas, 2),
    purchases: round(totals.purchases, 0),
    checkouts: round(totals.checkouts, 0),
    landing_page_views: round(totals.landing_page_views, 0),
    cpa: round(totals.cpa, 2),
    cost_per_checkout: round(totals.cost_per_checkout, 2),
    cost_per_lpv: round(totals.cost_per_lpv, 2),
    lpv_to_checkout_rate: round(totals.lpv_to_checkout_rate, 4),
    lpv_to_purchase_rate: round(totals.lpv_to_purchase_rate, 4),
    rows: totals.rows,
  };
}

function filterRows(rows, { market, dates, level } = {}) {
  return (rows || []).filter(row => {
    if (market && row.market !== market) return false;
    if (level && row.level !== level) return false;
    if (dates && !dates.has(String(row.date_start || row.date_stop || '').slice(0, 10))) return false;
    return true;
  });
}

function sumRows(rows) {
  const totals = emptyTotals();
  for (const row of rows || []) addRow(totals, row);
  return finalizeTotals(totals);
}

function groupRows(rows) {
  const groups = new Map();
  for (const row of rows || []) {
    const id = entityKey(row);
    if (!id) continue;
    if (!groups.has(id)) {
      groups.set(id, {
        id,
        level: row.level,
        name: entityName(row),
        parent: entityParent(row),
        market: row.market || 'unknown',
        status: row.status || 'UNKNOWN',
        totals: emptyTotals(),
        ctr_weighted: 0,
        cpm_weighted: 0,
        frequency_weighted: 0,
      });
    }
    const group = groups.get(id);
    const impressions = num(row.impressions);
    const spend = num(row.spend ?? row.amount_spent);
    addRow(group.totals, row);
    group.ctr_weighted += num(row.ctr) * impressions;
    group.cpm_weighted += num(row.cpm) * spend;
    group.frequency_weighted += num(row.frequency) * impressions;
  }

  return [...groups.values()].map(group => {
    const totals = finalizeTotals(group.totals);
    return {
      ...group,
      totals,
      ctr: totals.impressions > 0 ? group.ctr_weighted / totals.impressions : 0,
      cpm: totals.spend > 0 ? group.cpm_weighted / totals.spend : 0,
      frequency: totals.impressions > 0 ? group.frequency_weighted / totals.impressions : 0,
    };
  });
}

function compactEntity(group, extra = {}) {
  return {
    id: group.id,
    level: group.level,
    name: group.name,
    parent: group.parent || undefined,
    market: group.market,
    status: group.status,
    spend: round(group.totals.spend, 2),
    revenue: round(group.totals.revenue, 2),
    roas: round(group.totals.roas, 2),
    purchases: round(group.totals.purchases, 0),
    checkouts: round(group.totals.checkouts, 0),
    landing_page_views: round(group.totals.landing_page_views, 0),
    cpa: round(group.totals.cpa, 2),
    cost_per_checkout: round(group.totals.cost_per_checkout, 2),
    cost_per_lpv: round(group.totals.cost_per_lpv, 2),
    ctr: round(group.ctr, 3),
    cpm: round(group.cpm, 2),
    frequency: round(group.frequency, 2),
    ...extra,
  };
}

function marketWindows(dailyRows, targetDate, market) {
  const yesterdayRows = filterRows(dailyRows, { market, dates: new Set([targetDate]) });
  const prior2Rows = filterRows(dailyRows, { market, dates: new Set([addDays(targetDate, -2), addDays(targetDate, -1)]) });
  const last7Rows = filterRows(dailyRows, { market, dates: dateRange(targetDate, 7) });
  const last30Rows = filterRows(dailyRows, { market, dates: dateRange(targetDate, 30) });
  const yesterday = sumRows(yesterdayRows);
  const prior2 = sumRows(prior2Rows);
  const last7 = sumRows(last7Rows);
  const last30 = sumRows(last30Rows);
  return {
    yesterday,
    prior_2_day_avg: finalizeTotals({
      spend: prior2.spend / 2,
      revenue: prior2.revenue / 2,
      purchases: prior2.purchases / 2,
      checkouts: prior2.checkouts / 2,
      landing_page_views: prior2.landing_page_views / 2,
      impressions: prior2.impressions / 2,
      rows: prior2.rows,
    }),
    last_7d: last7,
    last_30d: last30,
  };
}

function classifyCzsk(windows) {
  const y = windows.yesterday;
  const prior = windows.prior_2_day_avg;
  const roasDelta = change(y.roas, prior.roas);
  const spendDelta = change(y.spend, prior.spend);
  let status = 'hold';
  const reasons = [];

  if (y.spend === 0) {
    status = 'no_spend';
    reasons.push('No CZSK spend yesterday.');
  } else if (y.roas < 1) {
    status = 'protect';
    reasons.push('CZSK is below the 1.0x ROAS floor.');
  } else if (y.roas < 1.2 || (y.roas < 1.2 && roasDelta < 0)) {
    status = 'alarm';
    reasons.push('CZSK is in the sub-1.2x alarm zone.');
  } else if (y.roas < 1.7) {
    status = 'hold_monitor';
    reasons.push('CZSK is between 1.0x and 1.7x ROAS, so hold and monitor.');
  } else {
    status = 'scale_carefully';
    reasons.push('CZSK is above the 1.7x scale threshold.');
  }

  if (y.roas >= 1.7 && spendDelta !== null && spendDelta < 0.05) {
    reasons.push('High ROAS with flat spend is a missed scaling opportunity.');
  }
  if (spendDelta !== null && spendDelta > 0.2 && roasDelta !== null && roasDelta > -0.1) {
    reasons.push('Spend increased while ROAS stayed broadly stable.');
  }
  if (spendDelta !== null && spendDelta > 0.2 && roasDelta !== null && roasDelta < -0.2) {
    reasons.push('Spend increased while ROAS softened materially.');
  }

  return {
    status,
    roas_delta_vs_prior_2_day_avg: roasDelta === null ? null : round(roasDelta, 4),
    spend_delta_vs_prior_2_day_avg: spendDelta === null ? null : round(spendDelta, 4),
    reasons,
  };
}

function classifyUs(windows) {
  const y = windows.yesterday;
  const last7 = windows.last_7d;
  const reasons = ['US is PMF discovery until breakeven becomes repeatable.'];
  let status = 'pmf_discovery';

  if (last7.spend === 0) {
    status = 'no_spend';
    reasons.push('No US spend in the last 7 days.');
  } else if (last7.roas >= 1 && (last7.purchases >= 2 || last7.checkouts >= 5)) {
    status = 'performance_review';
    reasons.push('US has a breakeven signal; review whether the signal is repeatable enough to treat as performance.');
  } else if (y.purchases > 0 || y.checkouts > 0) {
    status = 'pmf_signal';
    reasons.push('US produced purchase or checkout signal, but not enough to leave PMF mode.');
  } else {
    reasons.push('Judge US primarily by checkout/purchase signal and kill weak tests faster.');
  }

  return { status, reasons };
}

function topEntities(rows, { market, level, minSpend, kind, limit = 5 }) {
  const groups = groupRows(filterRows(rows, { market, level }))
    .filter(group => group.totals.spend >= minSpend);
  if (kind === 'winner') {
    return groups
      .filter(group => group.totals.revenue > 0 && group.totals.roas >= 1)
      .sort((a, b) => (b.totals.roas - a.totals.roas) || (b.totals.spend - a.totals.spend))
      .slice(0, limit)
      .map(group => compactEntity(group));
  }
  if (kind === 'loser') {
    return groups
      .filter(group => group.totals.roas < 1)
      .sort((a, b) => (b.totals.spend - a.totals.spend) || (a.totals.roas - b.totals.roas))
      .slice(0, limit)
      .map(group => compactEntity(group));
  }
  if (kind === 'zero_revenue') {
    return groups
      .filter(group => group.totals.revenue === 0)
      .sort((a, b) => b.totals.spend - a.totals.spend)
      .slice(0, limit)
      .map(group => compactEntity(group));
  }
  return [];
}

function signalBenchmarks(rows, market) {
  const totals = sumRows(filterRows(rows, { market }));
  return {
    cost_per_checkout: totals.cost_per_checkout,
    cost_per_lpv: totals.cost_per_lpv,
    lpv_to_checkout_rate: totals.lpv_to_checkout_rate,
  };
}

function strongSignalExceptions(rows, market, benchmarks) {
  return groupRows(filterRows(rows, { market, level: 'ad' }))
    .filter(group => (
      group.totals.spend >= 300
      && group.totals.roas < 1
      && group.totals.landing_page_views >= 20
      && (
        (benchmarks.cost_per_checkout > 0 && group.totals.cost_per_checkout > 0 && group.totals.cost_per_checkout < benchmarks.cost_per_checkout)
        || (benchmarks.cost_per_lpv > 0 && group.totals.cost_per_lpv > 0 && group.totals.cost_per_lpv < benchmarks.cost_per_lpv)
        || (benchmarks.lpv_to_checkout_rate > 0 && group.totals.lpv_to_checkout_rate > benchmarks.lpv_to_checkout_rate)
      )
    ))
    .sort((a, b) => b.totals.spend - a.totals.spend)
    .slice(0, 8)
    .map(group => compactEntity(group, { reason: 'Low ROAS, but checkout/LPV signal beats account average.' }));
}

function trendOutliers(rows, targetDate, { market, level, minSpend = 300, limit = 8 }) {
  const targetGroups = groupRows(filterRows(rows, { market, level, dates: new Set([targetDate]) }));
  const priorGroups = new Map(
    groupRows(filterRows(rows, { market, level, dates: new Set([addDays(targetDate, -2), addDays(targetDate, -1)]) }))
      .map(group => [group.id, group])
  );

  const outliers = [];
  for (const current of targetGroups) {
    const prior = priorGroups.get(current.id);
    if (!prior || current.totals.spend < minSpend) continue;
    const priorAvg = {
      spend: prior.totals.spend / 2,
      revenue: prior.totals.revenue / 2,
      purchases: prior.totals.purchases / 2,
      checkouts: prior.totals.checkouts / 2,
      landing_page_views: prior.totals.landing_page_views / 2,
      impressions: prior.totals.impressions / 2,
      rows: prior.totals.rows,
    };
    const finalizedPriorAvg = finalizeTotals(priorAvg);
    const spendDelta = change(current.totals.spend, finalizedPriorAvg.spend);
    const roasDelta = change(current.totals.roas, finalizedPriorAvg.roas);
    const checkoutDelta = change(current.totals.checkouts, finalizedPriorAvg.checkouts);
    const cpaDelta = change(current.totals.cpa, finalizedPriorAvg.cpa);
    if (spendDelta === null && roasDelta === null) continue;

    let classification = 'needs_judgement';
    const reasons = [];
    if (spendDelta !== null && spendDelta > 0.2 && (roasDelta === null || roasDelta > -0.1)) {
      classification = 'helped';
      reasons.push('Spend rose while ROAS held broadly stable.');
    }
    if (spendDelta !== null && spendDelta > 0.2 && roasDelta !== null && roasDelta < -0.2) {
      classification = 'hurt';
      reasons.push('Spend rose while ROAS fell materially.');
    }
    if (current.totals.revenue === 0 && current.totals.spend >= minSpend) {
      classification = 'hurt';
      reasons.push('Meaningful spend with zero attributed revenue.');
    }
    if (checkoutDelta !== null && checkoutDelta > 0.3 && current.totals.roas < 1) {
      classification = classification === 'hurt' ? 'needs_judgement' : classification;
      reasons.push('Checkout signal improved despite weak ROAS.');
    }
    if (cpaDelta !== null && cpaDelta > 0.3 && current.totals.purchases > 0) {
      reasons.push('CPA rose more than 30% vs prior 2-day average.');
    }

    outliers.push(compactEntity(current, {
      classification,
      spend_delta_vs_prior_2_day_avg: spendDelta === null ? null : round(spendDelta, 4),
      roas_delta_vs_prior_2_day_avg: roasDelta === null ? null : round(roasDelta, 4),
      checkout_delta_vs_prior_2_day_avg: checkoutDelta === null ? null : round(checkoutDelta, 4),
      reasons,
    }));
  }

  return outliers
    .sort((a, b) => {
      const severity = { hurt: 3, needs_judgement: 2, helped: 1 };
      return (severity[b.classification] - severity[a.classification]) || (b.spend - a.spend);
    })
    .slice(0, limit);
}

function fatigueRadar(rows, targetDate, { market, level = 'adset', minSpend = 1000, limit = 8 }) {
  const last3 = dateRange(targetDate, 3);
  const prior7 = new Set();
  for (let i = 9; i >= 3; i -= 1) prior7.add(addDays(targetDate, -i));

  const currentGroups = groupRows(filterRows(rows, { market, level, dates: last3 }));
  const priorGroups = new Map(groupRows(filterRows(rows, { market, level, dates: prior7 })).map(group => [group.id, group]));
  const alerts = [];

  for (const current of currentGroups) {
    const prior = priorGroups.get(current.id);
    if (!prior || current.totals.spend < minSpend || prior.totals.spend < minSpend) continue;
    const roasDelta = change(current.totals.roas, prior.totals.roas);
    const ctrDelta = change(current.ctr, prior.ctr);
    const cpmDelta = change(current.cpm, prior.cpm);
    const frequencyDelta = change(current.frequency, prior.frequency);
    const reasons = [];
    if (roasDelta !== null && roasDelta < -0.2) reasons.push('ROAS down more than 20% vs prior 7-day comparison window.');
    if (ctrDelta !== null && ctrDelta < -0.15) reasons.push('CTR down more than 15%.');
    if (cpmDelta !== null && cpmDelta > 0.15) reasons.push('CPM up more than 15%.');
    if (frequencyDelta !== null && frequencyDelta > 0.15) reasons.push('Frequency rising.');
    if (current.frequency >= 2.5) reasons.push('Frequency is elevated for a workhorse.');
    if (reasons.length >= 2) {
      alerts.push(compactEntity(current, {
        roas_delta_vs_prior_window: roasDelta === null ? null : round(roasDelta, 4),
        ctr_delta_vs_prior_window: ctrDelta === null ? null : round(ctrDelta, 4),
        cpm_delta_vs_prior_window: cpmDelta === null ? null : round(cpmDelta, 4),
        frequency_delta_vs_prior_window: frequencyDelta === null ? null : round(frequencyDelta, 4),
        reasons,
      }));
    }
  }

  return alerts.sort((a, b) => b.spend - a.spend).slice(0, limit);
}

function spendConcentration(rows, targetDate, market) {
  const last7Rows = filterRows(rows, { market, level: 'campaign', dates: dateRange(targetDate, 7) });
  const totals = sumRows(last7Rows);
  const groups = groupRows(last7Rows).sort((a, b) => b.totals.spend - a.totals.spend);
  const top = groups.slice(0, 3).map(group => compactEntity(group, {
    spend_share: totals.spend > 0 ? round(group.totals.spend / totals.spend, 4) : 0,
  }));
  return {
    top_3_spend_share: totals.spend > 0 ? round(groups.slice(0, 3).reduce((sum, group) => sum + group.totals.spend, 0) / totals.spend, 4) : 0,
    top,
  };
}

function actionQueue({ marketReads, winners, losers, zeroRevenue, exceptions, outliers, fatigue }) {
  const actions = [];
  const czsk = marketReads.czsk;
  const us = marketReads.us;

  if (czsk.status === 'scale_carefully' && winners.czsk.adsets.length) {
    actions.push({
      priority: 'high',
      market: 'czsk',
      type: 'budget_increase_review',
      entity_level: 'adset',
      entity: winners.czsk.adsets[0],
      recommendation: 'Review for standard +20% daily budget increase. Use up to +50% only if intentionally bullish.',
      reason: 'CZSK is above the 1.7x scale threshold and this ad set is a current winner.',
    });
  }
  if (czsk.status === 'protect' || czsk.status === 'alarm') {
    actions.push({
      priority: 'high',
      market: 'czsk',
      type: 'budget_protection',
      recommendation: 'Start with -25% cuts on weak entities; go up to -50% if ROAS protection is urgent. Kill/pause overrides percentage rules.',
      reason: czsk.reasons.join(' '),
    });
  }
  for (const item of zeroRevenue.czsk.ads.slice(0, 3)) {
    actions.push({
      priority: item.spend >= 1000 ? 'high' : 'medium',
      market: 'czsk',
      type: 'zero_revenue_review',
      entity_level: item.level,
      entity: item,
      recommendation: 'Review for pause/kill unless there is a deliberate learning reason to keep it running.',
      reason: `${czk(item.spend)} spend in the last 30 days with zero attributed revenue.`,
    });
  }
  for (const item of exceptions.czsk.slice(0, 3)) {
    actions.push({
      priority: 'medium',
      market: 'czsk',
      type: 'judgement_review',
      entity_level: item.level,
      entity: item,
      recommendation: 'Do not blindly kill; inspect offer/landing-page/creative fit and latest 2-day signal.',
      reason: item.reason,
    });
  }
  for (const item of outliers.filter(item => item.classification === 'hurt').slice(0, 3)) {
    actions.push({
      priority: 'high',
      market: item.market,
      type: 'negative_outlier_review',
      entity_level: item.level,
      entity: item,
      recommendation: 'Inspect before next budget move.',
      reason: item.reasons.join(' '),
    });
  }
  for (const item of fatigue.slice(0, 3)) {
    actions.push({
      priority: 'medium',
      market: item.market,
      type: 'fatigue_watch',
      entity_level: item.level,
      entity: item,
      recommendation: 'Prepare replacement creative or reduce dependency if trend continues.',
      reason: item.reasons.join(' '),
    });
  }
  if (us.status === 'pmf_signal' || us.status === 'performance_review') {
    actions.push({
      priority: us.status === 'performance_review' ? 'high' : 'medium',
      market: 'us',
      type: 'us_pmf_review',
      recommendation: us.status === 'performance_review'
        ? 'Review whether US can start behaving like a performance market.'
        : 'Keep US in PMF discovery; push tests with checkout/purchase signal and kill faster when signal disappears.',
      reason: us.reasons.join(' '),
    });
  }

  const priorityRank = { high: 3, medium: 2, low: 1 };
  return actions
    .sort((a, b) => (priorityRank[b.priority] - priorityRank[a.priority]))
    .slice(0, 12);
}

function capacityVerdict({ marketReads, actionQueueItems, marketWindowsByMarket }) {
  const czsk = marketReads.czsk;
  const highPriorityCount = actionQueueItems.filter(action => action.priority === 'high').length;
  if (czsk.status === 'protect' || (czsk.status === 'alarm' && highPriorityCount >= 2)) {
    return {
      verdict: 'revamp',
      reason: 'CZSK needs active ROAS protection and high-priority cleanup.',
    };
  }
  if (highPriorityCount > 0 || czsk.status === 'scale_carefully' || marketReads.us.status === 'pmf_signal' || marketReads.us.status === 'performance_review') {
    return {
      verdict: 'small_tweaks',
      reason: 'Account has clear optimization work, but does not require a full rebuild.',
    };
  }
  const czskLast7 = marketWindowsByMarket.czsk.last_7d;
  if (czskLast7.spend > 0 && czskLast7.roas >= 1.7) {
    return {
      verdict: 'status_quo',
      reason: 'CZSK is healthy and no urgent action cluster was detected.',
    };
  }
  return {
    verdict: 'small_tweaks',
    reason: 'Hold structure and keep monitoring until stronger scale/protect signal appears.',
  };
}

function marketReadPayload(market, windows, classification) {
  return {
    market,
    status: classification.status,
    reasons: classification.reasons,
    yesterday: compactTotals(windows.yesterday),
    prior_2_day_avg: compactTotals(windows.prior_2_day_avg),
    last_7d: compactTotals(windows.last_7d),
    last_30d: compactTotals(windows.last_30d),
    roas_delta_vs_prior_2_day_avg: classification.roas_delta_vs_prior_2_day_avg ?? null,
    spend_delta_vs_prior_2_day_avg: classification.spend_delta_vs_prior_2_day_avg ?? null,
  };
}

function memo({ targetDate, capacity, marketReads, actionQueueItems }) {
  const czsk = marketReads.czsk.yesterday;
  const us = marketReads.us.last_7d;
  const firstAction = actionQueueItems[0]?.recommendation || 'No urgent action; monitor for another day.';
  return [
    `GLV Meta Decision Report (${targetDate})`,
    `Capacity: ${capacity.verdict} - ${capacity.reason}`,
    `CZSK yesterday: ${czk(czsk.spend)} spend, ${czk(czsk.revenue)} revenue, ${czsk.roas}x ROAS.`,
    `US last 7d: ${czk(us.spend)} spend, ${czk(us.revenue)} revenue, ${us.roas}x ROAS. Still PMF until repeatable 1.0x ROAS.`,
    `Top action: ${firstAction}`,
  ].join('\n');
}

async function fetchDecisionInput(req, secret) {
  const preset = String(req.query.date_preset || req.query.preset || DEFAULT_PRESET);
  const params = new URLSearchParams({ date_preset: preset });
  if (req.query.refresh) params.set('refresh', String(req.query.refresh));
  if (req.query.time_range) params.set('time_range', String(req.query.time_range));

  const baseUrl = (
    process.env.GLV_META_BASE_URL
    || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : DEFAULT_BASE_URL)
  );
  const url = `${baseUrl.replace(/\/$/, '')}/api/glv-meta-ads/decision-input?${params.toString()}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${secret}` } });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `decision-input failed with HTTP ${response.status}`);
  }
  return payload;
}

function targetDateFor(input, requestedDate) {
  const allDates = new Set();
  for (const row of input.datasets?.campaign_daily || []) {
    const rowDate = String(row.date_start || row.date_stop || '').slice(0, 10);
    if (rowDate) allDates.add(rowDate);
  }
  const sorted = [...allDates].sort();
  if (requestedDate) {
    if (!allDates.has(requestedDate)) {
      throw new Error(`target_date ${requestedDate} is not present in decision-input range`);
    }
    return requestedDate;
  }
  return input.range?.until || sorted.at(-1);
}

function buildReport(input, req) {
  const targetDate = targetDateFor(input, req.query.target_date ? String(req.query.target_date) : null);
  const campaignDaily = input.datasets?.campaign_daily || [];
  const adsetDaily = input.datasets?.adset_daily || [];
  const adDaily = input.datasets?.ad_daily || [];
  const allDaily = [...campaignDaily, ...adsetDaily, ...adDaily];

  const marketWindowsByMarket = Object.fromEntries(MARKETS.map(market => [market, marketWindows(campaignDaily, targetDate, market)]));
  const czskClassification = classifyCzsk(marketWindowsByMarket.czsk);
  const usClassification = classifyUs(marketWindowsByMarket.us);
  const marketReads = {
    czsk: marketReadPayload('czsk', marketWindowsByMarket.czsk, czskClassification),
    us: marketReadPayload('us', marketWindowsByMarket.us, usClassification),
  };

  const winners = {
    czsk: {
      campaigns: topEntities(campaignDaily, { market: 'czsk', level: 'campaign', minSpend: 3000, kind: 'winner' }),
      adsets: topEntities(adsetDaily, { market: 'czsk', level: 'adset', minSpend: 1000, kind: 'winner' }),
      ads: topEntities(adDaily, { market: 'czsk', level: 'ad', minSpend: 500, kind: 'winner' }),
    },
    us: {
      campaigns: topEntities(campaignDaily, { market: 'us', level: 'campaign', minSpend: 500, kind: 'winner' }),
      adsets: topEntities(adsetDaily, { market: 'us', level: 'adset', minSpend: 300, kind: 'winner' }),
      ads: topEntities(adDaily, { market: 'us', level: 'ad', minSpend: 200, kind: 'winner' }),
    },
  };
  const losers = {
    czsk: {
      campaigns: topEntities(campaignDaily, { market: 'czsk', level: 'campaign', minSpend: 3000, kind: 'loser' }),
      adsets: topEntities(adsetDaily, { market: 'czsk', level: 'adset', minSpend: 1000, kind: 'loser' }),
      ads: topEntities(adDaily, { market: 'czsk', level: 'ad', minSpend: 500, kind: 'loser' }),
    },
    us: {
      campaigns: topEntities(campaignDaily, { market: 'us', level: 'campaign', minSpend: 500, kind: 'loser' }),
      adsets: topEntities(adsetDaily, { market: 'us', level: 'adset', minSpend: 300, kind: 'loser' }),
      ads: topEntities(adDaily, { market: 'us', level: 'ad', minSpend: 200, kind: 'loser' }),
    },
  };
  const zeroRevenue = {
    czsk: {
      campaigns: topEntities(campaignDaily, { market: 'czsk', level: 'campaign', minSpend: 3000, kind: 'zero_revenue' }),
      adsets: topEntities(adsetDaily, { market: 'czsk', level: 'adset', minSpend: 1000, kind: 'zero_revenue' }),
      ads: topEntities(adDaily, { market: 'czsk', level: 'ad', minSpend: 500, kind: 'zero_revenue' }),
    },
    us: {
      campaigns: topEntities(campaignDaily, { market: 'us', level: 'campaign', minSpend: 500, kind: 'zero_revenue' }),
      adsets: topEntities(adsetDaily, { market: 'us', level: 'adset', minSpend: 300, kind: 'zero_revenue' }),
      ads: topEntities(adDaily, { market: 'us', level: 'ad', minSpend: 200, kind: 'zero_revenue' }),
    },
  };
  const exceptions = {
    czsk: strongSignalExceptions(adDaily, 'czsk', signalBenchmarks(adDaily, 'czsk')),
    us: strongSignalExceptions(adDaily, 'us', signalBenchmarks(adDaily, 'us')),
  };
  const outliers = [
    ...trendOutliers(campaignDaily, targetDate, { market: 'czsk', level: 'campaign', minSpend: 1500 }),
    ...trendOutliers(adsetDaily, targetDate, { market: 'czsk', level: 'adset', minSpend: 500 }),
    ...trendOutliers(adDaily, targetDate, { market: 'czsk', level: 'ad', minSpend: 250 }),
    ...trendOutliers(campaignDaily, targetDate, { market: 'us', level: 'campaign', minSpend: 250 }),
    ...trendOutliers(adsetDaily, targetDate, { market: 'us', level: 'adset', minSpend: 150 }),
    ...trendOutliers(adDaily, targetDate, { market: 'us', level: 'ad', minSpend: 100 }),
  ].slice(0, 20);
  const fatigue = [
    ...fatigueRadar(adsetDaily, targetDate, { market: 'czsk', level: 'adset', minSpend: 1000 }),
    ...fatigueRadar(adDaily, targetDate, { market: 'czsk', level: 'ad', minSpend: 500 }),
    ...fatigueRadar(adsetDaily, targetDate, { market: 'us', level: 'adset', minSpend: 300 }),
    ...fatigueRadar(adDaily, targetDate, { market: 'us', level: 'ad', minSpend: 200 }),
  ].slice(0, 20);
  const concentration = {
    czsk: spendConcentration(campaignDaily, targetDate, 'czsk'),
    us: spendConcentration(campaignDaily, targetDate, 'us'),
  };
  const actions = actionQueue({ marketReads, winners, losers, zeroRevenue, exceptions, outliers, fatigue });
  const capacity = capacityVerdict({ marketReads, actionQueueItems: actions, marketWindowsByMarket });

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    source: {
      endpoint: '/api/glv-meta-ads/decision-input',
      preset: input.preset,
      range: input.range,
      currency: 'CZK',
      note: 'All paid-media decision metrics use Meta API data in the ad account currency, CZK.',
      row_counts: input.row_counts,
    },
    report_date: targetDate,
    capacity,
    market_reads: marketReads,
    winners,
    losers,
    zero_revenue_spend_pockets: zeroRevenue,
    strong_signal_exceptions: exceptions,
    outlier_radar: outliers,
    fatigue_radar: fatigue,
    spend_concentration: concentration,
    action_queue: actions,
    morning_memo: memo({ targetDate, capacity, marketReads, actionQueueItems: actions }),
    build_scope: {
      version: 'v1',
      included: [
        'last 30 day Meta input',
        'yesterday vs prior 2-day tendency',
        'CZSK/US market reads',
        'top winners/losers',
        'zero-revenue spend pockets',
        'strong-signal exceptions',
        'basic outlier radar',
        'basic fatigue radar',
        'action queue',
        'morning memo',
      ],
      excluded_until_v2: [
        'Hyros attribution',
        'web admin business truth',
        'new customer ratio automation',
        'promo calendar automation',
        '60-90 day background history cache',
        'automatic budget mutations',
      ],
    },
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

  try {
    const input = await fetchDecisionInput(req, secret);
    res.json(buildReport(input, req));
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};
