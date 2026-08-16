const { chromium } = require('playwright-core');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const publicRoot = path.join(root, 'public');
const chromePath = '/home/tom/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';
const browserLibRoot = '/home/tom/.cache/hermes-browser-libs/root';
const evidenceDir = path.resolve(process.env.ELM_THEME_QA_EVIDENCE_DIR || '/tmp/elm-theme-qa');
fs.rmSync(evidenceDir, { recursive: true, force: true });
fs.mkdirSync(evidenceDir, { recursive: true });

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function contrastRatio(foreground, background) {
  const parse = value => {
    if (/^#[\da-f]{6}$/i.test(value)) return [1, 3, 5].map(index => Number.parseInt(value.slice(index, index + 2), 16));
    return value.match(/[\d.]+/g).slice(0, 3).map(Number);
  };
  const luminance = value => {
    const channels = parse(value).map(channel => {
      const normalized = channel / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function server() {
  return http.createServer((req, res) => {
    const requestPath = new URL(req.url, 'http://127.0.0.1').pathname;
    const relative = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
    let filePath = path.resolve(publicRoot, relative);
    if (!filePath.startsWith(publicRoot)) return res.writeHead(403).end('Forbidden');
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, 'index.html');
    if (!fs.existsSync(filePath)) return res.writeHead(404).end('Not found');
    res.writeHead(200, { 'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(filePath).pipe(res);
  });
}

async function exerciseViewport(browser, baseUrl, viewport) {
  const errors = [];
  const context = await browser.newContext({ viewport, colorScheme: 'dark', reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('console', message => {
    const sourceUrl = message.location().url || '';
    if (message.type() === 'error' && !sourceUrl.endsWith('/favicon.ico')) {
      errors.push(`${viewport.name}: ${message.text()} (${sourceUrl || 'unknown URL'})`);
    }
  });
  page.on('pageerror', error => errors.push(`${viewport.name}: ${error.message}`));
  page.on('response', response => { if (response.status() >= 400) errors.push(`${viewport.name}: HTTP ${response.status()} ${response.url()}`); });
  page.on('requestfailed', request => errors.push(`${viewport.name}: request failed ${request.url()} (${request.failure()?.errorText || 'unknown'})`));

  const response = await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 30_000 });
  assert.equal(response.status(), 200);
  await page.locator('#kpiGrid .kpi').first().waitFor({ state: 'visible' });
  const dualAxisLegendOrder = await page.evaluate(() => Object.values(window.Chart.instances)
    .filter(chart => new Set(chart.data.datasets.map(dataset => dataset.yAxisID).filter(Boolean)).size > 1)
    .map(chart => ({
      id: chart.canvas.id,
      positions: chart.legend.legendItems.map(item => {
        const axis = chart.data.datasets[item.datasetIndex].yAxisID;
        return chart.options.scales[axis]?.position || 'left';
      }),
    })));
  assert.ok(dualAxisLegendOrder.length >= 4, JSON.stringify(dualAxisLegendOrder));
  assert.equal(dualAxisLegendOrder.every(chart => chart.positions.join(',').match(/^left(?:,left)*,right$/)), true, JSON.stringify(dualAxisLegendOrder));
  assert.equal(await page.locator('#kpiGrid .kpi').count(), 6);
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  assert.equal(await page.locator('#languageToggle').getAttribute('aria-label'), 'Switch to Vietnamese');
  assert.equal((await page.locator('#languageToggle').textContent()).trim(), '🇻🇳');
  assert.ok(await page.locator('#languageToggle').evaluate(node => node.getBoundingClientRect().height >= 42));
  await page.locator('#languageToggle').click();
  await page.waitForTimeout(50);
  assert.equal(await page.locator('html').getAttribute('lang'), 'vi');
  assert.equal(await page.locator('#languageToggle').getAttribute('aria-label'), 'Chuyển sang tiếng Anh');
  assert.equal((await page.locator('#languageToggle').textContent()).trim(), '🇬🇧');
  assert.equal(await page.locator('#themeToggle').getAttribute('aria-label'), 'Giao diện sáng');
  assert.equal((await page.locator('h1').innerText()).replace(/\s+/g, ' ').trim(), 'Theo dõi biến động tháng. Tìm nguyên nhân.');
  assert.equal((await page.locator('#kpiGrid .kpi span').first().textContent()).trim(), 'Chi tiêu');
  assert.equal((await page.locator('#kpiGrid .kpi strong').nth(1).textContent()).trim(), '3,19x');
  assert.equal((await page.locator('#kpiGrid .kpi strong').nth(3).textContent()).trim(), '1,3%');
  assert.equal(await page.evaluate(() => window.Chart.getChart('growthChart').options.scales.secondary.ticks.callback(3.19)), '3,19x');
  assert.equal(await page.evaluate(() => window.Chart.getChart('regionBaselineChart').options.scales.share.ticks.callback(1.3)), '1,3%');
  assert.equal(await page.evaluate(() => window.Chart.getChart('regionBaselineChart').options.plugins.tooltip.callbacks.label({ dataset: { yAxisID: 'share', label: 'Tỷ trọng' }, raw: 1.3 })), 'Tỷ trọng: 1,3%');
  assert.equal((await page.locator('#mappingCoverage').textContent()).trim(), '99,99%');
  assert.equal((await page.locator('#growthTitle').textContent()).trim(), 'Chi tiêu × ROAS định hướng');
  assert.equal((await page.locator('#exportButton').textContent()).trim(), 'Xuất CSV theo bộ lọc');
  assert.equal(await page.locator('#regionMonthlyTable').evaluate(node => node.closest('table').querySelector('thead th:last-child').textContent.trim()), 'CPC miền Nam');
  const vietnameseHeadings = await page.locator('h2').allTextContents();
  [
    'Góc nhìn vận hành tăng trưởng',
    'ROAS, chi phí, chuyển đổi và giá trị đơn hàng',
    'Hai tài khoản, hai đường xu hướng',
    'Phân tách theo ngành hàng, không phải vai trò tài khoản',
    'Phân tích riêng từng tháng',
    'Sức kéo nhu cầu Q4 theo ô',
    'Những gì tạo thành kế hoạch vận hành miền Nam',
    'Các nhóm hiển thị trong hệ thống đặt tên',
    'Cấu trúc hiển thị trong thiết lập',
    'Miền Nam như một thị trường mở rộng',
    'Phân tích bất thường được chuyển xuống phụ lục',
    'Những gì vẫn cần bằng chứng từ backend',
  ].forEach(heading => assert.ok(vietnameseHeadings.includes(heading), `Missing Vietnamese heading: ${heading}`));
  assert.equal(await page.evaluate(() => localStorage.getItem('elm-meta-language')), 'vi');
  await page.screenshot({ path: path.join(evidenceDir, `${viewport.name}-vi-dark.png`) });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#kpiGrid .kpi').first().waitFor({ state: 'visible' });
  assert.equal(await page.locator('html').getAttribute('lang'), 'vi');
  assert.equal((await page.locator('#languageToggle').textContent()).trim(), '🇬🇧');
  assert.equal((await page.locator('#growthTitle').textContent()).trim(), 'Chi tiêu × ROAS định hướng');
  await page.locator('#languageToggle').click();
  await page.waitForTimeout(50);
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  assert.equal((await page.locator('#languageToggle').textContent()).trim(), '🇻🇳');
  assert.equal((await page.locator('#growthTitle').textContent()).trim(), 'Spend × Directional ROAS');
  assert.equal((await page.locator('#kpiGrid .kpi strong').nth(1).textContent()).trim(), '3.19x');
  assert.equal((await page.locator('#kpiGrid .kpi strong').nth(3).textContent()).trim(), '1.3%');
  assert.equal(await page.evaluate(() => window.Chart.getChart('growthChart').options.scales.secondary.ticks.callback(3.19)), '3.19x');
  assert.equal(await page.evaluate(() => window.Chart.getChart('regionBaselineChart').options.scales.share.ticks.callback(1.3)), '1.3%');
  assert.equal(await page.evaluate(() => window.Chart.getChart('regionBaselineChart').options.plugins.tooltip.callbacks.label({ dataset: { yAxisID: 'share', label: 'Share' }, raw: 1.3 })), 'Share: 1.3%');
  assert.equal((await page.locator('#mappingCoverage').textContent()).trim(), '99.99%');
  const languageChartCount = await page.evaluate(() => Object.keys(window.Chart.instances).length);
  for (let index = 0; index < 4; index += 1) await page.locator('#languageToggle').click();
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  assert.equal(await page.evaluate(() => Object.keys(window.Chart.instances).length), languageChartCount);
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  assert.equal(await page.locator('#themeToggle').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('#themeToggle').getAttribute('aria-label'), 'Bright theme');
  assert.equal((await page.locator('#themeToggle').textContent()).trim(), '☾');
  assert.equal(await page.locator('#themeToggle .theme-toggle-label').count(), 0);
  assert.ok(await page.getByRole('button', { name: 'Bright theme', pressed: false }).isVisible());
  assert.ok(await page.locator('#themeToggle').isVisible());
  assert.ok(await page.locator('#themeToggle').evaluate(node => node.getBoundingClientRect().height >= 42));
  assert.equal(await page.locator('#errorState').isVisible(), false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 0);

  await page.locator('#dateFrom').focus();
  const darkTheme = await page.evaluate(() => ({
    body: getComputedStyle(document.body).color,
    background: getComputedStyle(document.documentElement).backgroundColor,
    chartText: window.Chart.defaults.color,
    focus: getComputedStyle(document.getElementById('dateFrom')).outlineColor,
    inputBackground: getComputedStyle(document.getElementById('dateFrom')).backgroundColor,
    exportColor: getComputedStyle(document.getElementById('exportButton')).color,
    exportBackground: getComputedStyle(document.getElementById('exportButton')).backgroundColor,
  }));
  assert.equal(darkTheme.background, 'rgb(9, 16, 25)');
  assert.equal(darkTheme.chartText, '#9aacc1');
  assert.ok(contrastRatio(darkTheme.focus, darkTheme.inputBackground) >= 3);
  assert.ok(contrastRatio(darkTheme.exportColor, darkTheme.exportBackground) >= 4.5);
  await page.screenshot({ path: path.join(evidenceDir, `${viewport.name}-dark.png`) });

  await page.locator('#themeToggle').click();
  await page.waitForTimeout(50);
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  assert.equal(await page.locator('#themeToggle').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#themeToggle').getAttribute('aria-label'), 'Bright theme');
  assert.equal((await page.locator('#themeToggle').textContent()).trim(), '☀');
  assert.ok(await page.getByRole('button', { name: 'Bright theme', pressed: true }).isVisible());
  await page.locator('#dateFrom').focus();
  const lightTheme = await page.evaluate(() => ({
    stored: localStorage.getItem('elm-meta-theme'),
    body: getComputedStyle(document.body).color,
    background: getComputedStyle(document.documentElement).backgroundColor,
    card: getComputedStyle(document.querySelector('.chart-card')).backgroundImage,
    chartText: window.Chart.defaults.color,
    doughnutBorder: window.Chart.getChart('creativeChart').data.datasets[0].borderColor,
    focus: getComputedStyle(document.getElementById('dateFrom')).outlineColor,
    inputBackground: getComputedStyle(document.getElementById('dateFrom')).backgroundColor,
    exportColor: getComputedStyle(document.getElementById('exportButton')).color,
    exportBackground: getComputedStyle(document.getElementById('exportButton')).backgroundColor,
    axisColors: [...new Set(Object.values(window.Chart.instances).flatMap(chart => Object.values(chart.options.scales || {}).flatMap(scale => [scale.ticks?.color, scale.title?.color]).filter(Boolean)))],
  }));
  assert.equal(lightTheme.stored, 'light');
  assert.equal(lightTheme.background, 'rgb(244, 247, 251)');
  assert.notEqual(lightTheme.body, darkTheme.body);
  assert.match(lightTheme.card, /linear-gradient/);
  assert.equal(lightTheme.chartText, '#5d7085');
  assert.equal(lightTheme.doughnutBorder, '#ffffff');
  assert.ok(contrastRatio(lightTheme.focus, lightTheme.inputBackground) >= 3);
  assert.ok(contrastRatio(lightTheme.exportColor, lightTheme.exportBackground) >= 4.5);
  lightTheme.axisColors.forEach(color => assert.ok(contrastRatio(color, 'rgb(244, 247, 251)') >= 4.5, `Light chart axis color ${color} must meet 4.5:1`));
  await page.screenshot({ path: path.join(evidenceDir, `${viewport.name}-light.png`) });
  const lightChartCount = await page.evaluate(() => Object.keys(window.Chart.instances).length);
  await page.locator('#languageToggle').click();
  assert.equal(await page.locator('html').getAttribute('lang'), 'vi');
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  assert.equal(await page.locator('#themeToggle').getAttribute('aria-label'), 'Giao diện sáng');
  assert.equal((await page.locator('#themeToggle').textContent()).trim(), '☀');
  assert.equal(await page.evaluate(() => Object.keys(window.Chart.instances).length), lightChartCount);
  await page.screenshot({ path: path.join(evidenceDir, `${viewport.name}-vi-light.png`) });
  await page.locator('#languageToggle').click();
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');

  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#kpiGrid .kpi').first().waitFor({ state: 'visible' });
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  assert.equal(await page.locator('#themeToggle').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#themeToggle').getAttribute('aria-label'), 'Bright theme');
  assert.equal((await page.locator('#themeToggle').textContent()).trim(), '☀');
  assert.equal(await page.evaluate(() => window.Chart.defaults.color), '#5d7085');

  const chartCount = await page.evaluate(() => Object.keys(window.Chart.instances).length);
  for (let index = 0; index < 4; index += 1) await page.locator('#themeToggle').click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  assert.equal(await page.evaluate(() => Object.keys(window.Chart.instances).length), chartCount);

  if (viewport.width >= 1000) {
    await page.locator('#growthChart').scrollIntoViewIfNeeded();
    await page.waitForTimeout(50);
    await page.locator('#growthChart').locator('..').screenshot({ path: path.join(evidenceDir, `${viewport.name}-light-chart.png`) });
  }

  assert.deepEqual(errors, []);
  await context.close();
}

async function run() {
  assert.ok(fs.existsSync(chromePath), `Chromium not found at ${chromePath}`);
  const app = server();
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${app.address().port}/elm-meta-ads/`;
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
  try {
    await exerciseViewport(browser, baseUrl, { name: 'desktop-1440', width: 1440, height: 1000 });
    await exerciseViewport(browser, baseUrl, { name: 'mobile-390', width: 390, height: 844 });
    console.log(JSON.stringify({ passed: true, baseUrl, screenshots: fs.readdirSync(evidenceDir).map(name => path.join(evidenceDir, name)) }, null, 2));
  } finally {
    await browser.close();
    await new Promise(resolve => app.close(resolve));
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
