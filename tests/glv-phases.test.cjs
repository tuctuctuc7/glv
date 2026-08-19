const test = require('node:test');
const assert = require('node:assert/strict');

const phases = require('../public/glv-2/phases.js');

const rows = [
  { date: '2026-02-01', region: 'czsk', revenue: 100, spend: 20, influ_revenue: 10, influ_commission: 0 },
  { date: '2026-02-06', region: 'czsk', revenue: 300, spend: 60, influ_revenue: 0, influ_commission: 0 },
  { date: '2026-02-19', region: 'czsk', revenue: 200, spend: 40, influ_revenue: 120, influ_commission: 10 },
  { date: '2026-02-19', region: 'us', revenue: 999, spend: 999, influ_revenue: 999, influ_commission: 999 },
];

const schedule = [
  { start_date: '2026-02-06', end_date: '2026-02-14', phase: 'Promo', label: 'Promo', influencer: '', notes: '' },
  { start_date: '2026-02-19', end_date: '2026-02-22', phase: 'Influ', label: 'Influ', influencer: 'Kristyna', notes: '' },
];

test('phase classification is CZSK-only, starts on 2026-02-01, and derives unscheduled days as BAU', () => {
  const days = phases.buildPhaseDays(rows, schedule);
  assert.equal(days.length, 3);
  assert.deepEqual(days.map(({ date, phase }) => [date, phase]), [
    ['2026-02-01', 'BAU'],
    ['2026-02-06', 'Promo'],
    ['2026-02-19', 'Influ'],
  ]);
});

test('Influ metrics add commission once and derive code/no-code revenue without averaging ratios', () => {
  const days = phases.buildPhaseDays(rows, schedule);
  const influ = days.find((day) => day.phase === 'Influ');
  assert.equal(influ.adjusted_spend, 50);
  assert.equal(influ.code_revenue, 120);
  assert.equal(influ.no_code_revenue, 80);

  const [group] = phases.aggregatePhaseGroups([influ], 'phase-time');
  assert.equal(group.adjusted_roas, 4);
  assert.equal(group.influ_commission, 10);
  assert.equal(group.code_share, 0.6);
  assert.equal(group.code_average_daily, 120);
  assert.equal(group.no_code_average_daily, 80);
});

test('code and no-code revenue preserve the source contract outside scheduled Influ windows', () => {
  const days = phases.buildPhaseDays(rows, schedule);
  const bau = days.find((day) => day.phase === 'BAU');
  assert.equal(bau.code_revenue, 10);
  assert.equal(bau.no_code_revenue, 90);
});

test('impossible Influ attribution fails instead of silently clamping the source value', () => {
  const impossible = rows.map((row) => row.date === '2026-02-19' && row.region === 'czsk'
    ? { ...row, influ_revenue: 201 }
    : row);
  assert.throws(() => phases.buildPhaseDays(impossible, schedule), /code revenue exceeds total revenue.*2026-02-19/i);
});

test('Promo and Influ overlap fails with a clear validation error', () => {
  const overlap = [...schedule, {
    start_date: '2026-02-13', end_date: '2026-02-20', phase: 'Influ', label: 'Influ', influencer: 'Guest', notes: '',
  }];
  assert.throws(() => phases.validateSchedule(overlap), /Promo and Influ overlap.*2026-02-13/i);
});

test('multiple influencer windows may overlap without duplicating daily phase totals', () => {
  const overlappingInfluencers = [
    { start_date: '2026-02-19', end_date: '2026-02-20', phase: 'Influ', label: 'Influ', influencer: 'Kristyna', notes: '' },
    { start_date: '2026-02-19', end_date: '2026-02-21', phase: 'Influ', label: 'Influ', influencer: 'Guest', notes: '' },
  ];
  const days = phases.buildPhaseDays(rows, overlappingInfluencers);
  const influ = days.find((day) => day.date === '2026-02-19');
  assert.deepEqual(influ.influencers, ['Guest', 'Kristyna']);
  assert.equal(influ.revenue, 200);
  const groups = phases.aggregatePhaseGroups([influ], 'influencer');
  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, 'Multiple influencers (unattributed)');
  assert.equal(groups[0].revenue, 200);
});

test('an unnamed influencer window is reported as unattributed rather than as an overlap', () => {
  const unnamed = [{ start_date: '2026-02-19', end_date: '2026-02-22', phase: 'Influ', label: 'Influ', influencer: '', notes: '' }];
  const days = phases.buildPhaseDays(rows, unnamed);
  const [group] = phases.aggregatePhaseGroups(days, 'influencer');
  assert.equal(group.label, 'Unspecified influencer');
});

test('month-with-phase and phase-across-time groups recalculate shares, day counts, averages, and adjusted ROAS', () => {
  const days = phases.buildPhaseDays(rows, schedule);
  const monthly = phases.aggregatePhaseGroups(days, 'month-phase');
  assert.deepEqual(monthly.map((group) => group.label), ['2026-02 · BAU', '2026-02 · Influ', '2026-02 · Promo']);
  const promo = monthly.find((group) => group.phase === 'Promo');
  assert.equal(promo.days, 1);
  assert.equal(promo.average_daily_revenue, 300);
  assert.equal(promo.revenue_share, 0.5);
  assert.equal(promo.adjusted_roas, 5);

  const acrossTime = phases.aggregatePhaseGroups(days, 'phase-time');
  assert.deepEqual(acrossTime.map((group) => group.phase), ['BAU', 'Influ', 'Promo']);
});

test('promo subtype and attributable influencer drilldowns preserve mutually exclusive totals', () => {
  const extendedRows = [...rows, { date: '2026-03-01', region: 'czsk', revenue: 150, spend: 30, influ_revenue: 0, influ_commission: 0 }];
  const extendedSchedule = [...schedule, { start_date: '2026-03-01', end_date: '2026-03-01', phase: 'Promo', label: 'Promo retention', influencer: '', notes: '' }];
  const days = phases.buildPhaseDays(extendedRows, extendedSchedule);
  const promoGroups = phases.aggregatePhaseGroups(days, 'promo-subtype');
  assert.deepEqual(promoGroups.map((group) => group.label), ['Promo', 'Promo retention']);
  assert.equal(promoGroups.reduce((sum, group) => sum + group.revenue, 0), 450);

  const influencerGroups = phases.aggregatePhaseGroups(days, 'influencer');
  assert.deepEqual(influencerGroups.map((group) => group.label), ['Kristyna']);
  assert.equal(influencerGroups[0].revenue, 200);
});

test('phase CSV cells neutralize spreadsheet formulas before RFC 4180 escaping', () => {
  for (const prefix of ['=', '+', '-', '@', '\t', '\r']) {
    assert.equal(phases.csvCell(`${prefix}SUM(A1:A2)`), `'${prefix}SUM(A1:A2)`);
  }
  assert.equal(phases.csvCell('Promo, "private"'), '"Promo, ""private"""');
});
