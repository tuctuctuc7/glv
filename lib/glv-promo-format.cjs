// Approved original campaign identities, not the reporting month. This preserves
// the same ad's mapping on later zero-delivery purchase dates. New campaigns do
// not inherit these manual rules merely because their names contain a code.
const ORIGINAL_MONTH = Object.freeze({
  '120241268747040687': 'March',
  '120243132341400687': 'April',
  '120244677479270687': 'May',
  '120248760747570687': 'July',
  '120248824028350687': 'July',
});
const CODES = {
  March: {403:'Video',407:'Video',409:'Video',404:'Banner',406:'Banner',408:'Banner'},
  April: {414:'Video',418:'Banner'},
  May: {421:'Video',423:'Video',425:'Video',427:'Video',422:'Banner',424:'Banner',426:'Banner',428:'Banner'},
  July: {442:'Video',443:'Video',444:'Video'},
};
function classifyFormat(ad, adset) {
  const labels = new Set((adset.name.match(/(?<![A-Za-z0-9])(banners?|videos?)(?![A-Za-z0-9])/gi) || []).map(label => /^banner/i.test(label) ? 'Banner' : 'Video'));
  if (labels.size > 1) return { format:'Unknown', reason:'conflicting_adset_labels' };
  if (labels.size) return { format:[...labels][0], reason:'current_adset_label' };
  const month = ORIGINAL_MONTH[ad.campaign_id];
  const hits = Object.entries(CODES[month] || {}).filter(([code]) => new RegExp(`(?<!\\d)${code}(?!\\d)`).test(ad.name)).map(([,format]) => format);
  if (month === 'July' && ad.name.includes('_B')) hits.push('Banner');
  if (/(?<![A-Za-z0-9])PAC(?:_|\s)*317(?![A-Za-z0-9])/.test(ad.name)) hits.push('Video');
  if (hits.length > 1) return { format:'Unknown', reason:'conflicting_manual_patterns' };
  if (hits.length) return { format:hits[0], reason:'approved_original_mapping' };
  return { format:'Unknown', reason:'no_approved_mapping' };
}
const FB_API = 'https://graph.facebook.com/v21.0';
const ACCOUNT = 'act_359758259164738';
const STATUSES = ['ACTIVE','PAUSED','DELETED','ARCHIVED','ADSET_PAUSED','CAMPAIGN_PAUSED','DISAPPROVED','PENDING_REVIEW','PREAPPROVED','PENDING_BILLING_INFO','WITH_ISSUES','IN_PROCESS'];
const qualifies = name => /^(TUC|GLV)_\d+_/.test(name) && name.includes('_CZSK_') && !name.includes('_US_') && name.includes('_Promo');
const amount = value => {
  if (value === undefined) return 0; // Meta omits absent action metrics.
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '' || !Number.isFinite(Number(value)) || Number(value) < 0) throw new Error('Invalid Promo metric');
  return Number(value);
};
const action = (row, key) => amount((row[key] || []).find(a => a.action_type === 'omni_purchase')?.value);
function metrics(row) { return {spend:amount(row.spend), purchases:action(row,'actions'), revenue:action(row,'action_values'), impressions:amount(row.impressions)}; }

async function fetchPromoFormats(token, range, fetcher = fetch, {timeoutMs = 240000} = {}) {
  // Leave room for validation/cache writes below the provider's 300s limit.
  // Every page and object lookup shares this budget, not 45s per page forever.
  const deadline = Date.now() + timeoutMs;
  // No attribution overrides: identical default attribution parameters to the
  // existing campaign/ads API. Never use purchase aliases or creative metadata.
  async function get(url) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Promo refresh time budget exceeded');
    let response;
    try { response = await fetcher(url, {headers:{Authorization:`Bearer ${token}`}, signal:AbortSignal.timeout(Math.min(45000,remaining))}); }
    catch { throw new Error('Promo Meta network request failed'); }
    let data;
    try { data = await response.json(); } catch { throw new Error('Invalid Promo Meta response'); }
    if (!response.ok || data.error) throw new Error(`Promo Meta request failed (code ${Number(data.error?.code) || response.status || 0})`);
    return data;
  }
  async function pages(params) {
    const rows = []; const cursors = new Set();
    for (;;) {
      const url = `${FB_API}/${ACCOUNT}/insights?${new URLSearchParams(params)}`;
      const data = await get(url);
      if (!Array.isArray(data.data)) throw new Error('Missing Promo insights data');
      rows.push(...data.data);
      if (!data.paging?.next) return rows;
      const after = data.paging.cursors?.after;
      if (!after || cursors.has(after)) throw new Error('Incomplete Promo pagination');
      cursors.add(after); params = {...params,after};
    }
  }
  async function objects(ids, fields) {
    const unique = [...new Set(ids)]; const result = {};
    for (let i=0; i<unique.length; i+=50) {
      const batch = unique.slice(i,i+50);
      const data = await get(`${FB_API}/?${new URLSearchParams({ids:batch.join(','),fields})}`);
      for (const id of batch) {
        if (!data[id]?.id || typeof data[id].name !== 'string' || data[id].error) throw new Error('Current Promo object unavailable');
        result[id] = data[id];
      }
    }
    return result;
  }
  const common = {time_range:JSON.stringify(range),time_increment:'1',limit:'500'};
  // Discover every activity-bearing campaign, including carryover-only rows.
  // Current direct object names determine scope, not stale insight names.
  const campaignsRaw = await pages({...common,level:'campaign',fields:'campaign_id,spend,impressions,actions,action_values',filtering:JSON.stringify([{field:'campaign.effective_status',operator:'IN',value:['ACTIVE','PAUSED','ARCHIVED','DELETED']}])});
  const campaigns = await objects(campaignsRaw.map(r=>r.campaign_id), 'id,name');
  const ids = Object.keys(campaigns).filter(id=>qualifies(campaigns[id].name));
  const raw = [];
  for (let i=0; i<ids.length; i+=50) raw.push(...await pages({...common,level:'ad',fields:'ad_id,adset_id,campaign_id,spend,impressions,actions,action_values',filtering:JSON.stringify([{field:'campaign.id',operator:'IN',value:ids.slice(i,i+50)},{field:'ad.effective_status',operator:'IN',value:STATUSES}])}));
  const ads = await objects(raw.map(r=>r.ad_id), 'id,name,campaign_id,adset_id,effective_status');
  const adsets = await objects(Object.values(ads).map(r=>r.adset_id), 'id,name,campaign_id');
  const seen = new Set();
  const rows = raw.map(r=>{
    const ad=ads[r.ad_id], adset=adsets[ad.adset_id];
    if (ad.campaign_id !== r.campaign_id || adset.campaign_id !== r.campaign_id || !ids.includes(r.campaign_id)) throw new Error('Promo object identity changed during refresh');
    const key=`${r.ad_id}|${r.date_start}`;
    if (seen.has(key)) throw new Error('Duplicate Promo ad date');
    seen.add(key);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date_start) || r.date_start < range.since || r.date_start > range.until) throw new Error('Invalid Promo insight date');
    return {ad_id:r.ad_id,ad_name:ad.name,adset_id:ad.adset_id,adset_name:adset.name,campaign_id:r.campaign_id,campaign_name:campaigns[r.campaign_id].name,date:r.date_start,...classifyFormat(ad,adset),...metrics(r)};
  });
  // Reconcile per campaign/day, so missing archived ads never masquerade as a
  // valid split. Rounding tolerance applies only to currency, not purchases.
  const totals = new Map();
  for (const row of rows) {
    const key=`${row.campaign_id}|${row.date}`; const total=totals.get(key)||{spend:0,purchases:0,revenue:0,impressions:0};
    for (const metric of Object.keys(total)) total[metric]+=row[metric];
    totals.set(key,total);
  }
  for (const row of campaignsRaw.filter(r=>ids.includes(r.campaign_id))) {
    const key=`${row.campaign_id}|${row.date_start}`;
    const expected=metrics(row), actual=totals.get(key)||{spend:0,purchases:0,revenue:0,impressions:0};
    for (const metric of Object.keys(expected)) if (Math.abs(expected[metric]-actual[metric]) > (['spend','revenue'].includes(metric) ? 0.11 : 0.000001)) throw new Error(`Promo ${metric} reconciliation failed`);
    totals.delete(key);
  }
  if (totals.size) throw new Error('Unmatched Promo ad dates');
  return {schema_version:1,classification_version:1,range,generated_at:new Date().toISOString(),reconciled:true,attribution:'Meta default (same as campaign API); omni_purchase only',rows};
}
const { validPayload, validDate } = require('../public/glv-meta-ads/promo-format.js');
const CACHE_KEY = 'glv:promo_formats:history:v1';
function formatRange(query = {}, now = new Date()) {
  const cutoff = new Date(now);
  if (!['1','true'].includes(String(query.include_today || '').toLowerCase())) cutoff.setUTCDate(cutoff.getUTCDate()-1);
  const until = cutoff.toISOString().slice(0,10);
  if (query.time_range) {
    let range;
    try { range=JSON.parse(query.time_range); } catch { throw new Error('Invalid Promo date range'); }
    if (!validDate(range?.since) || !validDate(range?.until) || range.since > range.until || range.since > until) throw new Error('Invalid Promo date range');
    return {since:range.since,until:range.until > until ? until : range.until};
  }
  const preset=query.date_preset || 'last_30d';
  if (preset === 'promo_history') return {since:'2026-03-01',until};
  if (preset === 'last_month') return {since:new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-1,1)).toISOString().slice(0,10),until:new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),0)).toISOString().slice(0,10)};
  if (preset === 'this_month') return {since:until.slice(0,8)+'01',until};
  const days={last_7d:6,last_14d:13,last_30d:29,last_90d:89}[preset];
  if (days === undefined) throw new Error('Invalid Promo date preset');
  const start=new Date(cutoff);start.setUTCDate(start.getUTCDate()-days);
  return {since:start.toISOString().slice(0,10),until};
}
function sliceCachedFormats(cached,range,now=new Date()) {
  if (!validPayload(cached) || cached.range.since > range.since || cached.range.until < range.until) return null;
  const age=now.getTime()-Date.parse(cached.generated_at);
  if (age < -60000 || age > 25*3600000) return null;
  return {...cached,range,rows:cached.rows.filter(row=>row.date>=range.since && row.date<=range.until)};
}
module.exports = { classifyFormat, qualifies, fetchPromoFormats, formatRange, sliceCachedFormats, CACHE_KEY };
