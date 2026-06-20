const METRICS = {
  spend: { label: 'Spend', type: 'money' },
  revenue: { label: 'Revenue', type: 'money' },
  roas: { label: 'ROAS', type: 'ratio' },
  purchases: { label: 'Purchases', type: 'count' },
  aov: { label: 'AOV', type: 'money' },
  cvr: { label: 'CVR', type: 'percent' },
  cpa: { label: 'CPA', type: 'money' },
};

const state = {
  data: null,
  chart: null,
};

const fmtNumber = (value, digits = 0) => Number(value || 0).toLocaleString('en-US', {
  minimumFractionDigits: digits,
  maximumFractionDigits: digits,
});

const fmtMoney = (value) => `$${fmtNumber(value, 2)}`;
const fmtPercent = (value) => `${(Number(value || 0) * 100).toFixed(2)}%`;
const fmtRatio = (value) => `${Number(value || 0).toFixed(2)}x`;

function formatMetric(key, value) {
  const type = METRICS[key]?.type;
  if (type === 'money') return fmtMoney(value);
  if (type === 'percent') return fmtPercent(value);
  if (type === 'ratio') return fmtRatio(value);
  return fmtNumber(value);
}

function metricValue(row, key) {
  if (key === 'roas') return row.spend ? row.revenue / row.spend : 0;
  if (key === 'cpa') return row.purchases ? row.spend / row.purchases : 0;
  if (key === 'aov') return row.purchases ? row.revenue / row.purchases : 0;
  if (key === 'cvr') return row.unique_visitors ? row.purchases / row.unique_visitors : 0;
  return row[key] || 0;
}

function blankAggregate(label) {
  return {
    label,
    spend: 0,
    revenue: 0,
    purchases: 0,
    unique_visitors: 0,
  };
}

function addAbsoluteMetrics(target, row) {
  target.spend += Number(row.spend || 0);
  target.revenue += Number(row.revenue || 0);
  target.purchases += Number(row.purchases || 0);
  target.unique_visitors += Number(row.unique_visitors || 0);
}

function weekLabel(dateString) {
  const date = new Date(`${dateString}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function grainLabel(dateString, grain) {
  if (grain === 'month') return dateString.slice(0, 7);
  if (grain === 'week') return weekLabel(dateString);
  return dateString;
}

function selectedRegions() {
  const checked = [...document.querySelectorAll('.region-buttons button[aria-pressed="true"]')]
    .map((button) => button.dataset.region);
  if (checked.includes('all')) return ['czsk', 'us', 'row'];
  return checked;
}

function selectedRows() {
  const from = document.getElementById('dateFrom').value;
  const to = document.getElementById('dateTo').value;
  const regions = selectedRegions();
  return state.data.rows.filter((row) => {
    if (from && row.date < from) return false;
    if (to && row.date > to) return false;
    return regions.includes(row.region);
  });
}

function aggregateRows(rows, grain) {
  const groups = new Map();
  rows.forEach((row) => {
    const label = grainLabel(row.date, grain);
    if (!groups.has(label)) groups.set(label, blankAggregate(label));
    addAbsoluteMetrics(groups.get(label), row);
  });
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function populateMetricPickers() {
  const options = Object.entries(METRICS).map(([key, metric]) => (
    `<option value="${key}">${metric.label}</option>`
  )).join('');
  document.getElementById('barMetric').innerHTML = options;
  document.getElementById('lineMetric').innerHTML = options;
  document.getElementById('barMetric').value = 'revenue';
  document.getElementById('lineMetric').value = 'roas';
}

function setupDateFilters() {
  document.getElementById('dateFrom').value = state.data.date_range.start || '';
  document.getElementById('dateTo').value = state.data.date_range.end || '';
}

function setupRegionBehavior() {
  const buttons = [...document.querySelectorAll('.region-buttons button')];
  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      const all = buttons.find((item) => item.dataset.region === 'all');
      const regional = buttons.filter((item) => item.dataset.region !== 'all');
      const isPressed = button.getAttribute('aria-pressed') === 'true';

      if (button.dataset.region === 'all') {
        all.setAttribute('aria-pressed', 'true');
        regional.forEach((item) => item.setAttribute('aria-pressed', 'false'));
      } else {
        button.setAttribute('aria-pressed', String(!isPressed));
        all.setAttribute('aria-pressed', 'false');
      }

      if (!buttons.some((item) => item.getAttribute('aria-pressed') === 'true')) {
        all.setAttribute('aria-pressed', 'true');
      }
      render();
    });
  });
}

function renderChart(rows) {
  const grain = document.getElementById('grain').value;
  const barMetric = document.getElementById('barMetric').value;
  const lineMetric = document.getElementById('lineMetric').value;
  const grouped = aggregateRows(rows, grain);

  if (state.chart) state.chart.destroy();
  state.chart = new Chart(document.getElementById('trendChart'), {
    data: {
      labels: grouped.map((row) => row.label),
      datasets: [
        {
          type: 'bar',
          label: METRICS[barMetric].label,
          data: grouped.map((row) => metricValue(row, barMetric)),
          backgroundColor: 'rgba(37, 99, 235, 0.24)',
          borderColor: 'rgba(37, 99, 235, 0.42)',
          borderWidth: 1,
          borderRadius: 5,
          yAxisID: 'barAxis',
        },
        {
          type: 'line',
          label: METRICS[lineMetric].label,
          data: grouped.map((row) => metricValue(row, lineMetric)),
          borderColor: '#10b981',
          backgroundColor: '#10b981',
          borderWidth: 3,
          pointRadius: 2.5,
          pointHoverRadius: 4,
          tension: 0.25,
          yAxisID: 'lineAxis',
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { boxWidth: 10, usePointStyle: true } },
        tooltip: {
          callbacks: {
            label: (item) => `${item.dataset.label}: ${formatMetric(
              item.datasetIndex === 0 ? barMetric : lineMetric,
              item.raw,
            )}`,
          },
        },
      },
      scales: {
        barAxis: {
          position: 'left',
          ticks: { callback: (value) => formatMetric(barMetric, value) },
        },
        lineAxis: {
          position: 'right',
          grid: { drawOnChartArea: false },
          ticks: { callback: (value) => formatMetric(lineMetric, value) },
        },
      },
    },
  });

  document.getElementById('chartSubtitle').textContent =
    `${METRICS[barMetric].label} and ${METRICS[lineMetric].label} by ${grain}`;
}

function renderTable(rows) {
  const grain = document.getElementById('grain').value;
  const grouped = aggregateRows(rows, grain).reverse();
  document.getElementById('tableSubtitle').textContent =
    `${fmtNumber(grouped.length)} ${grain === 'day' ? 'daily' : grain} rows`;
  document.getElementById('metricsTable').innerHTML = grouped.map((row) => `
    <tr>
      <td>${row.label}</td>
      <td>${formatMetric('spend', metricValue(row, 'spend'))}</td>
      <td>${formatMetric('revenue', metricValue(row, 'revenue'))}</td>
      <td>${formatMetric('roas', metricValue(row, 'roas'))}</td>
      <td>${formatMetric('cpa', metricValue(row, 'cpa'))}</td>
      <td>${formatMetric('aov', metricValue(row, 'aov'))}</td>
      <td>${formatMetric('cvr', metricValue(row, 'cvr'))}</td>
    </tr>
  `).join('');
}

function render() {
  const rows = selectedRows();
  renderChart(rows);
  renderTable(rows);
}

function setupHeaderToggle() {
  const topbar = document.querySelector('.topbar');
  const toggle = document.getElementById('filtersToggle');
  const mobile = window.matchMedia('(max-width: 620px)');

  function setCollapsed(collapsed) {
    topbar.classList.toggle('filters-collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
  }

  setCollapsed(mobile.matches);
  toggle.addEventListener('click', () => {
    setCollapsed(!topbar.classList.contains('filters-collapsed'));
  });
  mobile.addEventListener('change', (event) => {
    setCollapsed(event.matches);
  });
}

async function init() {
  const res = await fetch('./glv_dashboard.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('Missing glv_dashboard.json');
  state.data = await res.json();

  document.getElementById('updatedAt').textContent =
    `Updated ${state.data.updated_at} | ${state.data.date_range.start} to ${state.data.date_range.end}`;
  populateMetricPickers();
  setupDateFilters();
  setupRegionBehavior();
  setupHeaderToggle();

  ['dateFrom', 'dateTo', 'barMetric', 'lineMetric', 'grain'].forEach((id) => {
    document.getElementById(id).addEventListener('change', render);
  });
  render();
}

init().catch((error) => {
  document.getElementById('updatedAt').textContent = error.message;
});
