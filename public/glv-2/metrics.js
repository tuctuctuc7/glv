(function initGlvMetrics(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GlvMetrics = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const ABSOLUTE_METRICS = ['spend', 'revenue', 'purchases', 'unique_visitors', 'new_customers', 'returning_customers', 'new_customer_revenue'];
  const LOWER_IS_BETTER = new Set(['cpa']);
  const HIGHER_IS_BETTER = new Set(['revenue', 'roas', 'purchases', 'aov', 'cvr', 'unique_visitors']);

  function finiteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function ratio(numerator, denominator) {
    return denominator ? numerator / denominator : null;
  }

  function hasFiniteMetric(row, key) {
    return row?.[key] !== null && row?.[key] !== undefined && Number.isFinite(Number(row[key]));
  }

  function ratioFromRows(rows, numeratorKey, denominatorKey) {
    const eligible = (rows || []).filter((row) => hasFiniteMetric(row, numeratorKey) && hasFiniteMetric(row, denominatorKey));
    if (!eligible.length) return null;
    const numerator = eligible.reduce((sum, row) => sum + Number(row[numeratorKey]), 0);
    const denominator = eligible.reduce((sum, row) => sum + Number(row[denominatorKey]), 0);
    return ratio(numerator, denominator);
  }

  function aggregateRows(rows) {
    const totals = {
      spend: 0,
      revenue: 0,
      purchases: 0,
      unique_visitors: 0,
      new_customers: 0,
      returning_customers: 0,
      new_customer_revenue: 0,
    };

    const sourceRows = rows || [];
    sourceRows.forEach((row) => {
      ABSOLUTE_METRICS.forEach((key) => {
        if (hasFiniteMetric(row, key)) totals[key] += Number(row[key]);
      });
    });

    if (sourceRows.length) {
      ABSOLUTE_METRICS.forEach((key) => {
        if (!sourceRows.some((row) => hasFiniteMetric(row, key))) totals[key] = null;
      });
    }

    const customerRows = sourceRows.filter((row) => hasFiniteMetric(row, 'new_customers') && hasFiniteMetric(row, 'returning_customers'));
    const newCustomers = customerRows.reduce((sum, row) => sum + Number(row.new_customers), 0);
    const returningCustomers = customerRows.reduce((sum, row) => sum + Number(row.returning_customers), 0);

    return {
      ...totals,
      roas: ratioFromRows(sourceRows, 'revenue', 'spend'),
      cpa: ratioFromRows(sourceRows, 'spend', 'purchases'),
      aov: ratioFromRows(sourceRows, 'revenue', 'purchases'),
      cvr: ratioFromRows(sourceRows, 'purchases', 'unique_visitors'),
      new_customer_rate: customerRows.length ? ratio(newCustomers, newCustomers + returningCustomers) : null,
    };
  }

  function metricValue(row, key) {
    if (!row) return null;
    if (!hasFiniteMetric(row, key) && !['roas', 'cpa', 'aov', 'cvr', 'new_customer_rate'].includes(key)) return null;
    if (key === 'roas') return ratio(finiteNumber(row.revenue), finiteNumber(row.spend));
    if (key === 'cpa') return ratio(finiteNumber(row.spend), finiteNumber(row.purchases));
    if (key === 'aov') return ratio(finiteNumber(row.revenue), finiteNumber(row.purchases));
    if (key === 'cvr') return ratio(finiteNumber(row.purchases), finiteNumber(row.unique_visitors));
    if (key === 'new_customer_rate') return ratio(finiteNumber(row.new_customers), finiteNumber(row.new_customers) + finiteNumber(row.returning_customers));
    return finiteNumber(row[key]);
  }

  function filterRows(rows, { from, to, regions } = {}) {
    const selected = Array.isArray(regions) ? new Set(regions) : null;
    return (rows || []).filter((row) => {
      if (from && row.date < from) return false;
      if (to && row.date > to) return false;
      return !selected || selected.size === 0 || selected.has(row.region);
    });
  }

  function parseDate(dateString) {
    const [year, month, day] = String(dateString).split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }

  function isoDate(date) {
    return date.toISOString().slice(0, 10);
  }

  function shiftDays(dateString, days) {
    const date = parseDate(dateString);
    date.setUTCDate(date.getUTCDate() + days);
    return isoDate(date);
  }

  function inclusiveDayCount(from, to) {
    return Math.round((parseDate(to) - parseDate(from)) / 86400000) + 1;
  }

  function isoWeekLabel(dateString) {
    const date = parseDate(dateString);
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  }

  function grainLabel(dateString, grain) {
    if (grain === 'year') return String(dateString).slice(0, 4);
    if (grain === 'month') return String(dateString).slice(0, 7);
    if (grain === 'week') return isoWeekLabel(dateString);
    return dateString;
  }

  function groupRows(rows, grain = 'day') {
    const groups = new Map();
    (rows || []).forEach((row) => {
      const label = grainLabel(row.date, grain);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(row);
    });
    return [...groups.entries()]
      .map(([label, group]) => ({ label, ...aggregateRows(group) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  function presetBounds(preset, latestDate) {
    if (!latestDate) return { from: '', to: '' };
    const to = latestDate;
    if (preset === 'mtd') return { from: `${latestDate.slice(0, 7)}-01`, to };
    if (preset === 'ytd') return { from: `${latestDate.slice(0, 4)}-01-01`, to };
    const match = String(preset).match(/^(\d+)d$/);
    const days = match ? Number(match[1]) : 30;
    return { from: shiftDays(to, -(days - 1)), to };
  }

  function previousPeriodBounds(from, to) {
    if (!from || !to || from > to) return { from: '', to: '' };
    const days = inclusiveDayCount(from, to);
    return {
      from: shiftDays(from, -days),
      to: shiftDays(from, -1),
    };
  }

  function percentageChange(current, previous) {
    if (current === null || current === undefined || previous === null || previous === undefined) return null;
    const currentNumber = Number(current);
    const previousNumber = Number(previous);
    if (!Number.isFinite(currentNumber) || !Number.isFinite(previousNumber) || previousNumber === 0) return null;
    return (currentNumber - previousNumber) / Math.abs(previousNumber);
  }

  function deltaSignal(metric, change) {
    if (change === null || change === undefined || !Number.isFinite(change) || Math.abs(change) < 0.0005) return 'neutral';
    if (LOWER_IS_BETTER.has(metric)) return change < 0 ? 'positive' : 'negative';
    if (HIGHER_IS_BETTER.has(metric)) return change > 0 ? 'positive' : 'negative';
    return 'neutral';
  }

  function regionalBreakdown(rows, regions = ['czsk', 'us', 'row']) {
    const overall = aggregateRows(rows);
    return regions.map((region) => {
      const totals = aggregateRows((rows || []).filter((row) => row.region === region));
      return {
        region,
        ...totals,
        revenueShare: ratio(totals.revenue, overall.revenue),
        spendShare: ratio(totals.spend, overall.spend),
        purchaseShare: ratio(totals.purchases, overall.purchases),
        visitorShare: ratio(totals.unique_visitors, overall.unique_visitors),
      };
    });
  }

  function comparePeriods(currentRows, previousRows) {
    const current = aggregateRows(currentRows);
    const previous = aggregateRows(previousRows);
    const changes = {};
    [...ABSOLUTE_METRICS, 'roas', 'cpa', 'aov', 'cvr', 'new_customer_rate'].forEach((key) => {
      changes[key] = percentageChange(current[key], previous[key]);
    });
    return { current, previous, changes };
  }

  function revenueBridge(current, previous) {
    if (!current || !previous || current.aov === null || previous.aov === null) {
      return { purchaseEffect: null, aovEffect: null, totalChange: null };
    }
    const purchaseEffect = (current.purchases - previous.purchases) * ((current.aov + previous.aov) / 2);
    const aovEffect = (current.aov - previous.aov) * ((current.purchases + previous.purchases) / 2);
    return {
      purchaseEffect,
      aovEffect,
      totalChange: current.revenue - previous.revenue,
    };
  }

  function rollingRows(groupedRows, windowSize = 7) {
    const size = Math.max(1, Math.floor(Number(windowSize) || 1));
    return (groupedRows || []).map((row, index, allRows) => {
      if (index < size - 1) return null;
      const totals = aggregateRows(allRows.slice(index - size + 1, index + 1));
      return { label: row.label, ...totals };
    });
  }

  function rollingMetricValues(groupedRows, key, windowSize = 7) {
    const size = Math.max(1, Math.floor(Number(windowSize) || 1));
    return rollingRows(groupedRows, size).map((row) => {
      if (!row) return null;
      const value = metricValue(row, key);
      return ABSOLUTE_METRICS.includes(key) && value !== null ? value / size : value;
    });
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function assessGrowthQuality(current, previous) {
    if (!current || !previous || !previous.revenue || !previous.spend || previous.roas === null || previous.roas === undefined) {
      return {
        key: 'no-comparison',
        title: 'Comparison unavailable',
        summary: 'Choose a period with a valid preceding window to assess growth quality.',
        score: null,
        revenueChange: null,
        spendChange: null,
        roasChange: null,
        efficiencyGap: null,
      };
    }

    const revenueChange = percentageChange(current.revenue, previous.revenue);
    const spendChange = percentageChange(current.spend, previous.spend);
    const roasChange = percentageChange(current.roas, previous.roas);
    if ([revenueChange, spendChange, roasChange].some((value) => value === null)) {
      return assessGrowthQuality(current, null);
    }

    const efficiencyGap = revenueChange - spendChange;
    const score = Math.round(clamp(
      50
        + clamp(revenueChange * 100, -25, 25)
        + clamp(efficiencyGap * 100, -25, 25)
        + clamp(roasChange * 50, -15, 15),
      0,
      100,
    ));

    let key = 'stable';
    let title = 'Stable operating pattern';
    let summary = 'Revenue and spend are moving within a narrow band; monitor the next period for a clearer signal.';

    if (revenueChange >= 0.05) {
      if (efficiencyGap >= 0 && roasChange >= -0.01) {
        key = 'efficient-growth';
        title = 'Efficient growth';
        summary = 'Revenue grew at least as fast as spend while revenue-to-spend efficiency held or improved.';
      } else {
        key = 'growth-at-a-cost';
        title = 'Growth at a cost';
        summary = 'Revenue increased, but spend grew faster or revenue-to-spend efficiency weakened.';
      }
    } else if (revenueChange <= -0.05) {
      if (spendChange < revenueChange && roasChange >= -0.05) {
        key = 'disciplined-contraction';
        title = 'Disciplined contraction';
        summary = 'Revenue declined, but spend fell faster and efficiency was broadly protected.';
      } else {
        key = 'contraction-risk';
        title = 'Contraction risk';
        summary = 'Revenue declined without a proportionate reduction in spend or with weaker efficiency.';
      }
    } else if (roasChange >= 0.05) {
      key = 'efficiency-gain';
      title = 'Efficiency gain';
      summary = 'Revenue was broadly stable while revenue-to-spend efficiency improved.';
    } else if (roasChange <= -0.05) {
      key = 'efficiency-drift';
      title = 'Efficiency drift';
      summary = 'Revenue was broadly stable while revenue-to-spend efficiency weakened.';
    }

    return { key, title, summary, score, revenueChange, spendChange, roasChange, efficiencyGap };
  }

  function validateRows(rows, allowedRegions = ['czsk', 'us', 'row']) {
    if (!Array.isArray(rows) || !rows.length) throw new Error('Rows must be a non-empty array.');
    const allowed = new Set(allowedRegions);
    const seen = new Set();
    rows.forEach((row, index) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(row?.date)) || Number.isNaN(parseDate(row.date).getTime())) throw new Error(`Invalid date at row ${index}.`);
      if (!allowed.has(row.region)) throw new Error(`Unknown region at row ${index}.`);
      const identity = `${row.date}|${row.region}`;
      if (seen.has(identity)) throw new Error(`Duplicate market-day row: ${identity}.`);
      seen.add(identity);
      ABSOLUTE_METRICS.forEach((key) => {
        if (row[key] === undefined && !['spend', 'revenue', 'purchases', 'unique_visitors'].includes(key)) return;
        if (typeof row[key] !== 'number' || !Number.isFinite(row[key])) throw new Error(`Non-finite ${key} at row ${index}.`);
        if (row[key] < 0) throw new Error(`Negative ${key} at row ${index}.`);
      });
    });
    return true;
  }

  function decisionGate(currentInput, previousInput, context = {}) {
    const current = { ...currentInput };
    const previous = previousInput ? { ...previousInput } : null;
    current.roas = current.roas ?? ratio(current.revenue, current.spend);
    current.cpa = current.cpa ?? ratio(current.spend, current.purchases);
    current.aov = current.aov ?? ratio(current.revenue, current.purchases);
    current.cvr = current.cvr ?? ratio(current.purchases, current.unique_visitors);
    const changes = previous ? {
      revenue: percentageChange(current.revenue, previous.revenue),
      spend: percentageChange(current.spend, previous.spend),
      purchases: percentageChange(current.purchases, previous.purchases),
      unique_visitors: percentageChange(current.unique_visitors, previous.unique_visitors),
      roas: percentageChange(current.roas, previous.roas ?? ratio(previous.revenue, previous.spend)),
    } : {};
    const blocked = !context.targetsConfigured || !context.attributedRevenue || !context.marginAvailable;

    if (current.spend === 0 && (current.revenue > 0 || current.purchases > 0)) {
      return { action: 'INVESTIGATE', issue: 'SPEND CLASSIFICATION', eligibility: 'BLOCKED', tone: 'warning', capitalAuthorized: false, reason: 'Revenue or purchases exist with zero recorded spend; classify this as organic demand, unallocated spend, or a tracking issue.', changes };
    }
    if (changes.unique_visitors <= -0.1 && (changes.purchases === null || changes.purchases > -0.05)) {
      return { action: 'INVESTIGATE', issue: 'TRAFFIC VOLUME', eligibility: 'BLOCKED', tone: 'warning', capitalAuthorized: false, reason: 'Visitor volume declined materially while purchases held comparatively stable; investigate the missing traffic before changing conversion mechanics.', changes };
    }
    if (blocked) {
      const improved = changes.roas !== null && changes.roas > 0;
      return { action: 'HOLD', issue: 'ECONOMIC ELIGIBILITY', eligibility: 'INSUFFICIENT EVIDENCE', tone: 'warning', capitalAuthorized: false, reason: `${improved ? 'Recorded revenue-to-spend coverage improved, but ' : ''}scale and reallocation eligibility are unknown without approved targets, attributed revenue, and margin economics.`, changes };
    }
    return { action: 'MONITOR', issue: 'PERIOD MOVEMENT', eligibility: 'REVIEW AGAINST TARGET', tone: 'neutral', capitalAuthorized: false, reason: 'Observed movement is available; compare it with approved economic guardrails before authorizing capital changes.', changes };
  }

  return {
    ABSOLUTE_METRICS,
    aggregateRows,
    assessGrowthQuality,
    comparePeriods,
    decisionGate,
    deltaSignal,
    filterRows,
    grainLabel,
    groupRows,
    inclusiveDayCount,
    metricValue,
    percentageChange,
    presetBounds,
    previousPeriodBounds,
    regionalBreakdown,
    revenueBridge,
    rollingMetricValues,
    rollingRows,
    shiftDays,
    validateRows,
  };
}));
