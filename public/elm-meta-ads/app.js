import {
  accountSummary,
  aggregateDaily,
  brokenAxisScale,
  escapeHtml,
  filterDaily,
  monthlyRegionSeries,
  normalizeFilters,
  regionSummary,
  summarize,
} from './metrics.mjs';

const COLORS = {
  blue: '#5bb7f2',
  orange: '#ffbc58',
  green: '#90dfa8',
  red: '#ff817d',
  violet: '#a991ff',
  grid: 'rgba(154, 172, 193, .14)',
  muted: '#9aacc1',
};
const REGION_COLORS = { South: COLORS.blue, North: COLORS.orange, Mid: COLORS.green };
const state = { data: null, charts: {}, operatingMetric: 'spend' };

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 });
const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (value) => value == null ? 'N/A' : `${compact.format(value)} VND`;
const fullMoney = (value) => value == null ? 'N/A' : `${integer.format(value)} VND`;
const count = (value) => value == null ? 'N/A' : integer.format(value);
const ratio = (value) => value == null ? 'N/A' : `${decimal.format(value)}x`;
const percent = (value) => value == null ? 'N/A' : `${(value * 100).toFixed(1)}%`;

const brokenAxisMarker = {
  id: 'brokenAxisMarker',
  afterDraw(chart, _args, options) {
    if (!options.enabled) return;
    const yScale = chart.scales.y;
    const x = chart.chartArea.left;
    const y = yScale.getPixelForValue(options.breakValue);
    const { ctx } = chart;
    ctx.save();
    ctx.fillStyle = '#111a26';
    ctx.fillRect(x - 7, y - 12, 14, 24);
    ctx.fillStyle = COLORS.muted;
    ctx.font = '700 18px Inter, ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⋮', x, y);
    ctx.restore();
  },
};

function getFilters() {
  const account = document.getElementById('accountFilter').value;
  return {
    from: document.getElementById('dateFrom').value,
    to: document.getElementById('dateTo').value,
    account,
    accounts: account === 'all' ? [] : [account],
    grain: document.getElementById('grainFilter').value,
  };
}

function normalizeCurrentFilters() {
  const normalized = normalizeFilters(getFilters(), state.data.meta.date_range, ['all', 'Gia Dụng', 'Điện gia dụng']);
  document.getElementById('dateFrom').value = normalized.from;
  document.getElementById('dateTo').value = normalized.to;
  document.getElementById('accountFilter').value = normalized.account;
  document.getElementById('grainFilter').value = normalized.grain;
  return normalized;
}

function updateUrl(filters) {
  const params = new URLSearchParams();
  if (filters.from !== state.data.meta.date_range.start) params.set('from', filters.from);
  if (filters.to !== state.data.meta.date_range.end) params.set('to', filters.to);
  if (filters.accounts.length) params.set('account', filters.accounts[0]);
  if (filters.grain !== 'month') params.set('grain', filters.grain);
  const query = params.toString();
  history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}`);
}

function syncPresetState(filters) {
  const ranges = {
    all: state.data.meta.date_range,
    '2024h2': { start: '2024-07-01', end: '2024-12-31' },
    2025: { start: '2025-01-01', end: '2025-12-31' },
    '2026h1': { start: '2026-01-01', end: '2026-06-30' },
  };
  document.querySelectorAll('.preset').forEach((button) => {
    const range = ranges[button.dataset.preset];
    button.classList.toggle('active', filters.from === range.start && filters.to === range.end);
  });
}

function chartOptions(yFormatter, tooltipFormatter, extra = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 260 },
    interaction: { intersect: false, mode: 'index' },
    plugins: {
      legend: { labels: { color: COLORS.muted, usePointStyle: true, boxWidth: 8, padding: 18 } },
      tooltip: { callbacks: { label: tooltipFormatter } },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: COLORS.muted, maxRotation: 0, autoSkipPadding: 24 } },
      y: { beginAtZero: true, grid: { color: COLORS.grid }, ticks: { color: COLORS.muted, callback: yFormatter } },
    },
    ...extra,
  };
}

function replaceChart(name, canvas, config) {
  state.charts[name]?.destroy();
  state.charts[name] = new window.Chart(canvas, config);
}

function renderKpis(rows, filters) {
  const summary = summarize(rows);
  const cards = [
    ['Spend', money(summary.spend), 'Meta delivery', ''],
    ['Purchases', count(summary.purchases), 'Meta-reported', ''],
    ['Cost / purchase', money(summary.cost_per_purchase), 'Spend ÷ purchases', ''],
    ['Raw tracked ROAS', ratio(summary.raw_roas), 'Not decision-grade', 'risk'],
    ['Modelled ROAS', ratio(summary.modelled_roas), 'Sensitivity only', 'warning'],
    ['Flagged days', count(summary.flagged_account_days), 'Account × day', 'risk'],
  ];
  document.getElementById('kpiGrid').innerHTML = cards.map(([label, value, note, tone]) => `
    <article class="kpi ${tone}"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>
  `).join('');
  document.getElementById('selectionSummary').textContent = `${filters.from} → ${filters.to} · ${count(rows.length)} account-days`;
}

function renderOperating(rows, grain) {
  const grouped = aggregateDaily(rows, grain);
  const metric = state.operatingMetric;
  const config = {
    spend: { label: 'Spend', value: (row) => row.spend, format: money, color: COLORS.blue },
    purchases: { label: 'Purchases', value: (row) => row.purchases, format: count, color: COLORS.green },
    cost_per_purchase: { label: 'Cost per purchase', value: (row) => row.purchases ? row.spend / row.purchases : null, format: money, color: COLORS.orange },
  }[metric];
  const values = grouped.map(config.value);
  replaceChart('operating', document.getElementById('operatingChart'), {
    type: metric === 'purchases' ? 'bar' : 'line',
    data: { labels: grouped.map((row) => row.label), datasets: [{
      label: config.label,
      data: values,
      borderColor: config.color,
      backgroundColor: `${config.color}33`,
      borderWidth: 3,
      borderRadius: 6,
      pointRadius: grain === 'day' ? 0 : 3,
      pointHoverRadius: 5,
      tension: .24,
      fill: metric !== 'purchases',
    }] },
    options: chartOptions((value) => compact.format(value), (item) => `${config.label}: ${config.format(item.raw)}`),
  });
  const valid = values.map((value, index) => ({ value, label: grouped[index].label })).filter((item) => item.value != null);
  const best = valid.reduce((a, b) => (b.value > a.value ? b : a), valid[0] || { label: '—', value: null });
  document.getElementById('operatingInsight').textContent = valid.length
    ? `Peak ${config.label.toLowerCase()}: ${best.label} · ${config.format(best.value)}. Change the metric, date range, account, or grain to inspect the operating pattern.`
    : 'No rows match the selected filters.';
  document.getElementById('operatingDataTable').innerHTML = grouped.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${escapeHtml(money(row.spend))}</td><td>${escapeHtml(count(row.purchases))}</td><td>${escapeHtml(money(row.purchases ? row.spend / row.purchases : null))}</td></tr>`).join('');
}

function renderValue(rows, grain) {
  const grouped = aggregateDaily(rows, grain);
  const rawValues = grouped.map((row) => row.raw_purchase_value);
  const modelledValues = grouped.map((row) => row.modelled_purchase_value);
  const broken = brokenAxisScale([...rawValues, ...modelledValues]);
  const point = (value, index) => ({ x: grouped[index].label, y: broken.map(value), original: value });
  const options = chartOptions(
    (value) => compact.format(broken.inverse(Number(value))),
    (item) => `${item.dataset.label}: ${money(item.raw.original)}`,
  );
  if (broken.enabled) {
    options.scales.y.max = broken.visualMax;
    options.scales.y.ticks.stepSize = broken.lowerMax / 2;
    options.scales.y.title = { display: true, text: 'Tracked purchase value · compressed above ⋮', color: COLORS.muted };
    options.scales.y.grid.color = (context) => Math.abs(Number(context.tick.value) - broken.lowerMax) < 1
      ? 'rgba(154, 172, 193, .55)'
      : COLORS.grid;
    options.plugins.brokenAxisMarker = { enabled: true, breakValue: broken.lowerMax };
  } else {
    options.plugins.brokenAxisMarker = { enabled: false };
  }
  const canvas = document.getElementById('valueChart');
  canvas.setAttribute('aria-label', broken.enabled
    ? 'Raw and modelled tracked purchase value with a broken y-axis; exact values are available in tooltips and the data table'
    : 'Raw and modelled tracked purchase value');
  replaceChart('value', document.getElementById('valueChart'), {
    type: 'line',
    data: { labels: grouped.map((row) => row.label), datasets: [
      { label: 'Raw tracked value', data: rawValues.map(point), borderColor: COLORS.red, backgroundColor: `${COLORS.red}1f`, borderWidth: 2, pointRadius: (context) => context.raw.original > broken.lowerMax ? 4 : 2, tension: .18 },
      { label: 'Modelled sensitivity', data: modelledValues.map(point), borderColor: COLORS.orange, backgroundColor: `${COLORS.orange}22`, borderWidth: 3, pointRadius: 2, tension: .18 },
    ] },
    options,
    plugins: [brokenAxisMarker],
  });
  document.getElementById('valueAxisNote').textContent = broken.enabled
    ? `Broken y-axis: 0–${compact.format(broken.lowerMax)} VND stays linear; values above ⋮ are compressed so ordinary monthly differences remain visible. Hover a point or open the table for exact values.`
    : 'Linear y-axis for the selected range. Hover a point or open the table for exact values.';
  const summary = summarize(rows);
  const removed = summary.raw_purchase_value - summary.modelled_purchase_value;
  const removedShare = summary.raw_purchase_value ? removed / summary.raw_purchase_value : null;
  document.getElementById('valueBridge').innerHTML = [
    ['Raw tracked value', money(summary.raw_purchase_value)],
    ['Less scenario difference', `− ${money(removed)}`],
    ['Modelled sensitivity', money(summary.modelled_purchase_value)],
    ['Raw value isolated', percent(removedShare)],
  ].map(([label, value]) => `<article><span>${label}</span><strong>${value}</strong></article>`).join('');
  document.getElementById('flagCount').textContent = count(summary.flagged_account_days);
  document.getElementById('valueDataTable').innerHTML = grouped.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${escapeHtml(money(row.raw_purchase_value))}</td><td>${escapeHtml(money(row.modelled_purchase_value))}</td><td>${escapeHtml(count(row.flagged_account_days))}</td></tr>`).join('');
}

function renderAccount(rows) {
  const accounts = accountSummary(rows);
  const metric = document.getElementById('accountMetric').value;
  const configs = {
    spend: ['Spend', (row) => row.spend, money, COLORS.blue],
    purchases: ['Purchases', (row) => row.purchases, count, COLORS.green],
    cost_per_purchase: ['Cost per purchase', (row) => row.cost_per_purchase, money, COLORS.orange],
    modelled_roas: ['Modelled ROAS', (row) => row.modelled_roas, ratio, COLORS.violet],
  };
  const [label, value, formatter, color] = configs[metric];
  replaceChart('account', document.getElementById('accountChart'), {
    type: 'bar',
    data: { labels: accounts.map((row) => row.account), datasets: [{ label, data: accounts.map(value), backgroundColor: [COLORS.blue, COLORS.orange], borderRadius: 8, maxBarThickness: 130 }] },
    options: chartOptions((tick) => compact.format(tick), (item) => `${label}: ${formatter(item.raw)}`),
  });
  document.getElementById('accountTable').innerHTML = accounts.map((row) => `<tr>
    <td>${escapeHtml(row.account)}</td><td>${escapeHtml(money(row.spend))}</td><td>${escapeHtml(count(row.purchases))}</td><td>${escapeHtml(money(row.cost_per_purchase))}</td>
    <td>${escapeHtml(money(row.raw_purchase_value))}</td><td>${escapeHtml(money(row.modelled_purchase_value))}</td><td>${escapeHtml(ratio(row.modelled_roas))}</td>
  </tr>`).join('');
}

function renderRegional() {
  const rows = state.data.region_monthly;
  const order = { South: 0, North: 1, Mid: 2 };
  const summary = regionSummary(rows)
    .filter((row) => REGION_COLORS[row.region])
    .sort((a, b) => order[a.region] - order[b.region]);
  replaceChart('regionBaseline', document.getElementById('regionBaselineChart'), {
    data: { labels: summary.map((row) => row.region), datasets: [
      { type: 'bar', label: 'Spend share', data: summary.map((row) => row.spend_share * 100), backgroundColor: summary.map((row) => `${REGION_COLORS[row.region]}bb`), borderRadius: 7, yAxisID: 'share' },
      { type: 'bar', label: 'Purchase share', data: summary.map((row) => row.purchase_share * 100), backgroundColor: summary.map((row) => `${REGION_COLORS[row.region]}55`), borderColor: summary.map((row) => REGION_COLORS[row.region]), borderWidth: 1, borderRadius: 7, yAxisID: 'share' },
      { type: 'line', label: 'Cost / reported purchase', data: summary.map((row) => row.cost_per_purchase), borderColor: COLORS.violet, backgroundColor: COLORS.violet, pointRadius: 5, yAxisID: 'cost' },
    ] },
    options: chartOptions((value) => `${value}%`, (item) => item.dataset.yAxisID === 'cost' ? `${item.dataset.label}: ${money(item.raw)}` : `${item.dataset.label}: ${item.raw.toFixed(1)}%`, {
      scales: {
        x: { grid: { display: false }, ticks: { color: COLORS.muted } },
        share: { beginAtZero: true, position: 'left', grid: { color: COLORS.grid }, ticks: { color: COLORS.muted, callback: (value) => `${value}%` } },
        cost: { beginAtZero: true, position: 'right', grid: { display: false }, ticks: { color: COLORS.muted, callback: (value) => compact.format(value) } },
      },
    }),
  });

  const regions = ['South', 'North', 'Mid'];
  const byRegion = Object.fromEntries(regions.map((region) => [region, monthlyRegionSeries(rows, region)]));
  const labels = [...new Set(rows.filter((row) => REGION_COLORS[row.region]).map((row) => row.month))].sort();
  replaceChart('regionTrend', document.getElementById('regionTrendChart'), {
    type: 'line',
    data: { labels, datasets: regions.map((region) => ({
      label: region,
      data: labels.map((month) => byRegion[region].find((row) => row.month === month)?.cost_per_purchase ?? null),
      borderColor: REGION_COLORS[region],
      backgroundColor: REGION_COLORS[region],
      borderWidth: region === 'South' ? 3 : 2,
      pointRadius: 2,
      tension: .2,
      spanGaps: true,
    })) },
    options: chartOptions((value) => compact.format(value), (item) => `${item.dataset.label}: ${money(item.raw)}`),
  });
  document.getElementById('regionDataTable').innerHTML = summary.map((row) => `<tr><td>${escapeHtml(row.region)}</td><td>${escapeHtml(percent(row.spend_share))}</td><td>${escapeHtml(percent(row.purchase_share))}</td><td>${escapeHtml(money(row.cost_per_purchase))}</td></tr>`).join('');
  document.getElementById('regionTrendDataTable').innerHTML = labels.map((month) => `<tr><td>${escapeHtml(month)}</td>${regions.map((region) => `<td>${escapeHtml(money(byRegion[region].find((row) => row.month === month)?.cost_per_purchase ?? null))}</td>`).join('')}</tr>`).join('');
}

function renderDetail(filters) {
  const detailHead = document.getElementById('detailHead');
  const detailBody = document.getElementById('detailBody');
  const caption = document.getElementById('detailCaption');
  const rows = state.data.anomalies.filter((row) => (
    row.date >= filters.from && row.date <= filters.to
    && (!filters.accounts.length || filters.accounts.includes(row.account))
  ));
  caption.textContent = `${rows.length} flagged account-days, sorted by excess tracked value`;
  detailHead.innerHTML = '<tr><th>Date</th><th>Account</th><th>Purchases</th><th>Raw value</th><th>Raw AOV</th><th>Baseline AOV</th><th>Modelled value</th><th>Excess value</th></tr>';
  detailBody.innerHTML = rows.map((row) => `<tr><td>${escapeHtml(row.date)}</td><td>${escapeHtml(row.account)}</td><td>${escapeHtml(count(row.purchases))}</td><td>${escapeHtml(money(row.raw_purchase_value))}</td><td class="cell-risk">${escapeHtml(fullMoney(row.raw_aov))}</td><td>${escapeHtml(fullMoney(row.baseline_aov))}</td><td>${escapeHtml(money(row.modelled_purchase_value))}</td><td class="cell-risk">${escapeHtml(money(row.excess_purchase_value))}</td></tr>`).join('');
}

function render() {
  const filters = normalizeCurrentFilters();
  const rows = filterDaily(state.data.account_daily, filters);
  renderKpis(rows, filters);
  renderOperating(rows, filters.grain);
  renderValue(rows, filters.grain);
  renderAccount(rows);
  renderRegional();
  renderDetail(filters);
  syncPresetState(filters);
  updateUrl(filters);
}

function setPreset(name) {
  const range = {
    all: state.data.meta.date_range,
    '2024h2': { start: '2024-07-01', end: '2024-12-31' },
    2025: { start: '2025-01-01', end: '2025-12-31' },
    '2026h1': { start: '2026-01-01', end: '2026-06-30' },
  }[name];
  document.getElementById('dateFrom').value = range.start;
  document.getElementById('dateTo').value = range.end;
  document.querySelectorAll('.preset').forEach((button) => button.classList.toggle('active', button.dataset.preset === name));
  render();
}

function exportCsv() {
  const filters = normalizeCurrentFilters();
  const rows = filterDaily(state.data.account_daily, filters);
  const keys = ['date', 'account', 'spend', 'purchases', 'landing_page_views', 'checkouts', 'raw_purchase_value', 'modelled_purchase_value', 'flagged'];
  const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const csv = [keys.join(','), ...rows.map((row) => keys.map((key) => escape(row[key])).join(','))].join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  link.download = `elm-meta-ads-${filters.from}-${filters.to}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function bindControls() {
  document.querySelectorAll('.preset').forEach((button) => button.addEventListener('click', () => setPreset(button.dataset.preset)));
  ['dateFrom', 'dateTo', 'accountFilter', 'grainFilter', 'accountMetric'].forEach((id) => document.getElementById(id).addEventListener('change', () => {
    document.querySelectorAll('.preset').forEach((button) => button.classList.remove('active'));
    render();
  }));
  document.querySelectorAll('[data-operating-metric]').forEach((button) => button.addEventListener('click', () => {
    state.operatingMetric = button.dataset.operatingMetric;
    document.querySelectorAll('[data-operating-metric]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
    render();
  }));
  document.getElementById('exportButton').addEventListener('click', exportCsv);
}

function hydrateFilters() {
  const params = new URLSearchParams(location.search);
  const range = state.data.meta.date_range;
  document.getElementById('dateFrom').min = range.start;
  document.getElementById('dateFrom').max = range.end;
  document.getElementById('dateTo').min = range.start;
  document.getElementById('dateTo').max = range.end;
  document.getElementById('dateFrom').value = params.get('from') || range.start;
  document.getElementById('dateTo').value = params.get('to') || range.end;
  document.getElementById('accountFilter').value = params.get('account') || 'all';
  document.getElementById('grainFilter').value = params.get('grain') || 'month';
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
  document.getElementById('purchaseCoverage').textContent = percent(state.data.reconciliation.regional_purchase_coverage);
  document.getElementById('valueCoverage').textContent = percent(state.data.reconciliation.regional_value_coverage);
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
