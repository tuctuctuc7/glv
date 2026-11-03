const PRESET_DAYS = { last_7d: 6, last_14d: 13, last_30d: 29, last_90d: 89 };

function cutoffDate(includeToday = false, now = new Date()) {
  const d = new Date(now);
  if (!includeToday) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function sinceDate(preset, includeToday = false, now = new Date()) {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - (includeToday ? 0 : 1) - PRESET_DAYS[preset]);
  return d.toISOString().slice(0, 10);
}

function monthRange(preset, includeToday = false, now = new Date()) {
  if (preset === 'this_month') {
    const until = cutoffDate(includeToday, now);
    const cutoff = new Date(`${until}T00:00:00Z`);
    const since = new Date(Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth(), 1));
    return { since: since.toISOString().slice(0, 10), until };
  }
  if (preset === 'last_month') {
    const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const until = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
    return { since: since.toISOString().slice(0, 10), until: until.toISOString().slice(0, 10) };
  }
  return { since: sinceDate(preset, includeToday, now), until: cutoffDate(includeToday, now) };
}

module.exports = {cutoffDate,sinceDate,monthRange};
