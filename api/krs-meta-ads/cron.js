// KURSA Meta Ads daily prewarm. Normalized fields: 'actions:landing_page_view',
// 'actions:initiate_checkout', 'actions:purchase', 'action_values:purchase'.
const shared = require('./_shared.js');

const PRESETS = [...shared.CACHED_PRESETS];

async function refreshPreset(token, preset, includeToday) {
  const range = shared.monthRange(preset, includeToday);
  const summaries = {};
  for (const type of ['aggregate', 'daily', 'ads']) {
    const rows = await shared.fetchNormalized(type, token, { range });
    await shared.redisSet(`${shared.CACHE_PREFIX}:${type}:${preset}`, {
      rows,
      meta: { currency: shared.ACCOUNT_CURRENCY, timezone: shared.ACCOUNT_TIMEZONE, since: range.since, until: range.until },
    });
    summaries[type] = shared.summarizeRows(rows);
  }
  return { preset, since: range.since, until: range.until, ...summaries };
}

module.exports = async (req, res) => {
  const secret = process.env.CRON_SECRET || process.env.KRS_META_CRON_SECRET;
  const token = shared.envToken();
  const redis = shared.redisCredentials();
  if (!secret || !token || !redis.url || !redis.token) {
    return res.status(500).json({ ok: false, message: 'KURSA Meta Ads cron is not configured.' });
  }
  if (req.headers?.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });

  const includeToday = ['1', 'true'].includes(String(req.query?.include_today || '').toLowerCase());
  const summaries = [];
  const errors = [];
  for (const preset of PRESETS) {
    try {
      summaries.push(await refreshPreset(token, preset, includeToday));
    } catch (error) {
      errors.push(`${preset}: ${error.message}`);
    }
  }
  const ok = errors.length === 0;
  console.log(JSON.stringify({ event: 'krs-meta-ads-cron', ok, includeToday, summaries, errorCount: errors.length }));
  return res.status(ok ? 200 : 500).json({
    ok,
    message: ok ? `KURSA cache refreshed through ${shared.cutoffDate(includeToday)}` : `KURSA cache refresh failed: ${errors.join('; ')}`,
    summaries,
  });
};

module.exports._test = {
  cutoffDate: shared.cutoffDate,
  monthRange: shared.monthRange,
  summarizeRows: shared.summarizeRows,
};
