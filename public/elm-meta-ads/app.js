import {
  aggregateDaily,
  dayOfMonthProfile,
  escapeHtml,
  filterDaily,
  filterMonthlyDetail,
  monthlyRegionSeries,
  normalizeFilters,
  regionSummary,
  summarize,
  summarizeNamedGroups,
  withEfficiency,
} from './metrics.mjs';

const COLORS = {
  blue: '#5bb7f2', orange: '#ffbc58', green: '#90dfa8', red: '#ff817d', violet: '#a991ff',
  cyan: '#66e3da', pink: '#ec8eff', grid: 'rgba(154, 172, 193, .14)', muted: '#9aacc1',
};
const PALETTE = [COLORS.blue, COLORS.orange, COLORS.green, COLORS.violet, COLORS.cyan, COLORS.red, COLORS.pink, '#c4d3e6'];
const REGION_COLORS = { South: COLORS.blue, North: COLORS.orange, Mid: COLORS.green };
const state = { data: null, charts: {} };

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 });
const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const money = (value) => value == null ? 'N/A' : `${compact.format(value)} VND`;
const fullMoney = (value) => value == null ? 'N/A' : `${integer.format(value)} VND`;
const count = (value) => value == null ? 'N/A' : integer.format(value);
const ratio = (value) => value == null ? 'N/A' : `${Number(value).toFixed(2)}x`;
const percent = (value) => value == null ? 'N/A' : `${(Number(value) * 100).toFixed(1)}%`;
const signedPercent = (value) => value == null ? 'N/A' : `${value >= 0 ? '+' : ''}${(Number(value) * 100).toFixed(0)}%`;

const METRICS = {
  spend: { label: 'Spend', axis: 'Spend · VND', formatter: money, tick: (value) => compact.format(value), color: COLORS.blue },
  modelled_purchase_value: { label: 'Directional revenue', axis: 'Directional revenue · VND', formatter: money, tick: (value) => compact.format(value), color: COLORS.violet },
  purchases: { label: 'Purchases', axis: 'Reported purchases', formatter: count, tick: (value) => compact.format(value), color: COLORS.green },
  landing_page_views: { label: 'Landing-page views', axis: 'Landing-page views', formatter: count, tick: (value) => compact.format(value), color: COLORS.cyan },
  modelled_roas: { label: 'Directional ROAS', axis: 'Directional ROAS', formatter: ratio, tick: (value) => `${value}x`, color: COLORS.orange },
  cost_per_purchase: { label: 'Cost / purchase', axis: 'Cost / purchase · VND', formatter: money, tick: (value) => compact.format(value), color: COLORS.blue },
  purchase_cvr: { label: 'Purchase CVR', axis: 'Purchase CVR', formatter: percent, tick: (value) => percent(value), color: COLORS.green },
  modelled_aov: { label: 'Directional AOV', axis: 'Directional AOV · VND', formatter: money, tick: (value) => compact.format(value), color: COLORS.violet },
  clicks: { label: 'Clicks', axis: 'Clicks', formatter: count, tick: (value) => compact.format(value), color: COLORS.cyan },
  cost_per_click: { label: 'Cost / click', axis: 'Cost / click · VND', formatter: money, tick: (value) => compact.format(value), color: COLORS.violet },
  spend_share: { label: 'Spend share', axis: 'Spend share', formatter: percent, tick: (value) => percent(value), color: COLORS.blue },
};
const MAIN_KPIS = ['spend', 'modelled_purchase_value', 'purchases', 'landing_page_views', 'cost_per_purchase', 'purchase_cvr', 'modelled_aov', 'modelled_roas'];

function median(values) {
  const clean = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!clean.length) return null;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

function replaceChart(name, canvas, config) {
  state.charts[name]?.destroy();
  state.charts[name] = new window.Chart(canvas, config);
}

function baseScales() {
  return {
    x: { grid: { display: false }, ticks: { color: COLORS.muted, maxRotation: 0, autoSkipPadding: 24 } },
    y: { beginAtZero: true, grid: { color: COLORS.grid }, ticks: { color: COLORS.muted } },
  };
}

function options(tooltip, scales = baseScales(), mode = 'index') {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220 },
    interaction: { intersect: false, mode },
    plugins: {
      legend: { labels: { color: COLORS.muted, usePointStyle: true, boxWidth: 8, padding: 16 } },
      tooltip: { callbacks: { label: tooltip } },
    },
    scales,
  };
}

function dualAxisOptions(primaryMetric = 'spend', primaryAxisLabel = null, secondaryMetric = 'modelled_roas', secondaryAxisLabel = null) {
  const primary = METRICS[primaryMetric] || METRICS.spend;
  const secondary = METRICS[secondaryMetric] || METRICS.modelled_roas;
  return options(
    (item) => item.dataset.yAxisID === 'secondary' ? `${item.dataset.label}: ${secondary.formatter(item.raw)}` : `${item.dataset.label}: ${primary.formatter(item.raw)}`,
    {
      x: { grid: { display: false }, ticks: { color: COLORS.muted, maxRotation: 0, autoSkipPadding: 20 } },
      primary: { beginAtZero: true, position: 'left', grid: { color: COLORS.grid }, ticks: { color: COLORS.muted, callback: primary.tick }, title: { display: true, text: primaryAxisLabel || primary.axis, color: COLORS.muted } },
      secondary: { beginAtZero: true, position: 'right', grid: { display: false }, ticks: { color: secondary.color, callback: secondary.tick }, title: { display: true, text: secondaryAxisLabel || secondary.axis, color: secondary.color } },
    },
  );
}

function renderKpiTableBody(series) {
  return series.map((row) => `<tr><td>${escapeHtml(row.label)}</td>${MAIN_KPIS.map((key) => `<td>${escapeHtml(METRICS[key].formatter(row[key]))}</td>`).join('')}</tr>`).join('');
}

function renderKpiTableHead(label = 'Month') {
  return `<tr><th>${escapeHtml(label)}</th>${MAIN_KPIS.map((key) => `<th>${escapeHtml(METRICS[key].label)}</th>`).join('')}</tr>`;
}

function getFilters() {
  const account = document.getElementById('accountFilter').value;
  return {
    from: document.getElementById('dateFrom').value,
    to: document.getElementById('dateTo').value,
    account,
    accounts: account === 'all' ? [] : [account],
    grain: 'month',
  };
}

function normalizeCurrentFilters() {
  const normalized = normalizeFilters(getFilters(), state.data.meta.date_range, ['all', 'Gia Dụng', 'Điện gia dụng']);
  document.getElementById('dateFrom').value = normalized.from;
  document.getElementById('dateTo').value = normalized.to;
  document.getElementById('accountFilter').value = normalized.account;
  return normalized;
}

function presetRanges() {
  return {
    '6m': { start: '2026-01-01', end: '2026-06-30' },
    '12m': { start: '2025-07-01', end: '2026-06-30' },
    '24m': state.data.meta.date_range,
    2025: { start: '2025-01-01', end: '2025-12-31' },
  };
}

function updateUrl(filters) {
  const params = new URLSearchParams();
  if (filters.from !== '2025-07-01') params.set('from', filters.from);
  if (filters.to !== state.data.meta.date_range.end) params.set('to', filters.to);
  if (filters.accounts.length) params.set('account', filters.accounts[0]);
  history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}`);
}

function syncPreset(filters) {
  const ranges = presetRanges();
  document.querySelectorAll('.preset').forEach((button) => {
    const range = ranges[button.dataset.preset];
    button.classList.toggle('active', filters.from === range.start && filters.to === range.end);
  });
}

function monthly(rows) {
  return aggregateDaily(rows, 'month').map(withEfficiency);
}

function renderKpis(rows, filters) {
  const summary = summarize(rows);
  const cards = [
    ['Spend', money(summary.spend), 'Meta delivery'],
    ['Directional ROAS', ratio(summary.modelled_roas), 'Sensitivity value ÷ spend'],
    ['Cost / purchase', money(summary.cost_per_purchase), 'CPA proxy · reported purchase'],
    ['Purchase CVR', percent(summary.purchase_cvr), 'Purchases ÷ landing-page views'],
    ['Directional AOV', money(summary.modelled_aov), 'Sensitivity value ÷ purchases'],
    ['Purchases', count(summary.purchases), 'Meta-reported website family'],
  ];
  document.getElementById('kpiGrid').innerHTML = cards.map(([label, value, note]) => `<article class="kpi"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`).join('');
  document.getElementById('selectionSummary').textContent = `${filters.from} → ${filters.to} · ${filters.account === 'all' ? 'both accounts' : filters.account}`;
}

function renderGrowth(rows) {
  const series = monthly(rows);
  const metricKey = document.getElementById('growthMetric').value;
  const rightMetricKey = document.getElementById('growthMetricRight').value;
  const metric = METRICS[metricKey];
  const rightMetric = METRICS[rightMetricKey];
  document.getElementById('growthTitle').textContent = `${metric.label} × ${rightMetric.label}`;
  const canvas = document.getElementById('growthChart');
  canvas.setAttribute('aria-label', `Monthly ${metric.label} on the left axis and ${rightMetric.label} on the right axis`);
  replaceChart('growth', document.getElementById('growthChart'), {
    data: { labels: series.map((row) => row.label), datasets: [
      { type: 'bar', label: metric.label, data: series.map((row) => row[metricKey]), backgroundColor: `${metric.color}99`, borderColor: metric.color, borderWidth: 1, borderRadius: 6, yAxisID: 'primary' },
      { type: 'line', label: rightMetric.label, data: series.map((row) => row[rightMetricKey]), borderColor: rightMetric.color, backgroundColor: rightMetric.color, borderWidth: 3, pointRadius: 4, tension: .22, yAxisID: 'secondary' },
    ] },
    options: dualAxisOptions(metricKey, null, rightMetricKey),
  });
  const first = series[0];
  const last = series.at(-1);
  const change = first?.[metricKey] ? (last[metricKey] - first[metricKey]) / first[metricKey] : null;
  document.getElementById('growthInsight').textContent = first && last
    ? `${first.label} → ${last.label}: ${metric.label.toLowerCase()} moved ${signedPercent(change)} from ${metric.formatter(first[metricKey])} to ${metric.formatter(last[metricKey])}, while ${rightMetric.label.toLowerCase()} moved from ${rightMetric.formatter(first[rightMetricKey])} to ${rightMetric.formatter(last[rightMetricKey])}.`
    : 'No monthly rows match the selected filters.';
  document.getElementById('growthTableHead').innerHTML = renderKpiTableHead();
  document.getElementById('growthTableCaption').textContent = 'Filtered monthly KPI development';
  document.getElementById('growthTable').innerHTML = renderKpiTableBody(series);
  return series;
}

function renderMetricPair(name, canvasId, series, leftKey, rightKey) {
  const left = METRICS[leftKey];
  const right = METRICS[rightKey];
  replaceChart(name, document.getElementById(canvasId), {
    data: { labels: series.map((row) => row.label), datasets: [
      { type: 'bar', label: left.label, data: series.map((row) => row[leftKey]), backgroundColor: `${left.color}88`, borderRadius: 4, yAxisID: 'primary' },
      { type: 'line', label: right.label, data: series.map((row) => row[rightKey]), borderColor: right.color, backgroundColor: right.color, pointRadius: 3, borderWidth: 2.5, tension: .22, yAxisID: 'secondary' },
    ] },
    options: dualAxisOptions(leftKey, null, rightKey),
  });
}

function renderEfficiency(series) {
  const cards = {
    modelled_roas: { article: document.querySelector('[data-efficiency-card="modelled_roas"]'), chart: 'roas', canvas: 'roasChart' },
    cost_per_purchase: { article: document.querySelector('[data-efficiency-card="cost_per_purchase"]'), chart: 'cpp', canvas: 'cppChart' },
    purchase_cvr: { article: document.querySelector('[data-efficiency-card="purchase_cvr"]'), chart: 'cvr', canvas: 'cvrChart' },
    modelled_aov: { article: document.querySelector('[data-efficiency-card="modelled_aov"]'), chart: 'aov', canvas: 'aovChart' },
  };
  Object.entries(cards).forEach(([key, target]) => {
    const leftKey = document.getElementById(`${key}Left`).value;
    const rightKey = document.getElementById(`${key}Right`).value;
    const left = METRICS[leftKey];
    const right = METRICS[rightKey];
    target.article.querySelector('h3').textContent = `${left.label} × ${right.label}`;
    target.article.querySelector('canvas').setAttribute('aria-label', `Monthly ${left.label} and ${right.label}`);
    renderMetricPair(target.chart, target.canvas, series, leftKey, rightKey);
  });
  document.getElementById('efficiencyTableHead').innerHTML = renderKpiTableHead();
  document.getElementById('efficiencyTable').innerHTML = renderKpiTableBody(series);
}

function accountSeries(rows, account) {
  return monthly(rows.filter((row) => row.account === account));
}

function renderAccounts(rows, filters) {
  const metricKey = document.getElementById('accountMetric').value;
  const metric = METRICS[metricKey];
  const visibleAccounts = filters.accounts.length ? filters.accounts : ['Gia Dụng', 'Điện gia dụng'];
  const labels = [...new Set(monthly(rows).map((row) => row.label))].sort();
  const accountRows = Object.fromEntries(visibleAccounts.map((account) => [account, accountSeries(rows, account)]));
  replaceChart('accountCompare', document.getElementById('accountCompareChart'), {
    type: 'line',
    data: { labels, datasets: visibleAccounts.map((account, index) => ({
      label: account,
      data: labels.map((label) => accountRows[account].find((row) => row.label === label)?.[metricKey] ?? null),
      borderColor: PALETTE[index],
      backgroundColor: PALETTE[index],
      pointRadius: 3,
      borderWidth: 3,
      tension: .2,
      spanGaps: true,
    })) },
    options: options((item) => `${item.dataset.label}: ${metric.formatter(item.raw)}`, { x: baseScales().x, y: { ...baseScales().y, ticks: { color: COLORS.muted, callback: metric.tick }, title: { display: true, text: metric.axis, color: COLORS.muted } } }),
  });
  const home = accountRows['Gia Dụng'] || [];
  const electric = accountRows['Điện gia dụng'] || [];
  const records = [...home.map((row) => ({ ...row, account: 'Gia Dụng' })), ...electric.map((row) => ({ ...row, account: 'Điện gia dụng' }))].sort((a, b) => a.label.localeCompare(b.label) || a.account.localeCompare(b.account));
  document.getElementById('accountTableHead').innerHTML = `<tr><th>Month</th><th>Account</th>${MAIN_KPIS.map((key) => `<th>${escapeHtml(METRICS[key].label)}</th>`).join('')}</tr>`;
  document.getElementById('accountTableCaption').textContent = `Monthly account ${metric.label} and directional ROAS`;
  document.getElementById('accountMonthTable').innerHTML = records.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${escapeHtml(row.account)}</td>${MAIN_KPIS.map((key) => `<td>${escapeHtml(METRICS[key].formatter(row[key]))}</td>`).join('')}</tr>`).join('');
}

function renderDayOfMonth(rows) {
  const metricKey = document.getElementById('intramonthMetric').value;
  const rightMetricKey = document.getElementById('intramonthMetricRight').value;
  const metric = METRICS[metricKey];
  const rightMetric = METRICS[rightMetricKey];
  const monthSelect = document.getElementById('intramonthMonth');
  const months = [...new Set(rows.map((row) => row.date.slice(0, 7)))].sort();
  const current = months.includes(monthSelect.value) ? monthSelect.value : months.at(-1);
  monthSelect.innerHTML = months.map((month) => `<option value="${escapeHtml(month)}"${month === current ? ' selected' : ''}>${escapeHtml(month)}</option>`).join('');
  const dailyRows = rows.filter((row) => row.date.startsWith(current || '')).sort((a, b) => a.date.localeCompare(b.date)).map(withEfficiency);
  const profile = dailyRows.map((row) => ({ ...row, label: String(Number(row.date.slice(8, 10))) }));
  const canvas = document.getElementById('dayOfMonthChart');
  canvas.setAttribute('aria-label', `${metric.label} and ${rightMetric.label} by day inside ${current}`);
  replaceChart('dayOfMonth', document.getElementById('dayOfMonthChart'), {
    data: { labels: profile.map((row) => row.label), datasets: [
      { type: 'bar', label: metric.label, data: profile.map((row) => row[metricKey]), backgroundColor: `${metric.color}88`, borderRadius: 4, yAxisID: 'primary' },
      { type: 'line', label: rightMetric.label, data: profile.map((row) => row[rightMetricKey]), borderColor: rightMetric.color, backgroundColor: rightMetric.color, borderWidth: 2.5, pointRadius: 3, tension: .18, yAxisID: 'secondary' },
    ] },
    options: dualAxisOptions(metricKey, null, rightMetricKey),
  });
  const peak = profile.reduce((best, row) => !best || Number(row[metricKey] || 0) > Number(best[metricKey] || 0) ? row : best, null);
  const campaignDays = profile.filter((row) => Number(row.label) === Number((current || '00-00').slice(5, 7)) || ['15', '20', '25'].includes(row.label)).map((row) => row.label).join(', ');
  document.getElementById('dayOfMonthInsight').textContent = peak
    ? `${current}: day ${peak.label} has the strongest ${metric.label.toLowerCase()} at ${metric.formatter(peak[metricKey])}. Watch double-day and payday-style offer dates (${campaignDays || 'none in selected month'}), but attribute merit only after campaign-day extraction.`
    : 'No daily rows match the selected month.';
  document.getElementById('intramonthTableHead').innerHTML = renderKpiTableHead('Day');
  document.getElementById('intramonthTableCaption').textContent = `${current} daily KPI development`;
  document.getElementById('intramonthTable').innerHTML = profile.map((row) => `<tr><td>${escapeHtml(row.label)}</td>${MAIN_KPIS.map((key) => `<td>${escapeHtml(METRICS[key].formatter(row[key]))}</td>`).join('')}</tr>`).join('');
}

function summarizeCampaignCells(rows) {
  const grouped = new Map();
  const cleanMonthLeaders = new Map();
  rows.forEach((row) => {
    const key = `${row.account}|${row.cell}`;
    if (!grouped.has(key)) grouped.set(key, {
      account: row.account,
      cell: row.cell,
      months: new Set(),
      spend: 0,
      purchases: 0,
      landing_page_views: 0,
      checkouts: 0,
      raw_purchase_value: 0,
      clean_value_months_won: 0,
    });
    const target = grouped.get(key);
    target.months.add(row.month);
    ['spend', 'purchases', 'landing_page_views', 'checkouts', 'raw_purchase_value'].forEach((metric) => { target[metric] += Number(row[metric] || 0); });
    if (row.value_reliable) {
      const monthKey = `${row.account}|${row.month}`;
      const value = Number(row.raw_purchase_value || 0);
      if (!cleanMonthLeaders.has(monthKey) || value > cleanMonthLeaders.get(monthKey).value) {
        cleanMonthLeaders.set(monthKey, { key, value });
      }
    }
  });
  cleanMonthLeaders.forEach(({ key }) => {
    if (grouped.has(key)) grouped.get(key).clean_value_months_won += 1;
  });
  return [...grouped.values()].map((row) => ({
    ...row,
    months_active: row.months.size,
    cost_per_purchase: row.purchases ? row.spend / row.purchases : null,
    purchase_cvr: row.landing_page_views ? row.purchases / row.landing_page_views : null,
    raw_roas: row.spend ? row.raw_purchase_value / row.spend : null,
  })).sort((a, b) => b.spend - a.spend);
}

function benchmarkCells(rows) {
  const accounts = [...new Set(rows.map((row) => row.account))];
  return Object.fromEntries(accounts.map((account) => {
    const scoped = rows.filter((row) => row.account === account);
    return [account, {
      median_cpa: median(scoped.filter((row) => row.purchases >= 30).map((row) => row.cost_per_purchase)),
      median_cvr: median(scoped.filter((row) => row.landing_page_views >= 500).map((row) => row.purchase_cvr)),
    }];
  }));
}

function leverAction(type, cell) {
  const lower = cell.toLowerCase();
  if (type === 'scale') {
    if (lower.includes('retargeting')) return 'Turn into a clean South retargeting pool with offer sequencing and frequency control.';
    if (lower.includes('prospecting')) return 'Build a South-only prospecting test with isolated budget, matching product supply and local proof angles.';
    if (lower.includes('asc')) return 'Clone into a South-contained ASC test and protect it from blended national budget drift.';
    return 'Protect the pattern, isolate South delivery, then validate product/category margin before scaling.';
  }
  if (lower.includes('retargeting')) return 'Rebuild audience recency, exclusions and offer ladder before allowing more South retargeting spend.';
  if (lower.includes('prospecting')) return 'Audit audience breadth, creative promise and landing path; cap spend until CPA/CVR recovers.';
  return 'Treat as a budget leak: inspect offer, category fit, audience intent and conversion path.';
}

function renderLeverBoard(filters) {
  const rows = filterMonthlyDetail(state.data.campaign_cells || [], filters);
  const summaries = summarizeCampaignCells(rows).filter((row) => row.months_active >= 2 && row.spend >= 50_000_000 && row.purchases >= 40);
  const benchmarks = benchmarkCells(summaries);
  const enriched = summaries.map((row) => {
    const bench = benchmarks[row.account] || {};
    const cpaLift = bench.median_cpa && row.cost_per_purchase ? (bench.median_cpa - row.cost_per_purchase) / bench.median_cpa : null;
    const cvrLift = bench.median_cvr && row.purchase_cvr ? (row.purchase_cvr - bench.median_cvr) / bench.median_cvr : null;
    return { ...row, cpaLift, cvrLift };
  });
  const scale = enriched
    .filter((row) => row.cpaLift > .12)
    .sort((a, b) => (b.cpaLift * 60 + b.clean_value_months_won * 6 + b.months_active) - (a.cpaLift * 60 + a.clean_value_months_won * 6 + a.months_active))
    .slice(0, 5);
  const rebuild = enriched
    .filter((row) => row.cpaLift < -.25 && row.spend >= 80_000_000)
    .sort((a, b) => (a.cpaLift * 70 - b.spend / 100_000_000) - (b.cpaLift * 70 - a.spend / 100_000_000))
    .slice(0, 5);
  const cards = [
    ['Scale candidates', scale.length, scale[0] ? `${scale[0].cell} at ${money(scale[0].cost_per_purchase)} CPA` : 'No strong repeatable candidate in selection', 'signal-fact'],
    ['Rebuild / waste cells', rebuild.length, rebuild[0] ? `${rebuild[0].cell} at ${money(rebuild[0].cost_per_purchase)} CPA` : 'No major repeated waste cell in selection', 'signal-hold'],
    ['Offer bridge', scale.length + rebuild.length, 'Use these cells to define South-only campaign structure, product focus and budget rules.', 'signal-test'],
  ];
  document.getElementById('leverCards').innerHTML = cards.map(([label, value, note, className]) => `<article><span class="${className}">${label}</span><strong>${count(value)}</strong><p>${escapeHtml(note)}</p></article>`).join('');
  const tableRows = [
    ...scale.map((row) => ({ ...row, type: 'Scale' })),
    ...rebuild.map((row) => ({ ...row, type: 'Rebuild' })),
  ];
  document.getElementById('leverTable').innerHTML = tableRows.map((row) => `<tr><td><span class="${row.type === 'Scale' ? 'cell-good' : 'cell-hold'}">${row.type}</span></td><td>${escapeHtml(row.cell)}</td><td>${escapeHtml(count(row.months_active))}</td><td>${escapeHtml(money(row.spend))}</td><td>${escapeHtml(money(row.cost_per_purchase))}</td><td>${escapeHtml(signedPercent(row.cpaLift))}</td><td>${escapeHtml(percent(row.purchase_cvr))}</td><td>${escapeHtml(count(row.clean_value_months_won))}</td><td>${escapeHtml(leverAction(row.type.toLowerCase(), row.cell))}</td></tr>`).join('');
  document.getElementById('leverInsight').textContent = tableRows.length
    ? `This is the service-offer bridge: preserve the scale cells, rebuild the waste cells, and run the South Vietnam execution around isolated budget, local proof, product availability and clean measurement.`
    : 'No repeatable campaign cells meet the selected thresholds. Widen the date range or use the campaign taxonomy view below.';
}

function renderCampaigns(filters) {
  const rows = filterMonthlyDetail(state.data.campaign_groups, filters);
  const summary = summarizeNamedGroups(rows);
  const months = [...new Set(rows.map((row) => row.month))].sort();
  const groups = summary.map((row) => row.group);
  replaceChart('campaignMix', document.getElementById('campaignMixChart'), {
    type: 'bar',
    data: { labels: months, datasets: groups.map((group, index) => ({ label: group, data: months.map((month) => rows.filter((row) => row.month === month && row.group === group).reduce((sum, row) => sum + Number(row.spend || 0), 0)), backgroundColor: `${PALETTE[index % PALETTE.length]}bb`, borderRadius: 3 })) },
    options: options((item) => `${item.dataset.label}: ${money(item.raw)}`, { x: { ...baseScales().x, stacked: true }, y: { ...baseScales().y, stacked: true, ticks: { color: COLORS.muted, callback: (value) => compact.format(value) } } }),
  });
  document.getElementById('campaignTable').innerHTML = summary.map((row) => `<tr><td>${escapeHtml(row.group)}</td><td>${escapeHtml(percent(row.spend_share))}</td><td>${escapeHtml(money(row.spend))}</td><td>${escapeHtml(count(row.purchases))}</td><td>${escapeHtml(money(row.cost_per_purchase))}</td><td>${escapeHtml(percent(row.purchase_cvr))}</td><td>${escapeHtml(count(row.clean_value_months_won))}</td></tr>`).join('');
  const leader = summary[0];
  const valueLeader = [...summary].sort((a, b) => b.clean_value_months_won - a.clean_value_months_won)[0];
  document.getElementById('campaignInsight').textContent = leader
    ? `${leader.group} is the largest spend group at ${percent(leader.spend_share)} of selected campaign-level spend. ${valueLeader.group} leads raw tracked value in ${valueLeader.clean_value_months_won} clean account-months, but campaign value remains directional because the anomaly model is only available at account-day grain.`
    : 'No campaign-group rows match the selected filters.';
}

function renderCreatives(filters) {
  const rows = filterMonthlyDetail(state.data.creative_formats, filters);
  const summary = summarizeNamedGroups(rows);
  const totalSpend = summary.reduce((sum, row) => sum + row.spend, 0);
  if (!summary.length || !totalSpend) {
    state.charts.creative?.destroy();
    delete state.charts.creative;
    document.getElementById('creativeTable').innerHTML = '<tr><td colspan="6">No ad-level creative-format rows are available for this selected account/date range.</td></tr>';
    document.getElementById('creativeInsight').textContent = 'This section can be blank when the selected range falls outside cached ad-level coverage.';
    document.getElementById('creativeCoverageNote').textContent = 'Known gap: Điện gia dụng ad-level monthly coverage is only available through 2025-09 in the cached export. Campaign/ad set rows still exist, but format inference needs ad-level rows.';
    return;
  }
  document.getElementById('creativeCoverageNote').textContent = '';
  replaceChart('creative', document.getElementById('creativeChart'), {
    type: 'doughnut',
    data: { labels: summary.map((row) => row.group), datasets: [{ data: summary.map((row) => row.spend), backgroundColor: summary.map((_row, index) => PALETTE[index % PALETTE.length]), borderColor: '#111a26', borderWidth: 3 }] },
    options: { ...options((item) => `${item.label}: ${money(item.raw)} · ${percent(item.raw / totalSpend)}`, {}, 'nearest'), cutout: '58%' },
  });
  document.getElementById('creativeTable').innerHTML = summary.map((row) => `<tr><td>${escapeHtml(row.group)}</td><td>${escapeHtml(percent(row.spend_share))}</td><td>${escapeHtml(money(row.spend))}</td><td>${escapeHtml(count(row.purchases))}</td><td>${escapeHtml(money(row.cost_per_purchase))}</td><td>${escapeHtml(percent(row.purchase_cvr))}</td></tr>`).join('');
  const video = summary.find((row) => row.group === 'Video');
  const banner = summary.find((row) => row.group === 'Banner / single image');
  const classified = summary.filter((row) => row.group !== 'Unclassified' && row.spend_share >= .01);
  const cppLeader = [...classified].sort((a, b) => a.cost_per_purchase - b.cost_per_purchase)[0];
  const cvrLeader = [...classified].sort((a, b) => b.purchase_cvr - a.purchase_cvr)[0];
  document.getElementById('creativeInsight').textContent = video && banner && cppLeader && cvrLeader
    ? `${cppLeader.group} has the lowest observed cost per purchase (${money(cppLeader.cost_per_purchase)}), while ${cvrLeader.group} has the highest purchase CVR (${percent(cvrLeader.purchase_cvr)}) among material classified formats. Video records ${money(video.cost_per_purchase)} / ${percent(video.purchase_cvr)} versus banner / single image at ${money(banner.cost_per_purchase)} / ${percent(banner.purchase_cvr)}. Mix differs by account and month; this is not a causal creative test.`
    : 'Creative format coverage is incomplete for this selection.';
}

function summarizeScope(rows, filters) {
  return filterMonthlyDetail(rows, filters).reduce((acc, row) => {
    const key = `${row.account}|${row.category_scope}`;
    if (!acc.has(key)) acc.set(key, { ...row, months_active: 0, spend: 0, purchases: 0, landing_page_views: 0, checkouts: 0, raw_purchase_value: 0 });
    const target = acc.get(key);
    target.months_active = Math.max(target.months_active, Number(row.months_active || 0));
    ['spend', 'purchases', 'landing_page_views', 'checkouts', 'raw_purchase_value'].forEach((metric) => { target[metric] += Number(row[metric] || 0); });
    return acc;
  }, new Map());
}

function renderCategoryScope(filters) {
  const rows = [...summarizeScope(state.data.account_category_scope || [], filters).values()].map((row) => ({
    ...row,
    cost_per_purchase: row.purchases ? row.spend / row.purchases : null,
    purchase_cvr: row.landing_page_views ? row.purchases / row.landing_page_views : null,
  })).sort((a, b) => b.spend - a.spend);
  document.getElementById('categoryScopeTable').innerHTML = rows.slice(0, 18).map((row) => `<tr><td>${escapeHtml(row.account)}</td><td>${escapeHtml(row.category_scope)}</td><td>${escapeHtml(money(row.spend))}</td><td>${escapeHtml(percent(row.spend / rows.filter((item) => item.account === row.account).reduce((sum, item) => sum + item.spend, 0)))}</td><td>${escapeHtml(count(row.purchases))}</td><td>${escapeHtml(money(row.cost_per_purchase))}</td><td>${escapeHtml(percent(row.purchase_cvr))}</td></tr>`).join('');
  const homeTop = rows.filter((row) => row.account === 'Gia Dụng').slice(0, 3).map((row) => row.category_scope).join(', ');
  const electricTop = rows.filter((row) => row.account === 'Điện gia dụng').slice(0, 3).map((row) => row.category_scope).join(', ');
  document.getElementById('categoryScopeInsight').textContent = `Account scope read: Gia Dụng concentrates in kitchen/houseware categories (${homeTop}); Điện gia dụng concentrates in appliance categories (${electricTop}). URL/catalog confirmation is not in the cached export.`;
}

function renderSeasonality(filters) {
  const rows = (state.data.seasonality_cells || []).filter((row) => !filters.accounts.length || filters.accounts.includes(row.account));
  document.getElementById('seasonalityTable').innerHTML = rows.slice(0, 10).map((row) => `<tr><td>${escapeHtml(row.account)}</td><td>${escapeHtml(row.cell)}</td><td>${escapeHtml(money(row.q4_spend))}</td><td>${escapeHtml(count(row.q4_purchases))}</td><td>${escapeHtml(money(row.q4_cost_per_purchase))}</td><td>${escapeHtml(money(row.non_q4_cost_per_purchase))}</td><td>${escapeHtml(signedPercent(row.cpa_lift_in_q4))}</td><td>${escapeHtml(signedPercent(row.purchase_month_lift_in_q4))}</td></tr>`).join('');
  const leader = rows[0];
  document.getElementById('seasonalityInsight').textContent = leader
    ? `Q4 demand pull is not uniform. ${leader.cell} improved CPA by ${signedPercent(leader.cpa_lift_in_q4)} in Q4 while purchases/month moved ${signedPercent(leader.purchase_month_lift_in_q4)}.`
    : 'No material Q4 lift rows match the selected filters.';
}

function renderRegional() {
  const rows = state.data.region_monthly;
  const metricKey = document.getElementById('regionMetric').value;
  const metric = METRICS[metricKey] || METRICS.spend;
  const order = { South: 0, North: 1, Mid: 2 };
  const summary = regionSummary(rows).filter((row) => REGION_COLORS[row.region]).sort((a, b) => order[a.region] - order[b.region]);
  replaceChart('regionBaseline', document.getElementById('regionBaselineChart'), {
    data: { labels: summary.map((row) => row.region), datasets: [
      { type: 'bar', label: 'Spend share', data: summary.map((row) => row.spend_share * 100), backgroundColor: summary.map((row) => `${REGION_COLORS[row.region]}bb`), borderRadius: 6, yAxisID: 'share' },
      { type: 'bar', label: 'Click share', data: summary.map((row) => row.click_share * 100), backgroundColor: summary.map((row) => `${REGION_COLORS[row.region]}55`), borderColor: summary.map((row) => REGION_COLORS[row.region]), borderWidth: 1, borderRadius: 6, yAxisID: 'share' },
      { type: 'line', label: 'Cost / click', data: summary.map((row) => row.cost_per_click), borderColor: COLORS.violet, backgroundColor: COLORS.violet, pointRadius: 5, yAxisID: 'cost' },
    ] },
    options: options((item) => item.dataset.yAxisID === 'cost' ? `${item.dataset.label}: ${money(item.raw)}` : `${item.dataset.label}: ${item.raw.toFixed(1)}%`, { x: baseScales().x, share: { beginAtZero: true, position: 'left', grid: { color: COLORS.grid }, ticks: { color: COLORS.muted, callback: (value) => `${value}%` } }, cost: { beginAtZero: true, position: 'right', grid: { display: false }, ticks: { color: COLORS.muted, callback: (value) => compact.format(value) } } }),
  });
  const regions = ['South', 'North', 'Mid'];
  const byRegion = Object.fromEntries(regions.map((region) => [region, monthlyRegionSeries(rows, region)]));
  const labels = [...new Set(rows.filter((row) => REGION_COLORS[row.region]).map((row) => row.month))].sort();
  const totalsByMonth = Object.fromEntries(labels.map((month) => [month, rows.filter((row) => row.month === month && REGION_COLORS[row.region]).reduce((sum, row) => sum + Number(row.spend || 0), 0)]));
  const valueFor = (region, month) => {
    const row = byRegion[region].find((item) => item.month === month);
    if (!row) return null;
    if (metricKey === 'spend_share') return row.spend / totalsByMonth[month];
    if (metricKey === 'cost_per_click') return row.cost_per_click;
    return row[metricKey];
  };
  replaceChart('regionTrend', document.getElementById('regionTrendChart'), {
    type: 'line',
    data: { labels, datasets: regions.map((region) => ({ label: region, data: labels.map((month) => valueFor(region, month)), borderColor: REGION_COLORS[region], backgroundColor: REGION_COLORS[region], borderWidth: region === 'South' ? 3 : 2, pointRadius: 2, tension: .2, spanGaps: true })) },
    options: options((item) => `${item.dataset.label}: ${metric.formatter(item.raw)}`, { x: baseScales().x, y: { ...baseScales().y, ticks: { color: COLORS.muted, callback: metric.tick }, title: { display: true, text: metric.axis, color: COLORS.muted } } }),
  });
  document.getElementById('regionMonthlyTable').innerHTML = labels.map((month) => {
    const south = byRegion.South.find((row) => row.month === month) || {};
    return `<tr><td>${escapeHtml(month)}</td><td>${escapeHtml(money(south.spend))}</td><td>${escapeHtml(percent((south.spend || 0) / totalsByMonth[month]))}</td><td>${escapeHtml(count(south.clicks))}</td><td>${escapeHtml(money(south.cost_per_click))}</td></tr>`;
  }).join('');
}

function renderStructures(filters) {
  const rows = filterMonthlyDetail(state.data.structure_groups || [], filters);
  const summary = summarizeNamedGroups(rows).sort((a, b) => b.spend - a.spend);
  const leader = summary[0];
  document.getElementById('structureInsight').textContent = leader
    ? `${leader.group} is the largest visible setup bucket in the selection at ${percent(leader.spend_share)} of setup-classified spend. AWO is treated as an internal naming label, not as ABO.`
    : 'No setup rows match the selected account/date range.';
  document.getElementById('structureTable').innerHTML = summary.length
    ? summary.map((row) => `<tr><td>${escapeHtml(row.group)}</td><td>${escapeHtml(percent(row.spend_share))}</td><td>${escapeHtml(money(row.spend))}</td><td>${escapeHtml(count(row.purchases))}</td><td>${escapeHtml(money(row.cost_per_purchase))}</td><td>${escapeHtml(percent(row.purchase_cvr))}</td></tr>`).join('')
    : '<tr><td colspan="6">No campaign setup rows match this selected account/date range.</td></tr>';
}

function renderMeasurement(rows, filters) {
  const summary = summarize(rows);
  const removed = summary.raw_purchase_value - summary.modelled_purchase_value;
  document.getElementById('flagCount').textContent = count(summary.flagged_account_days);
  document.getElementById('valueBridge').innerHTML = [
    ['Raw tracked value', money(summary.raw_purchase_value)],
    ['Scenario difference', `− ${money(removed)}`],
    ['Directional value', money(summary.modelled_purchase_value)],
    ['Directional ROAS', ratio(summary.modelled_roas)],
  ].map(([label, value]) => `<article><span>${label}</span><strong>${value}</strong></article>`).join('');
  const anomalies = state.data.anomalies.filter((row) => row.date >= filters.from && row.date <= filters.to && (!filters.accounts.length || filters.accounts.includes(row.account)));
  document.getElementById('detailCaption').textContent = `${anomalies.length} flagged account-days in the selected period`;
  document.getElementById('detailBody').innerHTML = anomalies.map((row) => `<tr><td>${escapeHtml(row.date)}</td><td>${escapeHtml(row.account)}</td><td>${escapeHtml(count(row.purchases))}</td><td>${escapeHtml(money(row.raw_purchase_value))}</td><td>${escapeHtml(fullMoney(row.baseline_aov))}</td><td>${escapeHtml(money(row.modelled_purchase_value))}</td><td class="cell-risk">${escapeHtml(money(row.excess_purchase_value))}</td></tr>`).join('');
}

function render() {
  const filters = normalizeCurrentFilters();
  const rows = filterDaily(state.data.account_daily, filters);
  renderKpis(rows, filters);
  const series = renderGrowth(rows);
  renderEfficiency(series);
  renderAccounts(rows, filters);
  renderDayOfMonth(rows);
  renderCategoryScope(filters);
  renderSeasonality(filters);
  renderLeverBoard(filters);
  renderCampaigns(filters);
  renderCreatives(filters);
  renderRegional();
  renderStructures(filters);
  renderMeasurement(rows, filters);
  syncPreset(filters);
  updateUrl(filters);
}

function setPreset(name) {
  const range = presetRanges()[name];
  document.getElementById('dateFrom').value = range.start;
  document.getElementById('dateTo').value = range.end;
  render();
}

function exportCsv() {
  const filters = normalizeCurrentFilters();
  const rows = filterDaily(state.data.account_daily, filters);
  const keys = ['date', 'account', 'spend', 'purchases', 'landing_page_views', 'checkouts', 'modelled_purchase_value', 'flagged'];
  const csvEscape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const csv = [keys.join(','), ...rows.map((row) => keys.map((key) => csvEscape(row[key])).join(','))].join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  link.download = `elm-meta-growth-${filters.from}-${filters.to}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function bindControls() {
  document.querySelectorAll('.preset').forEach((button) => button.addEventListener('click', () => setPreset(button.dataset.preset)));
  ['dateFrom', 'dateTo', 'accountFilter', 'growthMetric', 'growthMetricRight', 'accountMetric', 'intramonthMetric', 'intramonthMetricRight', 'intramonthMonth', 'regionMetric']
    .forEach((id) => document.getElementById(id).addEventListener('change', render));
  document.querySelectorAll('.pair-metric').forEach((control) => control.addEventListener('change', render));
  document.getElementById('exportButton').addEventListener('click', exportCsv);
}

function hydrateFilters() {
  const params = new URLSearchParams(location.search);
  const range = state.data.meta.date_range;
  ['dateFrom', 'dateTo'].forEach((id) => { document.getElementById(id).min = range.start; document.getElementById(id).max = range.end; });
  document.getElementById('dateFrom').value = params.get('from') || '2025-07-01';
  document.getElementById('dateTo').value = params.get('to') || range.end;
  document.getElementById('accountFilter').value = params.get('account') || 'all';
  normalizeCurrentFilters();
}

async function init() {
  if (!window.Chart) throw new Error('Chart.js did not load. Check the network and refresh.');
  const response = await fetch('./elm_meta_ads.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Dashboard data failed to load (${response.status}).`);
  state.data = await response.json();
  window.Chart.defaults.color = COLORS.muted;
  window.Chart.defaults.font.family = 'Inter, ui-sans-serif, system-ui, sans-serif';
  document.getElementById('dataStamp').textContent = `${state.data.meta.date_range.start} → ${state.data.meta.date_range.end} · generated ${state.data.meta.generated_at.slice(0, 10)}`;
  document.getElementById('mappingCoverage').textContent = `${(state.data.reconciliation.mapped_spend_coverage * 100).toFixed(2)}%`;
  hydrateFilters();
  bindControls();
  render();
}

init().catch((error) => {
  const target = document.getElementById('errorState');
  target.hidden = false;
  target.textContent = error.message;
  document.getElementById('dataStamp').textContent = 'Dashboard unavailable';
  console.error(error);
});
