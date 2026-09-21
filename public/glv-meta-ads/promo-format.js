(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PromoFormat = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const FORMATS = ['Banner','Video','Unknown'];
  const COLORS = {Banner:'#3b82f6',Video:'#a855f7',Unknown:'#f59e0b'};
  function validDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
  }
  function validPayload(data) {
    if (!data || data.schema_version !== 1 || data.classification_version !== 1 || data.reconciled !== true || !Array.isArray(data.rows) || !Number.isFinite(Date.parse(data.generated_at)) || !validDate(data.range?.since) || !validDate(data.range?.until) || data.range.since > data.range.until) return false;
    const seen = new Set();
    return data.rows.every(row => {
      if (!row || !['ad_id','ad_name','adset_id','adset_name','campaign_id','campaign_name','reason'].every(k=>typeof row[k] === 'string' && row[k].length > 0) || !FORMATS.includes(row.format) || !validDate(row.date) || row.date < data.range.since || row.date > data.range.until || !['spend','purchases','revenue','impressions'].every(k=>typeof row[k] === 'number' && Number.isFinite(row[k]) && row[k] >= 0)) return false;
      const key=`${row.ad_id}|${row.date}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
  }
  function monthlyMix(rows) {
    const months = new Map();
    const empty = () => ({spend:0,purchases:0,revenue:0,impressions:0,ads:new Set()});
    for (const row of rows) {
      const month=row.date.slice(0,7);
      if (!months.has(month)) months.set(month,{month,total:empty(),formats:Object.fromEntries(FORMATS.map(f=>[f,empty()]))});
      const group=months.get(month);
      for (const target of [group.total,group.formats[row.format]]) {
        for (const metric of ['spend','purchases','revenue','impressions']) target[metric]+=row[metric];
        target.ads.add(row.ad_id);
      }
    }
    return [...months.values()].sort((a,b)=>a.month.localeCompare(b.month)).map(group=>{
      for (const target of [group.total,...Object.values(group.formats)]) {
        target.ads=target.ads.size;
        target.spendShare=group.total.spend ? target.spend/group.total.spend*100 : null;
        target.purchaseShare=group.total.purchases ? target.purchases/group.total.purchases*100 : null;
        target.roas=target.spend ? target.revenue/target.spend : null;
        target.cpa=target.purchases ? target.spend/target.purchases : null;
      }
      return group;
    });
  }
  return { FORMATS, COLORS, validDate, validPayload, monthlyMix };
});
