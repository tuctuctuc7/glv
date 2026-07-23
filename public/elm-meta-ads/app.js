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

function dualAxisOptions() {
  return options(
    (item) => item.dataset.yAxisID === 'roas' ? `${item.dataset.label}: ${ratio(item.raw)}` : `${item.dataset.label}: ${money(item.raw)}`,
    {
      x: { grid: { display: false }, ticks: { color: COLORS.muted, maxRotation: 0, autoSkipPadding: 20 } },
      spend: { beginAtZero: true, position: 'left', grid: { color: COLORS.grid }, ticks: { color: COLORS.muted, callback: (value) => compact.format(value) }, title: { display: true, text: 'Spend · VND', color: COLORS.muted } },
      roas: { beginAtZero: true, position: 'right', grid: { display: false }, ticks: { color: COLORS.orange, callback: (value) => `${value}x` }, title: { display: true, text: 'Directional ROAS', color: COLORS.orange } },
    },
  );
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
  replaceChart('growth', document.getElementById('growthChart'), {
    data: { labels: series.map((row) => row.label), datasets: [
      { type: 'bar', label: 'Spend', data: series.map((row) => row.spend), backgroundColor: `${COLORS.blue}99`, borderColor: COLORS.blue, borderWidth: 1, borderRadius: 6, yAxisID: 'spend' },
      { type: 'line', label: 'Directional ROAS', data: series.map((row) => row.modelled_roas), borderColor: COLORS.orange, backgroundColor: COLORS.orange, borderWidth: 3, pointRadius: 4, tension: .22, yAxisID: 'roas' },
    ] },
    options: dualAxisOptions(),
  });
  const first = series[0];
  const last = series.at(-1);
  document.getElementById('growthInsight').textContent = first && last
    ? `${first.label} → ${last.label}: spend moved ${percent((last.spend - first.spend) / first.spend)} while directional ROAS moved from ${ratio(first.modelled_roas)} to ${ratio(last.modelled_roas)}. Read that movement together with CVR and AOV below.`
    : 'No monthly rows match the selected filters.';
  document.getElementById('growthTable').innerHTML = series.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${escapeHtml(money(row.spend))}</td><td>${escapeHtml(ratio(row.modelled_roas))}</td><td>${escapeHtml(money(row.cost_per_purchase))}</td><td>${escapeHtml(percent(row.purchase_cvr))}</td><td>${escapeHtml(money(row.modelled_aov))}</td></tr>`).join('');
  return series;
}

function renderSmallLine(name, canvasId, series, key, label, color, formatter) {
  replaceChart(name, document.getElementById(canvasId), {
    type: 'line',
    data: { labels: series.map((row) => row.label), datasets: [{ label, data: series.map((row) => row[key]), borderColor: color, backgroundColor: `${color}1f`, fill: true, pointRadius: 3, borderWidth: 2.5, tension: .22 }] },
    options: options((item) => `${label}: ${formatter(item.raw)}`, { x: baseScales().x, y: { ...baseScales().y, ticks: { color: COLORS.muted, callback: (value) => formatter(value).replace(' VND', '') } } }),
  });
}

function renderEfficiency(series) {
  renderSmallLine('roas', 'roasChart', series, 'modelled_roas', 'Directional ROAS', COLORS.orange, ratio);
  renderSmallLine('cpp', 'cppChart', series, 'cost_per_purchase', 'Cost / purchase', COLORS.blue, money);
  renderSmallLine('cvr', 'cvrChart', series, 'purchase_cvr', 'Purchase CVR', COLORS.green, percent);
  renderSmallLine('aov', 'aovChart', series, 'modelled_aov', 'Directional AOV', COLORS.violet, money);
}

function accountSeries(rows, account) {
  return monthly(rows.filter((row) => row.account === account));
}

function renderAccountChart(name, canvasId, rows, account, visible) {
  const canvas = document.getElementById(canvasId);
  canvas.closest('article').hidden = !visible;
  if (!visible) { state.charts[name]?.destroy(); delete state.charts[name]; return []; }
  const series = accountSeries(rows, account);
  replaceChart(name, canvas, {
    data: { labels: series.map((row) => row.label), datasets: [
      { type: 'bar', label: 'Spend', data: series.map((row) => row.spend), backgroundColor: `${COLORS.blue}88`, borderRadius: 5, yAxisID: 'spend' },
      { type: 'line', label: 'Directional ROAS', data: series.map((row) => row.modelled_roas), borderColor: COLORS.orange, backgroundColor: COLORS.orange, borderWidth: 2.5, pointRadius: 3, tension: .2, yAxisID: 'roas' },
    ] },
    options: dualAxisOptions(),
  });
  return series;
}

function renderAccounts(rows, filters) {
  const home = renderAccountChart('homeAccount', 'homeAccountChart', rows, 'Gia Dụng', !filters.accounts.length || filters.accounts.includes('Gia Dụng'));
  const electric = renderAccountChart('electricAccount', 'electricAccountChart', rows, 'Điện gia dụng', !filters.accounts.length || filters.accounts.includes('Điện gia dụng'));
  const records = [...home.map((row) => ({ ...row, account: 'Gia Dụng' })), ...electric.map((row) => ({ ...row, account: 'Điện gia dụng' }))].sort((a, b) => a.label.localeCompare(b.label) || a.account.localeCompare(b.account));
  document.getElementById('accountMonthTable').innerHTML = records.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${escapeHtml(row.account)}</td><td>${escapeHtml(money(row.spend))}</td><td>${escapeHtml(ratio(row.modelled_roas))}</td><td>${escapeHtml(money(row.cost_per_purchase))}</td><td>${escapeHtml(percent(row.purchase_cvr))}</td><td>${escapeHtml(money(row.modelled_aov))}</td></tr>`).join('');
}

function renderDayOfMonth(rows) {
  const profile = dayOfMonthProfile(rows);
  replaceChart('dayOfMonth', document.getElementById('dayOfMonthChart'), {
    data: { labels: profile.map((row) => row.day), datasets: [
      { type: 'bar', label: 'Average spend / month', data: profile.map((row) => row.average_spend), backgroundColor: `${COLORS.blue}88`, borderRadius: 4, yAxisID: 'spend' },
      { type: 'line', label: 'Directional ROAS', data: profile.map((row) => row.modelled_roas), borderColor: COLORS.orange, backgroundColor: COLORS.orange, borderWidth: 2.5, pointRadius: 3, tension: .18, yAxisID: 'roas' },
    ] },
    options: dualAxisOptions(),
  });
  const eligible = profile.filter((row) => row.months >= 3);
  const spendPeak = eligible.reduce((best, row) => !best || row.average_spend > best.average_spend ? row : best, null);
  const roasPeak = eligible.reduce((best, row) => !best || row.modelled_roas > best.modelled_roas ? row : best, null);
  const recurringSpendDays = [...eligible].sort((a, b) => b.average_spend - a.average_spend).slice(0, 3).map((row) => row.day).join(', ');
  document.getElementById('dayOfMonthInsight').textContent = spendPeak && roasPeak
    ? `Across the selected months, the strongest recurring spend days are ${recurringSpendDays}; day ${spendPeak.day} is highest at ${money(spendPeak.average_spend)} average spend. Day ${roasPeak.day} has the highest directional ROAS (${ratio(roasPeak.modelled_roas)}). Timing alone does not identify a campaign cause.`
    : 'Select at least three months for a repeat-pattern view.';
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
  replaceChart('creative', document.getElementById('creativeChart'), {
    type: 'doughnut',
    data: { labels: summary.map((row) => row.group), datasets: [{ data: summary.map((row) => row.spend), backgroundColor: summary.map((_row, index) => PALETTE[index % PALETTE.length]), borderColor: '#111a26', borderWidth: 3 }] },
    options: { ...options((item) => `${item.label}: ${money(item.raw)} · ${percent(item.raw / summary.reduce((sum, row) => sum + row.spend, 0))}`, {}, 'nearest'), cutout: '58%' },
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

function renderRegional() {
  const rows = state.data.region_monthly;
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
  replaceChart('regionTrend', document.getElementById('regionTrendChart'), {
    type: 'line',
    data: { labels, datasets: regions.map((region) => ({ label: region, data: labels.map((month) => byRegion[region].find((row) => row.month === month)?.cost_per_click ?? null), borderColor: REGION_COLORS[region], backgroundColor: REGION_COLORS[region], borderWidth: region === 'South' ? 3 : 2, pointRadius: 2, tension: .2, spanGaps: true })) },
    options: options((item) => `${item.dataset.label}: ${money(item.raw)}`, { x: baseScales().x, y: { ...baseScales().y, ticks: { color: COLORS.muted, callback: (value) => compact.format(value) } } }),
  });
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
  renderLeverBoard(filters);
  renderCampaigns(filters);
  renderCreatives(filters);
  renderRegional();
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
  ['dateFrom', 'dateTo', 'accountFilter'].forEach((id) => document.getElementById(id).addEventListener('change', render));
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
