// Browser-safe proxy for the GELAVIS Media Buyer OS interface.
// Protected by middleware using the existing GLV Meta Ads beta cookie.

const DEFAULT_BASE_URL = 'https://lab.agenthic.com';

function baseUrl() {
  return (
    process.env.GLV_META_BASE_URL
    || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : DEFAULT_BASE_URL)
  );
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const secret = process.env.GLV_META_DECISION_SECRET || process.env.GLV_META_SUMMARY_SECRET;
  if (!secret) {
    res.status(503).json({ ok: false, error: 'Decision report secret is not configured' });
    return;
  }

  const params = new URLSearchParams();
  for (const key of ['date_preset', 'preset', 'target_date', 'refresh', 'time_range']) {
    if (req.query[key] !== undefined) params.set(key, String(req.query[key]));
  }
  if (!params.has('date_preset') && !params.has('preset') && !params.has('time_range')) {
    params.set('date_preset', 'last_30d');
  }

  try {
    const url = `${baseUrl().replace(/\/$/, '')}/api/glv-meta-ads/decision-report?${params.toString()}`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${secret}` } });
    const payload = await response.json();
    res.status(response.status).json(payload);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};
