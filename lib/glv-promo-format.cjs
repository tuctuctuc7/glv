// Approved original campaign identities, not the reporting month. This preserves
// the same ad's mapping on later zero-delivery purchase dates. New campaigns do
// not inherit these manual rules merely because their names contain a code.
const ORIGINAL_MONTH = Object.freeze({
  '120241268747040687': 'March',
  '120243132341400687': 'April',
  '120244677479270687': 'May',
  '120247470134450687': 'June',
  '120248760747570687': 'July',
  '120248824028350687': 'July',
});
const CODES = {
  March: {403:'Video',407:'Video',409:'Video',404:'Banner',406:'Banner',408:'Banner'},
  April: {414:'Video',418:'Banner'},
  May: {421:'Video',423:'Video',425:'Video',427:'Video',422:'Banner',424:'Banner',426:'Banner',428:'Banner'},
  July: {442:'Video',443:'Video',444:'Video'},
};
// Approved 036 creatives duplicated unchanged into 037's mixed-format adsets.
// Keep exact names and explicit campaign identities: no blanket _B/_V or PAC
// inference, and no inheritance by unrelated/future campaigns.
const WINNERS_CAMPAIGNS = new Set(['120250608228580687', '120250692949130687']);
const WINNERS_NAMES = new Map([
  ['PAC480 V3 no-CTA', 'Video'],
  ['2026-10-21_B_Velvet-Beauty-Round02_CC01_03_1080x1080', 'Banner'],
  ['2026-10-21_B_Velvet-Beauty-Round02_CC01_04_1080x1080', 'Banner'],
  ['2026-10-21_V_AI UGC_01 no-CTA', 'Video'],
  ['2026-10-21_B_Velvet-Beauty-Round02_CC04_03_1080x1080', 'Banner'],
  ['PAC475 V3', 'Video'],
]);
function classifyFormat(ad, adset) {
  const labels = new Set((adset.name.match(/(?<![A-Za-z0-9])(banners?|videos?)(?![A-Za-z0-9])/gi) || []).map(label => /^banner/i.test(label) ? 'Banner' : 'Video'));
  if (labels.size > 1) return { format:'Unknown', reason:'conflicting_adset_labels' };
  if (labels.size) return { format:[...labels][0], reason:'current_adset_label' };
  const month = ORIGINAL_MONTH[ad.campaign_id];
  const hits = Object.entries(CODES[month] || {}).filter(([code]) => new RegExp(`(?<!\\d)${code}(?!\\d)`).test(ad.name)).map(([,format]) => format);
  if (month === 'June') {
    // Tom's approved June fallback. Match complete creative identifiers, never
    // bare numbers or prefixes (CC100 / PAC4330); dates do not define identity.
    const codes = new Set(ad.name.match(/(?<![A-Za-z0-9])(?:CC1[0-5]|PAC(?:_|\s)*43[2-5])(?![A-Za-z0-9])/g) || []);
    for (const code of codes) hits.push(/^PAC(?:_|\s)*43[245]$/.test(code) ? 'Video' : 'Banner');
  }
  if (month === 'July' && ad.name.includes('_B')) hits.push('Banner');
  if (/(?<![A-Za-z0-9])PAC(?:_|\s)*317(?![A-Za-z0-9])/.test(ad.name)) hits.push('Video');
  if (WINNERS_CAMPAIGNS.has(ad.campaign_id) && WINNERS_NAMES.has(ad.name)) hits.push(WINNERS_NAMES.get(ad.name));
  if (hits.length > 1) return { format:'Unknown', reason:'conflicting_manual_patterns' };
  if (hits.length) return { format:hits[0], reason:'approved_original_mapping' };
  return { format:'Unknown', reason:'no_approved_mapping' };
}
const {parseCreative,CREATIVE_FIELDS} = require('./glv-promo-assets.cjs');
const FB_API = 'https://graph.facebook.com/v21.0';
const ACCOUNT = 'act_359758259164738';
const STATUSES = ['ACTIVE','PAUSED','DELETED','ARCHIVED','ADSET_PAUSED','CAMPAIGN_PAUSED','DISAPPROVED','PENDING_REVIEW','PREAPPROVED','PENDING_BILLING_INFO','WITH_ISSUES','IN_PROCESS'];
const qualifies = name => /^(TUC|GLV)_\d+_/.test(name) && name.includes('_CZSK_') && !name.includes('_US_') && name.includes('_Promo');
const amount = value => {
  if (value === undefined) return 0; // Meta omits absent action metrics.
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '' || !Number.isFinite(Number(value)) || Number(value) < 0) throw new Error('Invalid Promo metric');
  return Number(value);
};
const action = (row, key, type='omni_purchase') => amount((row[key] || []).find(a => a.action_type === type)?.value);
function metrics(row) {
  if(row.spend===undefined||row.impressions===undefined)throw new Error('Invalid Promo required metric');
  for(const key of ['actions','action_values'])if(row[key]!==undefined){
    if(!Array.isArray(row[key]))throw new Error('Invalid Promo actions');
    const seen=new Set();for(const item of row[key]){
      if(!item||typeof item.action_type!=='string'||!item.action_type||item.value===undefined||seen.has(item.action_type))throw new Error('Invalid Promo action');
      amount(item.value);seen.add(item.action_type);
    }
  }
  return {spend:amount(row.spend), purchases:action(row,'actions'), revenue:action(row,'action_values'), impressions:amount(row.impressions),link_clicks:action(row,'actions','link_click'),landing_page_views:action(row,'actions','landing_page_view'),checkouts:action(row,'actions','initiate_checkout')};
}

async function fetchPromoFormats(token, range, fetcher = fetch, {timeoutMs = 240000} = {}) {
  // Leave room for validation/cache writes below the provider's 300s limit.
  // Every page and object lookup shares this budget, not 45s per page forever.
  const deadline = Date.now() + timeoutMs;
  // No attribution overrides: identical default attribution parameters to the
  // existing campaign/ads API. Never use purchase aliases or creative metadata.
  async function get(url, stage = 'object metadata') {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Promo refresh time budget exceeded');
    const controller=new AbortController();
    let timer;
    try {
      return await Promise.race([
        new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Promo refresh time budget exceeded'));},Math.min(45000,remaining));}),
        (async()=>{
          let response;
          try { response=await fetcher(url,{headers:{Authorization:`Bearer ${token}`},signal:controller.signal}); }
          catch { throw new Error(`Promo Meta network request failed (${stage})`); }
          if(controller.signal.aborted) throw new Error('Promo refresh time budget exceeded');
          let data;
          try { data=await response.json(); } catch { throw new Error('Invalid Promo Meta response'); }
          if (!response.ok || !data || data.error) throw new Error(`Promo Meta ${stage} request failed (HTTP ${Number(response.status)||0}, code ${Number(data?.error?.code)||0}, subcode ${Number(data?.error?.error_subcode)||0})`);
          return data;
        })(),
      ]);
    } finally { clearTimeout(timer); }
  }
  async function pages(params) {
    const rows = []; const cursors = new Set();
    for (;;) {
      const url = `${FB_API}/${ACCOUNT}/insights?${new URLSearchParams(params)}`;
      const data = await get(url, `${params.level} insights`);
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
  const campaignDates=new Set();
  for(const row of campaignsRaw){
    if(!row||typeof row.campaign_id!=='string'||!row.campaign_id||!validDate(row.date_start)||row.date_start<range.since||row.date_start>range.until||(row.date_stop!==undefined&&row.date_stop!==row.date_start))throw new Error('Invalid Promo campaign date or identity');
    const key=`${row.campaign_id}|${row.date_start}`;if(campaignDates.has(key))throw new Error('Duplicate Promo campaign date');campaignDates.add(key);metrics(row);
  }
  const discoveredAds = [];
  // Multi-month ad insights can fail at Meta before the first page. Keep each
  // query within one calendar month, with disjoint inclusive boundaries. Scope
  // still comes from all-history activity/current objects (including carryover).
  // All chunks share the original deadline; none can publish a partial snapshot.
  for (let since=range.since; since<=range.until;) {
    const start=new Date(`${since}T00:00:00Z`);
    const monthEnd=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,0)).toISOString().slice(0,10);
    const until=monthEnd<range.until?monthEnd:range.until;
    discoveredAds.push(...await pages({...common,time_range:JSON.stringify({since,until}),level:'ad',fields:'ad_id,adset_id,campaign_id,spend,impressions,actions,action_values',filtering:JSON.stringify([{field:'ad.effective_status',operator:'IN',value:STATUSES}])}));
    since=new Date(Date.parse(`${until}T00:00:00Z`)+86400000).toISOString().slice(0,10);
  }
  // Discover from both levels: Meta can omit a campaign entirely while its ads
  // retain attributed outcomes. Only current direct campaign names gate scope.
  if(discoveredAds.some(r=>!r || typeof r.campaign_id!=='string' || !r.campaign_id))throw new Error('Invalid Promo ad campaign identity');
  const campaigns = await objects([...campaignsRaw,...discoveredAds].map(r=>r.campaign_id), 'id,name');
  const ids = Object.keys(campaigns).filter(id=>qualifies(campaigns[id].name));
  const raw = discoveredAds.filter(r=>ids.includes(r.campaign_id));
  const ads = await objects(raw.map(r=>r.ad_id), 'id,name,campaign_id,adset_id,effective_status');
  const adsets = await objects(Object.values(ads).map(r=>r.adset_id), 'id,name,campaign_id');
  const seen = new Set();
  const rows = raw.map(r=>{
    const ad=ads[r.ad_id], adset=adsets[ad.adset_id];
    if (ad.campaign_id !== r.campaign_id || adset.campaign_id !== r.campaign_id || !ids.includes(r.campaign_id)) throw new Error('Promo object identity changed during refresh');
    const key=`${r.ad_id}|${r.date_start}`;
    if (seen.has(key)) throw new Error('Duplicate Promo ad date');
    seen.add(key);
    if (!validDate(r.date_start) || r.date_start < range.since || r.date_start > range.until || (r.date_stop!==undefined&&r.date_stop!==r.date_start)) throw new Error('Invalid Promo insight date');
    return {ad_id:r.ad_id,ad_name:ad.name,adset_id:ad.adset_id,adset_name:adset.name,campaign_id:r.campaign_id,campaign_name:campaigns[r.campaign_id].name,date:r.date_start,...classifyFormat(ad,adset),...metrics(r)};
  });
  // Campaign/day is authoritative. Keep observed ads untouched and represent
  // signed differences separately, never as an invented ad or source asset.
  const totals = new Map();
  for (const row of rows) {
    const key=`${row.campaign_id}|${row.date}`; const total=totals.get(key)||{spend:0,purchases:0,revenue:0,impressions:0,link_clicks:0,landing_page_views:0,checkouts:0};
    for (const metric of Object.keys(total)) total[metric]+=row[metric];
    totals.set(key,total);
  }
  for (const row of campaignsRaw.filter(r=>ids.includes(r.campaign_id))) {
    const key=`${row.campaign_id}|${row.date_start}`;
    const expected=metrics(row), actual=totals.get(key)||{spend:0,purchases:0,revenue:0,impressions:0,link_clicks:0,landing_page_views:0,checkouts:0};
    const residual=Object.fromEntries(Object.keys(expected).map(metric=>[metric,expected[metric]-actual[metric]]));
    if(Object.values(residual).some(n=>Math.abs(n)>1e-9)) rows.push({is_ghost:true,label:'Ghost creative — pending Meta reconciliation',campaign_id:row.campaign_id,campaign_name:campaigns[row.campaign_id].name,date:row.date_start,format:'Ghost',reason:'campaign_day_residual',...residual});
    totals.delete(key);
  }
  for(const [key,total] of totals){
    const [campaign_id,date]=key.split('|');
    if(Object.values(total).some(n=>n!==0))rows.push({is_ghost:true,label:'Ghost creative — pending Meta reconciliation',campaign_id,campaign_name:campaigns[campaign_id].name,date,format:'Ghost',reason:'campaign_day_residual',...Object.fromEntries(Object.entries(total).map(([k,v])=>[k,-v]))});
  }
  // Optional inventory follows reconciliation: permissions or a metadata timeout
  // must not discard valid performance. One lookup per unique ad, batches of 50.
  const inventory = {};
  const adIds = Object.keys(ads);
  for (let i=0; i<adIds.length && Date.now()<deadline; i+=50) {
    const batch=adIds.slice(i,i+50);
    try {
      const data=await get(`${FB_API}/?${new URLSearchParams({ids:batch.join(','),fields:`id,${CREATIVE_FIELDS}`})}`);
      for (const id of batch) inventory[id]=parseCreative(data[id]?.id === id && !data[id].error ? data[id].creative : null,ACCOUNT.replace(/^act_/,''));
    } catch { /* Explicit unavailable metadata below; never use ad-count fallback. */ }
  }
  for (const row of rows) if(!row.is_ghost) row.asset_inventory=inventory[row.ad_id] || parseCreative(null,ACCOUNT.replace(/^act_/,''));
  return {schema_version:1,funnel_version:1,classification_version:CLASSIFICATION_VERSION,inventory_version:INVENTORY_VERSION,range,generated_at:new Date().toISOString(),reconciled:true,attribution:'Meta default (same as campaign API); omni_purchase only',rows};
}
const { validPayload, validDate, CLASSIFICATION_VERSION, INVENTORY_VERSION } = require('../public/glv-meta-ads/promo-format.js');
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
function sliceCachedFormats(cached,range,now=new Date(),{allowStale=false}={}) {
  // Schema 1 retains reconciled metrics and the direct-object names used at
  // extraction. Only known classification revisions 1/2 share this contract.
  // Recompute every label (including already-classified v2 rows), never metrics,
  // from those names. Keep the original freshness clock; this is NOT a Meta
  // refresh. Unknown future revisions and malformed/out-of-scope facts miss.
  if (!cached || !Array.isArray(cached.rows) || ![1,2].includes(cached.classification_version)) return null;
  const candidate={...cached,classification_version:CLASSIFICATION_VERSION,rows:cached.rows?.map(row=>{
    const copy={...row};
    if (cached.inventory_version === undefined) delete copy.asset_inventory;
    return copy;
  })};
  if (!validPayload(candidate) || !candidate.rows.every(row=>qualifies(row.campaign_name)) || cached.range.since > range.since || cached.range.until < range.since) return null;
  const age=now.getTime()-Date.parse(cached.generated_at);
  if (!Number.isFinite(age) || age < -60000) return null;
  const stale=age > 25*3600000 || cached.range.until < range.until;
  if (stale && !allowStale) return null;
  const requestedRange=range;
  range={since:range.since,until:cached.range.until < range.until ? cached.range.until : range.until};
  if(allowStale) candidate.freshness={status:stale?'stale':'fresh',generated_at:cached.generated_at,coverage:{...range},requested_range:requestedRange};
  return {...candidate,range,rows:candidate.rows.filter(row=>row.date>=range.since && row.date<=range.until).map(row=>row.is_ghost?row:({...row,...classifyFormat({name:row.ad_name,campaign_id:row.campaign_id},{name:row.adset_name})}))};
}
function refreshWindow(prior,range){
  if(!validPayload(prior)||prior.funnel_version!==1||prior.inventory_version!==INVENTORY_VERSION||prior.range.since!==range.since||prior.range.until>range.until||!prior.rows.every(r=>qualifies(r.campaign_name)))return range;
  const day=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
  const rolling=day(range.until,-6),next=day(prior.range.until,1);
  return {since:[range.since,rolling<next?rolling:next].sort().at(-1),until:range.until};
}
module.exports = { classifyFormat, qualifies, fetchPromoFormats, formatRange, sliceCachedFormats, refreshWindow, CACHE_KEY };
