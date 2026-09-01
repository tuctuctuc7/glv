const METRIC_CONFIG = {
  none: { label: 'None', type: 'count', color: 'transparent', description: 'No metric selected.' },
  revenue: { label: 'Revenue', type: 'money', color: 'var(--accent)', description: 'Total recorded business revenue.' },
  roas: { label: 'ROAS', type: 'ratio', color: 'var(--cyan)', description: 'Total recorded revenue divided by total recorded spend.' },
  spend: { label: 'Spend', type: 'money', color: 'var(--blue)', description: 'Total recorded marketing spend.' },
  purchases: { label: 'Purchases', type: 'count', color: 'var(--purple)', description: 'Total recorded purchases.' },
  cpa: { label: 'Cost per purchase', type: 'money', color: 'var(--blue)', description: 'Spend divided by purchases; lower is generally more efficient.' },
  aov: { label: 'AOV', type: 'money', color: 'var(--purple)', description: 'Revenue divided by purchases.' },
  cvr: { label: 'CVR', type: 'percent', color: 'var(--cyan)', description: 'Purchases divided by summed market-day unique visitors.' },
  unique_visitors: { label: 'Visitors', type: 'count', color: 'var(--accent)', description: 'Summed market-day unique visitors; visitors can repeat across dates or markets.' },
  new_customer_revenue: { label: 'New customer revenue', type: 'money', color: 'var(--blue)', description: 'Revenue recorded from new customers.' },
  new_customer_rate: { label: 'New customer rate', type: 'percent', color: 'var(--purple)', description: 'New customers divided by new plus returning customers after aggregation.' },
};

const REGION_CONFIG = {
  czsk: { label: 'CZSK', role: 'Core performance market', color: 'var(--accent)' },
  us: { label: 'US', role: 'Growth & validation market', color: 'var(--blue)' },
  row: { label: 'ROW', role: 'Long-tail demand', color: 'var(--purple)' },
};

const state = {
  data: null,
  historicalData: null,
  chart: null,
  selectedRegions: ['czsk', 'us', 'row'],
  loadAttempts: 0,
};

const $ = (id) => document.getElementById(id);
const metrics = window.GlvMetrics;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function compactNumber(value, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const number = Number(value);
  const magnitude = Math.abs(number);
  if (magnitude >= 1_000_000) return `${(number / 1_000_000).toFixed(digits)}M`;
  if (magnitude >= 1_000) return `${(number / 1_000).toFixed(digits)}K`;
  return number.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function formatMetric(key, value, compact = false) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const config = METRIC_CONFIG[key] || { type: 'count' };
  const number = Number(value);
  if (config.type === 'money') {
    return compact
      ? `$${compactNumber(number, Math.abs(number) >= 1000 ? 1 : 0)}`
      : number.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
  }
  if (config.type === 'percent') return `${(number * 100).toFixed(2)}%`;
  if (config.type === 'ratio') return `${number.toFixed(2)}x`;
  return compact ? compactNumber(number) : number.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function formatDelta(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'No baseline';
  const sign = value > 0.0005 ? '+' : value < -0.0005 ? '−' : '';
  return `${sign}${Math.abs(value * 100).toFixed(1)}%`;
}

function formatSignedMoney(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : '−'}${formatMetric('revenue', Math.abs(value), true)}`;
}

function formatDate(dateString, options = { month: 'short', day: 'numeric', year: 'numeric' }) {
  if (!dateString) return '—';
  const date = new Date(`${dateString}T00:00:00Z`);
  return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(date);
}

function selectedRegionLabel() {
  if (state.selectedRegions.length === 3) return 'All markets';
  return state.selectedRegions.map((region) => REGION_CONFIG[region].label).join(' + ');
}

function currentFilters() {
  return {
    from: $('dateFrom').value,
    to: $('dateTo').value,
    regions: state.selectedRegions,
  };
}

function historicalContext(view, grain) {
  const coverage = state.historicalData?.coverage;
  const intersects = Boolean(coverage && view.filters.from <= coverage.end && view.filters.to >= coverage.start);
  const eligibleGrain = ['month', 'year'].includes(grain);
  const includesCzsk = state.selectedRegions.includes('czsk');
  if (!intersects || !eligibleGrain || !includesCzsk) return { rows: [], intersects, eligibleGrain, includesCzsk };

  const workingMonths = new Set(view.currentRows
    .filter((row) => row.region === 'czsk')
    .map((row) => row.date.slice(0, 7)));
  const rows = state.historicalData.rows.filter((row) => (
    row.period_start >= view.filters.from
    && row.period_end <= view.filters.to
    && !workingMonths.has(row.period_start.slice(0, 7))
  ));
  return { rows, intersects, eligibleGrain, includesCzsk };
}

function rowsForGrain(view, grain) {
  const history = historicalContext(view, grain);
  return { history, rows: [...history.rows, ...view.currentRows] };
}

function renderHistoricalNote(id, context) {
  const note = $(id);
  if (!context.intersects) {
    const historyIsAvailable = Boolean(state.historicalData && context.eligibleGrain && context.includesCzsk);
    note.hidden = !historyIsAvailable;
    note.textContent = historyIsAvailable
      ? '2025 CZSK history is outside the selected dates. Choose All available data to include it.'
      : '';
    return;
  }
  note.hidden = false;
  if (!context.eligibleGrain) {
    note.textContent = '2025 history is monthly and is excluded at Day and Week grain; this view uses only the working source.';
  } else if (!context.includesCzsk) {
    note.textContent = '2025 history contains CZSK only and is excluded because selected markets do not include CZSK. Choose CZSK or All markets to include it.';
  } else if (!context.rows.length) {
    note.textContent = 'No complete 2025 month is contained by the selected date range.';
  } else {
    note.textContent = 'Includes the static 2025 CZSK monthly snapshot; US and ROW had no activity in 2025. Revenue and spend are converted from kCZK to USD with ECB monthly reference rates; Visitors, CVR, and New customer revenue are unavailable for 2025.';
  }
}

function getViewData() {
  const filters = currentFilters();
  const currentRows = metrics.filterRows(state.data.rows, filters);
  const previousBounds = metrics.previousPeriodBounds(filters.from, filters.to);
  const previousRows = $('comparisonToggle').checked
    ? metrics.filterRows(state.data.rows, { ...previousBounds, regions: state.selectedRegions })
    : [];
  const comparison = metrics.comparePeriods(currentRows, previousRows);
  if (!previousRows.length || !$('comparisonToggle').checked) {
    comparison.previous = null;
    Object.keys(comparison.changes).forEach((key) => { comparison.changes[key] = null; });
  }
  return { filters, currentRows, previousRows, previousBounds, comparison };
}

function applyPreset(preset) {
  if (!state.data || preset === 'custom') return;
  if (preset === 'all') {
    $('dateFrom').value = state.historicalData?.coverage?.start || state.data.date_range.start;
    $('dateTo').value = state.data.date_range.end;
    $('grain').value = 'month';
    $('auditGrain').value = 'month';
    return;
  }
  const bounds = metrics.presetBounds(preset, state.data.date_range.end);
  $('dateFrom').value = bounds.from;
  $('dateTo').value = bounds.to;
}

function syncUrl() {
  const params = new URLSearchParams();
  params.set('period', $('periodPreset').value);
  params.set('from', $('dateFrom').value);
  params.set('to', $('dateTo').value);
  if (state.selectedRegions.length < 3) params.set('markets', state.selectedRegions.join(','));
  params.set('compare', $('comparisonToggle').checked ? '1' : '0');
  params.set('metric', $('trendMetric').value);
  params.set('metric2', $('trendMetricSecondary').value);
  params.set('grain', $('grain').value);
  params.set('auditGrain', $('auditGrain').value);
  const query = params.toString();
  try {
    window.history.replaceState(null, '', `${window.location.pathname}?${query}${window.location.hash}`);
  } catch (error) {
    // Some local file viewers do not allow history state updates.
  }
}

function restoreUrlState() {
  const params = new URLSearchParams(window.location.search);
  const preset = params.get('period');
  const presetIsValid = Boolean(preset && [...$('periodPreset').options].some((option) => option.value === preset));
  if (presetIsValid) {
    $('periodPreset').value = preset;
  }
  const activePreset = $('periodPreset').value;
  applyPreset(activePreset);

  const from = params.get('from');
  const to = params.get('to');
  if (from && to && (activePreset === 'custom' || !presetIsValid)) {
    $('dateFrom').value = from;
    $('dateTo').value = to;
    $('periodPreset').value = 'custom';
  }

  const markets = (params.get('markets') || '').split(',').filter((region) => REGION_CONFIG[region]);
  if (markets.length) state.selectedRegions = [...new Set(markets)];
  $('comparisonToggle').checked = params.get('compare') !== '0';

  const metric = params.get('metric');
  if (metric && [...$('trendMetric').options].some((option) => option.value === metric)) $('trendMetric').value = metric;
  const secondaryMetric = params.get('metric2');
  if (secondaryMetric && [...$('trendMetricSecondary').options].some((option) => option.value === secondaryMetric)) $('trendMetricSecondary').value = secondaryMetric;
  const grain = params.get('grain');
  if (['day', 'week', 'month', 'year'].includes(grain)) $('grain').value = grain;
  const auditGrain = params.get('auditGrain');
  if (['day', 'week', 'month', 'year'].includes(auditGrain)) $('auditGrain').value = auditGrain;
  if (activePreset === 'all') {
    $('grain').value = 'month';
    $('auditGrain').value = 'month';
  }
  refreshRegionButtons();
}

function refreshRegionButtons() {
  const allSelected = state.selectedRegions.length === 3;
  document.querySelectorAll('.region-buttons button').forEach((button) => {
    const region = button.dataset.region;
    const pressed = region === 'all' ? allSelected : !allSelected && state.selectedRegions.includes(region);
    button.setAttribute('aria-pressed', String(pressed));
  });
}

function createSparkline(rows, key, color) {
  const grouped = metrics.groupRows(rows, 'day');
  const values = grouped.map((row) => metrics.metricValue(row, key)).filter((value) => value !== null && Number.isFinite(value));
  if (values.length < 2) return element('span', 'kpi-context-text', 'Not enough points');

  const width = 78;
  const height = 28;
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = maximum - minimum || 1;
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - 2 - ((value - minimum) / range) * (height - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'sparkline');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.style.setProperty('--metric-color', color);
  const glow = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  glow.setAttribute('points', points);
  glow.setAttribute('class', 'spark-area');
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  line.setAttribute('points', points);
  svg.append(glow, line);
  return svg;
}

function renderKpiCard(key, view) {
  const config = METRIC_CONFIG[key];
  const hasWorkingRows = view.currentRows.length > 0;
  const value = hasWorkingRows ? view.comparison.current[key] : null;
  const previous = hasWorkingRows ? view.comparison.previous?.[key] : null;
  const change = hasWorkingRows ? view.comparison.changes[key] : null;
  const card = element('article', 'kpi-card');
  card.dataset.metric = key;
  card.style.setProperty('--metric-color', config.color);

  const top = element('div', 'kpi-topline');
  const label = element('span', 'kpi-label', config.label);
  const info = element('span', 'metric-info', 'i');
  info.title = config.description;
  info.setAttribute('aria-label', config.description);
  top.append(label, info);

  const valueRow = element('div', 'kpi-value-row');
  valueRow.appendChild(element('strong', 'kpi-value', formatMetric(key, value, true)));
  const delta = element('span', 'kpi-delta', $('comparisonToggle').checked ? formatDelta(change) : 'Snapshot');
  delta.dataset.signal = 'neutral';
  if (change !== null && change !== undefined) delta.setAttribute('aria-label', `${formatDelta(change)} versus previous period; movement only, not a target verdict`);
  valueRow.appendChild(delta);

  const context = element('div', 'kpi-context');
  const baseline = view.comparison.previous
    ? `Previous ${formatMetric(key, previous, true)}`
    : 'No valid previous baseline';
  const baselines = element('div', 'kpi-baselines');
  baselines.append(element('span', 'kpi-context-text', baseline));
  context.append(baselines, createSparkline(view.currentRows, key, config.color));
  card.append(top, valueRow, context);
  return card;
}

function renderKpis(view) {
  const container = $('executiveKpis');
  clear(container);
  ['revenue', 'spend', 'purchases', 'new_customer_rate', 'cvr', 'aov', 'cpa', 'roas']
    .forEach((key) => container.appendChild(renderKpiCard(key, view)));
  const intersectsHistory = Boolean(state.historicalData
    && view.filters.from <= state.historicalData.coverage.end
    && view.filters.to >= state.historicalData.coverage.start);
  $('comparisonLabel').textContent = intersectsHistory
    ? 'Scorecards use the working source; 2025 static history appears only in Month/Year chart and Audit Trail'
    : view.comparison.previous
      ? `${formatDate(view.previousBounds.from)} – ${formatDate(view.previousBounds.to)} · historical comparison`
      : view.currentRows.length ? 'No valid previous-period baseline' : 'Working source has no rows for this period';
}

function renderExecutiveStrip(view, regions, actions) {
  const largest = strongestRegionalMovement(regions);
  $('companyMovement').textContent = `Revenue ${formatDelta(view.comparison.changes.revenue)} · spend ${formatDelta(view.comparison.changes.spend)}`;
  $('largestContributor').textContent = largest
    ? `${REGION_CONFIG[largest.region].label} · ${formatSignedMoney(largest.absoluteRevenueChange)}`
    : 'Previous-period bridge unavailable';
  $('attentionSummary').textContent = `${actions.length} ranked ${actions.length === 1 ? 'exception' : 'exceptions'} · ${actions[0]?.market || 'monitor'}`;
}

function regionComparisons(view) {
  return state.selectedRegions.map((region) => {
    const currentRows = view.currentRows.filter((row) => row.region === region);
    const previousRows = view.previousRows.filter((row) => row.region === region);
    const comparison = metrics.comparePeriods(currentRows, previousRows);
    const overall = view.comparison.current;
    return {
      region,
      ...comparison.current,
      previous: comparison.previous,
      changes: previousRows.length ? comparison.changes : {},
      revenueShare: overall.revenue ? comparison.current.revenue / overall.revenue : null,
      absoluteRevenueChange: previousRows.length ? comparison.current.revenue - comparison.previous.revenue : null,
    };
  });
}

function strongestRegionalMovement(regions) {
  return regions
    .filter((region) => region.absoluteRevenueChange !== null)
    .sort((a, b) => Math.abs(b.absoluteRevenueChange) - Math.abs(a.absoluteRevenueChange))[0] || null;
}

function renderDecision(view, regions) {
  const overallDecision = metrics.decisionGate(view.comparison.current, view.comparison.previous, {
    targetsConfigured: false,
    attributedRevenue: false,
    marginAvailable: false,
  });
  const czsk = regions.find((region) => region.region === 'czsk');
  const us = regions.find((region) => region.region === 'us');
  const row = regions.find((region) => region.region === 'row');
  let title = `${overallDecision.action} — ${overallDecision.issue}`;
  let summary = overallDecision.reason;

  if (czsk && czsk.changes.unique_visitors <= -0.1 && czsk.changes.revenue < 0) {
    title = 'RECONCILE CZSK REVENUE LOSS';
    summary = `CZSK visitors moved ${formatDelta(czsk.changes.unique_visitors)}, revenue ${formatDelta(czsk.changes.revenue)}, purchases ${formatDelta(czsk.changes.purchases)}, and CVR ${formatDelta(czsk.changes.cvr)}. Traffic is the largest observed movement, not a proven cause: reconcile source volume, offer/creative and landing-page mix, CVR, AOV/SKU/discount mix, and tracking before changing conversion mechanics or budget.`;
  } else if (state.selectedRegions.length === 1 && us) {
    title = 'HOLD US — VALIDATE ECONOMICS BEFORE SCALING';
    summary = `US relative coverage improved, but ${formatMetric('spend', us.spend, true)} recorded spend produced ${formatMetric('revenue', us.revenue, true)} revenue (${formatMetric('roas', us.roas)}) at ${formatMetric('cpa', us.cpa)} per purchase. Profitability, new-customer share, LTV, refunds, and attribution remain unknown.`;
  } else if (state.selectedRegions.length === 1 && row) {
    title = 'INVESTIGATE ROW SPEND CLASSIFICATION';
    summary = `ROW records ${formatMetric('revenue', row.revenue, true)} revenue and ${formatMetric('purchases', row.purchases, true)} purchases with zero recorded spend. Classify this as organic demand, unallocated spend, or a tracking issue before evaluating efficiency.`;
  }

  $('decisionTitle').textContent = title;
  $('decisionSummary').textContent = summary;
  $('decisionStatus').textContent = overallDecision.capitalAuthorized ? 'Action eligible' : 'Capital blocked';
  $('decisionStatus').dataset.tone = overallDecision.capitalAuthorized ? 'positive' : 'warning';
  $('capitalInstruction').textContent = 'No budget change authorized';
  $('decisionGuardrail').textContent = 'Attributed margin + approved target';
  $('reviewWindow').textContent = 'Pull evidence within 7 days';
  $('decisionConfidence').textContent = 'Medium on movement · blocked on economics';
  return overallDecision;
}

function qualityColor(key) {
  if (['efficient-growth', 'efficiency-gain', 'disciplined-contraction'].includes(key)) return 'var(--positive)';
  if (['growth-at-a-cost', 'contraction-risk', 'efficiency-drift'].includes(key)) return 'var(--negative)';
  return 'var(--warning)';
}

function changeBar(label, value, color) {
  const row = element('div', 'quality-row');
  const head = element('div', 'quality-row-head');
  head.append(element('span', '', label), element('strong', '', formatDelta(value)));
  const track = element('div', 'quality-track');
  const fill = element('div', 'quality-fill');
  fill.style.setProperty('--bar-color', color);
  fill.style.width = `${Math.min(100, Math.max(2, Math.abs(value || 0) * 200))}%`;
  track.appendChild(fill);
  row.append(head, track);
  return row;
}

function renderEconomicsConfidence(view) {
  const container = $('growthQualityContent');
  clear(container);
  const rows = [
    ['Observed purchase economics', 'Available', `Recorded ${formatMetric('revenue', view.comparison.current.revenue, true)} revenue, ${formatMetric('spend', view.comparison.current.spend, true)} spend, and ${formatMetric('cpa', view.comparison.current.cpa)} per purchase.`],
    ['Attributed paid efficiency', 'Unavailable', 'Revenue attribution scope and channel/campaign lineage are not supplied.'],
    ['Profitability / allowable acquisition cost', 'Unavailable', 'Requires contribution margin, refunds, customer status, LTV, and approved targets.'],
  ];
  rows.forEach(([label, status, copy]) => {
    const item = element('div', 'confidence-row');
    const head = element('div', 'confidence-head');
    head.append(element('strong', '', label), element('span', `confidence-status ${status === 'Available' ? 'available' : 'unavailable'}`, status));
    item.append(head, element('p', '', copy));
    container.appendChild(item);
  });
  const note = element('p', 'quality-note', `Observed movement only: revenue ${formatDelta(view.comparison.changes.revenue)}, spend ${formatDelta(view.comparison.changes.spend)}, ROAS ${formatDelta(view.comparison.changes.roas)}. This does not authorize scaling.`);
  note.style.setProperty('--quality-color', 'var(--warning)');
  container.appendChild(note);
}

function renderRegional(regions) {
  const container = $('regionalCards');
  clear(container);
  regions.forEach((data) => {
    const config = REGION_CONFIG[data.region];
    const card = element('article', 'region-card');
    card.style.setProperty('--region-color', config.color);
    const head = element('div', 'region-card-head');
    const name = element('div', 'region-name');
    const dot = element('span', 'market-dot');
    dot.style.background = config.color;
    name.append(dot, element('span', '', config.label));
    head.append(name, element('span', 'region-role', config.role));

    const primary = element('div', 'region-primary');
    primary.append(element('strong', 'region-revenue', formatMetric('revenue', data.revenue, true)));
    const delta = element('span', 'kpi-delta', formatDelta(data.changes.revenue));
    delta.dataset.signal = 'neutral';
    delta.setAttribute('aria-label', `${formatDelta(data.changes.revenue)} versus previous period; movement only, not a target verdict`);
    primary.appendChild(delta);

    const metricRow = element('div', 'region-metrics');
    [
      ['ROAS', 'roas'],
      ['Spend', 'spend'],
      ['Purchases', 'purchases'],
      ['Cost / purchase', 'cpa'],
      ['AOV', 'aov'],
      ['Visitors', 'unique_visitors'],
      ['CVR', 'cvr'],
    ].forEach(([label, key]) => {
      const metric = element('div', 'region-metric');
      metric.append(
        element('span', '', `${label} · ${formatDelta(data.changes[key])}`),
        element('strong', '', formatMetric(key, data[key], true)),
      );
      metricRow.appendChild(metric);
    });

    card.append(head, primary, metricRow);
    if (regions.length > 1) {
      const share = element('div', 'region-share');
      const shareLabel = element('div', 'region-share-label');
      shareLabel.append(element('span', '', 'Revenue share'), element('span', '', `${Math.round((data.revenueShare || 0) * 100)}%`));
      const track = element('div', 'share-track');
      const fill = element('div', 'share-fill');
      fill.style.width = `${Math.max(0, Math.min(100, (data.revenueShare || 0) * 100))}%`;
      track.appendChild(fill);
      share.append(shareLabel, track);
      card.appendChild(share);
    }
    container.appendChild(card);
  });
}

function appendCells(row, values) {
  values.forEach((value) => row.appendChild(element('td', '', value)));
}

function renderMarketComparison(regions) {
  const body = $('marketComparisonBody');
  clear(body);
  $('marketComparisonTitle').textContent = regions.length === 3
    ? 'CZSK, US & ROW'
    : `${regions.map((data) => REGION_CONFIG[data.region].label).join(' + ')} market`;
  regions.forEach((data) => {
    const row = document.createElement('tr');
    appendCells(row, [
      REGION_CONFIG[data.region].label,
      formatMetric('revenue', data.revenue, true),
      data.revenueShare === null ? '—' : `${(data.revenueShare * 100).toFixed(1)}%`,
      formatDelta(data.changes.revenue),
      formatMetric('spend', data.spend, true),
      formatMetric('purchases', data.purchases, true),
      formatMetric('cpa', data.cpa),
      formatMetric('aov', data.aov),
      formatMetric('cvr', data.cvr),
      formatMetric('roas', data.roas),
    ]);
    row.firstChild.dataset.market = data.region;
    body.appendChild(row);
  });
  const totals = regions.reduce((result, region) => {
    ['revenue', 'spend', 'purchases', 'unique_visitors'].forEach((key) => { result[key] += region[key] || 0; });
    ['revenue', 'spend'].forEach((key) => { result.previous[key] += region.previous?.[key] || 0; });
    return result;
  }, { revenue: 0, spend: 0, purchases: 0, unique_visitors: 0, previous: { revenue: 0, spend: 0 } });
  const totalRow = document.createElement('tr');
  totalRow.className = 'market-total-row';
  appendCells(totalRow, [
    'Total',
    formatMetric('revenue', totals.revenue, true),
    totals.revenue ? '100.0%' : '—',
    formatDelta(metrics.percentageChange(totals.revenue, totals.previous.revenue)),
    formatMetric('spend', totals.spend, true),
    formatMetric('purchases', totals.purchases, true),
    formatMetric('cpa', totals.purchases ? totals.spend / totals.purchases : null),
    formatMetric('aov', totals.purchases ? totals.revenue / totals.purchases : null),
    formatMetric('cvr', totals.unique_visitors ? totals.purchases / totals.unique_visitors : null),
    formatMetric('roas', totals.spend ? totals.revenue / totals.spend : null),
  ]);
  body.appendChild(totalRow);
}

function contributionRow(label, value, maximum, color) {
  const row = element('div', 'contribution-row');
  const head = element('div', 'contribution-head');
  head.append(element('span', '', label), element('strong', '', formatSignedMoney(value)));
  const track = element('div', 'contribution-track');
  const zero = element('i', 'contribution-zero');
  const bar = element('i', `contribution-bar ${value < 0 ? 'is-negative' : 'is-positive'}`);
  bar.style.width = `${Math.max(2, (Math.abs(value) / (maximum || 1)) * 48)}%`;
  bar.style.setProperty('--contribution-color', color);
  track.append(zero, bar);
  row.append(head, track);
  return row;
}

function renderContribution(view, regions) {
  const container = $('contributionContent');
  clear(container);
  const marketValues = regions.map((region) => region.absoluteRevenueChange).filter((value) => value !== null);
  const bridge = metrics.revenueBridge(view.comparison.current, view.comparison.previous);
  const driverValues = [bridge.purchaseEffect, bridge.aovEffect].filter((value) => value !== null);
  const maximum = Math.max(1, ...marketValues.map(Math.abs), ...driverValues.map(Math.abs));

  const marketGroup = element('div', 'contribution-group');
  marketGroup.appendChild(element('span', 'contribution-label', 'By market'));
  regions.forEach((region) => {
    if (region.absoluteRevenueChange === null) return;
    marketGroup.appendChild(contributionRow(REGION_CONFIG[region.region].label, region.absoluteRevenueChange, maximum, REGION_CONFIG[region.region].color));
  });

  const driverGroup = element('div', 'contribution-group');
  driverGroup.appendChild(element('span', 'contribution-label', 'By observed driver'));
  if (bridge.purchaseEffect === null) {
    driverGroup.appendChild(element('p', 'reserved-copy', 'Driver bridge requires a valid previous-period AOV and purchase baseline.'));
  } else {
    driverGroup.append(
      contributionRow('Purchase volume', bridge.purchaseEffect, maximum, 'var(--blue)'),
      contributionRow('AOV / mix', bridge.aovEffect, maximum, 'var(--purple)'),
    );
  }
  container.append(marketGroup, driverGroup);
}

function renderFunnel(view) {
  const container = $('funnelContent');
  clear(container);
  [
    ['Visitors', formatMetric('unique_visitors', view.comparison.current.unique_visitors, true), 'available'],
    ['Landing / product session', 'Not connected', 'reserved'],
    ['Checkout', 'Not connected', 'reserved'],
    ['Purchases', formatMetric('purchases', view.comparison.current.purchases, true), 'available'],
  ].forEach(([label, value, status], index) => {
    const stage = element('div', `funnel-stage ${status}`);
    stage.append(element('span', 'funnel-index', String(index + 1).padStart(2, '0')), element('strong', '', value), element('span', '', label));
    container.appendChild(stage);
  });
}

function buildActions(view, regions) {
  const actions = [];
  const czsk = regions.find((region) => region.region === 'czsk');
  const us = regions.find((region) => region.region === 'us');
  const row = regions.find((region) => region.region === 'row');
  const dueDate = metrics.shiftDays(view.filters.to, 7);

  if (czsk && czsk.changes.unique_visitors <= -0.1 && czsk.changes.revenue < 0) actions.push({
    action: 'INVESTIGATE', market: 'CZSK', metric: 'Revenue', metricKey: 'revenue', current: czsk.revenue, change: czsk.changes.revenue, confidence: 'Medium', title: 'Reconcile the CZSK revenue loss',
    exposure: Math.abs(czsk.absoluteRevenueChange || 0),
    evidence: `Visitors ${formatDelta(czsk.changes.unique_visitors)}, revenue ${formatDelta(czsk.changes.revenue)}, purchases ${formatDelta(czsk.changes.purchases)}, CVR ${formatDelta(czsk.changes.cvr)}.${regions.length > 1 ? ` CZSK represents ${Math.round((czsk.revenueShare || 0) * 100)}% of selected revenue.` : ''}`,
    nextData: 'Source/channel → landing page → device → new/returning traffic; campaign/creative/offer; SKU, discount and AOV mix; tracking-change log.',
    query: 'Reconcile source sessions to landing-page visits and orders; then split the revenue gap into traffic, CVR and AOV/mix effects.',
    guardrail: 'Protect current purchase efficiency; no conversion or budget change until the volume loss is explained.', review: 'Owner: Growth + Analytics · within 7 days',
    dri: 'Growth lead', due: dueDate, status: 'OPEN · EVIDENCE NOT CONNECTED',
    doneWhen: 'Source-to-order totals reconcile and the revenue gap is assigned to traffic, CVR, AOV/mix, or tracking with evidence.',
  });
  if (us && (us.roas === null || us.roas < 1 || us.changes.revenue > 0.2 || us.changes.spend > 0.2)) actions.push({
    action: 'HOLD', market: 'US', metric: 'ROAS', metricKey: 'roas', current: us.roas, change: us.changes.roas, confidence: 'Low', title: 'Validate US economics before scaling',
    exposure: Math.max(0, us.spend - us.revenue),
    evidence: `${formatMetric('spend', us.spend, true)} spend, ${formatMetric('revenue', us.revenue, true)} revenue, ${formatMetric('purchases', us.purchases, true)} purchases, ${formatMetric('cpa', us.cpa)} cost/purchase, ${formatMetric('aov', us.aov)} AOV, ${formatMetric('roas', us.roas)} ROAS.`,
    nextData: 'Attributed revenue, contribution margin, refunds, new-customer share, allowable acquisition cost, and LTV.',
    query: 'Reconcile platform spend to attributed new-customer orders by approved window; calculate contribution per order, payback and cohort LTV.',
    guardrail: 'No scale or cross-market reallocation authorization from blended relative improvement.', review: 'Owner: Finance + Growth · before next budget change',
    dri: 'Finance lead', due: dueDate, status: 'OPEN · ECONOMICS NOT CONNECTED',
    doneWhen: 'Attributed contribution, new-customer cost and payback reconcile to finance totals and approved scale guardrails are recorded.',
  });
  if (row && row.spend === 0 && (row.revenue > 0 || row.purchases > 0)) actions.push({
    action: 'INVESTIGATE', market: 'ROW', metric: 'Spend coverage', metricKey: 'spend', current: row.spend, change: null, confidence: 'Medium', title: 'Classify ROW demand and spend coverage',
    exposure: row.revenue,
    evidence: `${formatMetric('revenue', row.revenue, true)} revenue and ${formatMetric('purchases', row.purchases, true)} purchases on ${formatMetric('spend', row.spend, true)} recorded spend; visitors ${formatDelta(row.changes.unique_visitors)}, CVR ${formatDelta(row.changes.cvr)}.`,
    nextData: 'Traffic source, channel spend allocation, order geography, attribution export, and tracking reconciliation.',
    query: 'Tie every ROW order to order geography and traffic source; reconcile paid invoices and platform spend before classifying demand.',
    guardrail: 'Do not label this an efficiency win while recorded spend is zero.', review: 'Owner: Analytics · within 7 days',
    dri: 'Analytics lead', due: dueDate, status: 'OPEN · SPEND UNCLASSIFIED',
    doneWhen: 'Every ROW order is classified as organic, paid with allocated spend, or a documented tracking exception.',
  });

  if (!actions.length) {
    const movement = strongestRegionalMovement(regions);
    if (movement) actions.push({
      action: 'MONITOR', market: REGION_CONFIG[movement.region].label, metric: 'Revenue', metricKey: 'revenue', current: movement.revenue, change: movement.changes.revenue, confidence: 'Medium', title: 'Validate the largest regional movement',
      exposure: Math.abs(movement.absoluteRevenueChange || 0),
      evidence: `${REGION_CONFIG[movement.region].label} has the largest absolute recorded revenue movement at ${formatSignedMoney(movement.absoluteRevenueChange)} versus the previous period.`,
      nextData: 'Source/channel, offer calendar, product mix, tracking changes and approved operating targets.',
      query: 'Reconcile the regional revenue movement to traffic, CVR and AOV/mix before changing capital.',
      guardrail: 'Monitor only; relative movement without approved economics is not a capital signal.', review: 'Owner: Analytics · within 7 days',
      dri: 'Analytics lead', due: dueDate, status: 'OPEN · VALIDATION REQUIRED',
      doneWhen: 'The movement is reconciled to governed source data and compared with an approved target or guardrail.',
    });
  }

  return actions
    .sort((a, b) => b.exposure - a.exposure)
    .slice(0, 3)
    .map((action, index) => ({ ...action, priority: `P${index + 1}` }));
}

function renderExceptions(view, regions) {
  const actions = buildActions(view, regions);
  const body = $('exceptionTableBody');
  clear(body);
  $('exceptionCount').textContent = `${actions.length} open`;
  actions.forEach((signal, index) => {
    const row = document.createElement('tr');
    row.className = 'exception-row';
    const severityCell = document.createElement('td');
    const toggle = element('button', 'exception-toggle', `${signal.priority} · ${signal.action}`);
    const detailId = `exception-detail-${index}`;
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', detailId);
    severityCell.appendChild(toggle);
    row.appendChild(severityCell);
    appendCells(row, [
      signal.market,
      signal.metric,
      formatMetric(signal.metricKey, signal.current, true),
      formatDelta(signal.change),
      signal.exposure ? formatMetric('revenue', signal.exposure, true) : 'Movement only',
      signal.confidence,
      'Open',
    ]);

    const detail = document.createElement('tr');
    detail.id = detailId;
    detail.className = 'exception-detail';
    detail.hidden = true;
    const cell = document.createElement('td');
    cell.colSpan = 8;
    const panel = element('div', 'exception-drilldown');
    panel.append(element('h3', '', signal.title));
    const meta = element('dl', 'exception-meta');
    [
      ['Why it is here', signal.evidence],
      ['Owner / due', `${signal.dri} · ${formatDate(signal.due)}`],
      ['Evidence query', signal.query],
      ['Data limitation', signal.nextData],
      ['Recommended investigation', signal.doneWhen],
      ['Guardrail', signal.guardrail],
    ].forEach(([label, value]) => {
      const item = element('div');
      item.append(element('dt', '', label), element('dd', '', value));
      meta.appendChild(item);
    });
    panel.appendChild(meta);
    cell.appendChild(panel);
    detail.appendChild(cell);
    toggle.addEventListener('click', () => {
      const open = detail.hidden;
      detail.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
    });
    body.append(row, detail);
  });
  return actions;
}

function signalItem(signal) {
  const item = element('article', 'signal-item');
  item.dataset.level = 'warning';
  const top = element('div', 'signal-topline');
  top.append(element('span', 'signal-severity', `${signal.priority} · ${signal.action}`), element('span', 'signal-metric', signal.metric));
  const meta = element('dl', 'action-meta');
  [
    ['Dollar exposure', signal.exposure ? formatMetric('revenue', signal.exposure, true) : 'Movement only'],
    ['DRI / due', `${signal.dri} · ${formatDate(signal.due)}`],
    ['Status', signal.status],
    ['Evidence query', signal.query],
    ['Next dataset', signal.nextData],
    ['Done when', signal.doneWhen],
    ['Guardrail', signal.guardrail],
  ].forEach(([label, value]) => {
    const row = element('div');
    row.append(element('dt', '', label), element('dd', '', value));
    meta.appendChild(row);
  });
  item.append(top, element('h3', '', signal.title), element('p', 'action-evidence', signal.evidence), meta);
  return item;
}

function renderSignals(view, regions) {
  const signals = buildActions(view, regions);
  const container = $('signalList');
  clear(container);
  $('signalCount').textContent = `${signals.length} ${signals.length === 1 ? 'action' : 'actions'}`;
  if (!signals.length) return;
  container.appendChild(signalItem(signals[0]));
  if (signals.length > 1) {
    if (window.matchMedia('(min-width: 961px)').matches) {
      signals.slice(1).forEach((signal) => container.appendChild(signalItem(signal)));
      return;
    }
    const more = element('details', 'signal-more');
    const summary = element('summary', '', `Show ${signals.length - 1} more commissioned ${signals.length === 2 ? 'investigation' : 'investigations'}`);
    const body = element('div', 'signal-more-body');
    signals.slice(1).forEach((signal) => body.appendChild(signalItem(signal)));
    more.append(summary, body);
    container.appendChild(more);
  }
}

function chartColors() {
  const style = getComputedStyle(document.documentElement);
  return {
    primary: style.getPropertyValue('--accent').trim(),
    text: style.getPropertyValue('--text-tertiary').trim(),
    grid: style.getPropertyValue('--border').trim(),
    comparison: style.getPropertyValue('--text-tertiary').trim(),
    rolling: style.getPropertyValue('--cyan').trim(),
    surface: style.getPropertyValue('--surface').trim(),
  };
}

function renderChart(view) {
  const key = $('trendMetric').value;
  const secondaryKey = $('trendMetricSecondary').value;
  const grain = $('grain').value;
  const combined = rowsForGrain(view, grain);
  const current = metrics.groupRows(combined.rows, grain);
  const colors = chartColors();
  const canvas = $('trendChart');
  const fallback = $('chartFallback');

  if (state.chart) {
    state.chart.destroy();
    state.chart = null;
  }

  const currentValues = key === 'none' ? [] : current.map((row) => metrics.metricValue(row, key));
  const secondaryValues = secondaryKey === 'none' ? [] : current.map((row) => metrics.metricValue(row, secondaryKey));
  const validValues = currentValues.filter((value) => value !== null);
  const validSecondaryValues = secondaryValues.filter((value) => value !== null);
  const primaryRange = validValues.length ? `${formatMetric(key, Math.min(...validValues))} to ${formatMetric(key, Math.max(...validValues))}` : 'no finite values';
  const secondaryRange = validSecondaryValues.length ? `${formatMetric(secondaryKey, Math.min(...validSecondaryValues))} to ${formatMetric(secondaryKey, Math.max(...validSecondaryValues))}` : 'no finite values';
  const selectedMetrics = [key, secondaryKey].filter((metric) => metric !== 'none');
  fallback.textContent = selectedMetrics.length
    ? `${key === 'none' ? '' : `${METRIC_CONFIG[key].label} ranged from ${primaryRange}`}${key !== 'none' && secondaryKey !== 'none' ? '; ' : ''}${secondaryKey === 'none' ? '' : `${METRIC_CONFIG[secondaryKey].label} ranged from ${secondaryRange}`} across ${current.length} ${grain} points. Complete values follow in the chart data table.`
    : `No chart metrics selected across ${current.length} ${grain} points.`;
  canvas.setAttribute('aria-label', fallback.textContent);
  $('trendDataCaption').textContent = `${selectedMetrics.map((metric) => METRIC_CONFIG[metric].label).join(' and ') || 'No metrics'} by ${grain} for ${selectedRegionLabel()}`;
  $('trendPrimaryHeader').textContent = METRIC_CONFIG[key].label;
  $('trendSecondaryHeader').textContent = METRIC_CONFIG[secondaryKey].label;
  const trendDataBody = $('trendDataBody');
  clear(trendDataBody);
  current.forEach((row, index) => {
    const tr = document.createElement('tr');
    [row.label, key === 'none' ? '—' : formatMetric(key, currentValues[index]), secondaryKey === 'none' ? '—' : formatMetric(secondaryKey, secondaryValues[index])]
      .forEach((value) => tr.appendChild(element('td', '', value)));
    trendDataBody.appendChild(tr);
  });
  const historyLabel = combined.history.rows.length ? ' · 2025 static monthly included' : '';
  $('chartSubtitle').textContent = `${selectedMetrics.map((metric) => METRIC_CONFIG[metric].label).join(' + ') || 'No metrics selected'} by ${grain} · ${selectedRegionLabel()}${historyLabel}`;
  renderHistoricalNote('chartHistoryNote', combined.history);
  const legend = $('trendLegend');
  clear(legend);
  if (key !== 'none') {
    const barLegend = element('span');
    barLegend.append(element('i'), document.createTextNode(METRIC_CONFIG[key].label));
    legend.appendChild(barLegend);
  }
  if (secondaryKey !== 'none') {
    const lineLegend = element('span');
    const lineKey = element('i');
    lineKey.className = 'rolling-key';
    lineLegend.append(lineKey, document.createTextNode(METRIC_CONFIG[secondaryKey].label));
    legend.appendChild(lineLegend);
  }

  if (!window.Chart) {
    canvas.hidden = true;
    const visibleFallback = element('p', 'signal-empty', `Chart library unavailable. ${fallback.textContent}`);
    canvas.parentElement.appendChild(visibleFallback);
    return;
  }
  canvas.hidden = false;

  const datasets = [];
  if (key !== 'none') datasets.push({
    type: 'bar',
    label: METRIC_CONFIG[key].label,
    data: currentValues,
    borderColor: colors.primary,
    backgroundColor: `${colors.primary}55`,
    borderWidth: 1,
    borderRadius: 3,
    yAxisID: 'y',
  });
  if (secondaryKey !== 'none') datasets.push({
    type: 'line',
    label: METRIC_CONFIG[secondaryKey].label,
    data: secondaryValues,
    borderColor: colors.rolling,
    backgroundColor: `${colors.rolling}22`,
    borderWidth: 2.4,
    pointRadius: current.length > 45 ? 0 : 2,
    pointHoverRadius: 4,
    pointBackgroundColor: colors.surface,
    fill: false,
    spanGaps: true,
    tension: 0.28,
    yAxisID: 'y1',
  });

  state.chart = new window.Chart(canvas, {
    type: 'bar',
    data: { labels: current.map((row) => row.label), datasets },
    options: {
      animation: false,
      maintainAspectRatio: false,
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: colors.surface,
          borderColor: colors.grid,
          borderWidth: 1,
          titleColor: getComputedStyle(document.documentElement).getPropertyValue('--text').trim(),
          bodyColor: colors.text,
          padding: 11,
          callbacks: { label: (item) => `${item.dataset.label}: ${formatMetric(item.dataset.yAxisID === 'y1' ? secondaryKey : key, item.raw)}` },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: colors.text, font: { size: 9 }, maxTicksLimit: 9, maxRotation: 0 },
          border: { color: colors.grid },
        },
        y: {
          display: key !== 'none',
          beginAtZero: true,
          grid: { color: colors.grid },
          ticks: { color: colors.text, font: { size: 9 }, callback: (value) => formatMetric(key, value, true) },
          border: { display: false },
        },
        y1: {
          display: secondaryKey !== 'none',
          beginAtZero: true,
          position: 'right',
          grid: { drawOnChartArea: false },
          ticks: { color: colors.rolling, font: { size: 9 }, callback: (value) => formatMetric(secondaryKey, value, true) },
          border: { display: false },
        },
      },
    },
  });
}

function formatAuditMetric(key, value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const number = Number(value);
  if (['spend', 'revenue', 'new_customer_revenue'].includes(key)) {
    return number.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  }
  if (key === 'roas') return number.toFixed(2);
  return formatMetric(key, number);
}

function renderTable(view) {
  const grain = $('auditGrain').value;
  const combined = rowsForGrain(view, grain);
  const rows = metrics.groupRows(combined.rows, grain).reverse();
  const grainLabel = { day: 'day', week: 'week', month: 'month', year: 'year' }[grain];
  const body = $('metricsTableBody');
  clear(body);
  const summary = metrics.aggregateRows(combined.rows);
  const summaryRow = document.createElement('tr');
  summaryRow.className = 'summary-row';
  [
    'Selected period',
    formatAuditMetric('spend', summary.spend),
    formatAuditMetric('revenue', summary.revenue),
    formatAuditMetric('roas', summary.roas),
    formatMetric('purchases', summary.purchases),
    formatMetric('cpa', summary.cpa),
    formatMetric('aov', summary.aov),
    formatMetric('cvr', summary.cvr),
    formatMetric('unique_visitors', summary.unique_visitors),
    formatAuditMetric('new_customer_revenue', summary.new_customer_revenue),
    formatMetric('new_customer_rate', summary.new_customer_rate),
  ].forEach((value) => summaryRow.appendChild(element('td', '', value)));
  body.appendChild(summaryRow);
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    const values = [
      row.label,
      formatAuditMetric('spend', row.spend),
      formatAuditMetric('revenue', row.revenue),
      formatAuditMetric('roas', row.roas),
      formatMetric('purchases', row.purchases),
      formatMetric('cpa', row.cpa),
      formatMetric('aov', row.aov),
      formatMetric('cvr', row.cvr),
      formatMetric('unique_visitors', row.unique_visitors),
      formatAuditMetric('new_customer_revenue', row.new_customer_revenue),
      formatMetric('new_customer_rate', row.new_customer_rate),
    ];
    values.forEach((value) => tr.appendChild(element('td', '', value)));
    body.appendChild(tr);
  });
  $('auditPeriodHeader').textContent = grain === 'day' ? 'Date' : grain === 'week' ? 'Week' : grain === 'month' ? 'Month' : 'Year';
  $('metricsTableCaption').textContent = `GLV business performance by ${grainLabel}`;
  const historyLabel = combined.history.rows.length ? ' · 2025 static monthly included' : '';
  $('tableSubtitle').textContent = `Summary + ${rows.length} ${grainLabel} ${rows.length === 1 ? 'row' : 'rows'} · selected date range · newest first${historyLabel}`;
  renderHistoricalNote('auditHistoryNote', combined.history);
}

function renderScope(view) {
  const days = metrics.inclusiveDayCount(view.filters.from, view.filters.to);
  $('activeRange').textContent = `${formatDate(view.filters.from)} – ${formatDate(view.filters.to)}`;
  $('scopeMarkets').textContent = selectedRegionLabel();
  $('scopeDays').textContent = `${days} ${days === 1 ? 'day' : 'days'}`;
  const shortDate = (date) => formatDate(date, { month: 'short', day: 'numeric' });
  $('controlSummary').textContent = `${days}d (${shortDate(view.filters.from)} – ${shortDate(view.filters.to)}) · ${selectedRegionLabel()}`;
  $('screenReaderStatus').textContent = `Dashboard updated for ${selectedRegionLabel()}, ${days} days ending ${formatDate(view.filters.to)}.`;
}

function renderTrust() {
  const source = state.data.source || {};
  const history = state.historicalData;
  $('dataSource').textContent = history
    ? `${source.tab || 'Daily'} sheet · ${source.mode || 'read-only'} + static 2025 monthly snapshot`
    : `${source.tab || 'Daily'} sheet · ${source.mode || 'read-only'}`;
  $('dataCoverage').textContent = history
    ? `${formatDate(history.coverage.start)} – ${formatDate(state.data.date_range.end)} · ${history.rows.length} historical months + ${state.data.rows.length.toLocaleString('en-US')} market-days`
    : `${formatDate(state.data.date_range.start)} – ${formatDate(state.data.date_range.end)} · ${state.data.rows.length.toLocaleString('en-US')} market-days`;
}

function showEmpty(message) {
  $('loadingState').hidden = true;
  $('dashboardContent').hidden = true;
  $('errorState').hidden = false;
  $('errorMessage').textContent = message;
  $('freshnessBadge').dataset.status = 'error';
}

function render() {
  if (!state.data) return;
  const filters = currentFilters();
  if (!filters.from || !filters.to || filters.from > filters.to) {
    showEmpty('Choose a valid date range where From is on or before To.');
    return;
  }
  const view = getViewData();
  const hasHistoricalRows = [historicalContext(view, $('grain').value), historicalContext(view, $('auditGrain').value)]
    .some((context) => context.rows.length);
  if (!view.currentRows.length && !hasHistoricalRows) {
    showEmpty('No rows match this date and market selection. Reset to the last 28 days.');
    return;
  }

  $('errorState').hidden = true;
  $('loadingState').hidden = true;
  $('dashboardContent').hidden = false;
  renderScope(view);
  renderKpis(view);
  const regions = regionComparisons(view);
  renderChart(view);
  $('marketComparison').hidden = !view.currentRows.length;
  if (view.currentRows.length) renderMarketComparison(regions);
  renderTable(view);
  syncUrl();
}

async function exportCsv() {
  const view = getViewData();
  const sourcePayload = new TextEncoder().encode(JSON.stringify(state.data.rows));
  const digest = await crypto.subtle.digest('SHA-256', sourcePayload);
  const checksum = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const headers = ['date', 'region', 'spend_usd', 'revenue_usd', 'purchases', 'market_day_unique_visitors', 'new_customers', 'returning_customers', 'new_customer_revenue_usd'];
  const lines = [
    `# source_updated_at=${state.data.updated_at || 'unknown'}`,
    `# exported_at=${new Date().toISOString()}`,
    `# selected_from=${view.filters.from}`,
    `# selected_to=${view.filters.to}`,
    `# selected_regions=${state.selectedRegions.join('|')}`,
    '# aggregation_version=glv-metrics-v2-post-aggregation-ratios',
    `# dataset_sha256=${checksum}`,
    headers.join(','),
  ];
  [...view.currentRows].sort((a, b) => a.date.localeCompare(b.date) || a.region.localeCompare(b.region)).forEach((row) => {
    lines.push([row.date, row.region, row.spend, row.revenue, row.purchases, row.unique_visitors, row.new_customers, row.returning_customers, row.new_customer_revenue].join(','));
  });
  const blob = new Blob([`${lines.join('\n')}\n`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `glv-raw-${view.filters.from}-to-${view.filters.to}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('themeToggle').setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`);
  try { localStorage.setItem('glv-theme', theme); } catch (error) { /* storage can be disabled */ }
  if (state.data) renderChart(getViewData());
}

function setupTheme() {
  let saved = null;
  try { saved = localStorage.getItem('glv-theme'); } catch (error) { /* storage can be disabled */ }
  const preferred = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  setTheme(saved === 'light' || saved === 'dark' ? saved : preferred);
  $('themeToggle').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
}

function setupEvents() {
  $('periodPreset').addEventListener('change', async (event) => {
    if (event.target.value === 'all' && !state.historicalData) {
      const historicalData = await fetchHistoricalData();
      if (!historicalData) {
        event.target.value = 'custom';
        $('errorState').hidden = false;
        $('dashboardContent').hidden = false;
        $('errorMessage').textContent = '2025 historical data could not be loaded. Try All available data again.';
        return;
      }
      state.historicalData = historicalData;
      ['dateFrom', 'dateTo'].forEach((id) => { $(id).min = historicalData.coverage.start; });
    }
    applyPreset(event.target.value);
    render();
  });
  ['dateFrom', 'dateTo'].forEach((id) => $(id).addEventListener('change', () => {
    $('periodPreset').value = 'custom';
    render();
  }));
  ['comparisonToggle', 'trendMetric', 'trendMetricSecondary', 'grain', 'auditGrain'].forEach((id) => $(id).addEventListener('change', render));

  document.querySelectorAll('.section-toggle').forEach((button) => {
    button.addEventListener('click', () => {
      const content = $(button.getAttribute('aria-controls'));
      const expanded = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', String(!expanded));
      content.hidden = expanded;
      button.closest('.panel')?.classList.toggle('is-collapsed', expanded);
      if (!expanded && content.contains($('trendChart')) && state.chart) state.chart.resize();
    });
  });

  document.querySelectorAll('.region-buttons button').forEach((button) => {
    button.addEventListener('click', () => {
      const region = button.dataset.region;
      if (region === 'all') {
        state.selectedRegions = ['czsk', 'us', 'row'];
      } else {
        const selected = new Set(state.selectedRegions.length === 3 ? [] : state.selectedRegions);
        if (selected.has(region)) selected.delete(region); else selected.add(region);
        state.selectedRegions = selected.size ? [...selected] : ['czsk', 'us', 'row'];
      }
      refreshRegionButtons();
      render();
    });
  });

  $('filtersToggle').addEventListener('click', () => {
    const open = document.querySelector('.command-bar').classList.toggle('filters-open');
    $('filtersToggle').setAttribute('aria-expanded', String(open));
  });
  $('exportCsv').addEventListener('click', exportCsv);
  $('retryLoad').addEventListener('click', () => {
    if (state.data) {
      $('periodPreset').value = '28d';
      state.selectedRegions = ['czsk', 'us', 'row'];
      $('comparisonToggle').checked = true;
      applyPreset('28d');
      refreshRegionButtons();
      render();
    } else {
      loadData();
    }
  });
}

function setupPullToRefresh() {
  const indicator = $('pullRefreshIndicator');
  const indicatorText = $('pullRefreshText');
  const hapticSwitch = $('pullRefreshHaptic');
  const appSurface = $('appSurface');
  const threshold = 64;
  const maxDistance = 78;
  let startY = 0;
  let distance = 0;
  let tracking = false;
  let armed = false;
  let refreshing = false;

  const isEnabled = () => window.matchMedia('(max-width: 720px)').matches
    && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

  const haptic = (duration = 10) => {
    if (typeof navigator.vibrate === 'function' && navigator.vibrate(duration)) return;
    hapticSwitch?.click();
  };

  const setIndicator = (status, text, pullDistance = distance) => {
    indicator.dataset.state = status;
    indicatorText.textContent = text;
    indicator.setAttribute('aria-hidden', String(status === 'idle'));
    indicator.style.setProperty('--pull-offset', `${Math.max(0, pullDistance)}px`);
    appSurface.classList.toggle('pull-refresh-active', status !== 'idle');
    if (status === 'idle') appSurface.removeAttribute('style');
    else appSurface.style.transform = `translateY(${Math.max(0, pullDistance)}px)`;
  };

  const reset = () => {
    tracking = false;
    armed = false;
    distance = 0;
    setIndicator('idle', 'Pull to refresh', 0);
  };

  const refresh = async () => {
    refreshing = true;
    setIndicator('loading', 'Refreshing', maxDistance);
    haptic(14);
    const minimumDisplay = new Promise((resolve) => window.setTimeout(resolve, 550));
    const [success] = await Promise.all([loadData({ preserveContent: true }), minimumDisplay]);
    setIndicator(success ? 'success' : 'error', success ? 'Updated' : 'Refresh failed', maxDistance);
    if (success) haptic(8);
    await new Promise((resolve) => window.setTimeout(resolve, success ? 450 : 900));
    refreshing = false;
    reset();
  };

  document.addEventListener('touchstart', (event) => {
    if (!isEnabled() || refreshing || window.scrollY > 0 || event.touches.length !== 1) return;
    startY = event.touches[0].clientY;
    tracking = true;
    armed = false;
  }, { passive: true });

  document.addEventListener('touchmove', (event) => {
    if (!tracking || refreshing || event.touches.length !== 1) return;
    if (window.scrollY > 0) {
      reset();
      return;
    }
    const delta = event.touches[0].clientY - startY;
    if (delta <= 0) return;
    event.preventDefault();
    distance = Math.min(maxDistance, delta * 0.45);
    const nextArmed = distance >= threshold;
    if (nextArmed && !armed) haptic(10);
    armed = nextArmed;
    setIndicator(armed ? 'armed' : 'pulling', armed ? 'Release to refresh' : 'Pull to refresh');
  }, { passive: false });

  document.addEventListener('touchend', () => {
    if (!tracking || refreshing) return;
    tracking = false;
    if (armed) refresh(); else reset();
  }, { passive: true });

  document.addEventListener('touchcancel', () => {
    if (!refreshing) reset();
  }, { passive: true });
}

function validateData(data) {
  if (!data || !Array.isArray(data.rows) || !data.date_range?.start || !data.date_range?.end) throw new Error('Dashboard data has an invalid structure.');
  if (data.currency !== 'USD') throw new Error('Dashboard currency must be USD.');
  metrics.validateRows(data.rows);
}

function validateHistoricalData(data) {
  if (!data || data.schema_version !== 1 || data.currency !== 'USD' || !Array.isArray(data.rows) || data.rows.length !== 12) throw new Error('Historical data has an invalid structure.');
  if (data.coverage?.start !== '2025-01-01' || data.coverage?.end !== '2025-12-31') throw new Error('Historical coverage must be calendar year 2025.');
  const seen = new Set();
  data.rows.forEach((row, index) => {
    if (row.region !== 'czsk' || row.source_grain !== 'month' || !/^2025-\d{2}-\d{2}$/.test(row.date)) throw new Error(`Invalid historical row ${index}.`);
    if (seen.has(row.date)) throw new Error(`Duplicate historical month ${row.date}.`);
    seen.add(row.date);
    ['revenue', 'spend', 'purchases', 'new_customers', 'returning_customers'].forEach((key) => {
      if (typeof row[key] !== 'number' || !Number.isFinite(row[key]) || row[key] < 0) throw new Error(`Invalid historical ${key} at row ${index}.`);
    });
    ['unique_visitors', 'new_customer_revenue'].forEach((key) => {
      if (row[key] !== null) throw new Error(`Unavailable historical ${key} must be null.`);
    });
  });
}

async function fetchHistoricalData() {
  try {
    const response = await fetch('/glv-2/glv_2025_monthly.json?v=20260901-czsk-history-2', { cache: 'no-store' });
    if (!response.ok) return null;
    const historicalData = await response.json();
    validateHistoricalData(historicalData);
    return historicalData;
  } catch (error) {
    return null;
  }
}

function updateFreshness() {
  const updated = String(state.data.updated_at || '').replace(' UTC', 'Z').replace(' ', 'T');
  const date = new Date(updated);
  const ageHours = Number.isNaN(date.getTime()) ? null : (Date.now() - date.getTime()) / 3_600_000;
  $('updatedAt').textContent = `Data through ${formatDate(state.data.date_range.end, { month: 'short', day: 'numeric' })} · refreshed ${state.data.updated_at || 'unknown'}`;
  $('dataThrough').textContent = `Through ${formatDate(state.data.date_range.end, { month: 'short', day: 'numeric' })}`;
  $('freshnessBadge').dataset.status = ageHours === null ? 'loading' : ageHours <= 36 ? 'fresh' : 'stale';
}

async function loadData({ preserveContent = false } = {}) {
  state.loadAttempts += 1;
  $('loadingState').hidden = preserveContent;
  $('errorState').hidden = true;
  $('dashboardContent').hidden = !preserveContent;
  try {
    const historyRequest = state.historicalData
      ? Promise.resolve(state.historicalData)
      : fetchHistoricalData();
    const [response, historicalData] = await Promise.all([
      fetch('/glv-2/glv_dashboard.json', { cache: 'no-store' }),
      historyRequest,
    ]);
    if (!response.ok) throw new Error(`Data request failed (${response.status}).`);
    const data = await response.json();
    validateData(data);
    state.data = data;
    state.historicalData = historicalData;
    const minimumDate = historicalData?.coverage?.start || data.date_range.start;
    ['dateFrom', 'dateTo'].forEach((id) => {
      $(id).min = minimumDate;
      $(id).max = data.date_range.end;
    });
    restoreUrlState();
    updateFreshness();
    render();
    return true;
  } catch (error) {
    if (!preserveContent || !state.data) showEmpty(error instanceof Error ? error.message : 'Unknown data-loading error.');
    return false;
  }
}

setupTheme();
setupEvents();
setupPullToRefresh();
loadData();
