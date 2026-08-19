const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const route = path.join(__dirname, '..', 'public', 'glv-2');
const html = fs.readFileSync(path.join(route, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(route, 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(route, 'styles.css'), 'utf8');
const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');

test('desktop and mobile navigation expose Home and Phases as real tab controls', () => {
  assert.match(html, /<nav[^>]*aria-label="Dashboard views"/);
  assert.match(html, /data-dashboard-view="home"[^>]*aria-selected="true"/);
  assert.match(html, /data-dashboard-view="phases"[^>]*aria-selected="false"/);
  assert.match(app, /URLSearchParams[\s\S]*?view/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*?dashboard-view-nav/);
  assert.match(app, /\['ArrowLeft', 'ArrowRight', 'Home', 'End'\]/);
});

test('Phases view is CZSK-only and provides grouping, CSV, table, chart, empty, and error surfaces', () => {
  for (const id of [
    'phasesView', 'phaseGrouping', 'phaseExportCsv', 'phaseTableBody',
    'phasePerformanceChart', 'phaseMixChart', 'phaseCodeChart',
    'phaseInfluencerPanel', 'phaseEmptyState', 'phaseErrorState',
  ]) assert.match(html, new RegExp(`id="${id}"`), `missing ${id}`);
  assert.match(html, /CZSK only/);
  assert.match(html, /Month with phase/);
  assert.match(html, /Phase across time/);
  assert.match(html, /Influencer/);
  assert.match(html, /Promo subtype/);
  assert.match(html, /aria-label="Influencer code revenue and commission chart"/);
  assert.match(html, /<th>Code revenue<\/th><th>Commission<\/th>/);
  assert.match(app, /label: 'Code revenue'[\s\S]*?group\.code_revenue/);
  assert.match(html, /no-code revenue remains unattributed/);
  assert.doesNotMatch(html.match(/id="phasesView"[\s\S]*?<\/section>\s*<\/div>/)?.[0] || '', /data-region="(?:us|row)"/i);
});

test('Home retains its existing content contract beneath the new view wrapper', () => {
  for (const id of ['executiveKpis', 'trendSection', 'auditTable', 'marketComparison']) {
    assert.match(html, new RegExp(`id="${id}"`), `Home lost ${id}`);
  }
  assert.match(html, /id="homeView"/);
  assert.match(app, /state\.activeView === 'phases'[\s\S]*?destroyPhaseCharts\(\)/);
  assert.match(app, /state\.activeView === 'phases'[\s\S]*?state\.chart\.destroy\(\)/);
});

test('phase scripts load before the application from slash-safe route-local paths', () => {
  const phaseIndex = html.indexOf('/glv-2/phases.js');
  const appIndex = html.indexOf('/glv-2/app.js');
  assert.ok(phaseIndex >= 0 && appIndex > phaseIndex);
  assert.match(app, /window\.GlvPhases/);
});

test('README documents the writable schedule surface and exported phase metric contract', () => {
  assert.match(readme, /Phases tab/i);
  assert.match(readme, /Start date \| End date \| Phase \| Label \| Influencer \| Notes/);
  assert.match(readme, /influ_revenue/);
  assert.match(readme, /influ_commission/);
  assert.match(readme, /Promo and Influ.*overlap/i);
  assert.match(readme, /Notes.*private/i);
  assert.match(readme, /Independent manual-sheet reconciliation/i);
  assert.match(readme, /Feb.*\$89,286.*\$91,550/i);
  assert.match(readme, /source-driven/i);
});