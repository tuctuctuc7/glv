/* Independent concept history: no global date/filter dependency. */
let conceptPayload=null,conceptSequence=0,conceptSelection=null,conceptSort={key:null,direction:'desc'};
try{const saved=JSON.parse(sessionStorage.getItem('glv-promo-concept-selection-v1'));if(Array.isArray(saved)&&saved.every(id=>typeof id==='string'))conceptSelection=saved;}catch{}
const conceptColumns=[['spend','Spend · CZK'],['purchases','Purchases'],['roas','ROAS'],['revenue','Revenue · CZK'],['ctr','CTR'],['landing_page_views','LP Views'],['costLP','Cost / LP · CZK'],['lpCheckout','LP → Checkout'],['checkoutPurchase','Checkout → Purchase'],['cvr','CVR']];
async function loadPromoConcepts(){
  const sequence=++conceptSequence;
  try{const data=await apiFetch('promo_concepts');if(sequence!==conceptSequence)return;conceptPayload=data;conceptSelection=PromoConcepts.selection(data.rows,conceptSelection);renderPromoConcepts();}
  catch(error){if(sequence!==conceptSequence)return;conceptPayload=null;renderPromoConcepts();document.getElementById('promo-concept-status').textContent=`Concept data unavailable — ${error.message}. Retry Refresh concepts.`;}
}
function refreshPromoConceptHistory(){responseCache.invalidate('/api/glv-meta-ads/fb-data?type=promo_concepts&date_preset=promo_history');return loadPromoConcepts();}
function chooseConceptCampaigns(ids){conceptSelection=ids;try{sessionStorage.setItem('glv-promo-concept-selection-v1',JSON.stringify(ids));}catch{}renderPromoConcepts();}
function renderPromoConcepts(){
  const section=document.getElementById('promo-concept-section'),body=section.querySelector('tbody'),status=document.getElementById('promo-concept-status');body.replaceChildren();
  const head=section.querySelector('thead tr');
  head.innerHTML='<th scope="col">Concept / campaign</th>'+conceptColumns.map(([key,label])=>`<th scope="col" aria-sort="${conceptSort.key===key?(conceptSort.direction==='desc'?'descending':'ascending'):'none'}"><button type="button" data-sort="${key}">${label}</button></th>`).join('');
  head.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{conceptSort={key:b.dataset.sort,direction:conceptSort.key===b.dataset.sort&&conceptSort.direction==='desc'?'asc':'desc'};renderPromoConcepts();section.querySelector(`[data-sort="${b.dataset.sort}"]`).focus({preventScroll:true});}));
  if(!conceptPayload){status.textContent='Loading concept facts…';return;}
  const campaigns=PromoConcepts.campaigns(conceptPayload.rows),selected=conceptSelection||[];
  document.getElementById('promo-concept-range').textContent=`${conceptPayload.range.since} → ${conceptPayload.range.until} · Independent history · CZK`;
  const choices=document.getElementById('promo-concept-options');choices.innerHTML=campaigns.map(c=>`<label><input type="checkbox" value="${escapeHtml(c.id)}" ${selected.includes(c.id)?'checked':''}> <span>${escapeHtml(c.name)}</span></label>`).join('');
  choices.querySelectorAll('input').forEach(input=>input.addEventListener('change',()=>chooseConceptCampaigns(input.checked?[...new Set([...selected,input.value])]:selected.filter(id=>id!==input.value))));
  document.getElementById('promo-concept-all').onclick=()=>chooseConceptCampaigns(campaigns.map(c=>c.id));document.getElementById('promo-concept-none').onclick=()=>chooseConceptCampaigns([]);
  document.getElementById('promo-concept-count').textContent=`Campaigns · ${selected.length} selected`;
  let rows=PromoConcepts.aggregate(conceptPayload.rows,selected);if(conceptSort.key)rows=PromoConcepts.sort(rows,conceptSort.key,conceptSort.direction);
  const missing=selected.filter(id=>!campaigns.some(c=>c.id===id)).length,warnings=rows.filter(r=>r.warning).length;
  status.textContent=!rows.length?(selected.length?'No activity for selected campaigns.':'No campaigns selected.'):`${rows.length} concepts · ${warnings?`${warnings} unmapped/conflicting full-name groups retained in totals.`:'Carryover purchases included.'}`;
  if(missing)status.textContent+=` ${missing} selected campaign IDs unavailable; selection retained.`;
  const percent=n=>n===null?'—':n.toFixed(2)+'%',number=n=>n===null?'—':n.toLocaleString('en-US',{maximumFractionDigits:2});
  for(const row of rows){const tr=document.createElement('tr');tr.innerHTML=`<td><strong>${escapeHtml(row.label)}</strong><small>${escapeHtml(row.campaign_name)} · ${escapeHtml(row.campaign_id)}</small>${row.warning?`<small class="concept-warning">${escapeHtml(row.warning)}</small>`:''}</td>`+conceptColumns.map(([key])=>{let value=['ctr','lpCheckout','checkoutPurchase','cvr'].includes(key)?percent(row[key]):key==='roas'?(row[key]===null?'—':row[key].toFixed(2)+'x'):number(row[key]);if(key==='spend'||key==='purchases')value+=`<small>${percent(row[key==='spend'?'spendShare':'purchaseShare'])} share</small>`;return `<td>${value}</td>`;}).join('');body.append(tr);}
}
