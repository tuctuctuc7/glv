const assert = require('node:assert/strict');
const path = require('node:path');

module.exports = async function testTabFilters(page, viewport, evidenceDir, fixtures) {
  // Exercise the real normalizers, including the previously excluded US class.
  const advert = {...fixtures.aggregate[4], id:'u2', name:'GLV_202_US_AdVeRtOrIaL_"><svg onload=window.__tabXss=1></svg>', amount_spent:'7000'};
  await page.evaluate(({advert, ads}) => {
    aggregateCampaigns.push(...processAggregateRows([advert]));
    dailyCampaigns.push(...processDaily(['2026-08-10','2026-08-11','2026-08-12'].map(date=>({...advert,date_start:date,amount_spent:'1000'}))));
    adCreatives.push(...processCreatives([{...ads[2],id:'a5',campaign_id:'u2',amount_spent:'700'}]));
    buildAllFilters();TAB_KEYS.forEach(renderTab);
  }, {advert,ads:fixtures.ads});
  const tabs=['czsk','czsk-triage','czsk-promo','czsk-leadgen','us'];
  for(const tab of tabs) {
    await page.locator(`#tab-${tab}`).click();
    const section=page.locator(`#panel-${tab} > .tab-filter-section`);
    assert.equal(await section.count(),1);
    assert.equal(await page.locator(`#panel-${tab}`).evaluate(panel=>panel.firstElementChild.classList.contains('tab-filter-section')),true);
    assert.deepEqual((await section.locator('.triage-filter-label').allTextContents()).slice(0,3),['Campaign group','Campaign name','Grain']);
    const key=kind=>tab==='czsk-triage'?`triage-${kind}`:`tab-${tab}-${kind}`;
    const groups=tab==='us'?['bau','advertorial']:['promo','bau','wl'];
    assert.deepEqual(await page.locator(`#filter-options-${key('group')} input`).evaluateAll(inputs=>inputs.map(i=>i.value)),groups);
    for(const kind of ['group','campaign']) {
      const trigger=page.locator(`#filter-toggle-${key(kind)}`);
      await trigger.scrollIntoViewIfNeeded();
      await trigger.click();
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const geometry=await page.locator(`#filter-dropdown-${key(kind)}`).evaluate(menu=>{
        const r=menu.getBoundingClientRect();return {inside:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,box:[r.left,r.right,r.top,r.bottom],style:menu.getAttribute('style'),computed:[getComputedStyle(menu).position,getComputedStyle(menu).top,getComputedStyle(menu).left],trigger:document.querySelector(`[aria-controls="${menu.id}"]`)?.getBoundingClientRect().toJSON(),targets:[...menu.querySelectorAll('.filter-option,.filter-search,.filter-action-btn')].every(e=>e.getBoundingClientRect().height>=44)};
      });
      await page.screenshot({path:path.join(evidenceDir,`${viewport.name}-${tab}-${kind}-menu.png`)});
      assert.ok(geometry.inside,`${viewport.name}/${tab}/${kind}: ${JSON.stringify(geometry)}`);
      assert.ok(geometry.targets);
      await page.screenshot({path:path.join(evidenceDir,`${viewport.name}-${tab}-${kind}-menu.png`)});
      await page.keyboard.press('Escape');
    }
    const overflow=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,elements:[...document.querySelectorAll('body *')].filter(el=>{const r=el.getBoundingClientRect();return r.width&&r.right>innerWidth+1&&!el.closest('.data-table-wrap')&&(!el.closest('.sr-only')||el.classList.contains('sr-only'));}).map(el=>({tag:el.tagName,id:el.id,class:el.className,right:el.getBoundingClientRect().right})).slice(-12)}));
    assert.ok(overflow.scrollWidth<=overflow.width,JSON.stringify({tab,overflow}));
    if(viewport.width<=720) assert.ok(await section.locator('.filter-toggle,.metric-select').evaluateAll(els=>els.every(el=>el.getBoundingClientRect().height>=44)));
    // Group selection resets names to the new eligible domain; all surfaces narrow.
    const group=tab==='us'?'advertorial':'promo';
    await page.evaluate(k=>clearAll(k),key('group'));
    await page.locator(`#filter-toggle-${key('group')}`).click();
    await page.locator(`#filter-options-${key('group')} input[value="${group}"]`).check();
    await page.keyboard.press('Escape');
    const id=tab==='us'?'u2':'c1';
    assert.deepEqual(await page.locator(`#filter-options-${key('campaign')} input`).evaluateAll(els=>els.map(el=>[el.value,el.checked])),[[id,true]]);
    const actual=await page.evaluate(tab=>{
      const panel=document.getElementById('panel-'+tab);
      const chart=tab==='czsk-triage'?charts['triage-efficiency']:tab==='czsk-promo'?charts['promo-spend']:tab==='czsk-leadgen'?charts['leadgen-metric']:charts[tab];
      const spend=chart.data.datasets.reduce((total,dataset,index)=>total+((tab==='czsk'||tab==='us'||tab==='czsk-triage')&&index>0?0:dataset.data.reduce((a,b)=>a+b,0)),0);
      return {spend,kpis:[...panel.querySelectorAll('.kpi-val')].map(el=>el.textContent),creativeRows:panel.querySelectorAll('.creative-data-table tbody tr').length};
    },tab);
    assert.equal(Math.round(actual.spend),tab==='us'?3000:42300,`${tab}: chart follows top selection`);
    if(tab!=='czsk-triage') assert.ok(actual.kpis.includes(tab==='us'?'7,000':'42,000'),`${tab}: KPIs follow selection`);
    if(tab==='czsk'||tab==='us') assert.equal(actual.creativeRows,1);
    const grainId=tab==='czsk-triage'?'triage-grain':`tab-grain-${tab}`;
    for(const grain of ['week','month','day']) {
      await page.locator(`#${grainId}`).selectOption(grain);
      const counts=await page.evaluate(tab=>{
        const panel=document.getElementById('panel-'+tab);
        return [...panel.querySelectorAll('canvas')].map(canvas=>Chart.getChart(canvas)).filter(chart=>chart&&chart.config.type!=='doughnut').map(chart=>chart.data.labels.length);
      },tab);
      assert.ok(counts.every(count=>count===(grain==='day'?3:1)),`${tab}/${grain}: ${counts}`);
      if(tab==='czsk'||tab==='us') assert.equal(await page.locator(`#daily-table-${tab} tbody tr`).count(),grain==='day'?3:1);
      if(tab==='czsk-promo') {
        await page.evaluate(()=>{promoExpandedGroups.add('promo');renderPromoTable();});
        assert.equal(await page.locator('#promo-table .child-row').count(),grain==='day'?3:1);
      }
      if(tab==='czsk-leadgen') assert.equal(await page.locator('#leadgen-table .child-row').count(),grain==='day'?3:1);
      if(tab==='czsk-promo'||tab==='czsk-leadgen') {
        const prefix=tab==='czsk-promo'?'promo':'leadgen';
        const header=grain==='day'?'Date':'Period';
        const periodText=grain==='week'?'Week of 08-10':grain==='month'?'Aug 2026':'2026-08-12';
        assert.deepEqual((await page.locator(`#${prefix}-table th`).allTextContents()).slice(0,2),['Group',header]);
        assert.equal(await page.locator(`#${prefix}-table .child-row td:nth-child(2)`).first().textContent(),periodText);
        await page.locator(`#${prefix}-mode-days`).click();
        assert.deepEqual((await page.locator(`#${prefix}-table th`).allTextContents()).slice(0,2),[header,'Group']);
        assert.equal(await page.locator(`#${prefix}-table .subtotal-row td`).first().textContent(),periodText);
        await page.locator(`#${prefix}-mode-groups`).click();
      }
    }
    if(tab==='czsk'||tab==='us'||tab==='czsk-leadgen') {
      await page.locator(`#chart-grain-${tab==='czsk-leadgen'?'leadgen':tab}`).selectOption('week');
      assert.equal(await page.locator(`#${grainId}`).inputValue(),'mixed');
      await page.locator(`#${grainId}`).selectOption('day');
    }
    await page.evaluate(k=>clearAll(k),key('campaign'));
    assert.equal(await page.locator(`#filter-label-${key('campaign')}`).textContent(),'No campaigns');
    assert.equal(await page.evaluate(tab=>{
      const chart=tab==='czsk-triage'?charts['triage-efficiency']:tab==='czsk-promo'?charts['promo-spend']:tab==='czsk-leadgen'?charts['leadgen-metric']:charts[tab];return chart.data.labels.length;
    },tab),0);
    // Next tab retains All, not this tab's explicit none.
  }
  assert.equal(await page.evaluate(()=>window.__tabXss||window.__promoXss||0),0);
  await page.evaluate(()=>loadData());
  for(const tab of tabs) {
    const key=tab==='czsk-triage'?'triage-campaign':`tab-${tab}-campaign`;
    assert.equal(await page.locator(`#filter-label-${key}`).textContent(),'No campaigns',`${tab}: explicit none survives reload`);
  }
  // Reset fixture-only selections, not the runtime contract, for the established suite.
  await page.evaluate(()=>{
    TAB_KEYS.forEach(tab=>{filterState[tabFilterKey(tab,'group')]=null;filterState[tabFilterKey(tab,'campaign')]=null;});
    promoExpandedGroups.clear();buildAllFilters();TAB_KEYS.forEach(renderTab);
  });
  await page.locator('#tab-czsk').click();
};
