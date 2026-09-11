const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const route = path.join(root, 'public', 'glv');
const html = fs.readFileSync(path.join(route, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(route, 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(route, 'styles.css'), 'utf8');
const exporter = fs.readFileSync(path.join(root, 'export_glv_dashboard.py'), 'utf8');

test('Home and Phases are accessible keyboard tabs while Home content is preserved', () => {
  assert.match(html, /aria-label="Dashboard views"/);
  assert.match(html, /data-dashboard-view="home"[^>]*aria-selected="true"/);
  assert.match(html, /data-dashboard-view="phases"[^>]*aria-selected="false"/);
  for (const id of ['homeView', 'executiveKpis', 'trendSection', 'auditTable', 'marketComparison']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(app, /ArrowLeft[\s\S]*ArrowRight[\s\S]*Home[\s\S]*End/);
});

test('Phases has YTD chart metric, hierarchy, Influ split, and accessible expandable table surfaces', () => {
  for (const id of ['phasesView', 'phaseMetric', 'phaseHierarchy', 'phaseInfluSplit', 'phaseChart', 'phaseChartDataBody', 'phaseTableBody']) {
    assert.match(html, new RegExp(`id="${id}"`), `missing ${id}`);
  }
  assert.match(html, /CZSK only/);
  assert.match(html, /Month → phase → days/);
  assert.match(html, /Phase → month → days/);
  assert.match(html, /Revenue[^]*Share/);
  assert.match(app, /buildHierarchy/);
  assert.match(styles, /phase-disclosure/);
});

test('Phases metric selector preserves None first and Revenue as selected default', () => {
  const select = html.match(/<select id="phaseMetric">([\s\S]*?)<\/select>/)?.[1] || '';
  const options = [...select.matchAll(/<option value="([^"]+)"([^>]*)>/g)];
  assert.equal(options[0]?.[1], 'none');
  assert.equal(options.find((option) => option[1] === 'revenue')?.[2].includes('selected'), true);
});

test('manual calendar stays local and one canonical JSON artifact is published', () => {
  assert.match(exporter, /18oXDGQaE2p8E_G3PGHJwaYsl0CFM0eE9pVd-ju19edY/);
  assert.match(exporter, /spreadsheets\.readonly/);
  assert.doesNotMatch(html + app, /docs\.google\.com|googleapis\.com/);
  assert.doesNotMatch(exporter, /public[\\\/"]+glv-2/);
});

test('Phases uses the CZSK-specific cutoff rather than the global market date range', () => {
  assert.match(app, /phase_contract\?\.latest_date/);
  assert.doesNotMatch(app, /buildPhaseDays\(data\.rows, data\.phases, data\.date_range\.end\)/);
});
