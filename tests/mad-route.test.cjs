const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const route = path.join(root, 'public', 'mad');
const read = (name) => fs.readFileSync(path.join(route, name), 'utf8');

test('MAD route ships only the approved static website files', () => {
  const files = fs.readdirSync(route).sort();
  assert.deepEqual(files, ['app.js', 'index.html', 'styles.css']);
});

test('MAD route has the approved product identity and local assets', () => {
  const html = read('index.html');
  assert.match(html, /<title>AGENTHIC CONTROL — Meta Ads, without the fog\.<\/title>/);
  assert.match(html, /href="\/mad\/styles\.css"/);
  assert.match(html, /src="\/mad\/app\.js"/);
  assert.match(html, /Synthetic demonstration data\. No client data is displayed\./);
  assert.match(html, /href="mailto:hello@agenthic\.com" data-email-brief/);
  assert.ok(fs.statSync(path.join(route, 'styles.css')).size > 20_000);
  assert.ok(fs.statSync(path.join(route, 'app.js')).size > 8_000);
});

test('MAD audience selector implements a complete ARIA tab interface', () => {
  const html = read('index.html');
  const script = read('app.js');
  assert.match(html, /id="role-founder" type="button" role="tab" aria-selected="true" aria-controls="role-panel" tabindex="0"/);
  assert.match(html, /id="role-growth" type="button" role="tab" aria-selected="false" aria-controls="role-panel" tabindex="-1"/);
  assert.match(html, /id="role-panel" role="tabpanel" aria-labelledby="role-founder" tabindex="0"/);
  assert.match(script, /tab\.tabIndex = selected \? 0 : -1/);
  assert.match(script, /panel\.setAttribute\('aria-labelledby', `role-\$\{key\}`\)/);
});

test('MAD request brief has an explicit user-controlled delivery channel', () => {
  const html = read('index.html');
  const script = read('app.js');
  assert.match(html, /nothing is sent until you confirm in your mail app/i);
  assert.match(html, /Nothing is sent automatically/i);
  assert.match(script, /mailto:hello@agenthic\.com\?subject=/);
  assert.match(script, /encodeURIComponent\(brief\)/);
});

test('MAD demo exposes real controls only and announces market changes', () => {
  const html = read('index.html');
  const script = read('app.js');
  assert.doesNotMatch(html, /<aside class="window-sidebar"[^>]*>(?:(?!<\/aside>)[\s\S])*<button/i);
  assert.match(html, /aria-pressed="true" data-market="all"/);
  assert.match(html, /role="status" aria-live="polite" data-market-status/);
  assert.match(script, /item\.setAttribute\('aria-pressed', String\(selected\)\)/);
  assert.match(script, /status\.textContent = `\$\{button\.textContent\.trim\(\)\} market selected/);
});

test('MAD light surfaces preserve visible focus, readable helper text, and dialog naming', () => {
  const html = read('index.html');
  const script = read('app.js');
  const css = read('styles.css');
  assert.match(css, /\.section-light :focus-visible, \.contact-dialog :focus-visible \{ outline-color: #273126; \}/);
  assert.match(css, /\.dialog-step > small \{[^}]*color: #4f5651;[^}]*font-size: 11px;/);
  assert.match(html, /<h2 id="dialog-success-title">Your starting point is captured\.<\/h2>/);
  assert.match(script, /dialog\.setAttribute\('aria-labelledby', 'dialog-success-title'\)/);
  assert.match(script, /dialog\.setAttribute\('aria-labelledby', 'dialog-title'\)/);
});

test('MAD story selector exposes selection and controlled-panel state', () => {
  const html = read('index.html');
  const script = read('app.js');
  assert.match(html, /aria-pressed="true" aria-controls="story-panel-noise" data-story="noise"/);
  assert.match(html, /id="story-panel-noise" aria-hidden="false" data-story-panel="noise"/);
  assert.match(script, /step\.setAttribute\('aria-pressed', String\(selected\)\)/);
  assert.match(script, /panel\.setAttribute\('aria-hidden', String\(!selected\)\)/);
  assert.doesNotMatch(html, /<button class="story-step"[^>]*>(?:(?!<\/button>)[\s\S])*<div>/);
});

test('MAD route remains public, self-contained, and privacy-safe', () => {
  const middleware = fs.readFileSync(path.join(root, 'middleware.js'), 'utf8');
  const combined = ['index.html', 'styles.css', 'app.js'].map(read).join('\n');

  assert.doesNotMatch(middleware, /['"]\/mad(?:\/|['"])/);
  assert.doesNotMatch(combined, /\/api\//);
  assert.doesNotMatch(combined, /\b(?:GLV|KRS|KURSA|ELMICH)\b/i);
  assert.doesNotMatch(combined, /act_\d{8,}/i);
  assert.doesNotMatch(combined, /(?:access[_-]?token|api[_-]?key|password)\s*[:=]/i);
  assert.doesNotMatch(read('app.js'), /\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/);
});

test('MAD page references no remote scripts, stylesheets, or images', () => {
  const html = read('index.html');
  assert.doesNotMatch(html, /<(?:script|link|img)[^>]+(?:src|href)="https?:\/\//i);
});
