const { chromium } = require('playwright-core');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const publicRoot = path.join(root, 'public');
const chromePath = '/home/tom/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';
const browserLibRoot = '/home/tom/.cache/hermes-browser-libs/root';
const evidenceDir = path.resolve(process.env.GLV_META_QA_EVIDENCE_DIR || '/tmp/glv-meta-ads-qa');
fs.rmSync(evidenceDir, { recursive: true, force: true });
fs.mkdirSync(evidenceDir, { recursive: true });

const campaign = (id, name, spend, revenue, purchases, checkouts, clicks, impressions, date, leads = 0, landingViews = Math.round(clicks * 0.8), reach = Math.round(impressions / 1.7)) => ({
  id, name, amount_spent: String(spend), impressions: String(impressions),
  reach: String(reach),
  'actions:link_click': String(clicks), 'actions:omni_purchase': String(purchases),
  'actions:initiate_checkout': String(checkouts), 'actions:outbound_click': String(Math.round(clicks * 0.6)),
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
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
}

async function run() {
  const app = server();
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.address().port}/glv-meta-ads/`;
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox'], env: { ...process.env, LD_LIBRARY_PATH: `${browserLibRoot}/usr/lib/x86_64-linux-gnu:${browserLibRoot}/usr/lib`, FONTCONFIG_PATH: `${browserLibRoot}/etc/fonts` } });
  const errors = [];
  try {
    for (const viewport of [{ name: 'desktop', width: 1440, height: 1100 }, { name: 'desktop-800', width: 800, height: 1000 }, { name: 'mobile-390', width: 390, height: 844 }, { name: 'mobile-320', width: 320, height: 780 }]) {
      const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
      const page = await context.newPage();
      page.on('console', message => { if (message.type() === 'error') errors.push(`${viewport.name}: ${message.text()}`); });
      page.on('pageerror', error => errors.push(`${viewport.name}: ${error.message}`));
      page.on('response', response => {
        if (response.status() >= 400) errors.push(`${viewport.name}: HTTP ${response.status()} ${response.url()}`);
      });
      await page.route('https://api.frankfurter.dev/**', route => route.fulfill({ json: { rates: { USD: 0.044 } } }));
      if (viewport.name === 'desktop') {
        await page.goto(base.slice(0, -1), { waitUntil: 'networkidle' });
        await page.locator('#kpi-czsk .kpi-card').first().waitFor();
        assert.equal(await page.locator('h1, .header-logo').filter({ hasText: 'GLV Meta Ads Pulse' }).count() > 0, true);
      }
      await page.goto(base, { waitUntil: 'networkidle' });
      await page.locator('#kpi-czsk .kpi-card').first().waitFor();
      const homeIconHref = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
      assert.equal(homeIconHref, '/glv-meta-ads/apple-touch-icon.png');
      const homeIconResponse = await page.request.get(new URL(homeIconHref, base).href);
      assert.equal(homeIconResponse.status(), 200);
      assert.match(homeIconResponse.headers()['content-type'] || '', /^image\/png/);
      if (viewport.name === 'desktop') {
        const dateTrigger = page.locator('#date-btn');
        await dateTrigger.focus();
        await page.keyboard.press('Enter');
        assert.equal(await dateTrigger.getAttribute('aria-expanded'), 'true');
        assert.equal(await page.locator('.date-preset-item.active').evaluate(el => el === document.activeElement), true);
        await page.keyboard.press('ArrowUp');
        assert.equal(await page.locator('.date-preset-item[data-p="last_14d"]').evaluate(el => el === document.activeElement), true);
        await page.keyboard.press('Enter');
        await page.locator('#kpi-czsk .kpi-card').first().waitFor();
        assert.equal(await dateTrigger.getAttribute('aria-expanded'), 'false');
        assert.equal(await dateTrigger.evaluate(el => el === document.activeElement), true);
        await page.keyboard.press('ArrowDown');
        assert.equal(await dateTrigger.getAttribute('aria-expanded'), 'true');
        await page.keyboard.press('End');
        assert.equal(await page.locator('.date-preset-item[data-p="last_month"]').evaluate(el => el === document.activeElement), true);
        await page.keyboard.press('Home');
        assert.equal(await page.locator('.date-preset-item[data-p="last_7d"]').evaluate(el => el === document.activeElement), true);
        await page.keyboard.press('Escape');
        assert.equal(await dateTrigger.getAttribute('aria-expanded'), 'false');
        assert.equal(await dateTrigger.evaluate(el => el === document.activeElement), true);
        await dateTrigger.click();
        await page.locator('.date-preset-item[data-p="last_30d"]').click();
        await page.locator('#kpi-czsk .kpi-card').first().waitFor();
      }
      if (viewport.width <= 720) {
        assert.equal(await page.locator('#mobile-controls-toggle').getAttribute('aria-expanded'), 'false');
        assert.equal(await page.locator('.header-right').evaluate(el => el.classList.contains('controls-collapsed')), true);
        assert.equal(await page.locator('.header-tabs').evaluate(el => getComputedStyle(el).position), 'fixed');
        assert.equal(await page.locator('.dashboard-sub').evaluate(el => getComputedStyle(el).display), 'none');
        assert.equal(await page.locator('#kpi-czsk').evaluate(el => el.scrollWidth > el.clientWidth), true);
        assert.equal(await page.locator('#kpi-czsk').evaluate(grid => {
          const cardWidth = grid.querySelector('.kpi-card').getBoundingClientRect().width;
          const style = getComputedStyle(grid);
          const contentWidth = grid.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
          const expectedWidth = (contentWidth - 16) * 3 / 7;
          return Math.abs(cardWidth - expectedWidth) <= 1;
        }), true);
        assert.equal(await page.locator('#panel-czsk .chart-controls').first().evaluate(el => getComputedStyle(el).display), 'grid');
        assert.equal(await page.locator('#panel-czsk .axis-controls').count(), 1);
        assert.equal(await page.locator('#panel-czsk .axis-controls').evaluate(controls => {
          const bars = controls.querySelector('#chart-left-czsk').getBoundingClientRect();
          const line = controls.querySelector('#chart-right-czsk').getBoundingClientRect();
          const grain = controls.querySelector('#chart-grain-czsk').getBoundingClientRect();
          const labels = [...controls.querySelectorAll('.metric-label')].map(label => label.getBoundingClientRect());
          return bars.left < line.left && line.left < grain.left
            && Math.max(bars.top, line.top, grain.top) - Math.min(bars.top, line.top, grain.top) <= 1
            && labels.every(label => label.bottom <= bars.top)
            && controls.getBoundingClientRect().height <= 68;
        }), true);
        assert.deepEqual(await page.locator('#panel-czsk .axis-controls > .metric-label').allInnerTexts(), ['GRAIN', 'BARS', 'LINE']);
        assert.equal(await page.locator('#daily-table-czsk tbody td').first().evaluate(el => getComputedStyle(el).position), 'sticky');
        assert.equal(await page.locator('#daily-table-czsk tbody td').nth(1).evaluate(el => getComputedStyle(el).position), 'static');
        assert.equal(await page.locator('#daily-table-czsk thead th').evaluateAll(headers => headers.every(header => getComputedStyle(header).position === 'sticky' && getComputedStyle(header).top === '0px')), true);
        assert.equal(await page.locator('#daily-table-czsk').evaluate(async container => {
          const table = container.querySelector('table');
          const wrapper = table.closest('.data-table-wrap');
          const tbody = table.querySelector('tbody');
          const originals = [...tbody.children];
          for (let i = 0; i < 5; i += 1) originals.forEach(row => tbody.append(row.cloneNode(true)));
          wrapper.scrollTop = 160;
          await new Promise(resolve => requestAnimationFrame(resolve));
          const wrapperTop = wrapper.getBoundingClientRect().top;
          const headerTops = [...table.querySelectorAll('thead th')].map(header => header.getBoundingClientRect().top);
          const stayedPinned = wrapper.scrollTop > 0 && headerTops.every(top => Math.abs(top - wrapperTop) <= 1.5);
          tbody.replaceChildren(...originals);
          wrapper.scrollTop = 0;
          return stayedPinned;
        }), true);
        assert.deepEqual(await page.evaluate(() => {
          const campaign = getComputedStyle(document.querySelector('#filter-toggle-czsk'));
          const date = getComputedStyle(document.querySelector('#daily-sort-czsk'));
          return {
            heights: [document.querySelector('#filter-toggle-czsk').getBoundingClientRect().height, document.querySelector('#daily-sort-czsk').getBoundingClientRect().height],
            sameFont: campaign.fontFamily === date.fontFamily,
            sameSize: campaign.fontSize === date.fontSize,
            sameWeight: campaign.fontWeight === date.fontWeight,
            weight: campaign.fontWeight,
          };
        }), { heights: [44, 44], sameFont: true, sameSize: true, sameWeight: true, weight: '500' });
        assert.equal(await page.locator('#panel-czsk .compact-table-controls').count(), 1);
        assert.equal(await page.locator('#panel-czsk .compact-creative-controls').count(), 1);
        assert.equal(await page.locator('.compact-table-controls').count(), 4);
        assert.equal(await page.locator('.compact-grouped-table-controls').count(), 2);
        assert.equal(await page.locator('#panel-czsk .compact-table-controls').evaluate(controls => {
          const campaign = getComputedStyle(controls.querySelector('.filter-wrap'), '::before').color;
          const sort = getComputedStyle(controls.querySelector('.sort-controls .metric-label')).color;
          return campaign === sort;
        }), true);
        assert.equal(await page.locator('#panel-czsk .compact-table-controls').evaluate(controls => {
          const filter = controls.querySelector('.filter-wrap');
          const campaign = controls.querySelector('.filter-toggle').getBoundingClientRect();
          const sortLabel = controls.querySelector('.metric-label').getBoundingClientRect();
          const sort = controls.querySelector('.metric-select').getBoundingClientRect();
          const direction = controls.querySelector('.sort-dir-btn').getBoundingClientRect();
          return getComputedStyle(filter, '::before').content === '"Campaign"'
            && sortLabel.bottom <= sort.top
            && campaign.left < sort.left && sort.left < direction.left
            && Math.max(campaign.top, sort.top, direction.top) - Math.min(campaign.top, sort.top, direction.top) <= 1
            && [campaign, sort, direction].every(box => box.height === 44)
            && controls.getBoundingClientRect().height <= 68;
        }), true);
        assert.equal(await page.locator('#panel-czsk .compact-creative-controls').evaluate(controls => {
          const filter = controls.querySelector('.filter-wrap');
          const campaign = controls.querySelector('.filter-toggle').getBoundingClientRect();
          const labels = [...controls.querySelectorAll('.metric-label')].map(label => label.getBoundingClientRect());
          const type = controls.querySelector('#creative-type-czsk').getBoundingClientRect();
          const sort = controls.querySelector('#creative-sort-czsk').getBoundingClientRect();
          const direction = controls.querySelector('.sort-dir-btn').getBoundingClientRect();
          return getComputedStyle(filter, '::before').content === '"Campaign"'
            && labels.every(label => label.bottom <= type.top)
            && campaign.left < type.left && type.left < sort.left && sort.left < direction.left
            && Math.max(campaign.top, type.top, sort.top, direction.top) - Math.min(campaign.top, type.top, sort.top, direction.top) <= 1
            && [campaign, type, sort, direction].every(box => box.height === 44)
            && controls.getBoundingClientRect().height <= 68;
        }), true);
        const tabGeometry = await page.evaluate(() => {
          const boxes = [...document.querySelectorAll('.header-tabs .tab-btn')].map(tab => tab.getBoundingClientRect().toJSON());
          return { boxes, width: innerWidth, height: innerHeight, inside: boxes.every(box => box.left >= 0 && box.right <= innerWidth && box.bottom <= innerHeight + 1.5) };
        });
        assert.equal(tabGeometry.inside, true, JSON.stringify(tabGeometry));
        assert.deepEqual(await page.evaluate(() => [
          document.querySelector('#theme-toggle').getBoundingClientRect().height,
          document.querySelector('#mobile-controls-toggle').getBoundingClientRect().height,
          document.querySelector('.header-tabs .tab-btn').getBoundingClientRect().height,
        ]), [44, 44, 63]);
        await page.locator('#mobile-controls-toggle').click();
        assert.equal(await page.locator('#mobile-controls-toggle').getAttribute('aria-expanded'), 'true');
        assert.equal(await page.locator('#date-btn').isVisible(), true);
        assert.equal(await page.locator('.header-right .tick-filter:visible').count(), 1);
        assert.equal(await page.locator('.header-right').evaluate(el => getComputedStyle(el).position), 'fixed');
        assert.equal(await page.evaluate(() => [document.querySelector('#date-btn'), document.querySelector('.header-right .tick-filter:not(.hidden)')].every(control => control.getBoundingClientRect().height >= 44)), true);
        await page.locator('#mobile-controls-toggle').click();
        assert.deepEqual(await page.locator('#filter-toggle-czsk').evaluate(toggle => ({ tag: toggle.tagName, expanded: toggle.getAttribute('aria-expanded'), controls: toggle.getAttribute('aria-controls') })), { tag: 'BUTTON', expanded: 'false', controls: 'filter-dropdown-czsk' });
        await page.locator('#filter-toggle-czsk').click();
        assert.equal(await page.locator('#filter-dropdown-czsk').evaluate(el => el.classList.contains('open')), true);
        assert.equal(await page.locator('#filter-toggle-czsk').getAttribute('aria-expanded'), 'true');
        assert.equal(await page.locator('#filter-dropdown-czsk').evaluate(dropdown => {
          const controls = dropdown.closest('.compact-table-controls').getBoundingClientRect();
          const box = dropdown.getBoundingClientRect();
          return Math.abs(box.left - controls.left) <= 2.5 && Math.abs(box.width - controls.width) <= 2.5;
        }), true);
        for (const selector of ['#filter-dropdown-czsk .filter-search', '#filter-dropdown-czsk .filter-option', '#filter-dropdown-czsk .filter-action-btn']) {
          assert.ok(await page.locator(selector).first().evaluate(el => el.getBoundingClientRect().height >= 44));
        }
        await page.locator('#filter-toggle-czsk').click();
        assert.equal(await page.locator('#filter-toggle-czsk').getAttribute('aria-expanded'), 'false');
      } else {
        assert.equal(await page.locator('.header-tabs').evaluate(el => getComputedStyle(el).position), 'static');
        assert.equal(await page.locator('.dashboard-sub').isVisible(), true);
        assert.equal(await page.locator('#kpi-czsk').evaluate(el => el.scrollWidth === el.clientWidth), true);
        assert.equal(await page.locator('#panel-czsk .chart-controls').first().evaluate(el => getComputedStyle(el).display), 'flex');
        assert.deepEqual(await page.locator('#panel-czsk .axis-controls > .metric-label').allInnerTexts(), ['X-axis:', 'Left Y:', 'Right Y:']);
        assert.equal(await page.locator('#daily-table-czsk tbody td').nth(1).evaluate(el => getComputedStyle(el).position), 'sticky');
        assert.equal(await page.locator('#kpi-czsk').evaluate((el, width) => getComputedStyle(el).gridTemplateColumns.split(' ').length === (width > 1100 ? 4 : 2), viewport.width), true);
      }
      assert.equal(await page.locator('#kpi-czsk .kpi-card').count(), 8);
      assert.equal(await page.locator('#daily-table-czsk tbody tr').count(), 3);
      assert.equal(await page.locator('#creative-czsk tbody tr').count(), 2);
      assert.ok(await page.evaluate(() => Boolean(window.Chart.getChart('chart-czsk'))));
      if (viewport.width <= 720) await page.screenshot({ path: path.join(evidenceDir, `${viewport.name}-czsk.png`), fullPage: true });
      assert.equal(await page.locator('#include-leadgen').isChecked(), false);
      assert.equal(await page.locator('#kpi-czsk .kpi-card').first().locator('.kpi-val').textContent(), '99,000');
      const salesRevenue = await page.locator('#kpi-czsk .kpi-card').nth(1).locator('.kpi-val').textContent();
      assert.equal(await page.locator('#daily-table-czsk th', { hasText: 'Leads' }).count(), 0);
      assert.equal(await page.locator('#chart-left-czsk option[value="leads"]').count(), 0);
      if (viewport.width <= 720) await page.locator('#mobile-controls-toggle').click();
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

      await page.locator('#include-leadgen').uncheck();
      await page.locator('[data-tab="czsk-triage"]').click();
      if (viewport.width <= 720) await page.locator('#mobile-controls-toggle').click();
      assert.equal(await page.locator('#include-leadgen').isVisible(), true);
      assert.equal(await page.locator('#include-leadgen').isChecked(), false);
      assert.equal(await page.locator('#panel-czsk-triage .triage-intro').count(), 0);
      assert.equal(await page.locator('#panel-czsk-triage .triage-card').count(), 7);
      assert.equal(await page.locator('#panel-czsk-triage .triage-card--hero').count(), 1);
      assert.equal(await page.locator('#panel-czsk-triage .triage-card-heading h3.triage-preset').count(), 7);
      assert.equal(await page.locator('#panel-czsk-triage .triage-card-heading .chart-card-title').count(), 0);
      assert.equal(await page.locator('#triage-preset-lp-purchase').textContent(), 'Purchases · LP → Purchase · day');
      assert.equal(await page.locator('#panel-czsk-triage .triage-controls').count(), 7);
      assert.equal(await page.locator('#panel-czsk-triage .triage-controls select').count(), 21);
      assert.equal(await page.locator('#panel-czsk-triage .triage-data-table').count(), 7);
      const triageCharts = await page.evaluate(() => [...document.querySelectorAll('#panel-czsk-triage canvas')].map(canvas => {
        const chart = window.Chart.getChart(canvas);
        return {
          id: canvas.id,
          labels: chart.data.labels.length,
          datasets: chart.data.datasets.map(dataset => ({ type: dataset.type, metricKey: dataset.metricKey, color: dataset.borderColor, values: dataset.data })),
          tableRows: canvas.closest('.triage-card').querySelectorAll('.triage-data-table tbody tr').length,
        };
      }));
      assert.deepEqual(triageCharts.map(chart => chart.datasets.map(dataset => [dataset.type, dataset.metricKey])), [
        [['bar', 'spend'], ['line', 'roas']],
        [['bar', 'lp'], ['line', 'lp2co']],
        [['bar', 'checkouts'], ['line', 'co2pur']],
        [['bar', 'purchases'], ['line', 'lp2pur']],
        [['bar', 'revenue'], ['line', 'aov']],
        [['bar', 'impressions'], ['line', 'ctr']],
        [['line', 'cpm'], ['line', 'frequency']],
      ]);
      const defaultColors = triageCharts.flatMap(chart => chart.datasets.map(dataset => dataset.color));
      assert.equal(new Set(defaultColors).size, 14);
      assert.equal(triageCharts.every(chart => chart.labels > 0 && chart.tableRows === chart.labels), true);
      const expectedCtr = daily
        .filter(row => ['c1', 'c2', 'c3'].includes(row.id) && row.date_start === '2026-08-10')
        .reduce((totals, row) => ({ clicks: totals.clicks + Number(row['actions:link_click']), impressions: totals.impressions + Number(row.impressions) }), { clicks: 0, impressions: 0 });
      assert.ok(Math.abs(triageCharts[5].datasets[1].values[0] - expectedCtr.clicks / expectedCtr.impressions * 100) < 1e-9);
      const salesOnlySpend = triageCharts[0].datasets[0].values;
      const salesOnlyRoas = triageCharts[0].datasets[1].values;
      const salesOnlyCtr = triageCharts[5].datasets[1].values;
      await page.locator('#include-leadgen').check({ force: true });
      const withLeadGen = await page.evaluate(() => ({
        spend: window.Chart.getChart('triage-chart-efficiency').data.datasets[0].data,
        roas: window.Chart.getChart('triage-chart-efficiency').data.datasets[1].data,
        ctr: window.Chart.getChart('triage-chart-delivery-response').data.datasets[1].data,
      }));
      assert.ok(withLeadGen.spend.every((value, index) => value > salesOnlySpend[index]));
      assert.ok(withLeadGen.roas.every((value, index) => value < salesOnlyRoas[index]));
      assert.deepEqual(withLeadGen.ctr, salesOnlyCtr, 'Lead-gen remains spend-only when included in Triage');
      assert.equal(await page.evaluate(() => window.Chart.getChart('triage-chart-delivery-response').data.datasets[1].metricKey), 'ctr');
      await page.locator('#include-leadgen').uncheck({ force: true });
      assert.deepEqual(await page.evaluate(() => window.Chart.getChart('triage-chart-efficiency').data.datasets[0].data), salesOnlySpend);
      assert.equal(Math.round(triageCharts[0].datasets[0].values.reduce((sum, value) => sum + value, 0)), 99909, 'triage excludes Lead-gen by default');
      const layout = await page.locator('#triage-grid').evaluate(grid => {
        const cards = [...grid.querySelectorAll('.triage-card')].map(card => card.getBoundingClientRect());
        return {
          columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
          heroWidth: cards[0].width,
          gridWidth: grid.getBoundingClientRect().width,
          sameSecondRow: Math.abs(cards[1].top - cards[2].top) <= 1,
        };
      });
      if (viewport.width <= 1000) {
        assert.equal(layout.columns, 1);
        assert.equal(layout.sameSecondRow, false);
        if (viewport.width <= 720) assert.equal(await page.locator('#panel-czsk-triage .triage-controls').evaluateAll(controls => controls.every(control => {
            const boxes = [...control.querySelectorAll('select')].map(select => select.getBoundingClientRect());
            return boxes.every(box => box.height === 44)
              && Math.max(...boxes.map(box => box.top)) - Math.min(...boxes.map(box => box.top)) <= 1;
          })), true);
      } else {
        assert.equal(layout.columns, 2);
        assert.equal(layout.sameSecondRow, true);
        assert.ok(Math.abs(layout.heroWidth - layout.gridWidth) <= 1);
      }
      const efficiencyBefore = triageCharts[0].datasets[0].values;
      const lpDayCount = triageCharts[1].labels;
      await page.locator('#triage-primary-lp-checkout').selectOption('purchases');
      assert.deepEqual(await page.evaluate(() => window.Chart.getChart('triage-chart-lp-checkout').data.datasets.map(dataset => dataset.metricKey)), ['purchases', 'lp2co']);
      assert.equal(await page.locator('#triage-preset-lp-checkout').textContent(), 'Purchases · LP → Checkout · day');
      assert.equal(await page.evaluate(() => window.Chart.getChart('triage-chart-lp-checkout').data.datasets[0].borderColor === window.Chart.getChart('triage-chart-lp-purchase').data.datasets[0].borderColor), true);
      assert.deepEqual(await page.evaluate(() => window.Chart.getChart('triage-chart-efficiency').data.datasets[0].data), efficiencyBefore);
      await page.locator('#triage-grain-lp-checkout').selectOption('week');
      assert.ok(await page.evaluate(() => window.Chart.getChart('triage-chart-lp-checkout').data.labels.length) < lpDayCount);
      assert.equal(await page.locator('#triage-preset-lp-checkout').textContent(), 'Purchases · LP → Checkout · week');
      assert.equal(await page.evaluate(() => window.Chart.getChart('triage-chart-efficiency').data.labels.length), triageCharts[0].labels);
      await page.locator('#triage-primary-lp-checkout').selectOption('lp');
      await page.locator('#triage-grain-lp-checkout').selectOption('day');
      assert.equal(await page.locator('[data-tab="czsk-triage"]').getAttribute('aria-selected'), 'true');
      assert.equal(await page.locator('[data-tab="czsk"]').getAttribute('aria-selected'), 'false');
      if (viewport.name === 'desktop') {
        const matrixResult = await page.evaluate(() => {
          const chartCountBefore = Object.keys(window.Chart.instances).length;
          const metricColors = new Map();
          const presets = [...document.querySelectorAll('[data-triage-chart]')].map(card => {
            const id = card.dataset.triageChart;
            return {
              id,
              primary: document.getElementById(`triage-primary-${id}`).value,
              secondary: document.getElementById(`triage-secondary-${id}`).value,
              grain: document.getElementById(`triage-grain-${id}`).value,
            };
          });
          const verify = (id, role) => {
            const card = document.querySelector(`[data-triage-chart="${id}"]`);
            const chart = window.Chart.getChart(`triage-chart-${id}`);
            const primary = document.getElementById(`triage-primary-${id}`).value;
            const secondary = document.getElementById(`triage-secondary-${id}`).value;
            const grain = document.getElementById(`triage-grain-${id}`).value;
            if (!chart || chart.data.datasets.length !== 2) throw new Error(`${id}/${role}: missing two-dataset chart`);
            if (chart.data.datasets[0].metricKey !== primary || chart.data.datasets[1].metricKey !== secondary) throw new Error(`${id}/${role}: dataset keys are stale`);
            chart.data.datasets.forEach(dataset => {
              const known = metricColors.get(dataset.metricKey);
              if (known && known !== dataset.borderColor) throw new Error(`${dataset.metricKey}: unstable runtime color`);
              metricColors.set(dataset.metricKey, dataset.borderColor);
            });
            const table = card.querySelector('.triage-data-table');
            const primaryLabel = chart.data.datasets[0].label;
            const secondaryLabel = chart.data.datasets[1].label;
            if (table.querySelector('.triage-primary-header').textContent !== primaryLabel) throw new Error(`${id}/${role}: primary table heading is stale`);
            if (table.querySelector('.triage-secondary-header').textContent !== secondaryLabel) throw new Error(`${id}/${role}: secondary table heading is stale`);
            const caption = table.querySelector('caption').textContent;
            if (!caption.includes(primaryLabel) || !caption.includes(secondaryLabel) || !caption.includes(grain)) throw new Error(`${id}/${role}: table caption is stale`);
            const rows = [...table.querySelectorAll('tbody tr')];
            if (rows.length !== chart.data.labels.length) throw new Error(`${id}/${role}: table/chart row mismatch`);
            rows.forEach((row, index) => {
              const cells = row.querySelectorAll('td');
              const expectedPrimary = formatChartVal(primary, chart.data.datasets[0].data[index]);
              const expectedSecondary = formatChartVal(secondary, chart.data.datasets[1].data[index]);
              if (cells[0].textContent !== expectedPrimary || cells[1].textContent !== expectedSecondary) throw new Error(`${id}/${role}: table/chart value mismatch at ${index}`);
            });
            if (Object.keys(window.Chart.instances).length !== chartCountBefore) throw new Error(`${id}/${role}: Chart.js instance count leaked`);
          };
          for (const preset of presets) {
            for (const role of ['primary', 'secondary']) {
              const select = document.getElementById(`triage-${role}-${preset.id}`);
              for (const option of [...select.options]) {
                select.value = option.value;
                select.dispatchEvent(new Event('change', { bubbles: true }));
                verify(preset.id, `${role}:${option.value}`);
              }
            }
            const grainSelect = document.getElementById(`triage-grain-${preset.id}`);
            for (const grain of ['day', 'week', 'month']) {
              grainSelect.value = grain;
              grainSelect.dispatchEvent(new Event('change', { bubbles: true }));
              verify(preset.id, `grain:${grain}`);
            }
            const primarySelect = document.getElementById(`triage-primary-${preset.id}`);
            const secondarySelect = document.getElementById(`triage-secondary-${preset.id}`);
            secondarySelect.value = primarySelect.value;
            secondarySelect.dispatchEvent(new Event('change', { bubbles: true }));
            verify(preset.id, 'duplicate-selection');
            primarySelect.value = preset.primary;
            primarySelect.dispatchEvent(new Event('change', { bubbles: true }));
            secondarySelect.value = preset.secondary;
            secondarySelect.dispatchEvent(new Event('change', { bubbles: true }));
            grainSelect.value = 'day';
            grainSelect.dispatchEvent(new Event('change', { bubbles: true }));
            if (grainSelect.value !== 'day') throw new Error(`${preset.id}: default grain was not restored`);
            verify(preset.id, 'restored-default');
          }
          if (metricColors.size !== 15) throw new Error(`expected 15 triage metric colors, got ${metricColors.size}`);
          if (new Set(metricColors.values()).size !== metricColors.size) throw new Error('different runtime metrics share a color');
          return { charts: presets.length, metrics: metricColors.size, chartCount: chartCountBefore };
        });
        assert.deepEqual(matrixResult.charts, 7);
        assert.deepEqual(matrixResult.metrics, 15);
      }
      const triageOverflow = await page.evaluate(() => ({
        viewport: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        offenders: [...document.querySelectorAll('#panel-czsk-triage *')].filter(element => {
          const box = element.getBoundingClientRect();
          return box.right > window.innerWidth + 1 || box.left < -1;
        }).slice(0, 10).map(element => ({ tag: element.tagName, id: element.id, className: element.className, box: element.getBoundingClientRect().toJSON() })),
      }));
      assert.ok(triageOverflow.documentWidth <= triageOverflow.viewport, JSON.stringify(triageOverflow));
      await page.screenshot({ path: path.join(evidenceDir, `${viewport.name}-triage.png`), fullPage: true });

      await page.locator('[data-tab="czsk-promo"]').click();
      assert.equal(await page.locator('#kpi-czsk-promo .kpi-card').count(), 3);
      if (viewport.width <= 720) assert.equal(await page.locator('#panel-czsk-promo .compact-grouped-table-controls').evaluate(controls => {
        const campaign = controls.querySelector('.filter-toggle').getBoundingClientRect();
        const sort = controls.querySelector('.metric-select').getBoundingClientRect();
        const direction = controls.querySelector('.sort-dir-btn').getBoundingClientRect();
        const groupLabel = controls.querySelector('.toggle-row .metric-label').getBoundingClientRect();
        const segmented = controls.querySelector('.segmented').getBoundingClientRect();
        return Math.max(campaign.top, sort.top, direction.top) - Math.min(campaign.top, sort.top, direction.top) <= 1
          && [campaign, sort, direction].every(box => box.height === 44)
          && groupLabel.bottom <= segmented.top
          && segmented.height === 44
          && [...controls.querySelectorAll('.segmented button')].every(button => button.getBoundingClientRect().height === 44)
          && getComputedStyle(controls.querySelector('.filter-wrap'), '::before').color === getComputedStyle(controls.querySelector('.sort-controls .metric-label')).color
          && getComputedStyle(controls.querySelector('.filter-wrap'), '::before').color === getComputedStyle(controls.querySelector('.toggle-row .metric-label')).color;
      }), true);
      assert.deepEqual(await page.locator('#kpi-czsk-promo .kpi-val').allTextContents(), ['42,000', '26,000', '31,000']);
      assert.ok(await page.locator('#promo-table tbody tr').count() >= 6);
      assert.ok(await page.evaluate(() => Boolean(window.Chart.getChart('chart-promo-spend')) && Boolean(window.Chart.getChart('chart-promo-pie'))));
      if (viewport.width <= 720) await page.screenshot({ path: path.join(evidenceDir, `${viewport.name}-promo.png`), fullPage: true });
      if (viewport.width <= 720) await page.locator('#mobile-controls-toggle').click();
      await page.locator('#promo-active-days-only').check();
      assert.ok(await page.locator('#promo-table tbody tr').count() >= 6);

      await page.locator('[data-tab="czsk-leadgen"]').click();
      assert.equal(await page.locator('#include-leadgen').isVisible(), false);
      if (viewport.width <= 720) assert.equal(await page.locator('#panel-czsk-leadgen .compact-grouped-table-controls').evaluate(controls => {
        const campaign = controls.querySelector('.filter-toggle').getBoundingClientRect();
        const sort = controls.querySelector('.metric-select').getBoundingClientRect();
        const direction = controls.querySelector('.sort-dir-btn').getBoundingClientRect();
        const groupLabel = controls.querySelector('.toggle-row .metric-label').getBoundingClientRect();
        const segmented = controls.querySelector('.segmented').getBoundingClientRect();
        return Math.max(campaign.top, sort.top, direction.top) - Math.min(campaign.top, sort.top, direction.top) <= 1
          && [campaign, sort, direction].every(box => box.height === 44)
          && groupLabel.bottom <= segmented.top
          && segmented.height === 44
          && [...controls.querySelectorAll('.segmented button')].every(button => button.getBoundingClientRect().height === 44);
      }), true);
      assert.equal(await page.locator('#leadgen-only').isVisible(), viewport.width > 720);
      assert.equal(await page.locator('#leadgen-only').isChecked(), false);
      assert.equal(await page.locator('#kpi-czsk-leadgen .kpi-card').count(), 2);
      assert.ok(await page.locator('#leadgen-table tbody tr').count() >= 8);
      assert.equal((await page.locator('#leadgen-table tbody').textContent()).includes('Lead-gen'), true);
      assert.equal((await page.locator('#leadgen-table tbody').textContent()).includes('Sales'), true);
      assert.match(await page.locator('#leadgen-table tbody').textContent(), /20\.00%/);
      assert.equal(await page.locator('#chart-metric-leadgen').inputValue(), 'spend');
      assert.equal(await page.locator('#chart-grain-leadgen').inputValue(), 'day');
      assert.ok(await page.evaluate(() => Boolean(window.Chart.getChart('chart-leadgen-metric')) && Boolean(window.Chart.getChart('chart-leadgen-pie'))));
      if (viewport.width <= 720) assert.equal(await page.locator('#panel-czsk-leadgen .axis-controls').evaluate(controls => {
        const metric = controls.querySelector('#chart-metric-leadgen').getBoundingClientRect();
        const grain = controls.querySelector('#chart-grain-leadgen').getBoundingClientRect();
        return metric.top === grain.top && metric.width > grain.width && controls.getBoundingClientRect().height <= 68;
      }), true);
      if (viewport.width <= 720) await page.screenshot({ path: path.join(evidenceDir, `${viewport.name}-leadgen.png`), fullPage: true });
      const dayPointCount = await page.evaluate(() => window.Chart.getChart('chart-leadgen-metric').data.labels.length);
      await page.locator('#chart-metric-leadgen').selectOption('leads');
      assert.equal(await page.locator('#leadgen-chart-title').textContent(), 'Leads By Group');
      assert.ok(await page.evaluate(() => window.Chart.getChart('chart-leadgen-metric').data.datasets.some(dataset => dataset.data.some(value => value > 0))));
      await page.locator('#chart-grain-leadgen').selectOption('week');
      assert.ok(await page.evaluate(count => window.Chart.getChart('chart-leadgen-metric').data.labels.length < count, dayPointCount));
      if (viewport.width <= 720) await page.locator('#mobile-controls-toggle').click();
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
      if (viewport.width <= 720) assert.equal(await page.locator('#panel-czsk-leadgen .axis-controls').evaluate(controls => {
        const boxes = ['#chart-left-leadgen', '#chart-right-leadgen', '#chart-grain-leadgen'].map(selector => controls.querySelector(selector).getBoundingClientRect());
        return boxes[0].left < boxes[1].left && boxes[1].left < boxes[2].left
          && Math.max(...boxes.map(box => box.top)) - Math.min(...boxes.map(box => box.top)) <= 1
          && controls.getBoundingClientRect().height <= 68;
      }), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      assert.deepEqual(await page.evaluate(() => window.Chart.getChart('chart-leadgen-metric').data.datasets.map(dataset => [dataset.type, dataset.yAxisID, dataset.label])), [['bar', 'y', 'Spend (CZK)'], ['line', 'y1', 'CPL (CZK)']]);
      if (viewport.width <= 720) await page.locator('#mobile-controls-toggle').click();
      if (viewport.width <= 720) await page.screenshot({ path: path.join(evidenceDir, `${viewport.name}-leadgen-only.png`), fullPage: true });
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
