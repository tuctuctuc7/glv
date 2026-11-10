const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/glv-meta-ads/section-info.js'), 'utf8');
const context = vm.createContext({ document: { querySelectorAll: () => [] } });
vm.runInContext(source.slice(0, source.indexOf('  const sections =')) + '\nglobalThis.copy = descriptions;})();', context);

for (const title of ['Promo Period Split', 'Promo Group Charts', 'Promo Group Table']) {
  test(`${title} explains WL classification and scoped zero without inventing a diagnosis`, () => {
    const text = context.copy[title];
    for (const phrase of [
      'campaign-name phase precedence', '_Promo first', 'creator_PAC_variant ad-name prefix takes precedence',
      'legacy ads retain campaign-first then ad-set-name fallback', 'Multiple matches', 'No bare PAC inference',
      'Unresolved names stay in totals', 'individual ad facts', 'Unsplit views keep campaign reach',
      'creator-split reach and frequency are unavailable', 'selected dates and filters',
    ]) assert.ok(text.includes(phrase), `${title}: ${phrase}`);
    assert.doesNotMatch(text, /whitelist|ActionKate has no|ActionKate had no/i);
  });
}
test('existing popup-only interaction and native styling are preserved', () => {
  assert.match(source, /panel\.className = 'section-info-panel'; panel\.hidden = true/);
  assert.match(source, /button\.className = 'section-info-button'/);
  for (const event of ['focus', 'click', 'pointerenter']) assert.ok(source.includes(`button.addEventListener('${event}'`));
  assert.match(context.copy['Promo Group Table'], /Campaign, grouping and sort controls affect this table only/);
  assert.match(context.copy['Promo Period Split'], /Promo only restricts the group views to dates with Promo spend/);
});
