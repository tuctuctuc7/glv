(function initGlvPhases(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GlvPhases = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const PHASES = ['BAU', 'Promo', 'Influ'];
  const ABSOLUTE_METRICS = [
    'spend', 'revenue', 'purchases', 'unique_visitors', 'new_customers',
    'returning_customers', 'new_customer_revenue',
  ];

  function parseIsoDate(value) {
    const text = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`Invalid date: ${text || 'blank'}.`);
    const date = new Date(`${text}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
      throw new Error(`Invalid date: ${text}.`);
    }
    return date;
  }

  function finite(value) {
    return value !== null && value !== undefined && Number.isFinite(Number(value));
  }

  function ratio(numerator, denominator) {
    return finite(numerator) && finite(denominator) && Number(denominator) > 0
      ? Number(numerator) / Number(denominator) : null;
  }

  function validateSchedule(schedule) {
    if (!Array.isArray(schedule) || !schedule.length) throw new Error('Phase schedule is missing or empty.');
    const normalized = schedule.map((entry, index) => {
      const phase = String(entry?.phase || '').trim();
      if (!['Promo', 'Influ'].includes(phase)) throw new Error(`Invalid phase at schedule row ${entry?.source_row || index + 1}.`);
      const start = parseIsoDate(entry.start_date);
      const end = parseIsoDate(entry.end_date);
      if (end < start) throw new Error(`Phase range is reversed at schedule row ${entry?.source_row || index + 1}.`);
      return {
        start_date: entry.start_date,
        end_date: entry.end_date,
        phase,
        label: String(entry.label || phase).trim() || phase,
        source_row: Number(entry.source_row || index + 1),
      };
    });
    const dates = new Map();
    normalized.forEach((entry) => {
      for (let cursor = parseIsoDate(entry.start_date); cursor <= parseIsoDate(entry.end_date); cursor = new Date(cursor.getTime() + 86_400_000)) {
        const day = cursor.toISOString().slice(0, 10);
        if (!dates.has(day)) dates.set(day, []);
        dates.get(day).push(entry);
      }
    });
    for (const [day, entries] of dates) {
      const values = new Set(entries.map((entry) => entry.phase));
      if (values.has('Promo') && values.has('Influ')) {
        throw new Error(`Promo and Influ overlap on ${day}; source rows ${entries.map((entry) => entry.source_row).join(', ')}.`);
      }
    }
    return normalized;
  }

  function aggregateRows(rows) {
    const source = Array.isArray(rows) ? rows : [];
    const totals = {};
    ABSOLUTE_METRICS.forEach((key) => {
      totals[key] = source.length && source.every((row) => finite(row[key]))
        ? source.reduce((sum, row) => sum + Number(row[key]), 0) : null;
    });
    return {
      ...totals,
      roas: ratio(totals.revenue, totals.spend),
      cpa: ratio(totals.spend, totals.purchases),
      aov: ratio(totals.revenue, totals.purchases),
      cvr: ratio(totals.purchases, totals.unique_visitors),
      new_customer_rate: ratio(totals.new_customers, finite(totals.new_customers) && finite(totals.returning_customers)
        ? totals.new_customers + totals.returning_customers : null),
      cac: ratio(totals.spend, totals.new_customers),
    };
  }

  function buildPhaseDays(rows, schedule, latestDate) {
    const windows = validateSchedule(schedule);
    const latest = parseIsoDate(latestDate).toISOString().slice(0, 10);
    const reportingYear = latest.slice(0, 4);
    const seen = new Set();
    return (rows || [])
      .filter((row) => row?.region === 'czsk' && String(row.date).startsWith(reportingYear) && row.date <= latest)
      .map((row) => {
        parseIsoDate(row.date);
        if (seen.has(row.date)) throw new Error(`Duplicate CZSK day: ${row.date}.`);
        seen.add(row.date);
        const matches = windows.filter((entry) => row.date >= entry.start_date && row.date <= entry.end_date);
        const phase = matches[0]?.phase || 'BAU';
        const revenue = Number(row.revenue);
        const codeRevenue = Number(row.influ_revenue || 0);
        if (!Number.isFinite(codeRevenue) || codeRevenue < 0 || codeRevenue > revenue) {
          throw new Error(`Code revenue exceeds total revenue or is invalid on ${row.date}.`);
        }
        return {
          ...row,
          month: row.date.slice(0, 7),
          phase,
          schedule: matches,
          code_revenue: phase === 'Influ' ? codeRevenue : 0,
          no_code_revenue: phase === 'Influ' ? revenue - codeRevenue : 0,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  function monthlyDenominators(days) {
    const denominators = new Map();
    (days || []).forEach((day) => denominators.set(day.month, (denominators.get(day.month) || 0) + Number(day.revenue || 0)));
    return denominators;
  }

  function aggregatePhaseGroups(days) {
    const denominators = monthlyDenominators(days);
    const groups = new Map();
    (days || []).forEach((day) => {
      const key = `${day.month}|${day.phase}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(day);
    });
    return [...groups.entries()].map(([key, groupRows]) => {
      const [month, phase] = key.split('|');
      const metrics = aggregateRows(groupRows);
      return {
        month,
        phase,
        rows: groupRows,
        ...metrics,
        share: ratio(metrics.revenue, denominators.get(month)),
      };
    }).sort((a, b) => a.month.localeCompare(b.month) || PHASES.indexOf(a.phase) - PHASES.indexOf(b.phase));
  }

  function unavailableRevenueMetrics(revenue) {
    const metrics = Object.fromEntries([...ABSOLUTE_METRICS, 'roas', 'cpa', 'aov', 'cvr', 'new_customer_rate', 'cac'].map((key) => [key, null]));
    metrics.revenue = revenue;
    return metrics;
  }

  function makeNode({ id, parentId = null, depth, kind, label, month = null, phase = null, metrics, share = null, expandable = false }) {
    return { id, parentId, depth, kind, label, month, phase, metrics, share, expandable };
  }

  function appendDayNodes(nodes, days, parentId, depth, denominators, segment = null) {
    days.forEach((day) => {
      const revenue = segment === 'code' ? day.code_revenue : segment === 'no-code' ? day.no_code_revenue : day.revenue;
      const metrics = segment ? unavailableRevenueMetrics(revenue) : aggregateRows([day]);
      nodes.push(makeNode({
        id: `${parentId}|day|${day.date}${segment ? `|${segment}` : ''}`,
        parentId,
        depth,
        kind: 'day',
        label: day.date,
        month: day.month,
        phase: day.phase,
        metrics,
        share: ratio(revenue, denominators.get(day.month)),
      }));
    });
  }

  function appendInfluSplit(nodes, days, parentId, depth, denominators) {
    [['code', 'Code'], ['no-code', 'No code']].forEach(([segment, label]) => {
      const revenue = days.reduce((sum, day) => sum + Number(segment === 'code' ? day.code_revenue : day.no_code_revenue), 0);
      const id = `${parentId}|${segment}`;
      nodes.push(makeNode({
        id,
        parentId,
        depth,
        kind: 'influ-split',
        label,
        month: days[0]?.month || null,
        phase: 'Influ',
        metrics: unavailableRevenueMetrics(revenue),
        share: ratio(revenue, denominators.get(days[0]?.month)),
        expandable: true,
      }));
      appendDayNodes(nodes, days, id, depth + 1, denominators, segment);
    });
  }

  function buildHierarchy(days, orientation = 'month-phase', splitInflu = false) {
    if (!['month-phase', 'phase-month'].includes(orientation)) throw new Error(`Unknown hierarchy: ${orientation}.`);
    const source = Array.isArray(days) ? days : [];
    const denominators = monthlyDenominators(source);
    const nodes = [];
    const months = [...new Set(source.map((day) => day.month))].sort();
    const presentPhases = PHASES.filter((phase) => source.some((day) => day.phase === phase));

    if (orientation === 'month-phase') {
      months.forEach((month) => {
        const monthDays = source.filter((day) => day.month === month);
        const monthId = `month|${month}`;
        nodes.push(makeNode({ id: monthId, depth: 0, kind: 'month', label: month, month, metrics: aggregateRows(monthDays), share: 1, expandable: true }));
        presentPhases.forEach((phase) => {
          const phaseDays = monthDays.filter((day) => day.phase === phase);
          if (!phaseDays.length) return;
          const phaseId = `${monthId}|phase|${phase}`;
          const phaseMetrics = aggregateRows(phaseDays);
          nodes.push(makeNode({ id: phaseId, parentId: monthId, depth: 1, kind: 'phase', label: phase, month, phase, metrics: phaseMetrics, share: ratio(phaseMetrics.revenue, denominators.get(month)), expandable: true }));
          if (splitInflu && phase === 'Influ') appendInfluSplit(nodes, phaseDays, phaseId, 2, denominators);
          else appendDayNodes(nodes, phaseDays, phaseId, 2, denominators);
        });
      });
    } else {
      presentPhases.forEach((phase) => {
        const phaseDays = source.filter((day) => day.phase === phase);
        const phaseId = `phase|${phase}`;
        nodes.push(makeNode({ id: phaseId, depth: 0, kind: 'phase', label: phase, phase, metrics: aggregateRows(phaseDays), expandable: true }));
        months.forEach((month) => {
          const monthDays = phaseDays.filter((day) => day.month === month);
          if (!monthDays.length) return;
          const monthId = `${phaseId}|month|${month}`;
          const monthMetrics = aggregateRows(monthDays);
          nodes.push(makeNode({ id: monthId, parentId: phaseId, depth: 1, kind: 'month', label: month, month, phase, metrics: monthMetrics, share: ratio(monthMetrics.revenue, denominators.get(month)), expandable: true }));
          if (splitInflu && phase === 'Influ') appendInfluSplit(nodes, monthDays, monthId, 2, denominators);
          else appendDayNodes(nodes, monthDays, monthId, 2, denominators);
        });
      });
    }
    return nodes;
  }

  function metricValue(metrics, key) {
    if (key === 'none') return null;
    return finite(metrics?.[key]) ? Number(metrics[key]) : null;
  }

  function monthlySeries(days, metric) {
    const months = [...new Set((days || []).map((day) => day.month))].sort();
    const groups = aggregatePhaseGroups(days);
    const series = Object.fromEntries(PHASES.map((phase) => [phase, months.map((month) => {
      const group = groups.find((candidate) => candidate.month === month && candidate.phase === phase);
      return group ? metricValue(group, metric) : null;
    })]));
    return { months, phases: [...PHASES], series };
  }

  return {
    ABSOLUTE_METRICS,
    PHASES,
    aggregatePhaseGroups,
    aggregateRows,
    buildHierarchy,
    buildPhaseDays,
    metricValue,
    monthlySeries,
    parseIsoDate,
    validateSchedule,
  };
}));
