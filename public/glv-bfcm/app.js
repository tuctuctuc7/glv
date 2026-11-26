(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const absolute = ['spend', 'purchases', 'revenue', 'impressions', 'clicks', 'lpv', 'ad_count'];
  const metrics = [['spend', 'Spend · CZK'], ['purchases', 'Purchases'], ['roas', 'ROAS'], ['ctr', 'CTR · %'], ['cpm', 'CPM · CZK'], ['cost_lpv', 'Cost / LPV · CZK'], ['cvr', 'CVR · %']];
  let data = null, view = 'concept', busy = false;
  let sortState = BfcmSort.initial();
  let selectedCampaigns = new Set(), selectionMode = 'all';
  const isBfcm = name => /(?:^|[^a-z0-9])promo[\s_-]+bfcm(?:$|[^a-z0-9])/i.test(String(name || ''));
  function closeCampaigns(restoreFocus = false) {
    $('campaign-popover').hidden = true;
    $('campaign-trigger').setAttribute('aria-expanded', 'false');
    if (restoreFocus) $('campaign-trigger').focus();
  }
  function updateCampaignLabel() {
    const count = selectedCampaigns.size;
    $('campaign-trigger').textContent = !count ? 'None selected' : count === data.campaigns.length ? `All BFCM campaigns (${count})` : `${count} selected`;
    $('campaign-options').querySelectorAll('input').forEach(input => { input.checked = selectedCampaigns.has(input.value); });
  }
  function buildCampaignOptions() {
    $('campaign-options').replaceChildren(...data.campaigns.map(c => {
      const label = node('label'), input = node('input');
      input.type = 'checkbox'; input.value = String(c.id); input.checked = selectedCampaigns.has(input.value);
      input.addEventListener('change', () => {
        if (input.checked) selectedCampaigns.add(input.value); else selectedCampaigns.delete(input.value);
        selectionMode = selectedCampaigns.size > 0 && selectedCampaigns.size === data.campaigns.length ? 'all' : 'subset';
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
    const filtered = data.rows.filter(row => selectedCampaigns.has(String(row.campaign_id)) && (!query || `${row.concept || ''} ${campaignName(row)}`.toLocaleLowerCase().includes(query)));
    const groups = new Map(), totals = empty();
    const getGroup = (key, label, subtitle = '') => {
      if (!groups.has(key)) groups.set(key, {...empty(), label, subtitle});
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
      add(getGroup(key, label, subtitle), row);
    });
    const totalRatios = ratios(totals);
    $('kpis').replaceChildren(...metrics.map(([key, title]) => {
      const card = node('div', undefined, 'kpi');
      card.append(node('span', title), node('strong', format(totalRatios[key], key)));
      return card;
    }));
    const result = [...groups.values()].map(ratios).sort(BfcmSort.compare(sortState));
    $('rows').replaceChildren(...result.map(row => {
      const tr = node('tr'), label = node('th'); label.scope = 'row';
      label.append(node('span', row.label, 'row-name'));
      if (row.subtitle) label.append(node('small', row.subtitle));
      tr.append(label, ...metrics.map(([key]) => node('td', format(row[key], key), key === 'purchases' ? 'purchases' : '')));
      return tr;
    }));
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
    if (busy) return;
    busy = true; $('refresh').disabled = true; $('refresh').textContent = 'Refreshing…';
    $('notice').textContent = data ? 'Updating snapshot… Last successful data remains visible.' : 'Loading performance…';
    $('notice').className = '';
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 250000);
    try {
      const response = await fetch('/api/glv-bfcm/data', {credentials: 'same-origin', cache: 'no-store', signal: controller.signal});
      if (response.status === 401) { window.location.assign('/glv-meta-ads/login.html?next=%2Fglv-bfcm'); return; }
      if (!response.ok) throw new Error(`Request failed (${response.status})`);
      const incoming = await response.json();
      if (!Array.isArray(incoming.rows) || !Array.isArray(incoming.campaigns) || !incoming.date || incoming.currency !== 'CZK') throw new Error('Unexpected source data');
      if (incoming.schema_version !== 'glv-bfcm/v2' || incoming.reporting_period !== 'campaign-to-date' || incoming.since !== '2026-11-25' || !/^\d{4}-\d{2}-\d{2}$/.test(incoming.until) || incoming.until < incoming.since || incoming.date !== incoming.until || incoming.timezone !== 'Europe/Prague' || incoming.partial_day !== true) throw new Error('Unexpected campaign reporting window');
      const snapshot = new Date(incoming.generated_at);
      if (Number.isNaN(snapshot.getTime())) throw new Error('Invalid snapshot timestamp');
      const timestamp = new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/Prague', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'}).format(snapshot);
      const campaigns = incoming.campaigns.filter(c => isBfcm(c.name));
      const ids = new Set(campaigns.map(c => String(c.id)));
      data = {...incoming, campaigns, rows: incoming.rows.filter(row => ids.has(String(row.campaign_id)) && (!row.campaign_name || isBfcm(row.campaign_name)))};
      selectedCampaigns = selectionMode === 'all' ? new Set(ids) : new Set([...selectedCampaigns].filter(id => ids.has(id)));
      buildCampaignOptions();
      const start = new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/Prague', day: '2-digit', month: 'short', year: 'numeric'}).format(new Date(`${data.since}T12:00:00Z`));
      $('context').textContent = `${start} – now · through ${data.until} · Current day partial · Europe/Prague · CZK${data.account_name ? ' · ' + data.account_name : ''}`;
      $('notice').textContent = `Snapshot ${timestamp} · Prague time`;
      $('provenance').textContent = `Meta Ads · ${data.campaigns.length} BFCM Promo campaigns`;
      render();
    } catch (error) {
      $('notice').className = 'error';
      $('notice').textContent = `${error.name === 'AbortError' ? 'Request timed out' : error.message}. ${data ? 'Showing last successful snapshot; data may be stale.' : 'No data loaded.'} Use Refresh to retry.`;
      if (!data) $('rows').replaceChildren();
    } finally {
      clearTimeout(timer); busy = false; $('refresh').disabled = false; $('refresh').textContent = 'Refresh data ↻';
    }
  }
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => { view = button.dataset.view; render(); }));
  $('campaign-trigger').addEventListener('click', () => {
    const open = $('campaign-popover').hidden;
    $('campaign-popover').hidden = !open;
    $('campaign-trigger').setAttribute('aria-expanded', String(open));
  });
  ['none', 'all'].forEach(action => $('campaign-' + action).addEventListener('click', () => {
    if (!data) return;
    selectionMode = action === 'all' ? 'all' : 'subset';
    selectedCampaigns = new Set(action === 'all' ? data.campaigns.map(c => String(c.id)) : []);
    updateCampaignLabel(); render();
  }));
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('campaign-popover').hidden) { event.preventDefault(); closeCampaigns(true); } });
  document.addEventListener('click', event => { if (!$('campaign-picker').contains(event.target)) closeCampaigns(); });
  $('search').addEventListener('input', render);
  $('refresh').addEventListener('click', () => {
    // Manual refresh is a no-op until the displayed snapshot is over ten minutes old.
    if (data && Date.now() - Date.parse(data.generated_at) <= 10 * 60 * 1000) return;
    load();
  });
  setupSort();

  load();
})();
