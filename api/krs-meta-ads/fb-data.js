// KURSA Meta Ads API. Normalized fields: 'actions:landing_page_view',
// 'actions:initiate_checkout', 'actions:purchase', 'action_values:purchase'.
const shared = require('./_shared.js');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(204).end();
  }
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = shared.envToken();
  const redis = shared.redisCredentials();
  if (!token || !redis.url || !redis.token) {
    return res.status(500).json({ error: 'KURSA Meta Ads API is not configured.' });
  }

  const type = String(req.query?.type || '');
  if (!['aggregate', 'daily', 'ads'].includes(type)) return res.status(400).json({ error: 'Invalid type.' });
  const preset = String(req.query?.date_preset || 'last_30d');
  let range = null;
  if (req.query?.time_range) {
    try {
      range = JSON.parse(String(req.query.time_range));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(range.since || '') || !/^\d{4}-\d{2}-\d{2}$/.test(range.until || '') || range.since > range.until) {
        throw new Error('Invalid date range');
      }
    } catch {
      return res.status(400).json({ error: 'Invalid time_range.' });
    }
  }

  try {
    if (!range && shared.CACHED_PRESETS.has(preset)) {
      try {
        const cached = await shared.redisGet(shared.cacheKey(preset));
        if (cached?.[type]) {
          res.setHeader('X-Cache', 'HIT');
          return res.status(200).json(cached[type]);
        }
      } catch (error) {
        console.warn('krs-meta-ads cache read failed; falling back to Meta:', error.message);
      }
    }
    res.setHeader('X-Cache', 'MISS');
    const rows = await shared.fetchNormalized(type, token, { range: range || shared.presetRange(preset), preset });
    return res.status(200).json({ rows, meta: { currency: shared.ACCOUNT_CURRENCY, timezone: shared.ACCOUNT_TIMEZONE } });
  } catch (error) {
    console.error('krs-meta-ads fb-data error:', error.message);
    return res.status(500).json({ error: error.message });
  }
};

module.exports._test = {
  accountContract: shared.accountContract,
  cacheKey: shared.cacheKey,
  normalizeAd: shared.normalizeAd,
  normalizeCampaign: shared.normalizeCampaign,
  presetRange: shared.presetRange,
};
