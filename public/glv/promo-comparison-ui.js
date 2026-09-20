/* Chart-local state intentionally does not use the Phases or table filters. */
window.renderPromoComparison = (() => {
  let selected;
  let chart;
  let lastDays = [];
  const $ = id => document.getElementById(id);
  const node = (tag, text) => { const n = document.createElement(tag); if (text != null) n.textContent = text; return n; };
  const names = {revenue:'Revenue', avg_daily_revenue:'Avg daily revenue', spend:'Spend', roas:'ROAS', nc_roas:'NC ROAS', cac:'CAC', purchases:'Purchases', cpa:'Cost per purchase', aov:'AOV', cvr:'CVR', unique_visitors:'Visitors', new_customer_revenue:'New customer revenue', returning_customer_revenue:'RC revenue', new_customer_rate:'New customer rate'};
  const monthName = month => new Intl.DateTimeFormat('en-US', {month:'long', year:'numeric', timeZone:'UTC'}).format(new Date(`${month}-01T00:00:00Z`));
  function format(key, value, compact = false) {
    if (value == null) return '—';
    return formatMetric(key, value, compact);
  }
  function render(days) {
    lastDays = days;
    const api = window.GlvPromoComparison;
    const select = $('promoMetric');
    if (!select.options.length) {
      Object.entries(names).forEach(([key,label]) => { const o = node('option',label); o.value = key; select.append(o); });
      select.onchange = () => render(lastDays);
    }
    const metric = select.value;
    const data = api.build(days, selected, metric);
    if (selected === undefined && data.available.length) selected = data.selected;
    const host = $('promoMonths');
    const open = host.querySelector('button')?.getAttribute('aria-expanded') === 'true';
    const focus = host.contains(document.activeElement) ? document.activeElement.dataset.value : undefined;
    host.replaceChildren();
    const trigger = node('button', `Months: ${selected === null ? 'All' : data.selected.length ? `${data.selected.length} selected` : 'None'}`);
    trigger.className = 'phase-menu-trigger'; trigger.type = 'button';
    trigger.setAttribute('aria-expanded', String(open)); trigger.setAttribute('aria-controls','promoMonthOptions');
    const menu = node('div'); menu.id = 'promoMonthOptions'; menu.className = 'phase-menu-options'; menu.hidden = !open;
    menu.setAttribute('role','group'); menu.setAttribute('aria-label','Promo comparison months');
    trigger.onclick = () => { menu.hidden = !menu.hidden; trigger.setAttribute('aria-expanded',String(!menu.hidden)); };
    function option(value, label, checked, disabled, action) {
      const row = node('label'); const input = node('input'); input.type = 'checkbox'; input.dataset.value = value; input.checked = checked; input.disabled = disabled;
      input.onchange = action; row.append(input, document.createTextNode(label)); menu.append(row);
    }
    option('none','None',data.selected.length === 0,false, () => { selected = []; render(lastDays); });
    option('*','All',data.available.length > 0 && data.selected.length === data.available.length,false, e => { selected = e.target.checked ? null : []; render(lastDays); });
    data.months.forEach(month => option(month, `${monthName(month)}${data.available.includes(month) ? '' : ' · no Promo data'}`,data.selected.includes(month),!data.available.includes(month),e => {
      const next = new Set(data.selected); if (e.target.checked) next.add(month); else next.delete(month); selected = [...next]; render(lastDays);
    }));
    host.append(trigger,menu);
    host.onkeydown = e => { if (e.key === 'Escape') { menu.hidden = true; trigger.setAttribute('aria-expanded','false'); trigger.focus(); } };
    if (focus !== undefined) [...menu.querySelectorAll('input')].find(n => n.dataset.value === focus)?.focus();
    const caption = `CZSK Promo only · daily ${names[metric]} · ${data.selected.map(monthName).join(', ') || 'no months selected'}`;
    $('promoChart').setAttribute('aria-label',caption);
    $('promoChartCaption').textContent = caption;
    const header = $('promoChartData').querySelector('thead tr'); header.replaceChildren();
    ['Promo day', ...data.series.map(s => monthName(s.month))].forEach(label => { const th = node('th',label); th.scope = 'col'; header.append(th); });
    const body = $('promoChartDataBody'); body.replaceChildren();
    data.labels.forEach((label,i) => { const tr = node('tr'); const th = node('th',label); th.scope = 'row'; tr.append(th); data.series.forEach(s => tr.append(node('td',s.dates[i] ? `${s.dates[i]}: ${format(metric,s.values[i])}` : '—'))); body.append(tr); });
    const hasValues = data.series.some(s => s.values.some(v => v !== null));
    $('promoEmpty').hidden = hasValues;
    $('promoEmpty').textContent = !data.available.length ? 'No represented CZSK Promo days in the loaded data.' : !data.selected.length ? 'Select months to compare Promo days.' : 'No available values for this metric in the selected Promo days.';
    if (chart) chart.destroy(); chart = null;
    const canvas = $('promoChart'); canvas.hidden = !hasValues;
    if (!window.Chart || !hasValues) return;
    const style = getComputedStyle(document.documentElement); const text = style.getPropertyValue('--text-tertiary').trim(); const grid = style.getPropertyValue('--border').trim();
    const font = { family: getComputedStyle(document.body).fontFamily };
    chart = new window.Chart(canvas, {
      type: 'line',
      data: { labels: data.labels, datasets: data.series.map(s => ({
        label: monthName(s.month), month: s.month, dates: s.dates, data: s.values,
        borderColor: api.color(s.month, document.documentElement.dataset.theme),
        backgroundColor: api.color(s.month, document.documentElement.dataset.theme),
        borderWidth: 2.5, pointRadius: 3, pointHoverRadius: 5, spanGaps: false, tension: 0.25,
      })) },
      options: {
        animation: false, responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom', align: 'start', onClick: () => {}, labels: { font, color: text, boxWidth: 18, boxHeight: 2, padding: 16 } },
          tooltip: { titleFont: font, bodyFont: font, callbacks: { label: item => `${item.dataset.label} · ${item.dataset.dates[item.dataIndex]}: ${format(metric, item.raw)}` } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font, color: text }, border: { color: grid } },
          y: { beginAtZero: true, grid: { color: grid }, ticks: { font, color: text, callback: value => format(metric, value, true) }, border: { display: false } },
        },
      },
    });
  }
  return render;
})();
