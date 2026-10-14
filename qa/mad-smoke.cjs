#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { firefox } = require('playwright-core');

const baseUrl = process.env.MAD_QA_BASE_URL || 'http://127.0.0.1:4190/mad/';
const executablePath = process.env.PLAYWRIGHT_FIREFOX_EXECUTABLE;
const evidenceDir = process.env.MAD_QA_EVIDENCE_DIR || '/tmp/mad-qa';
fs.mkdirSync(evidenceDir, { recursive: true });

(async () => {
  const browser = await firefox.launch({ executablePath: executablePath || undefined, headless: true });
  const results = [];
  try {
    for (const viewport of [
      { width: 1440, height: 1000, name: 'desktop' },
      { width: 390, height: 844, name: 'mobile-390' },
      { width: 320, height: 780, name: 'mobile-320' },
    ]) {
      const page = await browser.newPage({ viewport });
      const errors = [];
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
      page.on('pageerror', (error) => errors.push(error.message));

      let response;
      try {
        response = await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
      } catch (error) {
        if (!String(error.message).includes('interrupted by another navigation')) throw error;
        await page.waitForTimeout(250);
        assert.equal(page.url(), baseUrl);
      }
      await page.waitForLoadState('networkidle').catch(() => {});
      if (response) assert.equal(response.status(), 200);
      assert.equal(await page.title(), 'AGENTHIC CONTROL — Meta Ads, without the fog.');
      await page.waitForTimeout(400);

      const geometry = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        heroVisible: document.querySelector('.hero h1').getBoundingClientRect().height > 0,
        sections: document.querySelectorAll('main section').length,
      }));
      assert.equal(geometry.scrollWidth, geometry.clientWidth, `${viewport.name} overflows horizontally`);
      assert.ok(geometry.heroVisible);
      assert.ok(geometry.sections >= 7);
      const runtimeAssets = await page.evaluate(() => ({
        stylesheet: [...document.styleSheets].map((sheet) => sheet.href).find(Boolean),
        script: [...document.scripts].map((node) => node.src).find(Boolean),
      }));
      assert.equal(new URL(runtimeAssets.stylesheet).pathname, '/mad/styles.css');
      assert.equal(new URL(runtimeAssets.script).pathname, '/mad/app.js');

      if (viewport.width >= 1000) {
        await page.click('[data-market="core"]');
        assert.equal(await page.textContent('[data-kpi="roas"]'), '3.78×');
        assert.equal(await page.getAttribute('[data-market="core"]', 'aria-pressed'), 'true');
        assert.equal(await page.getAttribute('[data-market="all"]', 'aria-pressed'), 'false');
        assert.match(await page.textContent('[data-market-status]'), /Core market selected.*3\.78×/);
        assert.equal(await page.locator('.window-sidebar button').count(), 0);
        await page.click('[data-story="truth"]');
        assert.equal(await page.getAttribute('[data-story="truth"]', 'aria-pressed'), 'true');
        assert.equal(await page.getAttribute('#story-panel-truth', 'aria-hidden'), 'false');
        await page.click('[data-role="buyer"]');
        assert.equal(await page.textContent('[data-role-title]'), 'Go from account scan to action list.');
        assert.equal(await page.getAttribute('[data-role="buyer"]', 'tabindex'), '0');
        assert.equal(await page.getAttribute('[data-role="founder"]', 'tabindex'), '-1');
        assert.equal(await page.getAttribute('[role="tabpanel"]', 'aria-labelledby'), 'role-buyer');
        await page.press('[data-role="buyer"]', 'ArrowRight');
        assert.equal(await page.getAttribute('[data-role="agency"]', 'aria-selected'), 'true');
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'role-agency');
        await page.click('[data-open-dialog]');
        assert.equal(await page.locator('[data-dialog]').getAttribute('open'), '');
        assert.equal(await page.getAttribute('[data-dialog]', 'aria-labelledby'), 'dialog-title');
        const helperStyle = await page.locator('[data-dialog-step="form"] > small').evaluate((node) => {
          const style = getComputedStyle(node);
          return { color: style.color, fontSize: style.fontSize };
        });
        assert.deepEqual(helperStyle, { color: 'rgb(79, 86, 81)', fontSize: '11px' });
        await page.fill('input[name="email"]', 'operator@example.com');
        await page.selectOption('select[name="spend"]', { label: '€150k–€500k' });
        await page.fill('textarea[name="challenge"]', 'We need one trusted daily decision layer.');
        await page.click('[data-brief-form] button[type="submit"]');
        assert.equal(await page.getAttribute('[data-dialog]', 'aria-labelledby'), 'dialog-success-title');
        const emailHref = await page.getAttribute('[data-email-brief]', 'href');
        assert.match(emailHref, /^mailto:hello@agenthic\.com\?subject=/);
        assert.match(decodeURIComponent(emailHref), /operator@example\.com/);
        await page.click('[data-close-dialog]');
      } else {
        await page.click('[data-menu-button]');
        assert.equal(await page.getAttribute('[data-menu-button]', 'aria-expanded'), 'true');
        assert.equal(await page.isVisible('[data-mobile-menu]'), true);
        await page.click('[data-mobile-menu] a[href="#system"]');
        assert.equal(await page.getAttribute('[data-menu-button]', 'aria-expanded'), 'false');
      }

      await page.screenshot({ path: path.join(evidenceDir, `${viewport.name}.png`), fullPage: false });
      assert.deepEqual(errors, [], `${viewport.name} console errors`);
      results.push({ ...viewport, geometry, errors });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify({ passed: true, baseUrl, results }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
