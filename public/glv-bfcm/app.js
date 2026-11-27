(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const absolute = ['spend', 'purchases', 'revenue', 'impressions', 'clicks', 'lpv', 'ad_count'];
  const metrics = [['spend', 'Spend · CZK'], ['purchases', 'Purchases'], ['roas', 'ROAS'], ['ctr', 'CTR · %'], ['cpm', 'CPM · CZK'], ['cost_lpv', 'Cost / LPV · CZK'], ['cvr', 'CVR · %']];
  let data = null, view = 'concept', busy = false;
  let latest = true, requestId = 0, activeController = null;
  const pragueToday = () => new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
  // Keep the native input as the sole value/validation/picker authority.
  function syncDateLabels() {
    for (const id of ['range-from','range-to']) {
      const input=$(id);
      input.previousElementSibling.textContent=validDate(input.value)
        ? new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',day:'2-digit',month:'short',year:'numeric'}).format(new Date(`${input.value}T12:00:00Z`))
        : 'Choose date';
    }
  }
  for (const id of ['range-from','range-to']) {
    $(id).addEventListener('input',syncDateLabels);
    $(id).addEventListener('change',syncDateLabels);
  }
  function clearScope() { data=null; $('rows').replaceChildren(); $('kpis').replaceChildren(); $('context').textContent='Selected period awaiting source · Europe/Prague · CZK'; $('count').textContent='Waiting for source'; $('period-badge').textContent='Selected period'; }
  function range() {
    const today=pragueToday();
    $('range-from').max=today; $('range-to').max=today;
    if(latest) { $('range-from').value='2026-11-25'; $('range-to').value=today; }
    syncDateLabels();
    const since=$('range-from').value, until=$('range-to').value;
    if(!validDate(since)||!validDate(until)||since<'2026-11-25'||since>until||until>today) throw new Error('Choose a valid inclusive range from 25 Nov 2026 through today');
    return {since,until,today,daily:$('daily-breakdown').checked};
  }
  let sortState = BfcmSort.initial();
  let selectedCampaigns = new Set(), selectionMode = 'all', campaignInventory = [];
  const isBfcm = name => /(?:^|[^a-z0-9])promo[\s_-]+bfcm(?:$|[^a-z0-9])/i.test(String(name || ''));
  function closeCampaigns(restoreFocus = false) {
    $('campaign-popover').hidden = true;
    $('campaign-trigger').setAttribute('aria-expanded', 'false');
    if (restoreFocus) $('campaign-trigger').focus();
  }
  function updateCampaignLabel() {
    const count = selectedCampaigns.size;
    $('campaign-trigger').textContent = !count ? 'None selected' : count === campaignInventory.length ? `All BFCM campaigns (${count})` : `${count} selected`;
    $('campaign-options').querySelectorAll('input').forEach(input => { input.checked = selectedCampaigns.has(input.value); });
  }
  function buildCampaignOptions() {
    $('campaign-options').replaceChildren(...data.campaigns.map(c => {
      const label = node('label'), input = node('input');
      input.type = 'checkbox'; input.value = String(c.id); input.checked = selectedCampaigns.has(input.value);
      input.addEventListener('change', () => {
        if (input.checked) selectedCampaigns.add(input.value); else selectedCampaigns.delete(input.value);
        selectionMode = selectedCampaigns.size > 0 && selectedCampaigns.size === campaignInventory.length ? 'all' : 'subset';
        updateCampaignLabel(); render();
      });
      label.append(input, node('span', c.name)); return label;
    }));
    updateCampaignLabel();
  }
  const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const empty = () => Object.fromEntries(absolute.map(key => [key, 0]));
  const add = (target, row) => absolute.forEach(key => { target[key] += number(row[key]); });
  const divide = (a, b, scale = 1) => b > 0 ? a / b * scale : null;
  function ratios(row) {
    return {...row, roas: divide(row.revenue, row.spend), ctr: divide(row.clicks, row.impressions, 100), cpm: divide(row.spend, row.impressions, 1000), cost_lpv: divide(row.spend, row.lpv), cvr: divide(row.purchases, row.lpv, 100)};
  }
  function format(value, key) {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    return new Intl.NumberFormat('en-GB', {maximumFractionDigits: 2, minimumFractionDigits: key === 'purchases' ? 0 : 2}).format(value) + (key === 'roas' ? '×' : ['ctr', 'cvr'].includes(key) ? '%' : '');
  }
  function node(tag, text, cls) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (cls) el.className = cls;
    return el;
  }
  function render() {
    if (!data) return;
    const query = $('search').value.trim().toLocaleLowerCase();
    const campaignMap = new Map(data.campaigns.map(c => [String(c.id), c]));
    const campaignName = row => String(campaignMap.get(String(row.campaign_id))?.name || row.campaign_name || row.campaign_id || 'Unknown campaign');
    const filtered = (data.daily_breakdown ? data.daily_rows : data.rows).filter(row => selectedCampaigns.has(String(row.campaign_id)) && (!query || `${row.concept || ''} ${campaignName(row)}`.toLocaleLowerCase().includes(query)));
    const groups = new Map(), totals = empty();
    const getGroup = (key, label, subtitle = '') => {
      if (!groups.has(key)) groups.set(key, {...empty(), label, subtitle, days:new Map()});
      return groups.get(key);
    };
    if (view === 'campaign') data.campaigns.forEach(c => {
      if (selectedCampaigns.has(String(c.id)) && (!query || String(c.name).toLocaleLowerCase().includes(query) || filtered.some(r => String(r.campaign_id) === String(c.id)))) getGroup(String(c.id), String(c.name), c.effective_status || c.status || '');
    });
    filtered.forEach(row => {
      add(totals, row);
      const concept = String(row.concept || 'Unclassified');
      const key = view === 'campaign' ? String(row.campaign_id) : view === 'detail' ? JSON.stringify([String(row.campaign_id), concept]) : concept;
      const label = view === 'campaign' ? campaignName(row) : concept;
      const subtitle = view === 'detail' ? campaignName(row) : '';
      const group=getGroup(key, label, subtitle); add(group, row);
      if(data.daily_breakdown) { if(!group.days.has(row.date)) group.days.set(row.date,empty()); add(group.days.get(row.date),row); }
    });
    const totalRatios = ratios(totals);
    $('kpis').replaceChildren(...metrics.map(([key, title]) => {
      const card = node('div', undefined, 'kpi');
      card.append(node('span', title), node('strong', format(totalRatios[key], key)));
      return card;
    }));
    const result = [...groups.values()].map(ratios).sort(BfcmSort.compare(sortState));
    const dates=[];
    if(data.daily_breakdown) for(let date=data.since;date<=data.until;) { dates.push(date); const next=new Date(`${date}T12:00:00Z`);next.setUTCDate(next.getUTCDate()+1);date=next.toISOString().slice(0,10); }
    const tableRow=(row, daily=false) => {
      const tr=node('tr',undefined,daily?'daily-row':'parent-row'), label=node('th'); label.scope='row';
      if(daily) {tr.dataset.date=row.date;label.setAttribute('aria-label',`${row.parent} · ${row.date}`);}
      label.append(node('span',row.label,'row-name'));
      if(row.subtitle) label.append(node('small',row.subtitle));
      tr.append(label,...metrics.map(([key])=>node('td',format(row[key],key),key==='purchases'?'purchases':'')));
      return tr;
    };
    $('rows').replaceChildren(...result.flatMap(row=>[tableRow(row),...dates.map(date=>tableRow({...ratios(row.days.get(date)||empty()),date,label:date,parent:row.label},true))]));
    if (!result.length) { const tr = node('tr'), td = node('td', 'No results for this scope. Try another campaign or search.', 'empty'); td.colSpan = 8; tr.append(td); $('rows').append(tr); }
    $('dimension').textContent = view === 'campaign' ? 'Campaign' : view === 'detail' ? 'Concept / campaign' : 'Concept';
    $('count').textContent = `${result.length} ${view === 'campaign' ? 'campaigns' : 'rows'} · ${selectedCampaigns.size !== data.campaigns.length || query ? 'Filtered totals' : 'All BFCM campaigns'}`;
    document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === view)));
  }
  function updateSort() {
    document.querySelectorAll('[data-sort]').forEach(button => {
      const active = button.dataset.sort === sortState.key;
      button.closest('th').setAttribute('aria-sort', active ? (sortState.direction === 'desc' ? 'descending' : 'ascending') : 'none');
      button.querySelector('.sort-arrow').textContent = active ? (sortState.direction === 'desc' ? '↓' : '↑') : '↕';
      const nextDirection = sortState.clickedKey === button.dataset.sort && sortState.direction === 'desc' ? 'low to high' : 'high to low';
      button.setAttribute('aria-label', `Sort ${button.dataset.title} ${nextDirection}`);
    });
    const title = metrics.find(([key]) => key === sortState.key)[1].split(' · ')[0];
    $('sort-status').textContent = `${title} ${sortState.direction === 'desc' ? '↓' : '↑'}`;
  }
  function setupSort() {
    const headers = [...document.querySelectorAll('thead th')].slice(1);
    metrics.forEach(([key,title],index) => {
      const button = node('button',undefined,'metric-sort'); button.type = 'button';
      button.dataset.sort = key; button.dataset.title = title;
      const [label,unit] = title.split(' · '), text = node('span',label,'sort-label');
      if(unit) text.append(node('small',unit));
      const arrow = node('span',undefined,'sort-arrow'); arrow.setAttribute('aria-hidden','true');
      button.append(text,arrow); headers[index].replaceChildren(button);
      button.addEventListener('click', () => { sortState = BfcmSort.next(sortState,key); updateSort(); render(); });
    });
    updateSort();
  }
  async function load() {
    const id=++requestId; activeController?.abort();
    let requested;
    try { requested=range(); } catch(error) { clearScope(); busy=false; $('refresh').disabled=false; $('refresh').textContent='Refresh data ↻'; $('notice').className='error'; $('notice').textContent=error.message;return; }
    const {since,until,daily}=requested;
    if(data && (data.since!==since || data.until!==until || data.daily_breakdown!==daily)) clearScope();
    busy=true; $('refresh').disabled=true; $('refresh').textContent='Refreshing…';
    $('notice').textContent=data?'Updating snapshot… Last successful data remains visible.':'Loading performance…'; $('notice').className='';
    const controller=new AbortController();activeController=controller;
    const timer=setTimeout(()=>controller.abort(),250000);
    try {
      const response=await fetch(`/api/glv-bfcm/data?${new URLSearchParams({since,until,daily:daily?'1':'0'})}`,{credentials:'same-origin',cache:'no-store',signal:controller.signal});
      if(id!==requestId)return;
      if(response.status===401){window.location.assign('/glv-meta-ads/login.html?next=%2Fglv-bfcm');return;}
      if(!response.ok)throw new Error(`Request failed (${response.status})`);
      const incoming=await response.json();if(id!==requestId)return;
      if(!Array.isArray(incoming.rows)||!Array.isArray(incoming.campaigns)||incoming.currency!=='CZK')throw new Error('Unexpected source data');
      if(incoming.schema_version!=='glv-bfcm/v4'||!['campaign-to-date','custom'].includes(incoming.reporting_period)||incoming.since!==since||incoming.until!==until||incoming.date!==until||incoming.timezone!=='Europe/Prague'||incoming.daily_breakdown!==daily||incoming.partial_day!==(until===requested.today)||(daily&&(!Array.isArray(incoming.daily_rows)||incoming.daily_rows.some(row=>!validDate(row.date)||row.date<since||row.date>until))))throw new Error('Unexpected campaign reporting window');
      const snapshot=new Date(incoming.generated_at);if(Number.isNaN(snapshot.getTime()))throw new Error('Invalid snapshot timestamp');
      const timestamp=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Prague',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(snapshot);
      const campaigns=incoming.campaigns.filter(c=>isBfcm(c.name)),ids=new Set(campaigns.map(c=>String(c.id)));
      const scoped=row=>ids.has(String(row.campaign_id))&&(!row.campaign_name||isBfcm(row.campaign_name));
      data={...incoming,campaigns,rows:incoming.rows.filter(scoped),...(daily?{daily_rows:incoming.daily_rows.filter(scoped)}:{})};
      campaignInventory=campaigns;
      selectedCampaigns=selectionMode==='all'?new Set(ids):new Set([...selectedCampaigns].filter(id=>ids.has(id)));buildCampaignOptions();
      const start=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Prague',day:'2-digit',month:'short',year:'numeric'}).format(new Date(`${since}T12:00:00Z`));
      $('context').textContent=`${start} – ${latest?'now':until} · through ${until} · ${data.partial_day?(until===pragueToday()?'Current day partial':'End day partial at refresh'):'Historical period'} · Europe/Prague · CZK${data.account_name?' · '+data.account_name:''}`;
      $('period-badge').textContent=data.partial_day?'Partial day':'Historical period';
      $('notice').textContent=`Snapshot ${timestamp} · Prague time`;
      $('provenance').textContent=`Meta Ads · ${campaigns.length} BFCM Promo campaigns`;render();
    } catch(error) {
      if(id!==requestId)return;
      $('notice').className='error';$('notice').textContent=`${error.name==='AbortError'?'Request timed out':error.message}. ${data?'Showing last successful snapshot for this period; data may be stale.':'No data loaded.'} Use Refresh to retry.`;
    } finally {
      clearTimeout(timer);if(id===requestId){busy=false;$('refresh').disabled=false;$('refresh').textContent='Refresh data ↻';}
    }
  }
  $('range-form').noValidate=true;
  $('range-form').addEventListener('submit',event=>event.preventDefault());
  for (const id of ['range-from','range-to']) {
    $(id).addEventListener('change',()=>{latest=false;load();});
  }
  $('daily-breakdown').addEventListener('change',()=>load());
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => { view = button.dataset.view; render(); }));
  $('campaign-trigger').addEventListener('click', () => {
    const open = $('campaign-popover').hidden;
    $('campaign-popover').hidden = !open;
    $('campaign-trigger').setAttribute('aria-expanded', String(open));
  });
  ['none', 'all'].forEach(action => $('campaign-' + action).addEventListener('click', () => {
    selectionMode = action === 'all' ? 'all' : 'subset';
    selectedCampaigns = new Set(action === 'all' ? campaignInventory.map(c => String(c.id)) : []);
    updateCampaignLabel(); render();
  }));
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('campaign-popover').hidden) { event.preventDefault(); closeCampaigns(true); } });
  document.addEventListener('click', event => { if (!$('campaign-picker').contains(event.target)) closeCampaigns(); });
  $('search').addEventListener('input', render);
  $('refresh').addEventListener('click', () => {
    // Manual refresh is a no-op until the displayed snapshot is over ten minutes old.
    if (busy) return;
    if (data && (!latest || data.until === pragueToday()) && Date.now() - Date.parse(data.generated_at) <= 10 * 60 * 1000) return;
    load();
  });
  setupSort();

  load();
})();
