/* Meta dashboard: share the established GLV info interaction without changing its route. */
(() => {
  // Route-local adapter of GLV's existing hover/focus/tap disclosure system.
  // Inventory every section heading; move only methodology, never alerts.
  const titles = [...document.querySelectorAll('.panel .section-title, .panel .triage-preset')];
  const wlDefinition = 'WL is a campaign-name group based on substrings, not ad-set or ad names. Case-sensitive: _Promo takes priority, then _WL; otherwise BAU. “Break down WL influencers” splits only WL by case-insensitive campaign-name matches: kristyna → Kristyna, actionkate → ActionKate; both or neither → Other. Totals use selected dates and filters. A displayed 0 does not prove no activity outside this scope.';
  const descriptions = {
    'Filters': 'These campaign and grain controls apply only to this tab. Table-level campaign controls narrow their own table further.',
    'Daily Performance Chart': 'Uses the dashboard dates and this tab’s campaign filters. Select metrics and daily, weekly or monthly grain. Ratios are recalculated from aggregated inputs.',
    'Daily Campaign Table': 'Campaign performance within the dashboard dates and this tab’s filters. Narrow this table and choose its sort independently.',
    'Creative Evaluation': 'Ad-level creative performance within the dashboard dates and this tab’s campaign filters. Type and sort controls affect this table only.',
    'Promo Period Split': wlDefinition + ' Promo only restricts the group views to dates with Promo spend; it does not affect the independent Creative tab.',
    'Promo Group Charts': wlDefinition + ' Metrics and this tab’s grain control the group charts. Ratios are calculated from summed inputs.',
    'Promo Group Table': wlDefinition + ' Group subtotals expand into dates. Switch grouping to start from dates instead. Campaign, grouping and sort controls affect this table only.',
    'Lead-gen Split': 'Lead-gen only restricts this tab to Lead-gen campaigns.',
    'Lead-gen Group Charts': 'Compares campaign-name Lead-gen and Sales groups within the dashboard dates and this tab’s filters.',
    'Lead-gen Group Table': 'Group subtotals expand into dates. Campaign, grouping and sort controls affect this table only.',
  };
  const sections = titles.map((title, index) => {
    title.id ||= `meta-section-${index}`;
    const section = title.closest('.section');
    const notes = [...section.querySelectorAll(':scope > .promo-note:not([id]), :scope > .promo-format-methodology')];
    notes.forEach((note,i)=>note.id ||= `${title.id}-note-${i}`);
    return [title.id, notes.map(note=>`#${note.id}`), descriptions[title.textContent.trim()] || (title.id === 'promo-format-title' ? '' : 'Select metrics and grain for this chart. Campaign filters apply across Triage; local chart settings remain independent.')];
  });
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
    button.addEventListener('pointerenter',event=>{if(event.pointerType!=='touch' && matchMedia('(hover:hover)').matches){item.pinned=false;open(item);}});
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
