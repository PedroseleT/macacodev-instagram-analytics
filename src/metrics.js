export function metricValue(metric) {
  if (!metric) return null;
  if (metric.total_value?.value !== undefined) {
    const flattened = flattenMetricValue(metric.total_value.value, null);
    return flattened.reduce((sum, item) => sum + (Number(item.value) || 0), 0);
  }
  if (Array.isArray(metric.values)) {
    return metric.values.reduce((sum, item) => sum + (Number(item.value) || 0), 0);
  }
  if (metric.value !== undefined) return Number(metric.value);
  return null;
}

export function metricsByName(metrics = []) {
  return new Map(metrics.map((metric) => [metric.name, metricValue(metric)]));
}

export function insightRows(metrics, { entityId, accountId, accountSnapshotId, endpoint, collectedAt }) {
  const rows = [];

  for (const metric of metrics || []) {
    const values = normalizeMetricValues(metric);
    for (const item of values) {
      rows.push({
        media_id: entityId,
        accountId,
        accountSnapshotId,
        metric_name: metric.name,
        period: metric.period ?? null,
        value: item.value,
        end_time: item.end_time ?? null,
        breakdown_name: item.breakdown_name ?? null,
        breakdown_value: item.breakdown_value ?? null,
        endpoint,
        available: true,
        raw: metric,
        collected_at: collectedAt
      });
    }
  }

  return rows;
}

export function normalizeMetricValues(metric) {
  if (!metric) return [];
  if (metric.total_value?.breakdowns) {
    return flattenBreakdowns(metric.total_value.breakdowns);
  }
  if (metric.total_value?.value !== undefined) {
    return flattenMetricValue(metric.total_value.value, null);
  }
  if (Array.isArray(metric.values)) {
    return metric.values.flatMap((item) => flattenMetricValue(item.value, item.end_time ?? null));
  }
  return [{ value: null, end_time: null }];
}

function flattenBreakdowns(breakdowns) {
  const rows = [];
  for (const breakdown of breakdowns || []) {
    for (const result of breakdown.results || []) {
      rows.push({
        breakdown_name: (breakdown.dimension_keys || []).join(','),
        breakdown_value: (result.dimension_values || []).join(','),
        value: numericOrNull(result.value),
        end_time: null
      });
    }
  }
  return rows;
}

function flattenMetricValue(value, endTime) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value).map(([key, nestedValue]) => ({
      breakdown_name: 'key',
      breakdown_value: key,
      value: numericOrNull(nestedValue),
      end_time: endTime
    }));
  }

  return [{ value: numericOrNull(value), end_time: endTime }];
}

export function expandComplexMetrics(metrics = []) {
  const expanded = [];
  for (const metric of metrics) {
    expanded.push(metric);
    if (metric.name === 'navigation') {
      expanded.push(...navigationBreakdownMetrics(metric));
    }
  }
  return expanded;
}

export function navigationBreakdownMetrics(metric) {
  const rows = normalizeMetricValues(metric);
  return rows
    .map((row) => {
      const internalName = mapNavigationAction(row.breakdown_value);
      if (!internalName) return null;
      return {
        name: internalName,
        period: metric.period ?? null,
        values: [{ value: row.value, end_time: row.end_time ?? null }],
        source_metric: 'navigation',
        source_breakdown_name: row.breakdown_name,
        source_breakdown_value: row.breakdown_value,
        raw_navigation: metric
      };
    })
    .filter(Boolean);
}

export function mapNavigationAction(action) {
  const normalized = String(action || '').trim().toLowerCase();
  const mappings = {
    tap_forward: 'taps_forward',
    taps_forward: 'taps_forward',
    story_taps_forward: 'taps_forward',
    tap_back: 'taps_back',
    taps_back: 'taps_back',
    story_taps_back: 'taps_back',
    tap_exit: 'exits',
    taps_exit: 'exits',
    story_exits: 'exits',
    exit: 'exits',
    exits: 'exits',
    swipe_forward: 'swipe_forward',
    story_swipe_forward: 'swipe_forward',
    next_story: 'next_story'
  };
  return mappings[normalized] || null;
}

export function numericOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function divideOrNull(numerator, denominator) {
  const n = numericOrNull(numerator);
  const d = numericOrNull(denominator);
  if (n === null || d === null || d === 0) return null;
  return n / d;
}

export function ratePair(decimal) {
  if (decimal === null || decimal === undefined) {
    return { decimal: null, percent: null };
  }

  return {
    decimal,
    percent: decimal * 100
  };
}

export function calculateMediaDerivedMetrics(row) {
  const likes = numericOrNull(row.likes);
  const comments = numericOrNull(row.comments);
  const saves = numericOrNull(row.saves);
  const shares = numericOrNull(row.shares);
  const reach = numericOrNull(row.reach);
  const follows = numericOrNull(row.follows);
  const profileVisits = numericOrNull(row.profile_visits);
  const views = numericOrNull(row.views);
  const reposts = numericOrNull(row.reposts);
  const averageWatchTime = numericOrNull(row.average_watch_time);
  const duration = numericOrNull(row.duracao_video ?? row.duracao_manual);

  const engagementParts = [likes, comments, saves, shares];
  const engagementNumerator = engagementParts.every((value) => value !== null)
    ? engagementParts.reduce((sum, value) => sum + value, 0)
    : null;

  return {
    engagement_rate: ratePair(divideOrNull(engagementNumerator, reach)),
    share_rate: ratePair(divideOrNull(shares, reach)),
    save_rate: ratePair(divideOrNull(saves, reach)),
    comment_rate: ratePair(divideOrNull(comments, reach)),
    like_rate: ratePair(divideOrNull(likes, reach)),
    follow_rate: ratePair(divideOrNull(follows, reach)),
    profile_visit_rate: ratePair(divideOrNull(profileVisits, reach)),
    profile_to_follow_conversion: ratePair(divideOrNull(follows, profileVisits)),
    watch_ratio: ratePair(divideOrNull(averageWatchTime, duration)),
    views_per_reached_account: ratePair(divideOrNull(views, reach)),
    repost_rate: ratePair(divideOrNull(reposts, reach))
  };
}

export function average(values) {
  const valid = values.map(numericOrNull).filter((value) => value !== null);
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

export function min(values) {
  const valid = values.map(numericOrNull).filter((value) => value !== null);
  return valid.length ? Math.min(...valid) : null;
}

export function max(values) {
  const valid = values.map(numericOrNull).filter((value) => value !== null);
  return valid.length ? Math.max(...valid) : null;
}

export function standardDeviation(values) {
  const valid = values.map(numericOrNull).filter((value) => value !== null);
  if (valid.length < 2) return null;
  const mean = average(valid);
  const variance = valid.reduce((sum, value) => sum + (value - mean) ** 2, 0) / valid.length;
  return Math.sqrt(variance);
}

export function sampleWarning(sampleSize) {
  if (sampleSize < 3) return 'amostra insuficiente';
  if (sampleSize < 10) return 'amostra pequena';
  return 'amostra utilizavel';
}

export function median(values) {
  const valid = values.map(numericOrNull).filter((value) => value !== null).sort((a, b) => a - b);
  if (!valid.length) return null;
  const middle = Math.floor(valid.length / 2);
  return valid.length % 2 ? valid[middle] : (valid[middle - 1] + valid[middle]) / 2;
}

export function aggregateMedia(rows, groupKey) {
  const groups = new Map();
  for (const row of rows) {
    const key = row[groupKey] ?? 'indisponivel';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  return [...groups.entries()].map(([key, items]) => ({
    group: key,
    total_conteudos: items.length,
    sample_size: items.length,
    sample_warning: sampleWarning(items.length),
    views_media: average(items.map((item) => item.views)),
    views_mediana: median(items.map((item) => item.views)),
    views_min: min(items.map((item) => item.views)),
    views_max: max(items.map((item) => item.views)),
    views_stddev: standardDeviation(items.map((item) => item.views)),
    reach_medio: average(items.map((item) => item.reach)),
    reach_mediana: median(items.map((item) => item.reach)),
    reach_min: min(items.map((item) => item.reach)),
    reach_max: max(items.map((item) => item.reach)),
    reach_stddev: standardDeviation(items.map((item) => item.reach)),
    shares_media: average(items.map((item) => item.shares)),
    saves_media: average(items.map((item) => item.saves)),
    engagement_rate_medio: average(items.map((item) => calculateMediaDerivedMetrics(item).engagement_rate.decimal)),
    share_rate_medio: average(items.map((item) => calculateMediaDerivedMetrics(item).share_rate.decimal)),
    save_rate_medio: average(items.map((item) => calculateMediaDerivedMetrics(item).save_rate.decimal)),
    comment_rate_medio: average(items.map((item) => calculateMediaDerivedMetrics(item).comment_rate.decimal)),
    like_rate_medio: average(items.map((item) => calculateMediaDerivedMetrics(item).like_rate.decimal)),
    views_per_reached_account_medio: average(items.map((item) => calculateMediaDerivedMetrics(item).views_per_reached_account.decimal)),
    follow_rate_medio: average(items.map((item) => calculateMediaDerivedMetrics(item).follow_rate.decimal)),
    average_watch_time_medio: average(items.map((item) => item.average_watch_time)),
    watch_ratio_medio: average(items.map((item) => calculateMediaDerivedMetrics(item).watch_ratio.decimal))
  }));
}

export function weekday(timestamp) {
  if (!timestamp) return 'indisponivel';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'indisponivel';
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: 'America/Sao_Paulo' }).format(date);
}

export function publicationHour(timestamp) {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return Number(new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    hour12: false,
    timeZone: 'America/Sao_Paulo'
  }).format(date));
}

export function timeBucket(hour) {
  if (hour === null || hour === undefined) return 'indisponivel';
  if (hour < 6) return '00-06';
  if (hour < 9) return '06-09';
  if (hour < 12) return '09-12';
  if (hour < 15) return '12-15';
  if (hour < 18) return '15-18';
  if (hour < 21) return '18-21';
  return '21-00';
}

export function calculateGrowthCurve(snapshots) {
  const sorted = [...snapshots].sort((a, b) => new Date(a.collected_at) - new Date(b.collected_at));
  return sorted.map((snapshot, index) => {
    const previous = sorted[index - 1];
    const deltaMs = previous ? new Date(snapshot.collected_at) - new Date(previous.collected_at) : null;
    const secondsDelta = deltaMs === null ? null : deltaMs / 1000;
    const minutesDelta = secondsDelta === null ? null : secondsDelta / 60;
    const hoursDelta = minutesDelta === null ? null : minutesDelta / 60;
    const velocityLowConfidence = minutesDelta !== null && minutesDelta < 10;
    const viewsDelta = previous && snapshot.views !== null && previous.views !== null
      ? snapshot.views - previous.views
      : null;
    const reachDelta = previous && snapshot.reach !== null && previous.reach !== null
      ? snapshot.reach - previous.reach
      : null;

    return {
      ...snapshot,
      delta_seconds: secondsDelta,
      delta_minutes: minutesDelta,
      delta_hours: hoursDelta,
      velocity_low_confidence: velocityLowConfidence,
      views_increment: viewsDelta,
      reach_increment: reachDelta,
      views_per_hour: hoursDelta && hoursDelta > 0 && !velocityLowConfidence && viewsDelta !== null ? viewsDelta / hoursDelta : null,
      reach_per_hour: hoursDelta && hoursDelta > 0 && !velocityLowConfidence && reachDelta !== null ? reachDelta / hoursDelta : null,
      views_growth_percent:
        previous && previous.views ? ((snapshot.views - previous.views) / previous.views) * 100 : null,
      reach_growth_percent:
        previous && previous.reach ? ((snapshot.reach - previous.reach) / previous.reach) * 100 : null
    };
  });
}

export const checkpointDefinitions = [
  { label: '1h', hours: 1, toleranceHours: 0.5 },
  { label: '3h', hours: 3, toleranceHours: 0.75 },
  { label: '6h', hours: 6, toleranceHours: 1 },
  { label: '12h', hours: 12, toleranceHours: 2 },
  { label: '24h', hours: 24, toleranceHours: 3 },
  { label: '48h', hours: 48, toleranceHours: 6 },
  { label: '72h', hours: 72, toleranceHours: 8 },
  { label: '7d', hours: 168, toleranceHours: 24 },
  { label: '14d', hours: 336, toleranceHours: 36 },
  { label: '30d', hours: 720, toleranceHours: 72 }
];

export function nearestCheckpoints(snapshots, definitions = checkpointDefinitions) {
  return definitions.map((definition) => {
    const candidates = snapshots
      .filter((snapshot) => numericOrNull(snapshot.hours_since_publication) !== null)
      .map((snapshot) => ({
        ...snapshot,
        checkpoint_distance_hours: Math.abs(snapshot.hours_since_publication - definition.hours)
      }))
      .filter((snapshot) => snapshot.checkpoint_distance_hours <= definition.toleranceHours)
      .sort((a, b) => a.checkpoint_distance_hours - b.checkpoint_distance_hours);

    const match = candidates[0] || null;
    return {
      checkpoint: definition.label,
      target_hours: definition.hours,
      tolerance_hours: definition.toleranceHours,
      media_id: match?.media_id ?? null,
      collected_at: match?.collected_at ?? null,
      hours_since_publication: match?.hours_since_publication ?? null,
      views: match?.views ?? null,
      reach: match?.reach ?? null
    };
  });
}

export function ageFromTimestamp(timestamp, now = new Date()) {
  if (!timestamp) return { age_hours: null, age_days: null };
  const published = new Date(timestamp);
  const current = new Date(now);
  if (Number.isNaN(published.getTime()) || Number.isNaN(current.getTime())) {
    return { age_hours: null, age_days: null };
  }
  const hours = (current - published) / 36e5;
  return {
    age_hours: hours,
    age_days: hours / 24
  };
}

export function calculateAccountGrowth(snapshots = []) {
  const sorted = [...snapshots].sort((a, b) => new Date(a.collected_at) - new Date(b.collected_at));
  if (sorted.length < 2) {
    return {
      seguidores_delta: null,
      seguidores_por_dia: null,
      reach_delta: null,
      views_delta: null,
      profile_views_delta: null,
      interactions_delta: null,
      period_days: null
    };
  }

  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const days = (new Date(last.collected_at) - new Date(first.collected_at)) / 864e5;
  const followersDelta = delta(last.seguidores_total, first.seguidores_total);
  return {
    seguidores_delta: followersDelta,
    seguidores_por_dia: days > 0 && followersDelta !== null ? followersDelta / days : null,
    reach_delta: delta(last.alcance_total, first.alcance_total),
    views_delta: delta(last.views, first.views),
    profile_views_delta: delta(last.visitas_ao_perfil, first.visitas_ao_perfil),
    interactions_delta: delta(last.interacoes_total, first.interacoes_total),
    period_days: days > 0 ? days : null
  };
}

export function calculateAccountDerivedMetrics(snapshot, growth) {
  const reach = snapshot?.alcance_total;
  return {
    profile_visit_rate: ratePair(divideOrNull(snapshot?.visitas_ao_perfil, reach)),
    account_follow_growth_rate: ratePair(divideOrNull(growth?.seguidores_delta, reach)),
    engaged_account_rate: ratePair(divideOrNull(snapshot?.contas_engajadas, reach)),
    interactions_per_reached_account: ratePair(divideOrNull(snapshot?.interacoes_total, reach)),
    views_per_reached_account: ratePair(divideOrNull(snapshot?.views, reach))
  };
}

function delta(current, previous) {
  const c = numericOrNull(current);
  const p = numericOrNull(previous);
  if (c === null || p === null) return null;
  return c - p;
}
