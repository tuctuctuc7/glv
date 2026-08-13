const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../public/glv-2/index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '../public/glv-2/app.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '../public/glv-2/styles.css'), 'utf8');

function has(pattern, message) {
  assert.match(html, pattern, message);
}

test('page has semantic navigation, main content, skip link, and status regions', () => {
  has(/class="skip-link"[^>]*href="#mainContent"/, 'missing skip link');
  has(/<nav[^>]*aria-label="Dashboard sections"/, 'missing labelled dashboard navigation');
  has(/<main[^>]*id="mainContent"/, 'missing main landmark target');
  has(/id="loadingState"[^>]*role="status"/, 'missing loading status');
  has(/id="errorState"[^>]*role="alert"/, 'missing error alert');
  has(/id="screenReaderStatus"[^>]*aria-live="polite"/, 'missing polite update region');
});

test('command bar exposes period, dates, comparison, regions, theme, and export controls', () => {
  for (const id of ['periodPreset', 'dateFrom', 'dateTo', 'comparisonToggle', 'themeToggle', 'exportCsv']) {
    has(new RegExp(`id="${id}"`), `missing ${id}`);
  }
  has(/data-region="czsk"/, 'missing CZSK filter');
  has(/data-region="us"/, 'missing US filter');
  has(/data-region="row"/, 'missing ROW filter');
});

test('executive hierarchy is data-first with open analysis and secondary action detail', () => {
  for (const id of [
    'executiveKpis',
    'trendSection',
    'marketComparison',
    'marketComparisonBody',
    'details',
  ]) {
    has(new RegExp(`id="${id}"`), `missing ${id}`);
  }
  assert.ok(html.indexOf('id="executiveKpis"') < html.indexOf('id="trendSection"'), 'eight KPI facts must lead the analytical canvas');
  assert.ok(html.indexOf('id="trendSection"') < html.indexOf('id="details"'), 'primary trend must lead the analysis');
  assert.ok(html.indexOf('id="details"') < html.indexOf('id="marketComparison"'), 'market comparison must move below the audit trail');
  assert.doesNotMatch(html, /<details[^>]*id="analysis"/, 'primary analysis must not be collapsed');
  for (const removedId of ['companyMovement', 'contributionAnalysis', 'funnelView', 'exceptionCenter', 'actionPanel', 'dataTrust', 'metricDefinitions']) {
    assert.doesNotMatch(html, new RegExp(`id="${removedId}"`), `${removedId} should be removed`);
  }
});

test('trend visual has an accessible text fallback and chart controls', () => {
  has(/<canvas[^>]*id="trendChart"[^>]*role="img"/, 'chart canvas needs role img');
  has(/<canvas[^>]*id="trendChart"[^>]*aria-describedby="trendDataTable"/, 'chart canvas must reference its complete data equivalent');
  has(/id="chartFallback"/, 'chart requires text fallback');
  has(/<table[^>]*id="trendDataTable"/, 'chart requires a complete accessible data table');
  has(/<caption[^>]*id="trendDataCaption"/, 'chart data table requires a meaningful caption');
  has(/<tbody[^>]*id="trendDataBody"/, 'chart data table requires a live body');
  for (const id of ['trendMetric', 'trendMetricSecondary', 'grain']) has(new RegExp(`id="${id}"`), `missing ${id}`);
  has(/id="trendMetric"[\s\S]*?<option value="revenue" selected>/, 'revenue must be the default bar metric');
  has(/id="trendMetricSecondary"[\s\S]*?<option value="roas" selected>/, 'ROAS must be the default line metric');
  const chartMetrics = ['none', 'revenue', 'spend', 'purchases', 'unique_visitors', 'new_customer_revenue', 'roas', 'cvr', 'cpa', 'aov', 'new_customer_rate'];
  for (const id of ['trendMetric', 'trendMetricSecondary']) {
    const select = html.match(new RegExp(`<select id="${id}">([\\s\\S]*?)<\\/select>`))?.[1] || '';
    for (const metric of chartMetrics) assert.match(select, new RegExp(`<option value="${metric}"`), `${id} missing ${metric}`);
  }
  assert.match(app, /fill:\s*false/, 'line dataset must not use an area fill');
});

test('latest executive branding and KPI copy are present', () => {
  has(/GELAVIS · Business intelligence by AGENTHIC/, 'missing approved header copy');
  has(/<img[^>]*src="\/glv-2\/agenthic-logo\.svg"/, 'missing slash-safe route-local AGENTHIC logo');
  has(/>8-metric executive read</, 'missing approved KPI heading');
  assert.match(app, /'new_customer_rate'/, 'new customer rate must be in the KPI contract');
  assert.doesNotMatch(app, /\['revenue', 'spend', 'purchases', 'unique_visitors', 'cvr'/, 'visitors must no longer occupy the fourth KPI slot');
  assert.match(html, /class="brand-mark"[\s\S]*?<img[^>]*class="brand-logo"/, 'logo needs an explicit full-square rendering hook');
});

test('pinned Chart.js dependency has subresource integrity protection', () => {
  has(/chart\.js@4\.4\.9\/dist\/chart\.umd\.min\.js"[^>]*integrity="sha384-[A-Za-z0-9+/=]+"[^>]*crossorigin="anonymous"/, 'Chart.js CDN script needs verified SRI and anonymous CORS');
});

test('detail table exposes the approved audit metrics and no row-limit control', () => {
  has(/<table[^>]*id="metricsTable"/, 'missing detail table');
  has(/<caption[^>]*>GLV business performance by selected date</i, 'detail table must describe daily rows independently of chart grain');
  for (const label of ['Date', 'Spend', 'Revenue', 'ROAS', 'Purchases', 'Cost per purchase', 'AOV', 'CVR', 'Visitors', 'New customer revenue', 'New customer rate']) {
    has(new RegExp(`<th[^>]*[^>]*>${label}<`, 'i'), `missing ${label} header`);
  }
  assert.doesNotMatch(html, /<th[^>]*>New customers</i);
  assert.doesNotMatch(html, /<th[^>]*>Returning customers</i);
  assert.match(app, /formatAuditMetric\('spend'/, 'audit Spend must use audit-specific integer formatting');
  assert.match(app, /formatAuditMetric\('roas'/, 'audit ROAS must omit the x suffix');
  assert.doesNotMatch(html, /id="tableLimit"/, 'row limit must follow the selected date range');
  has(/id="auditTableWrap"/, 'audit table needs a dedicated two-axis scroll container');
});

test('dashboard copy uses the approved CVR and ROAS names throughout', () => {
  assert.doesNotMatch(app, /visitor purchase(?:-rate| proxy)/i, 'stale visitor purchase-rate proxy copy remains');
  assert.doesNotMatch(app, /revenue\s*\/\s*spend/i, 'stale revenue/spend copy remains');
});

test('market comparison exposes CEO decision columns with concise metric names', () => {
  for (const label of ['Market', 'Revenue', 'Share', 'Growth', 'Spend', 'Purchases', 'Cost / purchase', 'AOV', 'CVR', 'ROAS']) {
    has(new RegExp(`<th[^>]*>${label}<`, 'i'), `missing market comparison ${label} header`);
  }
  assert.match(app, /className = 'market-total-row'/, 'market comparison needs a total row');
  has(/id="marketComparisonWrap"/, 'market comparison needs a dedicated horizontal scroll container');
  assert.doesNotMatch(html, /data-market-segment=/, 'nonfunctional market segment controls must be removed');
});

test('analysis and detail sections expose accessible toggles while KPI cards stay permanently visible', () => {
  for (const target of ['trendContent', 'auditContent', 'marketComparisonContent']) {
    has(new RegExp(`class="section-toggle"[^>]*aria-controls="${target}"[^>]*aria-expanded="true"`), `missing toggle for ${target}`);
    has(new RegExp(`id="${target}"`), `missing collapsible content ${target}`);
  }
  assert.doesNotMatch(html, /class="section-toggle"[^>]*aria-controls="executiveKpis"/, '8-metric executive read must not be collapsible');
  const kpiHeading = html.match(/<div class="section-heading compact-heading">([\s\S]*?)<div id="executiveKpis"/)?.[1] || '';
  assert.doesNotMatch(kpiHeading, /toggle-chevron/, '8-metric executive read must not show a toggle arrow');
  assert.match(app, /document\.querySelectorAll\('\.section-toggle'\)/, 'section toggles need event handling');
});

test('latest audit and market presentation feedback is encoded', () => {
  assert.match(styles, /#metricsTable th\s*\{[\s\S]*?white-space:\s*normal/, 'audit headers must wrap instead of truncating');
  const auditHeaderRule = styles.match(/#metricsTable th\s*\{([\s\S]*?)\}/)?.[1] || '';
  assert.doesNotMatch(auditHeaderRule, /text-overflow:\s*ellipsis/, 'audit headers must not inherit ellipsis truncation');
  assert.match(styles, /#metricsTable th\s*\{[\s\S]*?height:\s*52px/, 'audit header row must fit two lines');
  assert.match(styles, /--audit-summary-bg:\s*#[0-9a-f]{6}/i, 'dark theme needs an opaque green audit-summary surface');
  assert.match(styles, /html\[data-theme="light"\][\s\S]*?--audit-summary-bg:\s*#[0-9a-f]{6}/i, 'light theme needs an opaque green audit-summary surface');
  assert.match(styles, /\.summary-row td\s*\{[\s\S]*?background:\s*var\(--audit-summary-bg\)/, 'sticky selected-period row needs the opaque green background');
  assert.match(styles, /#metricsTable \.summary-row td:first-child\s*\{[\s\S]*?background:\s*var\(--audit-summary-bg\)/, 'sticky selected-period label needs the same opaque green background');
  assert.doesNotMatch(html, /PoP movement · no target verdict/i, 'unsupported market verdict label must be removed');
  assert.match(styles, /#marketComparison\s+\.panel-heading\s*\{[\s\S]*?padding-bottom:/, 'market heading needs balanced bottom padding');
});

test('route-local runtime assets use slash-safe absolute paths', () => {
  for (const asset of ['styles.css', 'metrics.js', 'app.js']) has(new RegExp(`(?:href|src)="/glv-2/${asset.replace('.', '\\.')}`), `${asset} must load at /glv-2 and /glv-2/`);
  assert.match(app, /fetch\('\/glv-2\/glv_dashboard\.json'/, 'data must load at /glv-2 and /glv-2/');
});

test('decision-safe vocabulary blocks unsupported acquisition and profitability claims', () => {
  assert.doesNotMatch(html, />CPA</i, 'spend divided by purchases must not be labelled CPA');
  has(/Cost per purchase/i, 'cost per purchase label is required');
});

test('scripts load pure metrics before the application and contain no inline handlers', () => {
  const metricsIndex = html.indexOf('/glv-2/metrics.js');
  const appIndex = html.indexOf('/glv-2/app.js');
  assert.ok(metricsIndex >= 0 && appIndex > metricsIndex, 'metrics.js must load before app.js');
  assert.doesNotMatch(html, /\son(?:click|change|input|submit)=/i);
});
