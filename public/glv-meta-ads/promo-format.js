(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PromoFormat = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const CLASSIFICATION_VERSION = 2;
  const INVENTORY_VERSION = 2;
  const FORMATS = ['Banner','Video','Unknown','Ghost'];
  const COLORS = {Banner:'#3b82f6',Video:'#a855f7',Unknown:'#f59e0b',Ghost:'#64748b'};
  function validDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
  }
  function validInventory(value) {
    return Boolean(value && value.version === INVENTORY_VERSION && typeof value.configured_media_complete === 'boolean' && Array.isArray(value.assets) && Array.isArray(value.unknown_reasons) && value.unknown_reasons.every(r=>typeof r === 'string') && Array.isArray(value.alternate_video_ids_not_counted) && value.alternate_video_ids_not_counted.every(id=>typeof id === 'string') && (!value.configured_media_complete || (value.assets.length > 0 && !value.unknown_reasons.length && !value.alternate_video_ids_not_counted.length)) && value.assets.every(a=>a && typeof a.id === 'string' && a.id.length > 0 && typeof a.key === 'string' && (a.kind === 'video' ? a.key === `video:${a.id}` : a.kind === 'image' && a.key.startsWith('image:') && a.key.endsWith(`:${a.id}`))));
  }
  function validPayload(data) {
    if (!data || data.schema_version !== 1 || data.classification_version !== CLASSIFICATION_VERSION || data.reconciled !== true || !Array.isArray(data.rows) || !Number.isFinite(Date.parse(data.generated_at)) || !validDate(data.range?.since) || !validDate(data.range?.until) || data.range.since > data.range.until) return false;
    if (data.funnel_version !== undefined && (data.funnel_version !== 1 || !data.rows.every(row=>row && ['link_clicks','landing_page_views','checkouts'].every(k=>typeof row[k]==='number'&&Number.isFinite(row[k])&&(row.is_ghost===true||row[k]>=0))))) return false;
    if (data.inventory_version !== undefined && data.inventory_version !== INVENTORY_VERSION) return false;
    const seen = new Set();
    return data.rows.every(row => {
      if(row?.is_ghost===true){
        if(row.format!=='Ghost'||row.reason!=='campaign_day_residual'||row.label!=='Ghost creative — pending Meta reconciliation'||!['campaign_id','campaign_name'].every(k=>typeof row[k]==='string'&&row[k])||!validDate(row.date)||row.date<data.range.since||row.date>data.range.until||['ad_id','ad_name','adset_id','adset_name','asset_inventory'].some(k=>row[k]!==undefined)||!['spend','purchases','revenue','impressions'].every(k=>typeof row[k]==='number'&&Number.isFinite(row[k])))return false;
        const key=`ghost:${row.campaign_id}|${row.date}`;if(seen.has(key))return false;seen.add(key);return true;
      }
      if(row?.format==='Ghost'||row?.is_ghost!==undefined)return false;
      if (!row || !['ad_id','ad_name','adset_id','adset_name','campaign_id','campaign_name','reason'].every(k=>typeof row[k] === 'string' && row[k].length > 0) || !FORMATS.includes(row.format) || !validDate(row.date) || row.date < data.range.since || row.date > data.range.until || !['spend','purchases','revenue','impressions'].every(k=>typeof row[k] === 'number' && Number.isFinite(row[k]) && row[k] >= 0)) return false;
      if (row.asset_inventory !== undefined && (data.inventory_version !== INVENTORY_VERSION || !validInventory(row.asset_inventory))) return false;
      const key=`${row.ad_id}|${row.date}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
  }
  // Naming metadata only, applied to first observed positive campaign spend.
  // Official ends never constrain membership or split campaign carryover.
  // Outside a named window use a month label, not a shared month identity.
  const PROMO_WINDOWS = [
    {id:'2026-06-15_2026-06-17',start:'2026-06-15',end:'2026-06-17',label:'Jun Private'},
    {id:'2026-06-18_2026-06-23',start:'2026-06-18',end:'2026-06-23',label:'Jun Public'},
    {id:'2026-08-18_2026-08-19',start:'2026-08-18',end:'2026-08-19',label:'Aug Private'},
    {id:'2026-08-20_2026-08-26',start:'2026-08-20',end:'2026-08-26',label:'Aug Public'},
    {id:'2026-10-07_2026-10-14',start:'2026-10-07',end:'2026-10-14',label:'Oct Menopause'},
    {id:'2026-10-28_2026-11-04',start:'2026-10-28',end:'2026-11-04',label:'Oct/Nov VB2'},
  ];
  function monthPeriod(row) {
    const month=row.date.slice(0,7);
    return {id:month,month,label:new Date(month+'-01T00:00:00Z').toLocaleDateString('en-US',{month:'short',year:'numeric',timeZone:'UTC'}),sort:month+'-01'};
  }
  function promoPeriod(row) {
    const event=PROMO_WINDOWS.find(event=>row.date>=event.start && row.date<=event.end);
    return event ? {...event,sort:event.start} : monthPeriod(row);
  }
  function monthlyMix(rows) {
    // Retain the existing monthly diagnostic contract for cron/offline audits.
    return aggregateMix(rows,monthPeriod).map(({month,total,formats})=>({month,total,formats}));
  }
  // Membership is campaign-lifetime, inferred from authoritative campaign/day
  // spend (creative facts plus signed residuals). No calendar end or gap timer.
  function campaignKey(row) {
    const account=String(row.account_id||'legacy').replace(/^act_/,'');
    return JSON.stringify([account,row.market||(/_US_/.test(row.campaign_name)?'US':'CZSK'),row.source_campaign_id||row.campaign_id]);
  }
  function promoMix(rows) {
    const campaigns=new Map();
    for(const row of rows) {
      const key=campaignKey(row);
      if(!campaigns.has(key))campaigns.set(key,{key,scope:JSON.parse(key).slice(0,2).join('|'),days:new Map(),first:row.date,eligible:/^(TUC|GLV)_\d+_/.test(row.campaign_name)&&row.campaign_name.includes('_Promo')});
      const c=campaigns.get(key);c.first=c.first<row.date?c.first:row.date;
      c.days.set(row.date,(c.days.get(row.date)||0)+czkValue(row,'spend'));
    }
    for(const c of campaigns.values())c.start=[...c.days].filter(([,spend])=>spend>1e-8).map(([date])=>date).sort()[0];
    const ordered=[...campaigns.values()].sort((a,b)=>(a.start||a.first).localeCompare(b.start||b.first)||a.key.localeCompare(b.key));
    const assigned=[];
    for(const c of ordered) {
      // Simultaneous starts join deterministically. If distinct older cohorts
      // overlap, choose the earliest cohort; never retroactively merge them.
      const active=c.eligible&&c.start?assigned.filter(p=>p.eligible&&p.scope===c.scope&&(p.days.get(c.start)||0)>1e-8).sort((a,b)=>a.period.sort.localeCompare(b.period.sort)||a.period.id.localeCompare(b.period.id)):[];
      const start=c.start||c.first, metadata=c.start?promoPeriod({date:start}):{...monthPeriod({date:start}),label:'Unassigned · '+monthPeriod({date:start}).label};
      c.period=active.length?active[0].period:{...metadata,id:'promo:'+c.key+':'+start,sort:start,start,delivery_observed:Boolean(c.start)};
      assigned.push(c);
    }
    return aggregateMix(rows.filter(row=>['spend','purchases','revenue','impressions'].some(key=>row[key]!==0)),row=>campaigns.get(campaignKey(row)).period);
  }
  function aggregateMix(rows,periodFor) {
    const months = new Map();
    const empty = () => ({spend:0,purchases:0,revenue:0,impressions:0,spend_czk:0,revenue_czk:0,ads:new Set(),assetKeys:new Set(),assetIncomplete:false});
    for (const row of rows) {
      const period=periodFor(row);
      if (!months.has(period.id)) months.set(period.id,{...period,total:empty(),formats:Object.fromEntries(FORMATS.map(f=>[f,empty()]))});
      const group=months.get(period.id);
      if (period.sort < group.sort) group.sort=period.sort;
      // Carryover purchases remain in performance, not media membership.
      if (!row.is_ghost && (row.spend > 0 || row.impressions > 0)) {
        const inventory=row.asset_inventory;
        const valid=validInventory(inventory);
        if (!valid || !inventory.configured_media_complete) {
          for (const target of [group.total,group.formats.Banner,group.formats.Video]) target.assetIncomplete=true;
        }
        if (valid) for (const asset of inventory.assets) {
          group.total.assetKeys.add(asset.key);
          group.formats[asset.kind === 'image' ? 'Banner' : 'Video'].assetKeys.add(asset.key);
        }
      }
      for (const target of [group.total,group.formats[row.format]]) {
        for (const metric of ['spend','purchases','revenue','impressions']) target[metric]+=row[metric];
        target.spend_czk+=czkValue(row,'spend'); target.revenue_czk+=czkValue(row,'revenue');
        if(!row.is_ghost) target.ads.add(row.ad_id);
      }
    }
    return [...months.values()].sort((a,b)=>a.sort.localeCompare(b.sort)||a.id.localeCompare(b.id)).map(group=>{
      for (const target of [group.total,...Object.values(group.formats)]) {
        target.ads=target.ads.size;
        target.assets=target.assetKeys.size || (target.assetIncomplete ? null : 0);
        target.asset_status=target.assetIncomplete ? (target.assets === null ? 'unavailable' : 'partial') : 'configured';
        if (target === group.formats.Unknown || target === group.formats.Ghost) { target.assets=null; target.asset_status='not_applicable'; }
        delete target.assetKeys; delete target.assetIncomplete;
        target.spendShare=group.total.spend ? target.spend/group.total.spend*100 : null;
        target.purchaseShare=group.total.purchases ? target.purchases/group.total.purchases*100 : null;
        target.roas=target!==group.formats.Ghost&&target.spend>0 ? target.revenue/target.spend : null;
        target.cpa=target!==group.formats.Ghost&&target.purchases>0 ? target.spend/target.purchases : null;
      }
      return group;
    });
  }
  const validConceptPayload=data=>validPayload(data)&&data.funnel_version===1&&data.rows.every(r=>/^(TUC|GLV)_\d+_/.test(r.campaign_name)&&r.campaign_name.includes('_CZSK_')&&!r.campaign_name.includes('_US_')&&r.campaign_name.includes('_Promo'));
  // Signed CZK equivalents are aggregated independently of display currency.
  function czkValue(row,key) {
    if(Number.isFinite(row[key+'_czk']))return row[key+'_czk'];
    if(Number.isFinite(row.native?.[key]))return row.native[key]*(row.native_currency==='USD'?row.fx.czk_per_usd:1);
    return row[key]*(row.report_currency==='USD'?row.fx.czk_per_usd:1);
  }
  const hasFinancialContribution=row=>(Math.abs(czkValue(row,'revenue'))>1e-8&&Math.abs(row.purchases)>1e-8)||Math.abs(czkValue(row,'spend'))>10+1e-8;
  return { czkValue, hasFinancialContribution, INVENTORY_VERSION, CLASSIFICATION_VERSION, FORMATS, COLORS, validDate, validPayload, validConceptPayload, monthlyMix, promoMix };
});
