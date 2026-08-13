const { chromium } = require('playwright-core');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const projectRoot = path.resolve(__dirname, '..');
const publicRoot = path.join(projectRoot, 'public');
const chromePath = '/home/tom/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';
const browserLibRoot = '/home/tom/.cache/hermes-browser-libs/root';
const evidenceDir = path.resolve(process.env.GLV_QA_EVIDENCE_DIR || path.join(projectRoot, 'qa', 'screenshots'));
fs.mkdirSync(evidenceDir, { recursive: true });

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function server() {
  return http.createServer((req, res) => {
    const requestPath = new URL(req.url, 'http://127.0.0.1').pathname;
    const relative = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
    let filePath = path.resolve(publicRoot, relative);
    if (!filePath.startsWith(publicRoot)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, 'index.html');
    if (!fs.existsSync(filePath)) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

async function run() {
  assert.ok(fs.existsSync(chromePath), `Chromium not found at ${chromePath}`);
  const appServer = server();
  await new Promise((resolve) => appServer.listen(0, '127.0.0.1', resolve));
  const { port } = appServer.address();
  const baseUrl = `http://127.0.0.1:${port}/glv-2/`;
  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    env: {
      ...process.env,
      LD_LIBRARY_PATH: `${browserLibRoot}/usr/lib/x86_64-linux-gnu:${browserLibRoot}/usr/lib`,
      FONTCONFIG_PATH: `${browserLibRoot}/etc/fonts`,
      XDG_DATA_DIRS: `${browserLibRoot}/usr/share`,
    },
  });

  const consoleErrors = [];
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
      acceptDownloads: true,
      colorScheme: 'dark',
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

    const response = await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 30_000 });
    assert.equal(response.status(), 200);
    await page.locator('#dashboardContent').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#executiveKpis .kpi-card').count(), 8);
    assert.equal(await page.locator('#marketComparisonBody tr').count(), 4);
    assert.match(await page.locator('#marketComparisonBody tr').nth(2).textContent(), /ROW/);
    assert.match(await page.locator('#marketComparisonBody tr').last().textContent(), /Total/);
    const marketContainment = await page.locator('#marketComparison').evaluate((section) => {
      const total = section.querySelector('.market-total-row').getBoundingClientRect();
      const bounds = section.getBoundingClientRect();
      return { totalBottom: total.bottom, sectionBottom: bounds.bottom };
    });
    assert.ok(marketContainment.totalBottom <= marketContainment.sectionBottom, `market Total row should not be clipped: ${JSON.stringify(marketContainment)}`);
    assert.match(await page.locator('#activeRange').textContent(), /Jul 16, 2026.*Aug 12, 2026/);
    assert.match(await page.locator('#comparisonLabel').textContent(), /no targets configured/);
    assert.ok(await page.locator('#trendChart').isVisible(), 'primary trend should be open by default');
    assert.equal(await page.locator('#trendMetric').inputValue(), 'revenue');
    assert.equal(await page.locator('#trendMetricSecondary').inputValue(), 'roas');
    const chartContract = await page.evaluate(() => window.Chart.getChart('trendChart').data.datasets.map((dataset) => ({ type: dataset.type, label: dataset.label, yAxisID: dataset.yAxisID })));
    assert.deepEqual(chartContract, [
      { type: 'bar', label: 'Revenue', yAxisID: 'y' },
      { type: 'line', label: 'ROAS', yAxisID: 'y1' },
    ]);
    assert.equal(await page.locator('#trendDataBody tr').count(), 28);
    assert.equal(await page.locator('#trendDataBody tr').first().locator('td').count(), 3);
    assert.match(await page.locator('#trendDataCaption').textContent(), /Revenue and ROAS by day/);
    assert.equal(await page.locator('#metricsTableBody tr').count(), 29);
    assert.match(await page.locator('#metricsTableBody tr').first().textContent(), /Selected period/);
    assert.equal(await page.locator('#metricsTable thead th').count(), 11);
    assert.doesNotMatch(await page.locator('#metricsTable thead').textContent(), /New customers|Returning customers/);
    assert.match(await page.locator('#executiveKpis').textContent(), /New customer rate/);
    assert.doesNotMatch(await page.locator('#executiveKpis').textContent(), /Visitors/);
    assert.match(await page.locator('.header-brand').textContent(), /GELAVIS · Business intelligence by AGENTHIC/);
    assert.ok(await page.locator('.brand-mark img').isVisible(), 'AGENTHIC logo should be visible');
    const logoGeometry = await page.locator('.brand-mark img').evaluate((node) => ({ image: node.getBoundingClientRect().toJSON(), mark: node.parentElement.getBoundingClientRect().toJSON() }));
    assert.equal(logoGeometry.image.width, logoGeometry.mark.width, 'logo should fill its square horizontally');
    assert.equal(logoGeometry.image.height, logoGeometry.mark.height, 'logo should fill its square vertically');
    assert.equal(await page.locator('.section-toggle[aria-controls="executiveKpis"]').count(), 0, 'KPI section must not have a toggle');
    assert.ok(await page.locator('#executiveKpis').isVisible(), 'KPI cards must stay visible');
    for (const target of ['trendContent', 'auditContent', 'marketComparisonContent']) {
      const toggle = page.locator(`.section-toggle[aria-controls="${target}"]`);
      await toggle.click();
      assert.equal(await page.locator(`#${target}`).isVisible(), false, `${target} should collapse`);
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      await toggle.click();
      assert.equal(await page.locator(`#${target}`).isVisible(), true, `${target} should expand`);
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    }
    assert.equal(await page.locator('#trendMetric option').count(), 11);
    assert.equal(await page.locator('#trendMetricSecondary option').count(), 11);
    await page.locator('#trendMetric').selectOption('roas');
    await page.locator('#trendMetricSecondary').selectOption('revenue');
    assert.deepEqual(await page.evaluate(() => window.Chart.getChart('trendChart').data.datasets.map((dataset) => ({ type: dataset.type, label: dataset.label, filled: dataset.fill === true }))), [
      { type: 'bar', label: 'ROAS', filled: false },
      { type: 'line', label: 'Revenue', filled: false },
    ]);
    await page.locator('#trendMetric').selectOption('none');
    await page.locator('#trendMetricSecondary').selectOption('none');
    assert.equal(await page.evaluate(() => window.Chart.getChart('trendChart').data.datasets.length), 0);
    await page.locator('#trendMetric').selectOption('revenue');
    await page.locator('#trendMetricSecondary').selectOption('roas');
    assert.match(await page.locator('#tableSubtitle').textContent(), /Summary \+ 28 day rows/);
    const auditGeometry = await page.locator('#auditTableWrap').evaluate((node) => ({ clientHeight: node.clientHeight, scrollHeight: node.scrollHeight, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth }));
    assert.ok(auditGeometry.scrollHeight > auditGeometry.clientHeight, `audit trail should scroll vertically: ${JSON.stringify(auditGeometry)}`);
    assert.ok(auditGeometry.scrollWidth > auditGeometry.clientWidth, `audit trail should scroll horizontally: ${JSON.stringify(auditGeometry)}`);
    const auditWidths = await page.locator('#metricsTable thead th').evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().width)));
    assert.ok(Math.max(...auditWidths) - Math.min(...auditWidths) <= 1, `audit columns should be equal width: ${auditWidths}`);
    const auditHeaderContract = await page.locator('#metricsTable thead th').evaluateAll((nodes) => nodes.map((node) => {
      const style = getComputedStyle(node);
      return { height: Math.round(node.getBoundingClientRect().height), whiteSpace: style.whiteSpace, textOverflow: style.textOverflow };
    }));
    assert.ok(auditHeaderContract.every((header) => header.height >= 52 && header.whiteSpace === 'normal' && header.textOverflow !== 'ellipsis'), `audit headers should wrap over two lines without ellipses: ${JSON.stringify(auditHeaderContract)}`);
    const stickyTotalBackground = await page.locator('#metricsTableBody .summary-row td').first().evaluate((node) => getComputedStyle(node).backgroundColor);
    assert.notEqual(stickyTotalBackground, 'rgba(0, 0, 0, 0)', 'sticky selected-period row must have an opaque background');
    assert.notEqual(stickyTotalBackground, 'transparent', 'sticky selected-period row must have an opaque background');
    assert.equal(await page.getByText('PoP movement · no target verdict', { exact: true }).count(), 0);
    const visibleAuditRows = await page.locator('#auditTableWrap').evaluate((wrap) => {
      const bounds = wrap.getBoundingClientRect();
      return [...wrap.querySelectorAll('tbody tr')].filter((row) => {
        const rect = row.getBoundingClientRect();
        return rect.top >= bounds.top && rect.bottom <= bounds.bottom;
      }).length;
    });
    assert.equal(visibleAuditRows, 14, `audit viewport should show exactly 14 complete body rows, got ${visibleAuditRows}`);
    await page.locator('#grain').selectOption('week');
    assert.equal(await page.locator('#trendDataBody tr').count(), 5, 'accessible chart table must follow weekly chart grain');
    assert.match(await page.locator('#trendDataCaption').textContent(), /Revenue and ROAS by week/);
    assert.equal(await page.locator('#metricsTableBody tr').count(), 29, 'chart grain must not reduce selected-date detail rows');
    assert.match(await page.locator('#tableSubtitle').textContent(), /Summary \+ 28 day rows/);
    await page.locator('#grain').selectOption('day');
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(50);
    await page.screenshot({ path: path.join(evidenceDir, 'desktop-dark.png'), fullPage: true });
    assert.equal(await page.locator('#errorState').isVisible(), false);
    assert.match(await page.locator('#trendLegend').textContent(), /Revenue[\s\S]*ROAS/);
    const desktopOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(desktopOverflow <= 1, `desktop horizontal overflow: ${desktopOverflow}px`);

    await page.locator('[data-region="us"]').click();
    await page.waitForTimeout(100);
    assert.equal((await page.locator('#scopeMarkets').textContent()).trim(), 'US');
    assert.equal(new URL(page.url()).searchParams.get('markets'), 'us');
    assert.equal(await page.locator('#marketComparisonBody tr').count(), 2);
    assert.match(await page.locator('#marketComparisonBody').textContent(), /US/);

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#exportCsv').click();
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /^glv-.*\.csv$/);

    await page.locator('#themeToggle').click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    await page.waitForTimeout(200);
    const lightKpiStyles = await page.locator('.kpi-card').first().evaluate((node) => {
      const style = getComputedStyle(node);
      const parentStyle = getComputedStyle(node.parentElement);
      return {
        backgroundColor: style.backgroundColor,
        color: style.color,
        opacity: style.opacity,
        filter: style.filter,
        parentOpacity: parentStyle.opacity,
        parentFilter: parentStyle.filter,
      };
    });
    assert.equal(lightKpiStyles.backgroundColor, 'rgb(255, 255, 255)', `light KPI surface: ${JSON.stringify(lightKpiStyles)}`);
    assert.equal(lightKpiStyles.color, 'rgb(17, 24, 32)', `light KPI text: ${JSON.stringify(lightKpiStyles)}`);
    await page.screenshot({ path: path.join(evidenceDir, 'desktop-light-us.png'), fullPage: true });
    await page.locator('[data-region="all"]').click();
    await page.locator('[data-region="row"]').click();
    assert.equal((await page.locator('#scopeMarkets').textContent()).trim(), 'ROW');
    assert.equal(await page.locator('#metricsTableBody tr').count(), 29);
    await page.locator('#dateFrom').fill('2026-08-12');
    await page.locator('#dateFrom').dispatchEvent('change');
    await page.locator('#dateTo').fill('2026-08-11');
    await page.locator('#dateTo').dispatchEvent('change');
    assert.equal(await page.locator('#errorState').isVisible(), true);
    assert.match(await page.locator('#errorMessage').textContent(), /From is on or before To/);
    assert.equal(await page.locator('#dashboardContent').isVisible(), false);
    await context.close();

    const invalidUrlContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark', reducedMotion: 'reduce' });
    const invalidUrl = await invalidUrlContext.newPage();
    await invalidUrl.goto(`${baseUrl}?metric=roas&metric2=revenue`, { waitUntil: 'networkidle', timeout: 30_000 });
    await invalidUrl.locator('#dashboardContent').waitFor({ state: 'visible' });
    assert.equal(await invalidUrl.locator('#trendMetric').inputValue(), 'roas', 'every supported metric must restore in the bar selector');
    assert.equal(await invalidUrl.locator('#trendMetricSecondary').inputValue(), 'revenue', 'every supported metric must restore in the line selector');
    assert.equal(await invalidUrl.locator('#errorState').isVisible(), false);
    await invalidUrlContext.close();

    const slashlessContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark', reducedMotion: 'reduce' });
    const slashless = await slashlessContext.newPage();
    await slashless.goto(baseUrl.replace(/\/$/, ''), { waitUntil: 'networkidle', timeout: 30_000 });
    await slashless.locator('#dashboardContent').waitFor({ state: 'visible' });
    assert.equal(await slashless.locator('#errorState').isVisible(), false, 'slashless /glv-2 must load all route assets and data');
    await slashlessContext.close();

    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', reducedMotion: 'reduce' });
    const mobile = await mobileContext.newPage();
    mobile.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(`mobile: ${message.text()}`);
    });
    mobile.on('pageerror', (error) => consoleErrors.push(`mobile pageerror: ${error.message}`));
    await mobile.goto(baseUrl, { waitUntil: 'networkidle', timeout: 30_000 });
    await mobile.locator('#dashboardContent').waitFor({ state: 'visible' });
    assert.match(await mobile.locator('#dataThrough').textContent(), /Through/);
    assert.equal(await mobile.locator('#dashboardFilters').isVisible(), false);
    const mobileOverflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const mobileOverflowContext = await mobile.evaluate(() => {
      const trendTable = document.querySelector('#trendDataTable');
      const detailWrap = document.querySelector('#metricsTable').parentElement;
      return {
        bodyScrollWidth: document.body.scrollWidth,
        rootScrollWidth: document.documentElement.scrollWidth,
        trendRect: trendTable.getBoundingClientRect().toJSON(),
        trendMinWidth: getComputedStyle(trendTable).minWidth,
        detailWrapRect: detailWrap.getBoundingClientRect().toJSON(),
        detailWrapScrollWidth: detailWrap.scrollWidth,
      };
    });
    const mobileOverflowSources = await mobile.evaluate(() => [...document.querySelectorAll('body *')]
      .map((node) => ({
        tag: node.tagName,
        id: node.id,
        className: typeof node.className === 'string' ? node.className : '',
        right: node.getBoundingClientRect().right,
        width: node.getBoundingClientRect().width,
        parent: node.parentElement ? `${node.parentElement.tagName}#${node.parentElement.id}.${node.parentElement.className}` : '',
        parentWidth: node.parentElement?.getBoundingClientRect().width,
        parentOverflowX: node.parentElement ? getComputedStyle(node.parentElement).overflowX : '',
      }))
      .filter(({ right, width }) => right > window.innerWidth + 1 || width > window.innerWidth + 1)
      .sort((a, b) => b.right - a.right)
      .slice(0, 8));
    assert.ok(mobileOverflow <= 1, `mobile horizontal overflow: ${mobileOverflow}px; context: ${JSON.stringify(mobileOverflowContext)}; sources: ${JSON.stringify(mobileOverflowSources)}`);
    const mobileDecisionOrder = await mobile.evaluate(() => ({
      kpis: document.querySelector('#executiveKpis').getBoundingClientRect().top,
      trend: document.querySelector('#trendSection').getBoundingClientRect().top,
      details: document.querySelector('#details').getBoundingClientRect().top,
      markets: document.querySelector('#marketComparison').getBoundingClientRect().top,
    }));
    assert.ok(mobileDecisionOrder.kpis < mobileDecisionOrder.trend && mobileDecisionOrder.trend < mobileDecisionOrder.details && mobileDecisionOrder.details < mobileDecisionOrder.markets,
      `mobile order should be KPI health → main trend → audit trail → market comparison: ${JSON.stringify(mobileDecisionOrder)}`);
    assert.equal(await mobile.locator('[data-market-segment]').count(), 0, 'market segment buttons should be removed');
    const marketScroll = await mobile.locator('#marketComparisonWrap').evaluate((node) => ({ clientWidth: node.clientWidth, scrollWidth: node.scrollWidth }));
    assert.ok(marketScroll.scrollWidth > marketScroll.clientWidth, `market comparison should scroll inside its section: ${JSON.stringify(marketScroll)}`);
    await mobile.locator('#marketComparison .section-toggle').click();
    assert.equal(await mobile.locator('#marketComparisonContent').isVisible(), false, 'market comparison section should collapse');
    await mobile.locator('#marketComparison .section-toggle').click();
    assert.equal(await mobile.locator('#marketComparisonContent').isVisible(), true, 'market comparison section should expand');
    await mobile.locator('#details').scrollIntoViewIfNeeded();
    assert.ok(await mobile.locator('#details').isVisible(), 'performance detail should be reachable by vertical scrolling');
    await mobile.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      window.scrollTo(0, 0);
    });
    await mobile.waitForTimeout(50);
    await mobile.screenshot({ path: path.join(evidenceDir, 'mobile-dark-filters.png'), fullPage: true });
    await mobileContext.close();

    const narrowContext = await browser.newContext({ viewport: { width: 320, height: 720 }, colorScheme: 'dark', reducedMotion: 'reduce' });
    const narrow = await narrowContext.newPage();
    narrow.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(`narrow: ${message.text()}`);
    });
    narrow.on('pageerror', (error) => consoleErrors.push(`narrow pageerror: ${error.message}`));
    await narrow.goto(baseUrl, { waitUntil: 'networkidle', timeout: 30_000 });
    await narrow.locator('#dashboardContent').waitFor({ state: 'visible' });
    await narrow.locator('#filtersToggle').click();
    const narrowOverflow = await narrow.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(narrowOverflow <= 1, `320px page overflow: ${narrowOverflow}px`);
    const undersizedTargets = await narrow.evaluate(() => [...document.querySelectorAll('button, select, input')]
      .filter((node) => {
        const style = getComputedStyle(node);
        return node.getClientRects().length > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      })
      .map((node) => ({ id: node.id || node.textContent.trim(), rect: node.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width < 44 || rect.height < 44)
      .map(({ id, rect }) => ({ id, width: rect.width, height: rect.height })));
    assert.deepEqual(undersizedTargets, [], `interactive targets below 44px: ${JSON.stringify(undersizedTargets)}`);
    await narrow.screenshot({ path: path.join(evidenceDir, 'mobile-320-dark-filters.png'), fullPage: true });
    await narrowContext.close();

    const errorContext = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', reducedMotion: 'reduce' });
    const errorPage = await errorContext.newPage();
    await errorPage.route('**/glv_dashboard.json', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"currency":"EUR","rows":[]}' }));
    await errorPage.goto(baseUrl, { waitUntil: 'networkidle', timeout: 30_000 });
    assert.equal(await errorPage.locator('#errorState').isVisible(), true);
    assert.match(await errorPage.locator('#errorMessage').textContent(), /invalid structure|currency must be USD/i);
    assert.equal(await errorPage.locator('#dashboardContent').isVisible(), false);
    await errorContext.close();

    assert.deepEqual(consoleErrors, [], `browser console errors: ${consoleErrors.join(' | ')}`);
    console.log(JSON.stringify({
      passed: true,
      baseUrl,
      screenshots: [
        path.join(evidenceDir, 'desktop-dark.png'),
        path.join(evidenceDir, 'desktop-light-us.png'),
        path.join(evidenceDir, 'mobile-dark-filters.png'),
        path.join(evidenceDir, 'mobile-320-dark-filters.png'),
      ],
      consoleErrors,
    }, null, 2));
  } finally {
    await browser.close();
    await new Promise((resolve) => appServer.close(resolve));
  }
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
