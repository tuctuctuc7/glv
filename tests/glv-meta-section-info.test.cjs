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
      'WL is a campaign-name group', 'not ad-set or ad names',
      'Case-sensitive: _Promo takes priority, then _WL; otherwise BAU',
      'Break down WL influencers', 'case-insensitive', 'kristyna', 'actionkate',
      'both or neither → Other', 'selected dates and filters',
      'A displayed 0 does not prove no activity outside this scope',
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
