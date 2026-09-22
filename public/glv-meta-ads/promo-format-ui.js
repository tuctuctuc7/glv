/* Native Promo format view. All facts arrive through the protected shared API. */
let promoFormatPayload = null;
let promoFormatError = '';
const PROMO_FORMAT_CHART_KEYS = ['promo-format-spend','promo-format-purchases'];
function promoFormatRows() {
  if (!promoFormatPayload) return [];
  return promoFormatPayload.rows;
}
let promoFormatSequence=0;
function promoFormatHistory() {
  responseCache.invalidate('/api/glv-meta-ads/fb-data?type=promo_formats&date_preset=promo_history');
  return loadPromoFormats();
}
async function loadPromoFormats() {
  const sequence=++promoFormatSequence;
  try {
    const data=await apiFetch('promo_formats');
    if(sequence!==promoFormatSequence)return;
    if (!PromoFormat.validPayload(data)) throw new Error('Refresh required: format schema unavailable');
    if(promoFormatPayload===data&&!promoFormatError)return;
    promoFormatPayload=data;promoFormatError='';
  } catch (error) {
    if(sequence!==promoFormatSequence)return;
    promoFormatPayload=null;promoFormatError=error.message;
  }
  refreshPromoFormats();
}
function refreshPromoFormats() {
  const section=document.getElementById('promo-format-section');if(!section)return;
  PROMO_FORMAT_CHART_KEYS.forEach(key=>{if(charts[key]){charts[key].destroy();delete charts[key];}});
  const status=document.getElementById('promo-format-status');status.hidden=false;
  document.getElementById('promo-format-summary').textContent='';
  const body=document.querySelector('#promo-format-table tbody');body.innerHTML='';
  const unknown=document.getElementById('promo-format-unknown');unknown.innerHTML='';unknown.hidden=true;
  const chartGrid=section.querySelector('.promo-format-grid');
  const rows=promoFormatRows(), months=PromoFormat.monthlyMix(rows);
  chartGrid.hidden=!months.length;
  section.querySelector('.promo-format-table-wrap').hidden=!months.length;
  status.classList.toggle('format-warning',Boolean(promoFormatError));
  if(!promoFormatPayload){status.textContent=promoFormatError?`Format data unavailable — ${promoFormatError}`:'Loading ad-level format facts…';return;}
  const range=promoFormatPayload.range;
  document.getElementById('promo-format-range').textContent=`${range.since} → ${range.until} · Monthly · independent history`;
  if(!months.length){status.textContent='No Promo ad activity in this history range.';return;}
  const unknownRows=rows.filter(row=>row.format==='Unknown');
  const unknownCount=new Set(unknownRows.map(row=>row.ad_id)).size;
  status.textContent=unknownCount?`Unknown: ${unknownCount} ads retained in totals and shares. Review unmapped or conflicting labels below.`:`All ${new Set(rows.map(row=>row.ad_id)).size} activity-bearing ads classified. Carryover purchases included.`;
  status.classList.toggle('format-warning',unknownCount>0);
  status.hidden=unknownCount===0;
  if(!unknownCount)document.getElementById('promo-format-summary').textContent=status.textContent;
  const formats=PromoFormat.FORMATS.filter(format=>format!=='Unknown'||unknownCount);
  const percent=value=>value===null?'—':value.toFixed(1)+'%';
  const value=(key,n)=>n===null?'—':formatChartVal(key,n);
  const label=month=>new Date(month+'-01T00:00:00Z').toLocaleDateString('en-US',{month:'short',year:'numeric',timeZone:'UTC'});
  for(const month of months) {
    const renderRow=(format,data,total=false)=>`<tr class="${total?'subtotal-row':'child-row'}"><td>${escapeHtml(label(month.month))}</td><td>${total?'Total':`<span class="format-dot" style="background:${PromoFormat.COLORS[format]}"></span>${format}`}</td><td>${data.ads}</td><td>${escapeHtml(value('spend',data.spend))}</td><td>${percent(data.spendShare)}</td><td>${escapeHtml(value('purchases',data.purchases))}</td><td>${percent(data.purchaseShare)}</td><td>${escapeHtml(value('revenue',data.revenue))}</td><td>${escapeHtml(value('roas',data.roas))}</td><td>${escapeHtml(value('cpa',data.cpa))}</td></tr>`;
    body.insertAdjacentHTML('beforeend',renderRow('Total',month.total,true)+formats.filter(format=>format!=='Unknown'||month.formats.Unknown.ads).map(format=>renderRow(format,month.formats[format])).join(''));
  }
  if(unknownCount){
    const ads=new Map();
    for(const row of unknownRows){const key=row.ad_id;const current=ads.get(key)||{...row,spend:0,purchases:0};current.spend+=row.spend;current.purchases+=row.purchases;ads.set(key,current);}
    unknown.hidden=false;
    unknown.innerHTML=`<summary>Review ${unknownCount} Unknown ads</summary><div class="data-table-wrap"><table class="data-table"><caption class="sr-only">Unmapped or conflicting Promo ads retained in this view</caption><thead><tr><th scope="col">Ad / ID</th><th scope="col">Current ad set</th><th scope="col">Campaign</th><th scope="col">Reason</th><th scope="col">Spend</th><th scope="col">Purchases</th></tr></thead><tbody>${[...ads.values()].map(row=>`<tr><td title="${escapeHtml(row.ad_name)}">${escapeHtml(row.ad_name)} · ${escapeHtml(row.ad_id)}</td><td title="${escapeHtml(row.adset_name)}">${escapeHtml(row.adset_name)}</td><td title="${escapeHtml(row.campaign_name)}">${escapeHtml(row.campaign_name)}</td><td>${escapeHtml(row.reason.replaceAll('_',' '))}</td><td>${escapeHtml(value('spend',row.spend))}</td><td>${escapeHtml(value('purchases',row.purchases))}</td></tr>`).join('')}</tbody></table></div>`;
  }
  const percentLabels={id:'promoFormatLabels',afterDatasetsDraw(chart){
    const {ctx}=chart;ctx.save();ctx.font='700 11px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#fff';
    chart.data.datasets.forEach((dataset,index)=>{if(!chart.isDatasetVisible(index))return;chart.getDatasetMeta(index).data.forEach((bar,i)=>{const n=dataset.data[i];if(n===null||n<6||bar.width<26||Math.abs(bar.base-bar.y)<18)return;ctx.fillText(percent(n),bar.x,(bar.y+bar.base)/2);});});ctx.restore();
  }};
  for(const [key,metric,title] of [['promo-format-spend','spendShare','Spend share'],['promo-format-purchases','purchaseShare','Purchase share']]){
    charts[key]=new Chart(document.getElementById('chart-'+key).getContext('2d'),{
      type:'bar',data:{labels:months.map(month=>label(month.month)),datasets:formats.map(format=>({label:format,data:months.map(month=>month.formats[format][metric]),backgroundColor:PromoFormat.COLORS[format],borderWidth:0,maxBarThickness:64}))},
      plugins:[percentLabels],options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
        plugins:{legend:{position:'top',labels:{boxWidth:12,font:{size:11},sort:sortLegendByAxis}},tooltip:{callbacks:{label:item=>`${item.dataset.label}: ${percent(item.raw)}`}}},
        scales:{x:{stacked:true,grid:{display:false},ticks:{font:{size:11},maxRotation:45}},y:{stacked:true,min:0,max:100,title:{display:true,text:title},ticks:{font:{size:11},stepSize:20,callback:n=>n+'%'}}}}
    });
  }
}
