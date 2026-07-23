const DAY_MS = 86_400_000;

export function safeRatio(numerator, denominator) {
  const n = Number(numerator || 0);
  const d = Number(denominator || 0);
  return d ? n / d : null;
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]);
}

export function normalizeFilters(input, range, allowedAccounts = []) {
  const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && value >= range.start && value <= range.end;
  let from = validDate(input.from) ? input.from : range.start;
  let to = validDate(input.to) ? input.to : range.end;
  if (from > to) [from, to] = [to, from];
  const account = allowedAccounts.includes(input.account) ? input.account : 'all';
  const grain = ['day', 'week', 'month'].includes(input.grain) ? input.grain : 'month';
  return { from, to, account, accounts: account === 'all' ? [] : [account], grain };
}

function niceCeiling(value) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const fraction = value / magnitude;
  const niceFraction = [1, 1.5, 2, 2.5, 5, 10].find((candidate) => candidate >= fraction) || 10;
  return niceFraction * magnitude;
}

export function brokenAxisScale(values) {
  const sorted = values
    .map(Number)
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  const max = sorted.at(-1) || 0;
  const typical = sorted[Math.floor((sorted.length - 1) * 0.85)] || max;
  const lowerMax = niceCeiling(typical * 1.25);
  const enabled = sorted.length >= 5 && lowerMax > 0 && max > lowerMax * 5;
  if (!enabled) {
    return { enabled: false, lowerMax: max, visualMax: max, max, map: (value) => value, inverse: (value) => value };
  }
  const visualMax = lowerMax * 2;
  const upperSpan = max - lowerMax;
  const map = (value) => value <= lowerMax
    ? value
    : lowerMax + ((value - lowerMax) / upperSpan) * lowerMax;
  const inverse = (value) => value <= lowerMax
    ? value
    : lowerMax + ((value - lowerMax) / lowerMax) * upperSpan;
  return { enabled: true, lowerMax, visualMax, max, map, inverse };
}

export function isoWeek(dateString) {
  const date = new Date(`${dateString}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - yearStart) / DAY_MS) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function periodKey(date, grain) {
  if (grain === 'month') return date.slice(0, 7);
  if (grain === 'week') return isoWeek(date);
  return date;
}

export function filterDaily(rows, filters) {
  const accounts = filters.accounts || [];
  return rows.filter((row) => {
    if (filters.from && row.date < filters.from) return false;
    if (filters.to && row.date > filters.to) return false;
    return !accounts.length || accounts.includes(row.account);
  });
}

export function aggregateDaily(rows, grain = 'month') {
  const groups = new Map();
  rows.forEach((row) => {
    const key = periodKey(row.date, grain);
    if (!groups.has(key)) {
      groups.set(key, {
        label: key,
        spend: 0,
        purchases: 0,
        landing_page_views: 0,
        checkouts: 0,
        raw_purchase_value: 0,
        modelled_purchase_value: 0,
        flagged_account_days: 0,
      });
    }
    const target = groups.get(key);
    ['spend', 'purchases', 'landing_page_views', 'checkouts', 'raw_purchase_value', 'modelled_purchase_value']
      .forEach((metric) => { target[metric] += Number(row[metric] || 0); });
    target.flagged_account_days += row.flagged ? 1 : 0;
  });
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export function summarize(rows) {
  const totals = aggregateDaily(rows, 'all').reduce((acc, row) => {
    Object.keys(acc).forEach((key) => { acc[key] += Number(row[key] || 0); });
    return acc;
  }, {
    spend: 0,
    purchases: 0,
    landing_page_views: 0,
    checkouts: 0,
    raw_purchase_value: 0,
    modelled_purchase_value: 0,
    flagged_account_days: 0,
  });
  return {
    ...totals,
    cost_per_purchase: safeRatio(totals.spend, totals.purchases),
    raw_roas: safeRatio(totals.raw_purchase_value, totals.spend),
    modelled_roas: safeRatio(totals.modelled_purchase_value, totals.spend),
    raw_aov: safeRatio(totals.raw_purchase_value, totals.purchases),
    modelled_aov: safeRatio(totals.modelled_purchase_value, totals.purchases),
    purchase_cvr: safeRatio(totals.purchases, totals.landing_page_views),
    checkout_rate: safeRatio(totals.checkouts, totals.landing_page_views),
  };
}

export function withEfficiency(row) {
  return {
    ...row,
    modelled_roas: safeRatio(row.modelled_purchase_value, row.spend),
    cost_per_purchase: safeRatio(row.spend, row.purchases),
    purchase_cvr: safeRatio(row.purchases, row.landing_page_views),
    modelled_aov: safeRatio(row.modelled_purchase_value, row.purchases),
  };
}

export function dayOfMonthProfile(rows) {
  const groups = new Map();
  rows.forEach((row) => {
    const day = Number(row.date.slice(8, 10));
    if (!groups.has(day)) groups.set(day, { day, months: new Set(), spend: 0, purchases: 0, landing_page_views: 0, modelled_purchase_value: 0 });
    const target = groups.get(day);
    target.months.add(row.date.slice(0, 7));
    ['spend', 'purchases', 'landing_page_views', 'modelled_purchase_value'].forEach((key) => { target[key] += Number(row[key] || 0); });
  });
  return [...groups.values()].sort((a, b) => a.day - b.day).map((row) => withEfficiency({
    ...row,
    months: row.months.size,
    average_spend: row.months.size ? row.spend / row.months.size : null,
  }));
}

export function filterMonthlyDetail(rows, filters) {
  const accounts = filters.accounts || [];
  const fromMonth = (filters.from || '').slice(0, 7);
  const toMonth = (filters.to || '').slice(0, 7);
  return rows.filter((row) => (
    (!fromMonth || row.month >= fromMonth)
    && (!toMonth || row.month <= toMonth)
    && (!accounts.length || accounts.includes(row.account))
  ));
}

export function summarizeNamedGroups(rows) {
  const groups = new Map();
  rows.forEach((row) => {
    if (!groups.has(row.group)) groups.set(row.group, { group: row.group, spend: 0, purchases: 0, landing_page_views: 0, checkouts: 0, raw_purchase_value: 0, clean_value_months_won: 0 });
    const target = groups.get(row.group);
    ['spend', 'purchases', 'landing_page_views', 'checkouts', 'raw_purchase_value'].forEach((key) => { target[key] += Number(row[key] || 0); });
  });
  const totalSpend = [...groups.values()].reduce((sum, row) => sum + row.spend, 0);
  const cleanMonths = new Map();
  rows.filter((row) => row.value_reliable).forEach((row) => {
    const key = `${row.account}|${row.month}`;
    if (!cleanMonths.has(key) || Number(row.raw_purchase_value || 0) > cleanMonths.get(key).value) {
      cleanMonths.set(key, { group: row.group, value: Number(row.raw_purchase_value || 0) });
    }
  });
  cleanMonths.forEach(({ group }) => { if (groups.has(group)) groups.get(group).clean_value_months_won += 1; });
  return [...groups.values()].map((row) => ({
    ...row,
    spend_share: safeRatio(row.spend, totalSpend),
    cost_per_purchase: safeRatio(row.spend, row.purchases),
    purchase_cvr: safeRatio(row.purchases, row.landing_page_views),
  })).sort((a, b) => b.spend - a.spend);
}

export function accountSummary(rows) {
  const accounts = [...new Set(rows.map((row) => row.account))].sort();
  return accounts.map((account) => ({ account, ...summarize(rows.filter((row) => row.account === account)) }));
}

export function regionSummary(rows) {
  const groups = new Map();
  rows.forEach((row) => {
    if (!groups.has(row.region)) groups.set(row.region, { region: row.region, spend: 0, clicks: 0 });
    const target = groups.get(row.region);
    target.spend += Number(row.spend || 0);
    target.clicks += Number(row.clicks || 0);
  });
  const totalSpend = [...groups.values()].reduce((sum, row) => sum + row.spend, 0);
  const totalClicks = [...groups.values()].reduce((sum, row) => sum + row.clicks, 0);
  return [...groups.values()].map((row) => ({
    ...row,
    spend_share: safeRatio(row.spend, totalSpend),
    click_share: safeRatio(row.clicks, totalClicks),
    cost_per_click: safeRatio(row.spend, row.clicks),
  }));
}

export function monthlyRegionSeries(rows, region) {
  const groups = new Map();
  rows.filter((row) => row.region === region).forEach((row) => {
    if (!groups.has(row.month)) groups.set(row.month, { month: row.month, spend: 0, clicks: 0 });
    const target = groups.get(row.month);
    target.spend += Number(row.spend || 0);
    target.clicks += Number(row.clicks || 0);
  });
  return [...groups.values()].sort((a, b) => a.month.localeCompare(b.month)).map((row) => ({
    ...row,
    cost_per_click: safeRatio(row.spend, row.clicks),
  }));
}
