const { chromium } = require('playwright-core');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const publicRoot = path.join(root, 'public');
const chromePath = '/home/tom/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';
const browserLibRoot = '/home/tom/.cache/hermes-browser-libs/root';
const evidenceDir = path.resolve(process.env.GLV_META_QA_EVIDENCE_DIR || '/tmp/glv-meta-ads-v2-qa');
fs.mkdirSync(evidenceDir, { recursive: true });

const campaign = (id, name, spend, revenue, purchases, checkouts, clicks, impressions, date, leads = 0, landingViews = clicks) => ({
  id, name, amount_spent: String(spend), impressions: String(impressions),
  'actions:link_click': String(clicks), 'actions:omni_purchase': String(purchases),
  'actions:initiate_checkout': String(checkouts), 'actions:outbound_click': String(clicks),
  'actions:lead': String(leads), 'actions:landing_page_view': String(landingViews),
  'action_values:omni_purchase': String(revenue), date_start: date, date_stop: date,
});
const aggregate = [
  campaign('c1', 'GLV_101_CZ_Promo_August', 42000, 91000, 121, 238, 1280, 92000),
  campaign('c2', 'GLV_102_CZ_Kristyna_Core', 26000, 51000, 69, 141, 840, 61000),
  campaign('c3', 'GLV_103_CZ_BAU_Core', 31000, 58000, 72, 156, 950, 73000),
  campaign('c4', 'GLV_104_CZ_Leads_August', 12000, 0, 0, 0, 360, 28000, undefined, 48, 240),
  campaign('u1', 'GLV_201_US_Core', 55000, 47000, 38, 106, 1210, 132000),
];
const daily = ['2026-08-10', '2026-08-11', '2026-08-12'].flatMap((date, day) => aggregate.map((row, i) => campaign(
  row.id, row.name, Number(row.amount_spent) / 3 + day * 100 + i, Number(row['action_values:omni_purchase']) / 3 + day * 250,
  Math.max(1, Math.round(Number(row['actions:omni_purchase']) / 3)), Math.max(1, Math.round(Number(row['actions:initiate_checkout']) / 3)),
  Math.round(Number(row['actions:link_click']) / 3), Math.round(Number(row.impressions) / 3), date,
  Math.round(Number(row['actions:lead']) / 3), Math.round(Number(row['actions:landing_page_view']) / 3),
)));
const ads = [
  { id: 'a1', name: 'PAC500 · Founder video', status: 'ACTIVE', campaign_id: 'c1', amount_spent: '14000', impressions: '31000', 'actions:link_click': '430', 'actions:landing_page_view': '390', 'actions:omni_purchase': '40', 'actions:initiate_checkout': '76', 'actions:outbound_click': '430', 'actions:lead': '0', 'action_values:omni_purchase': '30000', video_thruplay_watched_actions: '4000', video_3_sec_watched_actions: '9000', video_p100_watched_actions: '1200' },
  { id: 'a2', name: 'PAC501 · Product static', status: 'ACTIVE', campaign_id: 'c2', amount_spent: '9000', impressions: '23000', 'actions:link_click': '260', 'actions:landing_page_view': '220', 'actions:omni_purchase': '23', 'actions:initiate_checkout': '48', 'actions:outbound_click': '260', 'actions:lead': '0', 'action_values:omni_purchase': '18000', video_thruplay_watched_actions: '0', video_3_sec_watched_actions: '0', video_p100_watched_actions: '0' },
  { id: 'a3', name: 'PAC502 · US proof video', status: 'ACTIVE', campaign_id: 'u1', amount_spent: '18000', impressions: '44000', 'actions:link_click': '390', 'actions:landing_page_view': '340', 'actions:omni_purchase': '12', 'actions:initiate_checkout': '33', 'actions:outbound_click': '390', 'actions:lead': '0', 'action_values:omni_purchase': '15000', video_thruplay_watched_actions: '5100', video_3_sec_watched_actions: '12000', video_p100_watched_actions: '1600' },
  { id: 'a4', name: 'PAC503 · Lead form static', status: 'ACTIVE', campaign_id: 'c4', amount_spent: '4000', impressions: '9000', 'actions:link_click': '120', 'actions:landing_page_view': '80', 'actions:omni_purchase': '0', 'actions:initiate_checkout': '0', 'actions:outbound_click': '120', 'actions:lead': '16', 'action_values:omni_purchase': '0', video_thruplay_watched_actions: '0', video_3_sec_watched_actions: '0', video_p100_watched_actions: '0' },
];

function server() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/api/glv-meta-ads/fb-data') {
      const rows = url.searchParams.get('type') === 'aggregate' ? aggregate : url.searchParams.get('type') === 'daily' ? daily : ads;
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ rows }));
      return;
    }
    if (url.hostname === 'api.frankfurter.dev') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ rates: { USD: 0.044 } }));
      return;
    }
    const relative = url.pathname.replace(/^\/+/, '') || 'index.html';
    let file = path.resolve(publicRoot, relative);
    if (!file.startsWith(publicRoot)) return res.writeHead(403).end();
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) return res.writeHead(404).end('Not found');
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
}

async function run() {
  const app = server();
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.address().port}/glv-meta-ads-2/`;
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox'], env: { ...process.env, LD_LIBRARY_PATH: `${browserLibRoot}/usr/lib/x86_64-linux-gnu:${browserLibRoot}/usr/lib`, FONTCONFIG_PATH: `${browserLibRoot}/etc/fonts` } });
  const errors = [];
  try {
    for (const viewport of [{ name: 'desktop', width: 1440, height: 1100 }, { name: 'mobile-390', width: 390, height: 844 }, { name: 'mobile-320', width: 320, height: 780 }]) {
      const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
      const page = await context.newPage();
      page.on('console', message => { if (message.type() === 'error') errors.push(`${viewport.name}: ${message.text()}`); });
      page.on('pageerror', error => errors.push(`${viewport.name}: ${error.message}`));
      page.on('response', response => {
        if (response.status() >= 400) errors.push(`${viewport.name}: HTTP ${response.status()} ${response.url()}`);
      });
      await page.route('https://api.frankfurter.dev/**', route => route.fulfill({ json: { rates: { USD: 0.044 } } }));
      await page.goto(base, { waitUntil: 'networkidle' });
      await page.locator('#kpi-czsk .kpi-card').first().waitFor();
      assert.equal(await page.locator('#kpi-czsk .kpi-card').count(), 8);
      assert.equal(await page.locator('#daily-table-czsk tbody tr').count(), 3);
      assert.equal(await page.locator('#creative-czsk tbody tr').count(), 2);
      assert.ok(await page.evaluate(() => Boolean(window.Chart.getChart('chart-czsk'))));
      assert.equal(await page.locator('#include-leadgen').isChecked(), false);
      assert.equal(await page.locator('#kpi-czsk .kpi-card').first().locator('.kpi-val').textContent(), '99,000');
      const salesRevenue = await page.locator('#kpi-czsk .kpi-card').nth(1).locator('.kpi-val').textContent();
      assert.equal(await page.locator('#daily-table-czsk th', { hasText: 'Leads' }).count(), 0);
      assert.equal(await page.locator('#chart-left-czsk option[value="leads"]').count(), 0);
      await page.locator('#include-leadgen').check();
      assert.equal(await page.locator('#kpi-czsk .kpi-card').first().locator('.kpi-val').textContent(), '111,000');
      assert.equal(await page.locator('#kpi-czsk .kpi-card').nth(1).locator('.kpi-val').textContent(), salesRevenue);
      assert.equal(await page.locator('#daily-table-czsk th', { hasText: 'Leads' }).count(), 0);
      assert.equal(await page.locator('#daily-table-czsk th', { hasText: 'CPL' }).count(), 0);
      assert.equal(await page.locator('#daily-table-czsk th', { hasText: 'LP→Lead' }).count(), 0);
      assert.equal(await page.locator('#creative-czsk th', { hasText: 'Leads' }).count(), 0);
      assert.equal(await page.locator('#creative-czsk th', { hasText: 'CPL' }).count(), 0);
      assert.equal(await page.locator('#creative-czsk th', { hasText: 'LP→Lead' }).count(), 0);
      assert.equal(await page.locator('#creative-czsk tbody tr').count(), 3);
      const leadCreativeText = await page.locator('#creative-czsk tbody tr', { hasText: 'PAC503' }).textContent();
      assert.doesNotMatch(leadCreativeText, /16|250|20\.00%/);
      for (const metric of ['leads', 'cpl', 'lp2lead']) assert.equal(await page.locator(`#chart-left-czsk option[value="${metric}"]`).count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);

      await page.locator('[data-tab="czsk-promo"]').click();
      assert.equal(await page.locator('#kpi-czsk-promo .kpi-card').count(), 3);
      assert.deepEqual(await page.locator('#kpi-czsk-promo .kpi-val').allTextContents(), ['42,000', '26,000', '31,000']);
      assert.ok(await page.locator('#promo-table tbody tr').count() >= 6);
      assert.ok(await page.evaluate(() => Boolean(window.Chart.getChart('chart-promo-spend')) && Boolean(window.Chart.getChart('chart-promo-pie'))));
      await page.locator('#promo-active-days-only').check();
      assert.ok(await page.locator('#promo-table tbody tr').count() >= 6);

      await page.locator('[data-tab="czsk-leadgen"]').click();
      assert.equal(await page.locator('#include-leadgen').isVisible(), false);
      assert.equal(await page.locator('#leadgen-only').isVisible(), true);
      assert.equal(await page.locator('#leadgen-only').isChecked(), false);
      assert.equal(await page.locator('#kpi-czsk-leadgen .kpi-card').count(), 2);
      assert.ok(await page.locator('#leadgen-table tbody tr').count() >= 8);
      assert.equal((await page.locator('#leadgen-table tbody').textContent()).includes('Lead-gen'), true);
      assert.equal((await page.locator('#leadgen-table tbody').textContent()).includes('Sales'), true);
      assert.match(await page.locator('#leadgen-table tbody').textContent(), /20\.00%/);
      assert.equal(await page.locator('#chart-metric-leadgen').inputValue(), 'spend');
      assert.equal(await page.locator('#chart-grain-leadgen').inputValue(), 'day');
      assert.ok(await page.evaluate(() => Boolean(window.Chart.getChart('chart-leadgen-metric')) && Boolean(window.Chart.getChart('chart-leadgen-pie'))));
      const dayPointCount = await page.evaluate(() => window.Chart.getChart('chart-leadgen-metric').data.labels.length);
      await page.locator('#chart-metric-leadgen').selectOption('leads');
      assert.equal(await page.locator('#leadgen-chart-title').textContent(), 'Leads By Group');
      assert.ok(await page.evaluate(() => window.Chart.getChart('chart-leadgen-metric').data.datasets.some(dataset => dataset.data.some(value => value > 0))));
      await page.locator('#chart-grain-leadgen').selectOption('week');
      assert.ok(await page.evaluate(count => window.Chart.getChart('chart-leadgen-metric').data.labels.length < count, dayPointCount));
      await page.locator('#leadgen-only').check();
      assert.equal(await page.locator('#kpi-czsk-leadgen .kpi-card').count(), 1);
      assert.equal((await page.locator('#leadgen-table tbody').textContent()).includes('Lead-gen'), true);
      assert.equal((await page.locator('#leadgen-table tbody').textContent()).includes('Sales'), false);
      assert.equal(await page.locator('#leadgen-single-metric-wrap').isVisible(), false);
      assert.equal(await page.locator('#leadgen-dual-metric-controls').isVisible(), true);
      assert.equal(await page.locator('#chart-left-leadgen').inputValue(), 'spend');
      assert.equal(await page.locator('#chart-right-leadgen').inputValue(), 'cpl');
      assert.equal(await page.locator('#leadgen-pie-card').isVisible(), false);
      assert.equal(await page.evaluate(() => Boolean(window.Chart.getChart('chart-leadgen-pie'))), false);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      assert.deepEqual(await page.evaluate(() => window.Chart.getChart('chart-leadgen-metric').data.datasets.map(dataset => [dataset.type, dataset.yAxisID, dataset.label])), [['bar', 'y', 'Spend (CZK)'], ['line', 'y1', 'CPL (CZK)']]);
      await page.locator('#chart-left-leadgen').selectOption('revenue');
      await page.locator('#chart-right-leadgen').selectOption('leads');
      assert.deepEqual(await page.evaluate(() => window.Chart.getChart('chart-leadgen-metric').data.datasets.map(dataset => dataset.label)), ['Revenue (CZK)', 'Leads']);

      await page.locator('[data-tab="us"]').click();
      assert.equal(await page.locator('#kpi-us .kpi-card').count(), 8);
      assert.equal(await page.locator('#creative-us tbody tr').count(), 1);
      assert.ok(await page.evaluate(() => Boolean(window.Chart.getChart('chart-us'))));

      await page.locator('#theme-toggle').click();
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
      assert.equal(await page.locator('#theme-toggle').getAttribute('aria-label'), 'Switch to dark theme');
      if (viewport.width <= 720) {
        await page.locator('#mobile-controls-toggle').click();
        assert.equal(await page.locator('#mobile-controls-toggle').getAttribute('aria-expanded'), 'false');
      }
      await page.screenshot({ path: path.join(evidenceDir, `${viewport.name}-light.png`), fullPage: true });
      await context.close();
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, base, screenshots: fs.readdirSync(evidenceDir).map(name => path.join(evidenceDir, name)), consoleErrors: errors }, null, 2));
  } finally {
    await browser.close();
    await new Promise(resolve => app.close(resolve));
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
