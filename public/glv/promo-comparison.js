(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GlvPromoComparison = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const palettes = {
    dark: ['#75baff','#ffae66','#70d6a0','#d3a0ff','#ff8da1','#72dce5','#e6cc70','#b6c5ff','#e6a0d5','#99d478','#e3b49a','#a5cbd2'],
    light: ['#2464ad','#a45113','#187346','#8044b5','#b33350','#087b87','#806811','#5655ae','#984382','#48781a','#885740','#416d78'],
  };
  function color(month, theme = 'dark') { return palettes[theme === 'light' ? 'light' : 'dark'][Number(month.slice(5,7)) - 1]; }
  const finite = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
  const ratio = (n,d) => finite(n) && finite(d) && Number(d) > 0 ? Number(n) / Number(d) : null;
  function value(row, metric) {
    const ratios = {roas:['revenue','spend'], nc_roas:['new_customer_revenue','spend'], cac:['spend','new_customers'], cpa:['spend','purchases'], aov:['revenue','purchases'], cvr:['purchases','unique_visitors']};
    if (ratios[metric]) return ratio(...ratios[metric].map(k => row[k]));
    if (metric === 'new_customer_rate') return ratio(row.new_customers, finite(row.new_customers) && finite(row.returning_customers) ? Number(row.new_customers) + Number(row.returning_customers) : null);
    if (metric === 'returning_customer_revenue') return finite(row.revenue) && finite(row.new_customer_revenue) ? Number(row.revenue) - Number(row.new_customer_revenue) : null;
    const raw = row[metric === 'avg_daily_revenue' ? 'revenue' : metric];
    return finite(raw) ? Number(raw) : null;
  }
  // Input is the unfiltered, source-classified output of GlvPhases.buildPhaseDays.
  function build(days, selected, metric = 'revenue') {
    const source = (days || []).filter(d => d.region === 'czsk');
    const months = [...new Set(source.map(d => d.date.slice(0, 7)))].sort();
    const promo = source.filter(d => d.phase === 'Promo').sort((a,b) => a.date.localeCompare(b.date));
    const available = months.filter(month => promo.some(d => d.date.startsWith(month)));
    const chosen = selected === undefined ? available.slice(-2) : selected === null ? available : available.filter(m => selected.includes(m));
    const groups = chosen.map(month => ({ month, days: promo.filter(d => d.date.startsWith(month)) }));
    const length = Math.max(0, ...groups.map(g => g.days.length));
    return { months, available, selected: chosen, labels: Array.from({length}, (_,i) => `Day ${i+1}`), series: groups.map(g => ({
      month: g.month, dates: g.days.map(d => d.date), values: Array.from({length}, (_,i) => g.days[i] ? value(g.days[i], metric) : null),
    })) };
  }
  return { build, value, color };
}));
