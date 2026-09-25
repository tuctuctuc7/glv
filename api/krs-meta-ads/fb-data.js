const frozen = require('./frozen-data.js');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(204).end();
  }
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const type = String(req.query?.type || '');
  try {
    const snapshot = await frozen.loadSnapshot();
    if (!snapshot) return res.status(503).json({ error: 'The discontinued KRS dashboard snapshot is unavailable.' });
    const range = frozen.rangeForQuery(snapshot, req.query || {});
    const rows = frozen.rowsForRequest(snapshot, type, range);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-KRS-Data-State', 'frozen');
    return res.status(200).json({
      rows,
      meta: {
        currency: snapshot.currency,
        timezone: snapshot.timezone,
        since: range.since,
        until: range.until,
        frozen: true,
        frozen_at: snapshot.frozenAt,
        frozen_through: snapshot.until,
      },
    });
  } catch (error) {
    if (/Invalid type|Invalid time_range|Invalid date_preset/.test(error.message)) return res.status(400).json({ error: error.message });
    console.error('krs frozen data error:', error.message);
    return res.status(500).json({ error: 'The discontinued KRS dashboard snapshot could not be read.' });
  }
};
