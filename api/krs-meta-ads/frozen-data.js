const crypto = require('node:crypto');

const AD_ACCOUNT = '903309897610642';
const ACCOUNT_CURRENCY = 'CZK';
const ACCOUNT_TIMEZONE = 'Europe/Prague';
const FROZEN_AT = '2026-09-25T04:07:32.195Z';
const FROZEN_SINCE = '2026-06-27';
const FROZEN_THROUGH = '2026-09-24';
const EXPECTED_CAMPAIGN_ROWS = 276;
const EXPECTED_AD_ROWS = 1696;
const SNAPSHOT_SHA256 = 'ea0f819f0ee490c1ffb5316a97558f330abd8dc0e6dfa03317874ccf5c7c41e1';
const SNAPSHOT_KEY = 'krs:discontinued:frozen:v1';
const RELATIVE_PRESET_DAYS = {
  last_7d: 6,
  last_14d: 13,
  last_30d: 29,
  last_90d: 89,
};

const SUM_FIELDS = [
  'amount_spent',
  'impressions',
  'inline_link_clicks',
  'actions:landing_page_view',
  'actions:initiate_checkout',
  'actions:purchase',
  'action_values:purchase',
  'video_thruplay_watched_actions',
  'video_3_sec_watched_actions',
];


function shiftIsoDate(iso, days) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function previousMonthRange(anchor) {
  const current = new Date(`${anchor.slice(0, 7)}-01T12:00:00Z`);
  current.setUTCMonth(current.getUTCMonth() - 1);
  const since = current.toISOString().slice(0, 10);
  current.setUTCMonth(current.getUTCMonth() + 1);
  current.setUTCDate(current.getUTCDate() - 1);
  return { since, until: current.toISOString().slice(0, 10) };
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function rangeForQuery(snapshot, query = {}) {
  if (query.time_range) {
    let range;
    try {
      range = JSON.parse(String(query.time_range));
    } catch (error) {
      throw new Error('Invalid time_range.');
    }
    if (!range || typeof range !== 'object' || Array.isArray(range)
      || !isIsoDate(range.since)
      || !isIsoDate(range.until)
      || range.since > range.until
      || range.since < snapshot.since
      || range.until > snapshot.until) {
      throw new Error('Invalid time_range.');
    }
    return { since: range.since, until: range.until };
  }

  const preset = String(query.date_preset || 'last_30d');
  const allowedPresets = new Set([...Object.keys(RELATIVE_PRESET_DAYS), 'this_month', 'last_month']);
  if (!allowedPresets.has(preset)) throw new Error('Invalid date_preset.');
  if (preset === 'this_month') return { since: `${snapshot.until.slice(0, 7)}-01`, until: snapshot.until };
  if (preset === 'last_month') return previousMonthRange(snapshot.until);
  const days = RELATIVE_PRESET_DAYS[preset] ?? RELATIVE_PRESET_DAYS.last_30d;
  return { since: shiftIsoDate(snapshot.until, -days), until: snapshot.until };
}

function inRange(row, range) {
  return row.date_start >= range.since && row.date_start <= range.until;
}

function emptyMetrics() {
  return Object.fromEntries(SUM_FIELDS.map(field => [field, 0]));
}

function aggregateRows(rows, keyFor, identityFor) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFor(row);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, { ...identityFor(row), ...emptyMetrics() });
    const group = groups.get(key);
    for (const field of SUM_FIELDS) group[field] += Number(row[field] || 0);
  }
  return [...groups.values()].map(row => {
    const normalized = { ...row };
    for (const field of SUM_FIELDS) normalized[field] = String(row[field]);
    return normalized;
  });
}

function rowsForRequest(snapshot, type, range) {
  if (!['aggregate', 'daily', 'ads'].includes(type)) throw new Error('Invalid type.');
  const campaignRows = snapshot.campaignDaily.filter(row => inRange(row, range));
  if (type === 'daily') return campaignRows;
  if (type === 'aggregate') {
    return aggregateRows(
      campaignRows,
      row => row.id,
      row => ({ id: row.id, name: row.name, date_start: range.since, date_stop: range.until })
    );
  }

  const adRows = snapshot.adDaily.filter(row => inRange(row, range));
  const rows = aggregateRows(
    adRows,
    row => row.id,
    row => ({
      id: row.id,
      name: row.name,
      campaign_id: row.campaign_id,
      campaign_name: row.campaign_name,
      status: snapshot.statusMap[row.id] || 'UNKNOWN',
      date_start: range.since,
      date_stop: range.until,
    })
  );
  return rows.sort((left, right) => Number(right.amount_spent) - Number(left.amount_spent));
}

function redisCredentials() {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_READ_ONLY_TOKEN;
  if (url && token) return { url, token };
  if (url || token) throw new Error('KV read-only Redis credentials are incomplete.');
  return { url: null, token: null };
}

function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)
    || snapshot.schemaVersion !== 1
    || snapshot.accountId !== AD_ACCOUNT
    || snapshot.frozenAt !== FROZEN_AT
    || snapshot.currency !== ACCOUNT_CURRENCY
    || snapshot.timezone !== ACCOUNT_TIMEZONE
    || snapshot.since !== FROZEN_SINCE
    || snapshot.until !== FROZEN_THROUGH
    || !Array.isArray(snapshot.campaignDaily)
    || snapshot.campaignDaily.length !== EXPECTED_CAMPAIGN_ROWS
    || !Array.isArray(snapshot.adDaily)
    || snapshot.adDaily.length !== EXPECTED_AD_ROWS
    || !snapshot.statusMap || typeof snapshot.statusMap !== 'object' || Array.isArray(snapshot.statusMap)) {
    throw new Error('Frozen KRS snapshot schema is invalid.');
  }
  const campaignKeys = new Set();
  const adKeys = new Set();
  for (const [kind, rows, keys] of [
    ['campaign', snapshot.campaignDaily, campaignKeys],
    ['ad', snapshot.adDaily, adKeys],
  ]) for (const row of rows) {
    if (!row || typeof row !== 'object' || !row.id
      || !isIsoDate(row.date_start)
      || row.date_stop !== row.date_start
      || row.date_start < snapshot.since || row.date_start > snapshot.until) {
      throw new Error('Frozen KRS snapshot rows are invalid.');
    }
    const key = `${row.id}:${row.date_start}`;
    if (keys.has(key)) throw new Error(`Frozen KRS snapshot has duplicate ${kind} rows.`);
    keys.add(key);
    for (const field of SUM_FIELDS) {
      const value = Number(row[field]);
      if (!Number.isFinite(value) || value < 0) throw new Error('Frozen KRS snapshot metrics are invalid.');
    }
  }
  return snapshot;
}

async function redisCommand(command) {
  const credentials = redisCredentials();
  if (!credentials.url || !credentials.token) throw new Error('Frozen KRS storage is not configured.');
  const response = await fetch(credentials.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${credentials.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(`Frozen KRS storage failed (${response.status}).`);
  return payload.result;
}

async function loadSnapshot() {
  const result = await redisCommand(['GET', SNAPSHOT_KEY]);
  if (!result) return null;
  const digest = crypto.createHash('sha256').update(result).digest('hex');
  if (digest !== SNAPSHOT_SHA256) throw new Error('Frozen KRS snapshot identity is invalid.');
  return validateSnapshot(JSON.parse(result));
}

module.exports = {
  ACCOUNT_CURRENCY,
  ACCOUNT_TIMEZONE,
  FROZEN_AT,
  FROZEN_SINCE,
  FROZEN_THROUGH,
  SNAPSHOT_SHA256,
  SNAPSHOT_KEY,
  aggregateRows,
  loadSnapshot,
  rangeForQuery,
  redisCredentials,
  rowsForRequest,

  shiftIsoDate,
  validateSnapshot,
};
