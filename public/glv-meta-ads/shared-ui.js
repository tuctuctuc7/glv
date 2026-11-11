/* V1-reference presentation shared by both MAD routes. */
function renderTab(tab){
  if(tab==='czsk-triage'){refreshTriageCharts();return;}
  if(tab==='czsk-promo'){renderPromoKPIs();refreshPromoCharts();renderPromoTable();return;}
  if(tab==='czsk-leadgen'){renderLeadgenKPIs();refreshLeadgenCharts();renderLeadgenTable();return;}
  renderKPIs(tab);refreshChart(tab);renderDailyTable(tab);renderCreatives(tab);
}

function renderKPIs(seg){
  renderCreatorWarning(seg);
  if(renderSourceEmpty('kpi-'+seg,'aggregate'))return;
  const rows=getMainSegmentRows(seg,'aggregate');const a=aggregate(rows);const m=calcMetrics(a);
  document.getElementById('kpi-'+seg).innerHTML=`
    <div class="kpi-card"><div class="kpi-label">Spend</div><div class="kpi-val">${fmtInt(a.spend)}</div><div class="kpi-sub">${reportCurrency}</div><div class="kpi-sub2" title="${MadPresentation.usdNote}">${fmtUsd(a.spend)}</div></div>
    <div class="kpi-card"><div class="kpi-label">Revenue</div><div class="kpi-val">${a.revenue>0?fmtInt(a.revenue):'—'}</div><div class="kpi-sub">${reportCurrency}</div><div class="kpi-sub2" title="${MadPresentation.usdNote}">${fmtUsd(a.revenue)}</div></div>
    <div class="kpi-card hl"><div class="kpi-label">ROAS</div><div class="kpi-val ${roasClass(m.roas)}">${fmtRoas(m.roas)}</div><div class="kpi-sub">Revenue / Spend</div></div>
    <div class="kpi-card"><div class="kpi-label">Purchases</div><div class="kpi-val">${a.purchases>0?fmtInt(a.purchases):'—'}</div><div class="kpi-sub">${m.cpa>0?'CPA: '+fmtInt(m.cpa)+moneyLabel(' CZK'):'CPA: —'}</div></div>
    <div class="kpi-card"><div class="kpi-label">LP → Purchase</div><div class="kpi-val">${fmtPct(m.lp2pur)}</div><div class="kpi-sub">${a.lp>0?fmtInt(a.lp)+' LP views':'No LP data'}</div></div>
    <div class="kpi-card"><div class="kpi-label">LP → Checkout</div><div class="kpi-val">${fmtPct(m.lp2co)}</div><div class="kpi-sub">${a.checkouts>0?fmtInt(a.checkouts)+' checkouts':'No checkout data'}</div></div>
    <div class="kpi-card"><div class="kpi-label">Checkout → Purchase</div><div class="kpi-val">${fmtPct(m.co2pur)}</div><div class="kpi-sub">Checkout to purchase</div></div>
    <div class="kpi-card"><div class="kpi-label">Cost / Checkout</div><div class="kpi-val">${m.costChk>0?fmtInt(m.costChk):'—'}</div><div class="kpi-sub">${m.costChk>0?moneyLabel('CZK'):'No checkout data'}</div></div>
  `;
}

function refreshChart(seg){
  const rows=getMainSegmentRows(seg,'daily');const grain=chartGranularity[seg]||'day';const daily=byPeriod(rows,null,grain);
  const lKey=document.getElementById('chart-left-'+seg).value;const rKey=document.getElementById('chart-right-'+seg).value;
  const labels=daily.map(d=>fmtChartDate(d.date,grain));
  const leftVals=daily.map(d=>{const m=calcMetrics(d);return computeChartMetric(lKey,d,m);});
  const rightVals=daily.map(d=>{const m=calcMetrics(d);return computeChartMetric(rKey,d,m);});
  if(charts[seg]){charts[seg].destroy();delete charts[seg];}
  const ctx=document.getElementById('chart-'+seg).getContext('2d');
  const allMetrics=[...CHART_METRIC_OPTIONS,...LEAD_CHART_METRIC_OPTIONS];
  const leftMetric=allMetrics.find(m=>m.key===lKey)||metricDefinition(lKey);
  const rightMetric=allMetrics.find(m=>m.key===rKey)||metricDefinition(rKey);
  const lLabel=leftMetric.label;const rLabel=rightMetric.label;
  charts[seg]=new Chart(ctx,{
    data:{labels,datasets:[
      {type:'bar',label:lLabel,metricKey:lKey,data:leftVals,backgroundColor:hexToRgba(leftMetric.color,.25),borderColor:leftMetric.color,borderWidth:1.5,yAxisID:'y',order:2},
      {type:'line',label:rLabel,metricKey:rKey,data:rightVals,borderColor:rightMetric.color,backgroundColor:hexToRgba(rightMetric.color,.1),borderWidth:2,pointRadius:3,fill:false,yAxisID:'y1',order:1,tension:.3},
    ]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:{position:'bottom',align:'start',labels:{boxWidth:12,font:{size:11},sort:sortLegendByAxis}},
        tooltip:{callbacks:{label:(ctx)=>`${ctx.dataset.label}: ${formatChartVal(ctx.datasetIndex===0?lKey:rKey,ctx.raw)}`}}},
      scales:{x:{grid:{display:false},ticks:{font:{size:11},maxRotation:45}},
        y:{position:'left',grid:{color:'rgba(0,0,0,.05)'},ticks:{precision:wholeNumberTickPrecision(lKey),font:{size:11},callback:v=>formatChartTick(lKey,v)}},
        y1:{position:'right',grid:{display:false},ticks:{precision:wholeNumberTickPrecision(rKey),font:{size:11},callback:v=>formatChartTick(rKey,v)}}}}
  });
}

function renderDailyTable(seg){
  if(renderSourceEmpty('daily-table-'+seg,'daily'))return;
  const sel=filterState[seg];const rows=getMainSegmentRows(seg,'daily');const daily=byPeriod(rows,sel,tabGrain[seg]);
  const container=document.getElementById('daily-table-'+seg);
  container.innerHTML='';
  if(!daily.length){container.innerHTML='<div class="empty">No data.</div>';return;}
  if(grids['daily-'+seg]){try{grids['daily-'+seg].destroy();}catch(e){}}
  const sorted=sortRows(daily,'daily',seg);
  const tableRows=sorted.map(d=>({d,m:calcMetrics(d)}));
  const columns=[
    {label:tabGrain[seg]==='day'?'Date':'Period',text:r=>tabGrain[seg]==='day'?r.d.date:fmtChartDate(r.d.date,tabGrain[seg])},
    {label:'Spend',text:r=>fmtInt(r.d.spend)},
    {label:'Revenue',text:r=>r.d.revenue>0?fmtInt(r.d.revenue):'—'},
    {label:'ROAS',text:r=>fmtRoas(r.m.roas),html:r=>roasHtml(r.m.roas)},
    {label:'Purchases',text:r=>r.d.purchases||'—'},
    {label:'CPA',text:r=>r.m.cpa>0?fmtInt(r.m.cpa):'—'},
    {label:'AOV',text:r=>r.m.aov>0?fmtInt(r.m.aov):'—'},
    {label:'LP→Checkout',text:r=>fmtPct(r.m.lp2co)},
    {label:'Checkout→Purchase',text:r=>fmtPct(r.m.co2pur)},
    {label:'Checkouts',text:r=>r.d.checkouts||'—'},
    {label:'Cost/Checkout',text:r=>r.m.costChk>0?fmtInt(r.m.costChk):'—'},
    {label:'LP Views',text:r=>fmtInt(r.d.lp)},
    {label:'Cost/LP',text:r=>fmtOne(r.m.costLp)},
    {label:'CTR',text:r=>fmtPct(r.m.ctr)},
    {label:'LP→Purchase',text:r=>fmtPct(r.m.lp2pur)},
    {label:'CPM',text:r=>r.m.cpm>0?fmtInt(r.m.cpm):'—'},
  ];
  renderControlledTable(container,columns,tableRows,'daily-data-table');
}

function renderLeadgenTable(){
  if(renderSourceEmpty('leadgen-table','daily'))return;
  const container=document.getElementById('leadgen-table');if(!container)return;
  const grain=tabGrain['czsk-leadgen'];const period=grain==='day'?'days':grain==='week'?'weeks':'months';
  document.getElementById('leadgen-mode-groups').textContent=`Groups → ${period}`;document.getElementById('leadgen-mode-days').textContent=`${period[0].toUpperCase()+period.slice(1)} → groups`;
  const rows=byDateLeadgenGroup(periodRows(getLeadgenRows('daily'),'czsk-leadgen'),filterState['czsk-leadgen']);
  if(!rows.length){container.innerHTML='<div class="empty">No CZSK Lead-gen data for this range.</div>';return;}
  const metricColumns=['Spend','Revenue','ROAS','Purchases','CPA','AOV','LP→Checkout','Checkout→Purchase','Checkouts','Cost/Checkout','LP Views','Cost/LP','CTR','LP→Purchase','CPM','Leads','CPL','LP→Lead'];
  const columns=leadgenTableMode==='groups'?['Group',grain==='day'?'Date':'Period',...metricColumns]:[grain==='day'?'Date':'Period','Group',...metricColumns];
  const state=sortState.leadgen.czsk;let body='';
  if(leadgenTableMode==='groups'){
    let groups=activeLeadgenGroups().map(g=>sumPromoRows(rows.filter(r=>r.group===g.key),null,g.key)).filter(g=>g.spend||g.revenue||g.purchases||g.checkouts||g.leads||g.lp);
    groups=state.key==='date'?groups.sort((a,b)=>LEADGEN_GROUPS.findIndex(g=>g.key===a.group)-LEADGEN_GROUPS.findIndex(g=>g.key===b.group)):groups.sort(leadgenSortComparator);
    for(const total of groups){const children=rows.filter(r=>r.group===total.group).sort(leadgenSortComparator);body+=leadgenNestedRow('subtotal-row',leadgenGroupHtml(total.group),'Subtotal',total);body+=children.map(r=>leadgenNestedRow('child-row','',`<span class="nested-child">${escapeHtml(grain==='day'?r.date:fmtChartDate(r.date,grain))}</span>`,r)).join('');}
  }else{
    const dates=[...new Set(rows.map(r=>r.date))].map(date=>sumPromoRows(rows.filter(r=>r.date===date),date,null)).sort(leadgenSortComparator);
    for(const total of dates){let children=rows.filter(r=>r.date===total.date);children=state.key==='date'?children.sort((a,b)=>LEADGEN_GROUPS.findIndex(g=>g.key===a.group)-LEADGEN_GROUPS.findIndex(g=>g.key===b.group)):children.sort(leadgenSortComparator);body+=leadgenNestedRow('subtotal-row',escapeHtml(grain==='day'?total.date:fmtChartDate(total.date,grain)),'Subtotal',total);body+=children.map(r=>leadgenNestedRow('child-row','',`<span class="nested-child">${leadgenGroupHtml(r.group)}</span>`,r)).join('');}
  }
  container.innerHTML=`<div class="data-table-wrap"><table class="data-table daily-data-table"><thead><tr>${columns.map(label=>`<th title="${escapeHtml(label)}">${escapeHtml(label)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
}
