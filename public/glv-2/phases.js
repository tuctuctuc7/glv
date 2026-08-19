(function initGlvPhases(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GlvPhases = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const HISTORICAL_START = '2026-02-01';
  const VALID_PHASES = new Set(['Promo', 'Influ']);
  const SUM_FIELDS = ['revenue', 'spend', 'adjusted_spend', 'commission', 'code_revenue', 'no_code_revenue'];

  function finite(value) {
    const result = Number(value);
    return Number.isFinite(result) ? result : 0;
  }

  function ratio(numerator, denominator) {
    return denominator ? numerator / denominator : null;
  }

  function csvCell(value) {
    const text = String(value ?? '');
    const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
  }

  function parseIsoDate(value, field) {
    const text = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`Invalid ${field}: ${text || 'blank'}.`);
    const date = new Date(`${text}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) throw new Error(`Invalid ${field}: ${text}.`);
    return date;
  }

  function eachDate(start, end) {
    const first = parseIsoDate(start, 'start date');
    const last = parseIsoDate(end, 'end date');
    if (first > last) throw new Error(`Phase start date ${start} is after end date ${end}.`);
    const dates = [];
    for (let cursor = first; cursor <= last; cursor = new Date(cursor.getTime() + 86_400_000)) {
      dates.push(cursor.toISOString().slice(0, 10));
    }
    return dates;
  }

  function normalizeWindow(window, index) {
    const phase = String(window?.phase || '').trim();
    if (!VALID_PHASES.has(phase)) throw new Error(`Invalid phase at schedule row ${index + 1}: ${phase || 'blank'}.`);
    const startDate = String(window?.start_date || '').trim();
    const endDate = String(window?.end_date || '').trim();
    eachDate(startDate, endDate);
    return {
      start_date: startDate,
      end_date: endDate,
      phase,
      label: String(window?.label || phase).trim() || phase,
      influencer: String(window?.influencer || '').trim(),
    };
  }

  function validateSchedule(schedule) {
    if (!Array.isArray(schedule) || !schedule.length) throw new Error('Phases schedule is missing or empty.');
    const normalized = schedule.map(normalizeWindow);
    const byDate = new Map();
    normalized.forEach((window) => {
      eachDate(window.start_date, window.end_date).forEach((date) => {
        if (!byDate.has(date)) byDate.set(date, []);
        byDate.get(date).push(window);
      });
    });
    for (const [date, windows] of byDate) {
      const promo = windows.filter((window) => window.phase === 'Promo');
      const influ = windows.filter((window) => window.phase === 'Influ');
      if (promo.length && influ.length) throw new Error(`Promo and Influ overlap on ${date}. Update the Phases schedule.`);
      if (promo.length > 1) throw new Error(`Promo windows overlap on ${date}. Update the Phases schedule.`);
    }
    return normalized;
  }

  function buildPhaseDays(rows, schedule, historicalStart = HISTORICAL_START) {
    const windows = validateSchedule(schedule);
    return (rows || [])
      .filter((row) => row?.region === 'czsk' && String(row.date) >= historicalStart)
      .map((row) => {
        const matches = windows.filter((window) => row.date >= window.start_date && row.date <= window.end_date);
        const promo = matches.find((window) => window.phase === 'Promo');
        const influ = matches.filter((window) => window.phase === 'Influ');
        const phase = promo ? 'Promo' : influ.length ? 'Influ' : 'BAU';
        const revenue = finite(row.revenue);
        const spend = finite(row.spend);
        const commission = phase === 'Influ' ? finite(row.influ_commission) : 0;
        const codeRevenue = finite(row.influ_revenue);
        if (codeRevenue > revenue) throw new Error(`Code revenue exceeds total revenue on ${row.date}. Check the canonical source.`);
        const influencers = [...new Set(influ.map((window) => window.influencer).filter(Boolean))].sort((a, b) => a.localeCompare(b));
        return {
          date: row.date,
          month: String(row.date).slice(0, 7),
          phase,
          phase_label: promo?.label || (influ.length === 1 ? influ[0].label : phase),
          promo_subtype: promo?.label || '',
          influencers,
          revenue,
          spend,
          adjusted_spend: spend + commission,
          commission,
          code_revenue: codeRevenue,
          no_code_revenue: revenue - codeRevenue,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  function groupIdentity(day, grouping) {
    if (grouping === 'phase-time') return { key: day.phase, label: day.phase, phase: day.phase };
    if (grouping === 'influencer') {
      if (day.phase !== 'Influ') return null;
      const label = day.influencers.length === 1
        ? day.influencers[0]
        : day.influencers.length > 1 ? 'Multiple influencers (unattributed)' : 'Unspecified influencer';
      return { key: label, label, phase: 'Influ' };
    }
    if (grouping === 'promo-subtype') {
      if (day.phase !== 'Promo') return null;
      const label = day.promo_subtype || 'Promo';
      return { key: label, label, phase: 'Promo' };
    }
    const label = `${day.month} · ${day.phase}`;
    return { key: label, label, phase: day.phase, month: day.month };
  }

  function aggregatePhaseGroups(days, grouping = 'month-phase') {
    const source = Array.isArray(days) ? days : [];
    const totalRevenue = source.reduce((sum, day) => sum + finite(day.revenue), 0);
    const groups = new Map();
    source.forEach((day) => {
      const identity = groupIdentity(day, grouping);
      if (!identity) return;
      if (!groups.has(identity.key)) groups.set(identity.key, { ...identity, rows: [] });
      groups.get(identity.key).rows.push(day);
    });
    return [...groups.values()].map((group) => {
      const totals = Object.fromEntries(SUM_FIELDS.map((field) => [field, group.rows.reduce((sum, row) => sum + finite(row[field]), 0)]));
      const dayCount = new Set(group.rows.map((row) => row.date)).size;
      return {
        label: group.label,
        phase: group.phase,
        month: group.month || '',
        revenue: totals.revenue,
        revenue_share: ratio(totals.revenue, totalRevenue),
        days: dayCount,
        average_daily_revenue: ratio(totals.revenue, dayCount),
        spend: totals.spend,
        adjusted_spend: totals.adjusted_spend,
        adjusted_roas: ratio(totals.revenue, totals.adjusted_spend),
        influ_commission: totals.commission,
        code_revenue: totals.code_revenue,
        no_code_revenue: totals.no_code_revenue,
        code_share: ratio(totals.code_revenue, totals.revenue),
        code_average_daily: ratio(totals.code_revenue, dayCount),
        no_code_average_daily: ratio(totals.no_code_revenue, dayCount),
      };
    }).sort((a, b) => a.label.localeCompare(b.label));
  }

  return {
    HISTORICAL_START,
    aggregatePhaseGroups,
    buildPhaseDays,
    csvCell,
    validateSchedule,
  };
}));
