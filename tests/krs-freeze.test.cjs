const assert = require('node:assert/strict');
const test = require('node:test');
const frozen = require('../api/krs-meta-ads/frozen-data.js');


const snapshot = {
  schemaVersion: 1,
  accountId: '903309897610642',
  frozenAt: '2026-09-25T09:00:00.000Z',
  since: '2026-06-27',
  until: '2026-09-24',
  currency: 'CZK',
  timezone: 'Europe/Prague',
  campaignDaily: [
    {
      id: 'c1', name: 'Campaign 1', date_start: '2026-09-23', date_stop: '2026-09-23',
      amount_spent: '10.5', impressions: '100', inline_link_clicks: '5',
      'actions:landing_page_view': '4', 'actions:initiate_checkout': '2', 'actions:purchase': '1',
      'action_values:purchase': '30', video_thruplay_watched_actions: '8', 'video_3_sec_watched_actions': '10',
    },
    {
      id: 'c1', name: 'Campaign 1', date_start: '2026-09-24', date_stop: '2026-09-24',
      amount_spent: '20', impressions: '200', inline_link_clicks: '8',
      'actions:landing_page_view': '7', 'actions:initiate_checkout': '3', 'actions:purchase': '2',
      'action_values:purchase': '80', video_thruplay_watched_actions: '12', 'video_3_sec_watched_actions': '14',
    },
  ],
  adDaily: [
    {
      id: 'a1', name: 'Ad 1', campaign_id: 'c1', campaign_name: 'Campaign 1', date_start: '2026-09-24', date_stop: '2026-09-24',
      amount_spent: '12', impressions: '120', inline_link_clicks: '5',
      'actions:landing_page_view': '4', 'actions:initiate_checkout': '2', 'actions:purchase': '1',
      'action_values:purchase': '40', video_thruplay_watched_actions: '5', 'video_3_sec_watched_actions': '7',
    },
    {
      id: 'a2', name: 'Ad 2', campaign_id: 'c1', campaign_name: 'Campaign 1', date_start: '2026-09-24', date_stop: '2026-09-24',
      amount_spent: '8', impressions: '80', inline_link_clicks: '3',
      'actions:landing_page_view': '3', 'actions:initiate_checkout': '1', 'actions:purchase': '1',
      'action_values:purchase': '40', video_thruplay_watched_actions: '7', 'video_3_sec_watched_actions': '7',
    },
  ],
  statusMap: { a1: 'ACTIVE', a2: 'PAUSED' },
};

function metricRow(id, date, extra = {}) {
  return {
    id,
    name: id,
    date_start: date,
    date_stop: date,
    amount_spent: '0',
    impressions: '0',
    inline_link_clicks: '0',
    'actions:landing_page_view': '0',
    'actions:initiate_checkout': '0',
    'actions:purchase': '0',
    'action_values:purchase': '0',
    video_thruplay_watched_actions: '0',
    'video_3_sec_watched_actions': '0',
    ...extra,
  };
}

function completeSnapshot() {
  const campaignDaily = Array.from({ length: 276 }, (_, index) => metricRow(
    `c${index}`,
    frozen.shiftIsoDate(frozen.FROZEN_SINCE, index % 90)
  ));
  const adDaily = Array.from({ length: 1696 }, (_, index) => metricRow(
    `a${index}`,
    frozen.shiftIsoDate(frozen.FROZEN_SINCE, index % 90),
    { campaign_id: `c${index % 276}`, campaign_name: `c${index % 276}` }
  ));
  return {
    schemaVersion: 1,
    accountId: '903309897610642',
    frozenAt: frozen.FROZEN_AT,
    since: frozen.FROZEN_SINCE,
    until: frozen.FROZEN_THROUGH,
    currency: 'CZK',
    timezone: 'Europe/Prague',
    campaignDaily,
    adDaily,
    statusMap: Object.fromEntries(adDaily.map(row => [row.id, 'ACTIVE'])),
  };
}

test('relative presets are anchored to the frozen cutoff, not wall-clock time', () => {
  assert.deepEqual(frozen.rangeForQuery(snapshot, { date_preset: 'last_7d' }), {
    since: '2026-09-18', until: '2026-09-24',
  });
  assert.deepEqual(frozen.rangeForQuery(snapshot, { date_preset: 'this_month' }), {
    since: '2026-09-01', until: '2026-09-24',
  });
  assert.deepEqual(frozen.rangeForQuery(snapshot, { date_preset: 'last_month' }), {
    since: '2026-08-01', until: '2026-08-31',
  });
});

test('aggregate rows preserve the existing dashboard response contract', () => {
  const rows = frozen.rowsForRequest(snapshot, 'aggregate', { since: '2026-09-23', until: '2026-09-24' });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    id: 'c1', name: 'Campaign 1', date_start: '2026-09-23', date_stop: '2026-09-24',
    amount_spent: '30.5', impressions: '300', inline_link_clicks: '13',
    'actions:landing_page_view': '11', 'actions:initiate_checkout': '5', 'actions:purchase': '3',
    'action_values:purchase': '110', video_thruplay_watched_actions: '20', 'video_3_sec_watched_actions': '24',
  });
});

test('ad rows aggregate and retain frozen effective statuses', () => {
  const rows = frozen.rowsForRequest(snapshot, 'ads', { since: '2026-09-24', until: '2026-09-24' });
  assert.deepEqual(rows.map(row => [row.id, row.amount_spent, row.status]), [
    ['a1', '12', 'ACTIVE'],
    ['a2', '8', 'PAUSED'],
  ]);
});

test('custom ranges are validated', () => {
  assert.deepEqual(
    frozen.rangeForQuery(snapshot, { time_range: JSON.stringify({ since: '2026-09-01', until: '2026-09-10' }) }),
    { since: '2026-09-01', until: '2026-09-10' }
  );
  assert.throws(() => frozen.rangeForQuery(snapshot, { time_range: '{"since":"bad"}' }), /Invalid time_range/);
  assert.throws(() => frozen.rangeForQuery(snapshot, { time_range: 'null' }), /Invalid time_range/);
  assert.throws(() => frozen.rangeForQuery(snapshot, { time_range: '{' }), /Invalid time_range/);
  assert.throws(() => frozen.rangeForQuery(snapshot, { time_range: '{"since":"2026-02-30","until":"2026-03-01"}' }), /Invalid time_range/);
  assert.throws(() => frozen.rangeForQuery(snapshot, { time_range: '{"since":"2026-09-24","until":"2026-09-25"}' }), /Invalid time_range/);
  assert.throws(() => frozen.rangeForQuery(snapshot, { date_preset: 'constructor' }), /Invalid date_preset/);
});

test('Redis credentials are selected atomically and never mixed across families', () => {
  const saved = { ...process.env };
  for (const key of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'KV_REST_API_READ_ONLY_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) delete process.env[key];
  process.env.KV_REST_API_URL = 'https://kv.example';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'wrong-family-token';
  assert.throws(() => frozen.redisCredentials(), /KV read-only Redis credentials are incomplete/);
  process.env.KV_REST_API_TOKEN = 'write-token';
  assert.throws(() => frozen.redisCredentials(), /read-only Redis credentials are incomplete/);
  process.env.KV_REST_API_READ_ONLY_TOKEN = 'read-only-token';
  assert.deepEqual(frozen.redisCredentials(), { url: 'https://kv.example', token: 'read-only-token' });
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
});

test('snapshot identity, coverage, metrics, and status schema are immutable', () => {
  const valid = completeSnapshot();
  assert.equal(frozen.validateSnapshot(valid), valid);

  for (const mutate of [
    value => { value.until = '2026-09-25'; },
    value => { value.frozenAt = '2026-09-25T04:07:33.195Z'; },
    value => { value.campaignDaily[0].amount_spent = 'NaN'; },
    value => { value.statusMap = []; },
    value => { value.adDaily.pop(); },
  ]) {
    const candidate = structuredClone(valid);
    mutate(candidate);
    assert.throws(() => frozen.validateSnapshot(candidate), /Frozen KRS snapshot/);
  }
});
