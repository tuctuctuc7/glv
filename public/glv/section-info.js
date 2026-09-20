/* Business dashboard only. Move live note nodes, never copy their changing text. */
(() => {
  const definitions = 'Totals sum available inputs after filtering. ROAS = revenue / spend; CAC = spend / new customers (positive customers required); Cost per purchase = spend / purchases; AOV = revenue / purchases; CVR = purchases / visitors; New customer rate = new / (new + returning customers). Unavailable inputs remain blank, not zero.';
  const acquisition = 'NC ROAS = NC revenue / existing Spend (ad spend), using matching available rows and positive total spend. RC revenue = revenue − NC revenue only where both inputs exist; negative source discrepancies are preserved. Partial inputs report the available subset, not the whole period; 2025 NC is unavailable.';
  const history = 'History is monthly CZSK only: only complete selected 2025 months enter Month/Year views. Working-source months take precedence over overlapping history. Visitors, CVR and NC inputs are unavailable in history. Day/Week views exclude history.';
  const sections = [
    ['executiveKpiTitle', [], 'Eight cards use the selected working-source market-days only, never the historical snapshot. Comparison uses the immediately preceding equal-length period; unavailable comparisons remain blank. ' + definitions],
    ['trendTitle', ['#trendContent > .historical-scope-note'], definitions + ' ' + history],
    ['detailTitle', ['#auditHistoryNote'], definitions + ' ' + acquisition + ' ' + history],
    ['marketComparisonTitle', [], 'CZSK, US and ROW use working-source rows in the selected dates. Share = market revenue / total revenue across the markets shown; Growth compares revenue with the preceding equal-length period. Total ratios are recalculated from sums, not averaged. ' + definitions + ' ' + acquisition],
    ['phaseChartTitle', ['#phaseSplitNotice'], 'CZSK only, January 1 through the latest loaded working date; independent of Home filters. Promo and Influ follow inclusive calendar intervals; remaining dates are BAU. Monthly ratios are recalculated from sums. Avg daily revenue = revenue / distinct represented phase dates, including zero-revenue days and excluding missing/future days. Split code/no-code uses the same Influ dates; no cost or customer allocation is inferred. ' + definitions + ' ' + acquisition],
    ['phaseTableTitle', ['.phase-table-panel > .historical-scope-note'], definitions + ' Number of days counts distinct represented dates, matching the Avg daily revenue denominator. Hierarchy and Months affect this table independently of Home.'],
    ['promoTitle', ['#promoComparison > .historical-scope-note:not(#promoEmpty)'], 'Daily CZSK Promo values, not cumulative: Day 1…N aligns represented Promo dates within each month, with actual dates in chart data/tooltips. Shorter months retain null tails. Defaults select the last two months with actual Promo data; explicit month choices persist. ' + definitions + ' ' + acquisition],
  ];
  let active = null;
  let timer;
  let suppressFocus = false;
  function position() {
    if (!active) return;
    const { button, panel } = active;
    if (!button.getClientRects().length) { close(); return; }
    const r = button.getBoundingClientRect();
    const w = panel.offsetWidth;
    const h = panel.offsetHeight;
    const below = innerHeight - r.bottom - 12;
    const top = below >= h || below >= r.top - 12 ? r.bottom + 4 : r.top - h - 4;
    panel.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`;
    panel.style.top = `${Math.max(8, Math.min(top, innerHeight - h - 8))}px`;
  }
  function close(restore = false) {
    clearTimeout(timer);
    if (!active) return;
    const {button,panel} = active;
    active = null;
    panel.hidden = true;
    button.setAttribute('aria-expanded','false');
    if (restore) { suppressFocus = true; button.focus({preventScroll:true}); suppressFocus = false; }
  }
  function open(item) {
    clearTimeout(timer);
    if (active !== item) close();
    active = item;
    item.panel.hidden = false;
    item.button.setAttribute('aria-expanded','true');
    position();
  }
  function deferClose(item) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (active === item && !item.pinned && !item.panel.matches(':hover') && !item.button.matches(':hover') && !item.panel.contains(document.activeElement) && document.activeElement !== item.button) close();
    }, 180);
  }
  for (const [id, selectors, text] of sections) {
    const title = document.getElementById(id);
    const row = document.createElement('span'); row.className = 'section-info-title';
    const toggle = title.closest('button');
    if (toggle) {
      // Keep the disclosure button and info button siblings, including mobile.
      const copy = toggle.firstElementChild;
      toggle.before(copy);
      title.before(row); row.append(toggle); toggle.prepend(title);
      toggle.classList.add('section-info-disclosure');
    } else { title.before(row); row.append(title); }
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'section-info-button'; button.id = `${id}-info-button`;
    button.setAttribute('aria-label',`About ${title.textContent}`);
    button.setAttribute('aria-controls',`${id}-info`); button.setAttribute('aria-expanded','false'); button.setAttribute('aria-haspopup','dialog');
    button.innerHTML = '<span aria-hidden="true">i</span>'; row.append(button);
    const panel = document.createElement('div'); panel.id = `${id}-info`; panel.className = 'section-info-panel'; panel.hidden = true;
    panel.setAttribute('role','dialog'); panel.setAttribute('aria-label',`About ${title.textContent}`); panel.tabIndex = 0;
    const heading = document.createElement('strong'); heading.textContent = title.textContent; panel.append(heading);
    for (const selector of selectors) document.querySelectorAll(selector).forEach(note => panel.append(note));
    const explanation = document.createElement('p'); explanation.textContent = text; panel.append(explanation);
    document.body.append(panel);
    new MutationObserver(() => {
      heading.textContent = title.textContent;
      button.setAttribute('aria-label', `About ${title.textContent}`);
      panel.setAttribute('aria-label', `About ${title.textContent}`);
    }).observe(title, {childList:true,subtree:true,characterData:true});
    const item = {button,panel,pinned:false};
    let pointerWasOpen = false;
    button.addEventListener('pointerdown',()=>{ pointerWasOpen = active === item && item.pinned; });
    button.addEventListener('focus',()=>{ if (!suppressFocus) {item.pinned=false;open(item);} });
    button.addEventListener('click',event=>{ event.stopPropagation(); if (active===item && (pointerWasOpen || (event.detail===0 && item.pinned))) {item.pinned=false;close();} else {item.pinned=true;open(item);} pointerWasOpen=false; });
    button.addEventListener('pointerenter',event=>{if(event.pointerType!=='touch'){item.pinned=false;open(item);}});
    for (const node of [button,panel]) {
      node.addEventListener('pointerleave',()=>deferClose(item));
      node.addEventListener('focusout',()=>setTimeout(() => {
        if (active === item && document.activeElement !== button && !panel.contains(document.activeElement)) close();
      }, 0));
    }
    panel.addEventListener('pointerenter',()=>clearTimeout(timer));
    new MutationObserver(()=>{if(active===item)position();}).observe(panel,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['hidden']});
  }
  document.addEventListener('pointerdown',event=>{if(active && !active.button.contains(event.target) && !active.panel.contains(event.target))close();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape' && active){event.preventDefault();close(true);}});
  window.addEventListener('resize',position);
  document.addEventListener('scroll',position,true);
})();
