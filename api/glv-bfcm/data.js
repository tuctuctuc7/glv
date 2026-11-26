const { timingSafeEqual } = require('crypto');
const { fetchReport, today } = require('../../lib/glv-bfcm.cjs');
let cached = null;
let pending = null;
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
    if (!cached || cached.date!==today() || Date.now()-Date.parse(cached.generated_at)>=60000) {
      if (!pending) pending=fetchReport(token).then(result=>{cached=result;return result;}).finally(()=>{pending=null;});
      await pending;
    }
    return res.status(200).json(cached);
  } catch {
    return res.status(502).json({error:'Live Meta refresh failed. Please retry; previous figures have not been replaced.'});
  }
};
