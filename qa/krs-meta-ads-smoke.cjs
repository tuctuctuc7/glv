const { chromium } = require('playwright-core');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const publicRoot = path.join(root, 'public');
const chromePath = '/home/tom/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';
const browserLibRoot = '/home/tom/.cache/hermes-browser-libs/root';
const evidenceDir = path.resolve(process.env.KRS_META_QA_EVIDENCE_DIR || '/tmp/krs-meta-ads-qa');
fs.rmSync(evidenceDir, { recursive: true, force: true });
fs.mkdirSync(evidenceDir, { recursive: true });

const campaign = (id, name, spend, impressions, clicks, lpv, checkouts, purchases, value, date) => ({
  id, name, amount_spent: String(spend), impressions: String(impressions), inline_link_clicks: String(clicks),
  'actions:landing_page_view': String(lpv), 'actions:initiate_checkout': String(checkouts),
  'actions:purchase': String(purchases), 'action_values:purchase': String(value),
  date_start: date || null, date_stop: date || null,
});

const dates = Array.from({ length: 14 }, (_, index) => {
  const date = new Date('2026-08-01T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + index);
  return date.toISOString().slice(0, 10);
});
const daily = dates.flatMap(date => [
  campaign('c1', 'AG_KURSA_Core', 100, 1000, 20, 10, 4, 2, 400, date),
  campaign('c2', 'AG_KURSA_Retargeting', 50, 500, 10, 5, 1, 1, 120, date),
]);
const aggregate = [
  campaign('c1', 'AG_KURSA_Core', 1400, 14000, 280, 140, 56, 28, 5600),
  campaign('c2', 'AG_KURSA_Retargeting', 700, 7000, 140, 70, 14, 14, 1680),
];
const ads = [
  { ...campaign('a1', 'Founder proof video', 800, 8000, 180, 95, 34, 18, 3600), campaign_id: 'c1', campaign_name: 'AG_KURSA_Core', status: 'ACTIVE', video_3_sec_watched_actions: '2400', video_thruplay_watched_actions: '900' },
  { ...campaign('a2', 'Service outcome static', 600, 6000, 100, 45, 22, 10, 2000), campaign_id: 'c1', campaign_name: 'AG_KURSA_Core', status: 'ACTIVE', video_3_sec_watched_actions: '0', video_thruplay_watched_actions: '0' },
  { ...campaign('a3', 'Retargeting testimonial', 700, 7000, 140, 70, 14, 14, 1680), campaign_id: 'c2', campaign_name: 'AG_KURSA_Retargeting', status: 'PAUSED', video_3_sec_watched_actions: '0', video_thruplay_watched_actions: '0' },
];

function server() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/api/krs-meta-ads/fb-data') {
      const type = url.searchParams.get('type');
      const rows = type === 'aggregate' ? aggregate : type === 'daily' ? daily : ads;
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ rows }));
      return;
    }
    const relative = url.pathname.replace(/^\/+/, '') || 'index.html';
    let file = path.resolve(publicRoot, relative);
    if (!file.startsWith(publicRoot)) return res.writeHead(403).end();
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) return res.writeHead(404).end('Not found');
    const types = { '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.js': 'text/javascript' };
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
}

async function run() {
  const app = server();
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.address().port}/krs-meta-ads/`;
  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox'],
    env: { ...process.env, LD_LIBRARY_PATH: `${browserLibRoot}/usr/lib/x86_64-linux-gnu:${browserLibRoot}/usr/lib`, FONTCONFIG_PATH: `${browserLibRoot}/etc/fonts` },
  });
  const errors = [];
  try {
    for (const viewport of [
      { name: 'desktop-1440', width: 1440, height: 1000 },
      { name: 'tablet-800', width: 800, height: 950 },
      { name: 'mobile-390', width: 390, height: 844 },
      { name: 'mobile-320', width: 320, height: 780 },
    ]) {
      const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
      const page = await context.newPage();
      page.on('console', message => { if (message.type() === 'error') errors.push(`${viewport.name}: ${message.text()}`); });
      page.on('pageerror', error => errors.push(`${viewport.name}: ${error.message}`));
      page.on('response', response => { if (response.status() >= 400) errors.push(`${viewport.name}: HTTP ${response.status()} ${response.url()}`); });
      await page.goto(base, { waitUntil: 'networkidle' });
      await page.locator('#kpis .kpi-card').first().waitFor();

      assert.equal(await page.locator('#kpis .kpi-card').count(), 9);
      assert.equal(await page.locator('#kpis .kpi-card').nth(0).locator('.kpi-value').textContent(), '2,100 CZK');
      assert.equal(await page.locator('#kpis .kpi-card').nth(1).locator('.kpi-value').textContent(), '42');
      assert.equal(await page.locator('#kpis .kpi-card').nth(2).locator('.kpi-value').textContent(), '50 CZK');
      assert.match(await page.locator('#funnel').textContent(), /Checkout = CTA button click/);
      assert.match(await page.locator('#funnel').textContent(), /Purchase = qualified lead submit/);
      assert.equal(await page.evaluate(() => Boolean(window.Chart.getChart('trend-chart'))), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
      assert.equal(await page.locator('#date-from').inputValue(), await page.evaluate(() => presetBounds('last_30d').since));
      assert.equal(await page.locator('#date-to').inputValue(), await page.evaluate(() => presetBounds('last_30d').until));
      assert.deepEqual(await page.evaluate(() => ({
        zeroLeads: formatMetric('purchases', 0),
        zeroCtr: formatMetric('ctr', 0),
        undefinedCpl: formatMetric('cpa', null),
      })), { zeroLeads: '0', zeroCtr: '0.00%', undefinedCpl: '—' });
      assert.deepEqual(await page.evaluate(() => {
        const rows = [
          { ...empty({ date: '2026-08-01' }), spend: 10 },
          { ...empty({ date: '2026-08-07' }), spend: 20 },
          { ...empty({ date: '2026-08-08' }), spend: 30 },
          { ...empty({ date: '2026-08-14' }), spend: 40 },
        ];
        const result = comparison(rows, { since: '2026-08-01', until: '2026-08-14' });
        return { current: result.current.spend, previous: result.previous.spend };
      }), { current: 70, previous: 30 });

      if (viewport.width <= 760) {
        assert.equal(await page.locator('.brand-title').evaluate(element => element.getBoundingClientRect().right <= document.querySelector('.filters-toggle').getBoundingClientRect().left), true);
        assert.equal(await page.locator('#theme-toggle').isVisible(), viewport.width > 350);
        assert.equal(await page.locator('.tabs').evaluate(element => getComputedStyle(element).position), 'fixed');
        assert.equal(await page.locator('#kpis').evaluate(element => element.scrollWidth > element.clientWidth), true);
        assert.equal(await page.locator('.tabs .tab').evaluateAll(elements => elements.every(element => { const box = element.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth && box.bottom <= innerHeight + 1; })), true);
        assert.equal(await page.locator('.axis-controls').evaluate(element => getComputedStyle(element).display), 'grid');
        assert.equal(await page.locator('.axis-controls .select').evaluateAll(elements => elements.every(element => element.getBoundingClientRect().height === 44)), true);
        await page.locator('#filters-toggle').click();
        assert.equal(await page.locator('#filters-toggle').getAttribute('aria-expanded'), 'true');
        assert.equal(await page.locator('#filters-menu').isVisible(), true);
        assert.equal(await page.locator('#filters-menu input').evaluateAll(elements => elements.every(element => element.getBoundingClientRect().height >= 42)), true);
        await page.locator('#filters-toggle').click();

        await page.locator('[data-tab="campaigns"]').click();
        assert.equal(await page.locator('#panel-campaigns').isVisible(), true);
        assert.equal(await page.locator('#campaign-table tbody tr').count(), 2);
        assert.equal(await page.locator('#campaign-table tbody td').first().evaluate(element => getComputedStyle(element).position), 'sticky');
        assert.equal(await page.locator('#campaign-table tbody td').nth(1).evaluate(element => getComputedStyle(element).position), 'static');
        assert.equal(await page.locator('#campaign-table thead th').evaluateAll(elements => elements.every(element => getComputedStyle(element).position === 'sticky' && getComputedStyle(element).top === '0px')), true);
        await page.locator('#campaign-toggle').click();
        assert.equal(await page.locator('#campaign-toggle').getAttribute('aria-expanded'), 'true');
        assert.equal(await page.locator('.campaign-option').first().evaluate(element => element.getBoundingClientRect().height >= 44), true);
        await page.locator('#campaign-done').click();
        assert.equal(await page.locator('#campaign-toggle').getAttribute('aria-expanded'), 'false');
        await page.screenshot({ path: path.join(evidenceDir, `${viewport.name}-campaigns.png`) });

        await page.locator('[data-tab="creatives"]').click();
        assert.equal(await page.locator('#creative-table tbody tr').count(), 3);
        await page.locator('#creative-type').selectOption('video');
        assert.equal(await page.locator('#creative-table tbody tr').count(), 1);
        await page.screenshot({ path: path.join(evidenceDir, `${viewport.name}-creatives.png`) });
        await page.locator('[data-tab="overview"]').click();
      } else {
        const columns = await page.locator('#kpis').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length);
        assert.equal(columns, viewport.width >= 1180 ? 5 : 3);
        assert.equal(await page.locator('.tabs').evaluate(element => getComputedStyle(element).position), 'static');
      }

      await page.screenshot({ path: path.join(evidenceDir, `${viewport.name}-overview-dark.png`) });
      if (viewport.width > 350) await page.locator('#theme-toggle').click();
      else await page.evaluate(() => setTheme('light'));
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
      assert.equal(await page.locator('#theme-toggle').getAttribute('aria-label'), 'Switch to dark theme');
      await page.screenshot({ path: path.join(evidenceDir, `${viewport.name}-overview-light.png`) });
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
