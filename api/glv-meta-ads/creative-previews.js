const FB_API = 'https://graph.facebook.com/v21.0';

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function cleanIds(value) {
  return String(value || '')
    .split(',')
    .map(id => id.trim())
    .filter(id => /^\d+$/.test(id));
}

function creativeUrl(ad) {
  const creative = ad?.creative || {};
  return (
    creative.thumbnail_url
    || creative.image_url
    || creative.object_story_spec?.link_data?.picture
    || creative.object_story_spec?.video_data?.image_url
    || null
  );
}

async function fetchBatch(ids, token) {
  const fields = [
    'id',
    'name',
    'effective_status',
    'creative{id,name,object_type,thumbnail_url,image_url,effective_object_story_id,object_story_spec,asset_feed_spec,video_id}',
  ].join(',');
  const url = `${FB_API}/?ids=${ids.join(',')}&fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`;
  const response = await fetch(url);
  const data = await response.json();
  if (data.error) throw new Error(`FB API: ${data.error.message} (code ${data.error.code})`);
  return data;
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
    return res.status(202).json({ ok: false, error: 'GLV_META_DECISION_SECRET or GLV_META_SUMMARY_SECRET is not configured' });
  }
  if (req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = process.env.GLV_META_FB_ACCESS_TOKEN || process.env.FB_ACCESS_TOKEN;
  if (!token) {
    return res.status(202).json({ ok: false, error: 'GLV Meta token is missing in Vercel env' });
  }

  const ids = [...new Set(cleanIds(req.query.ad_ids || req.query.ids))];
  if (!ids.length) return res.status(400).json({ ok: false, error: 'Pass ad_ids as a comma-separated list.' });
  if (ids.length > 50) return res.status(400).json({ ok: false, error: 'Maximum 50 ad IDs per request.' });

  try {
    const results = {};
    for (const idChunk of chunk(ids, 20)) {
      const data = await fetchBatch(idChunk, token);
      for (const id of idChunk) {
        const ad = data[id] || null;
        results[id] = ad
          ? {
              id,
              name: ad.name || '',
              effective_status: ad.effective_status || '',
              preview_url: creativeUrl(ad),
              creative: ad.creative || null,
            }
          : { id, error: 'Not returned by Meta API' };
      }
    }
    res.json({ ok: true, count: ids.length, results });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};
