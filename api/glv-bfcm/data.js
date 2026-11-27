const { timingSafeEqual } = require('crypto');
const { fetchReport, reportWindow, today, SCHEMA_VERSION } = require('../../lib/glv-bfcm.cjs');
const cached = new Map();
const pending = new Map();
function authorized(req) {
  // Reuse the existing GLV server credential for authorized report clients.
  const serverSecret = process.env.CRON_SECRET || process.env.GLV_META_CRON_SECRET;
  const bearer = req.headers.authorization || '';
  if (serverSecret && bearer.startsWith('Bearer ')) {
    const a = Buffer.from(bearer.slice(7)), b = Buffer.from(serverSecret);
    if (a.length === b.length && timingSafeEqual(a,b)) return true;
  }
  const expected = process.env.GLV_META_BETA_AUTH_TOKEN;
  const part = (req.headers.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith('glv_meta_beta='));
  const value = part ? part.slice('glv_meta_beta='.length) : '';
  if (!expected || !value) return false;
  const a=Buffer.from(value), b=Buffer.from(expected);
  return a.length===b.length && timingSafeEqual(a,b);
}
module.exports = async (req,res) => {
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('Vary','Cookie, Authorization');
  if (!authorized(req)) return res.status(401).json({error:'Unauthorized'});
  if (req.method!=='GET') { res.setHeader('Allow','GET'); return res.status(405).json({error:'Method not allowed'}); }
  const now = new Date(), query = req.query || {};
  let since,until;
  try {
    ({since,until} = reportWindow(now,query));
    if (query.daily !== undefined && query.daily !== '0' && query.daily !== '1') throw new Error('Invalid mode');
  } catch { return res.status(400).json({error:'Invalid reporting range or daily mode. Use inclusive YYYY-MM-DD dates from campaign start through today.'}); }
  const daily = query.daily === '1';
  const token=process.env.GLV_META_FB_ACCESS_TOKEN || process.env.FB_ACCESS_TOKEN;
  if (!token) return res.status(503).json({error:'Meta connection is not configured'});
  try {
    const key = `${SCHEMA_VERSION}:${since}:${until}:${daily}:${today(now)}`;
    for (const [id,result] of cached) if (Date.now()-Date.parse(result.generated_at)>=60000) cached.delete(id);
    if (cached.has(key)) return res.status(200).json(cached.get(key));
    if (!pending.has(key)) {
      if (pending.size >= 8) return res.status(429).json({error:'Too many report requests. Please retry shortly.'});
      const request = fetchReport(token,undefined,now,{since,until,daily}).then(result=>{
        if (result.schema_version!==SCHEMA_VERSION || !['campaign-to-date','custom'].includes(result.reporting_period) || result.since!==since || result.until!==until || result.daily_breakdown!==daily) throw new Error('Unexpected report window');
        cached.set(key,result);
        while (cached.size > 12) cached.delete(cached.keys().next().value);
        return result;
      }).finally(()=>{pending.delete(key);});
      pending.set(key,request);
    }
    return res.status(200).json(await pending.get(key));
  } catch {
    return res.status(502).json({error:'Live Meta refresh failed. Please retry; previous figures have not been replaced.'});
  }
};
