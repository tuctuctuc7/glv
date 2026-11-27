const ACCOUNT = 'act_359758259164738';
const SCHEMA_VERSION = 'glv-bfcm/v3';
const CAMPAIGN_START = '2026-11-25';
const API = 'https://graph.facebook.com/v25.0';
const KEYS = ['spend','purchases','revenue','impressions','clicks','lpv','ad_count'];
const isBfcm = (name = '') => /(?:^|[^A-Za-z0-9])Promo[-_\s]+BFCM(?=$|[^A-Za-z0-9])/i.test(name);
const today = (now = new Date()) => new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
function reportWindow(now = new Date(), query = {}) {
  if (query.since === undefined && query.until === undefined) return {since:CAMPAIGN_START,until:today(now)};
  const {since,until} = query;
  const valid = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
  if (!valid(since) || !valid(until) || since < CAMPAIGN_START || since > until || until > today(now)) throw new Error('Invalid reporting range');
  return {since,until};
}
function number(value, optional = false) {
  if (optional && value === undefined) return 0;
  if (value === null || value === undefined || String(value).trim() === '' || !Number.isFinite(Number(value)) || Number(value) < 0) throw new Error('Invalid Meta metric');
  return Number(value);
}
function action(items = [], types) {
  if (!Array.isArray(items)) throw new Error('Invalid Meta action list');
  for (const type of types) {
    const found = items.filter(item => item.action_type === type);
    if (found.length > 1) throw new Error('Duplicate Meta action');
    if (found.length) return number(found[0].value);
  }
  return 0;
}
function codes(name = '') {
  const standard = (name.match(/(?<![A-Za-z0-9])(?:CC|PAC)[_\s]*\d+[A-Za-z]?(?![A-Za-z0-9])/gi) || []).map(code => code.replace(/[_\s]/g,'').toUpperCase());
  // First number identifies the AI EGC concept; subsequent numbers are variants.
  const ai = [...name.matchAll(/(?<![A-Za-z0-9])AI[-_\s]+EGC[-_\s]+(\d+)(?![A-Za-z0-9])/gi)].map(match => `AI EGC ${match[1].padStart(2,'0')}`);
  return [...new Set([...standard,...ai])];
}
function concept(row) {
  // Approved format-level exception: animated banners are one concept group.
  if (/(?:^|[^A-Za-z0-9])Animated[-_\s]*Banners?(?=$|[^A-Za-z0-9])/i.test(row.campaign_name || '')) return 'Animated banners';
  const ad = codes(row.ad_name);
  if (ad.length === 1) return ad[0];
  if (!ad.length) { const set = codes(row.adset_name); if (set.length === 1) return set[0]; }
  return `Unmapped · ${row.ad_name || 'Unnamed ad'} [${row.ad_id}]`;
}
function derived(row) {
  const div = (n,d,m=1) => d > 0 ? n/d*m : null;
  return {...row,roas:div(row.revenue,row.spend),ctr:div(row.clicks,row.impressions,100),cpm:div(row.spend,row.impressions,1000),cost_lpv:div(row.spend,row.lpv),cvr:div(row.purchases,row.lpv,100)};
}
function summarize(source) {
  const groups = new Map(); const seen = new Set();
  const totals = Object.fromEntries(KEYS.map(key=>[key,0]));
  for (const row of source) {
    if (!row.ad_id || !row.campaign_id || !row.campaign_name) throw new Error('Invalid Meta identity');
    if (seen.has(row.ad_id)) throw new Error('Duplicate Meta ad row');
    seen.add(row.ad_id);
    const label = concept(row); const key = `${row.campaign_id}:${label}`;
    if (!groups.has(key)) groups.set(key,{concept:label,campaign_id:row.campaign_id,campaign_name:row.campaign_name,...Object.fromEntries(KEYS.map(k=>[k,0]))});
    const values = {spend:number(row.spend),impressions:number(row.impressions),clicks:number(row.clicks,true),purchases:action(row.actions,['omni_purchase','purchase','offsite_conversion.fb_pixel_purchase']),revenue:action(row.action_values,['omni_purchase','purchase','offsite_conversion.fb_pixel_purchase']),lpv:action(row.actions,['landing_page_view']),ad_count:1};
    for (const k of KEYS) { groups.get(key)[k] += values[k]; totals[k] += values[k]; }
  }
  const rows = [...groups.values()].map(derived).sort((a,b)=>b.purchases-a.purchases || b.spend-a.spend || a.concept.localeCompare(b.concept));
  return {rows,totals:derived(totals),source_ad_count:seen.size};
}
async function fetchReport(token, fetcher = fetch, now = new Date(), options = {}) {
  const {since,until} = reportWindow(now,options); const deadline = Date.now()+240000;
  const daily = options.daily === true;
  async function get(path, params) {
    const remaining = deadline-Date.now();
    if (remaining <= 0) throw new Error('Meta request deadline exceeded');
    let response;
    try { response = await fetcher(`${API}/${path}?${new URLSearchParams(params)}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(Math.min(60000,remaining))}); }
    catch { throw new Error('Meta network request failed'); }
    let data;
    try { data=await response.json(); } catch { throw new Error('Invalid Meta response'); }
    if (!response.ok || data.error) throw new Error(`Meta request failed (${Number(data?.error?.code)||Number(response.status)||0})`);
    return data;
  }
  async function pages(edge, params) {
    const result=[]; const seen=new Set();
    for (;;) {
      const data=await get(`${ACCOUNT}/${edge}`,params);
      if (!Array.isArray(data.data)) throw new Error('Invalid Meta page');
      result.push(...data.data);
      if (result.length > 250000 || seen.size >= 500) throw new Error('Meta pagination limit exceeded');
      if (!data.paging?.next) return result;
      const after=data.paging.cursors?.after;
      if (!after || seen.has(after)) throw new Error('Incomplete Meta pagination');
      seen.add(after);params={...params,after};
    }
  }
  const account=await get(ACCOUNT,{fields:'id,name,currency,timezone_name'});
  if (account.id!==ACCOUNT || account.currency!=='CZK' || account.timezone_name!=='Europe/Prague') throw new Error('Unexpected Meta account identity');
  const filtering=JSON.stringify([{field:'campaign.name',operator:'CONTAIN',value:'BFCM'}]);
  const [allSource,inventory]=await Promise.all([
    pages('insights',{level:'ad',fields:'ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,clicks,actions,action_values',time_range:JSON.stringify({since,until}),...(daily ? {time_increment:'1'} : {}),filtering,limit:'500',use_account_attribution_setting:'true',action_report_time:'impression'}),
    pages('campaigns',{fields:'id,name,status,effective_status',limit:'500',filtering:JSON.stringify([{field:'effective_status',operator:'IN',value:['ACTIVE','PAUSED','ARCHIVED','DELETED']}])}),
  ]);
  const source = allSource.filter(row=>isBfcm(row.campaign_name));
  if (source.some(row=>daily ? (!/^\d{4}-\d{2}-\d{2}$/.test(row.date_start) || row.date_start !== row.date_stop || row.date_start < since || row.date_start > until || new Date(row.date_start).toISOString().slice(0,10) !== row.date_start) : (row.date_start || row.date_stop) && (row.date_start!==since || row.date_stop!==until))) throw new Error('Unexpected Meta reporting date');
  const campaigns=new Map(inventory.filter(c=>isBfcm(c.name)).map(c=>[c.id,c]));
  for(const row of source) if(!campaigns.has(row.campaign_id)) campaigns.set(row.campaign_id,{id:row.campaign_id,name:row.campaign_name,status:null,effective_status:null});
  let result;
  if (daily) {
    const dates = new Map();
    for (const row of source) { if (!dates.has(row.date_start)) dates.set(row.date_start,[]); dates.get(row.date_start).push(row); }
    const daily_rows = [...dates].sort(([a],[b])=>a.localeCompare(b)).flatMap(([date,rows])=>summarize(rows).rows.map(row=>({...row,date})));
    const groups = new Map(), totals = Object.fromEntries(KEYS.map(k=>[k,0]));
    for (const row of daily_rows) {
      const key=JSON.stringify([row.campaign_id,row.concept]);
      if (!groups.has(key)) groups.set(key,{campaign_id:row.campaign_id,campaign_name:row.campaign_name,concept:row.concept,...Object.fromEntries(KEYS.map(k=>[k,0]))});
      for (const k of KEYS) { groups.get(key)[k]+=row[k]; totals[k]+=row[k]; }
    }
    result={rows:[...groups.values()].map(derived).sort((a,b)=>b.purchases-a.purchases || b.spend-a.spend || a.concept.localeCompare(b.concept)),totals:derived(totals),daily_rows,source_ad_count:source.length};
  } else result=summarize(source);
  return {...result,schema_version:SCHEMA_VERSION,reporting_period:since===CAMPAIGN_START && until===today(now)?'campaign-to-date':'custom',daily_breakdown:daily,since,until,date:until,timezone:account.timezone_name,currency:account.currency,account_name:account.name,generated_at:new Date().toISOString(),partial_day:until===today(now),attribution:'Account setting; impression-time reporting',campaigns:[...campaigns.values()],reconciliation:{source_ads:source.length,grouped_ads:result.rows.reduce((n,r)=>n+r.ad_count,0),unmapped_ads:result.rows.filter(r=>r.concept.startsWith('Unmapped')).reduce((n,r)=>n+r.ad_count,0)}};
}
module.exports={concept,summarize,derived,fetchReport,today,isBfcm,reportWindow,SCHEMA_VERSION};
