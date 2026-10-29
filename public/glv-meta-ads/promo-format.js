(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PromoFormat = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const CLASSIFICATION_VERSION = 2;
  const INVENTORY_VERSION = 2;
  const FORMATS = ['Banner','Video','Unknown'];
  const COLORS = {Banner:'#3b82f6',Video:'#a855f7',Unknown:'#f59e0b'};
  function validDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
  }
  function validInventory(value) {
    return Boolean(value && value.version === INVENTORY_VERSION && typeof value.configured_media_complete === 'boolean' && Array.isArray(value.assets) && Array.isArray(value.unknown_reasons) && value.unknown_reasons.every(r=>typeof r === 'string') && Array.isArray(value.alternate_video_ids_not_counted) && value.alternate_video_ids_not_counted.every(id=>typeof id === 'string') && (!value.configured_media_complete || (value.assets.length > 0 && !value.unknown_reasons.length && !value.alternate_video_ids_not_counted.length)) && value.assets.every(a=>a && typeof a.id === 'string' && a.id.length > 0 && typeof a.key === 'string' && (a.kind === 'video' ? a.key === `video:${a.id}` : a.kind === 'image' && a.key.startsWith('image:') && a.key.endsWith(`:${a.id}`))));
  }
  function validPayload(data) {
    if (!data || data.schema_version !== 1 || data.classification_version !== CLASSIFICATION_VERSION || data.reconciled !== true || !Array.isArray(data.rows) || !Number.isFinite(Date.parse(data.generated_at)) || !validDate(data.range?.since) || !validDate(data.range?.until) || data.range.since > data.range.until) return false;
    if (data.funnel_version !== undefined && (data.funnel_version !== 1 || !data.rows.every(row=>row && ['link_clicks','landing_page_views','checkouts'].every(k=>typeof row[k]==='number'&&Number.isFinite(row[k])&&row[k]>=0)))) return false;
    if (data.inventory_version !== undefined && data.inventory_version !== INVENTORY_VERSION) return false;
    const seen = new Set();
    return data.rows.every(row => {
      if (!row || !['ad_id','ad_name','adset_id','adset_name','campaign_id','campaign_name','reason'].every(k=>typeof row[k] === 'string' && row[k].length > 0) || !FORMATS.includes(row.format) || !validDate(row.date) || row.date < data.range.since || row.date > data.range.until || !['spend','purchases','revenue','impressions'].every(k=>typeof row[k] === 'number' && Number.isFinite(row[k]) && row[k] >= 0)) return false;
      if (row.asset_inventory !== undefined && (data.inventory_version !== INVENTORY_VERSION || !validInventory(row.asset_inventory))) return false;
      const key=`${row.ad_id}|${row.date}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
  }
  // Reporting-date windows, not Meta campaign identity or Business KPI scope.
  // 2026 dates supplied by Tom and confirmed in the read-only phase calendar.
  // Outside a named window keep a month bucket: carryover is never discarded.
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
  function promoMix(rows) {
    return aggregateMix(rows.filter(row=>['spend','purchases','revenue','impressions'].some(key=>row[key]>0)),promoPeriod);
  }
  function aggregateMix(rows,periodFor) {
    const months = new Map();
    const empty = () => ({spend:0,purchases:0,revenue:0,impressions:0,ads:new Set(),assetKeys:new Set(),assetIncomplete:false});
    for (const row of rows) {
      const period=periodFor(row);
      if (!months.has(period.id)) months.set(period.id,{...period,total:empty(),formats:Object.fromEntries(FORMATS.map(f=>[f,empty()]))});
      const group=months.get(period.id);
      if (period.sort < group.sort) group.sort=period.sort;
      // Carryover purchases remain in performance, not media membership.
      if (row.spend > 0 || row.impressions > 0) {
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
        target.ads.add(row.ad_id);
      }
    }
    return [...months.values()].sort((a,b)=>a.sort.localeCompare(b.sort)||a.id.localeCompare(b.id)).map(group=>{
      for (const target of [group.total,...Object.values(group.formats)]) {
        target.ads=target.ads.size;
        target.assets=target.assetKeys.size || (target.assetIncomplete ? null : 0);
        target.asset_status=target.assetIncomplete ? (target.assets === null ? 'unavailable' : 'partial') : 'configured';
        if (target === group.formats.Unknown) { target.assets=null; target.asset_status='not_applicable'; }
        delete target.assetKeys; delete target.assetIncomplete;
        target.spendShare=group.total.spend ? target.spend/group.total.spend*100 : null;
        target.purchaseShare=group.total.purchases ? target.purchases/group.total.purchases*100 : null;
        target.roas=target.spend ? target.revenue/target.spend : null;
        target.cpa=target.purchases ? target.spend/target.purchases : null;
      }
      return group;
    });
  }
  const validConceptPayload=data=>validPayload(data)&&data.funnel_version===1&&data.rows.every(r=>/^(TUC|GLV)_\d+_/.test(r.campaign_name)&&r.campaign_name.includes('_CZSK_')&&!r.campaign_name.includes('_US_')&&r.campaign_name.includes('_Promo'));
  return { INVENTORY_VERSION, CLASSIFICATION_VERSION, FORMATS, COLORS, validDate, validPayload, validConceptPayload, monthlyMix, promoMix };
});
