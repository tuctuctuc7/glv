const { timingSafeEqual } = require('crypto');
const { fetchReport, reportWindow, SCHEMA_VERSION } = require('../../lib/glv-bfcm.cjs');
let cached = null;
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
  const token=process.env.GLV_META_FB_ACCESS_TOKEN || process.env.FB_ACCESS_TOKEN;
  if (!token) return res.status(503).json({error:'Meta connection is not configured'});
  try {
    const now = new Date();
    const {since,until} = reportWindow(now);
    const key = `${SCHEMA_VERSION}:${since}:${until}`;
    if (cached?.key===key && Date.now()-Date.parse(cached.result.generated_at)<60000) return res.status(200).json(cached.result);
    if (!pending.has(key)) {
      const request = fetchReport(token,undefined,now).then(result=>{
        if (result.schema_version!==SCHEMA_VERSION || result.reporting_period!=='campaign-to-date' || result.since!==since || result.until!==until) throw new Error('Unexpected report window');
        // A slower previous-day extraction must not replace the newer day's cache.
        if (!cached || cached.result.until<=until) cached={key,result};
        return result;
      }).finally(()=>{pending.delete(key);});
      pending.set(key,request);
    }
    return res.status(200).json(await pending.get(key));
  } catch {
    return res.status(502).json({error:'Live Meta refresh failed. Please retry; previous figures have not been replaced.'});
  }
};
