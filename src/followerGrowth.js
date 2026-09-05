import { ageFromTimestamp, calculateMediaDerivedMetrics, numericOrNull } from './metrics.js';

export const followerGrowthWindows = [
  { label: '1h', hours: 1, toleranceHours: 0.5 },
  { label: '3h', hours: 3, toleranceHours: 0.75 },
  { label: '6h', hours: 6, toleranceHours: 1 },
  { label: '12h', hours: 12, toleranceHours: 2 },
  { label: '24h', hours: 24, toleranceHours: 3 },
  { label: '3d', hours: 72, toleranceHours: 12 },
  { label: '7d', hours: 168, toleranceHours: 24 }
];

export const followerMomentumWindows = [
  { label: '6h', hours: 6, toleranceHours: 1 },
  { label: '12h', hours: 12, toleranceHours: 2 },
  { label: '24h', hours: 24, toleranceHours: 3 }
];

export const followerGrowthCheckpoints = [
  { label: '1h', hours: 1, toleranceHours: 0.5 },
  { label: '3h', hours: 3, toleranceHours: 0.75 },
  { label: '6h', hours: 6, toleranceHours: 1 },
  { label: '12h', hours: 12, toleranceHours: 2 },
  { label: '24h', hours: 24, toleranceHours: 4 },
  { label: '48h', hours: 48, toleranceHours: 6 }
];

export const followerGrowthThresholds = {
  stablePercent: 15,
  mildChangePercent: 30,
  minVelocityMinutes: 10,
  spikeMultiplier: 2,
  spikeMinDelta: 5
};

export function buildFollowerGrowthMonitor({
  accountSnapshots = [],
  media = [],
  mediaSnapshots = [],
  generatedAt = new Date().toISOString(),
  targetFollowers = 10000,
  windows = followerGrowthWindows,
  thresholds = followerGrowthThresholds
} = {}) {
  const snapshots = normalizeFollowerSnapshots(accountSnapshots);
  const latest = snapshots.at(-1) || null;
  const first = snapshots[0] || null;
  const velocity = Object.fromEntries(
    windows.map((window) => [window.label, calculateFollowerVelocityWindow(snapshots, window, latest)])
  );
  const momentum = calculateFollowerMomentum(snapshots, { thresholds });
  const goal = calculateFollowerGoal(latest, first, targetFollowers);
  const projection = calculateGoalProjection(goal.followers_remaining, velocity);
  const history = calculateFollowerHistory(snapshots, thresholds);
  const growthAfterPublications = calculateGrowthAfterPublications({
    snapshots,
    media,
    mediaSnapshots,
    generatedAt
  });
  const latestReel = calculateLatestReelGrowth({
    snapshots,
    media,
    generatedAt
  });
  const spikes = detectFollowerGrowthSpikes(history, media, thresholds);

  return {
    generated_at: generatedAt,
    thresholds,
    target_followers: targetFollowers,
    goal,
    velocity,
    momentum,
    projection,
    history,
    growth_after_publications: growthAfterPublications,
    growth_rankings: {
      top_reels_por_crescimento_pos_publicacao: rankGrowthAfterPublication(growthAfterPublications)
    },
    latest_reel: latestReel,
    spikes,
    limitations: [
      'followers_count e um contador atual e pode ser comparado entre snapshots locais.',
      'Crescimento apos publicacao e correlacao temporal da conta, nao seguidores atribuidos ao Reel.',
      'Projecoes ate 10k sao extrapolacoes lineares simples e mudam conforme o ritmo do perfil.',
      'Para velocidade por hora com melhor qualidade, use coleta recorrente pelo menos a cada 1 hora.'
    ]
  };
}

export function normalizeFollowerSnapshots(snapshots = []) {
  return [...snapshots]
    .map((snapshot) => {
      const collectedAt = snapshot.collected_at;
      const time = new Date(collectedAt).getTime();
      const followers = numericOrNull(snapshot.seguidores_total ?? snapshot.followers_count);
      if (!collectedAt || Number.isNaN(time) || followers === null) return null;
      return {
        ...snapshot,
        collected_at: collectedAt,
        collected_time: time,
        followers_total: followers
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.collected_time - b.collected_time);
}

export function calculateFollowerVelocityWindow(snapshots, window, endSnapshot = snapshots.at(-1) || null) {
  if (!endSnapshot) return emptyVelocityWindow(window);
  const targetStart = endSnapshot.collected_time - window.hours * 36e5;
  const startSnapshot = nearestSnapshotToTime(snapshots, targetStart, window.toleranceHours);
  if (!startSnapshot || startSnapshot.collected_time === endSnapshot.collected_time) {
    return emptyVelocityWindow(window, endSnapshot);
  }

  const elapsedHours = (endSnapshot.collected_time - startSnapshot.collected_time) / 36e5;
  if (elapsedHours <= 0) return emptyVelocityWindow(window, endSnapshot);
  const delta = endSnapshot.followers_total - startSnapshot.followers_total;
  const snapshotsInWindow = countSnapshotsBetween(snapshots, startSnapshot.collected_time, endSnapshot.collected_time);

  return {
    window: window.label,
    target_hours: window.hours,
    tolerance_hours: window.toleranceHours,
    start_collected_at: startSnapshot.collected_at,
    end_collected_at: endSnapshot.collected_at,
    followers_start: startSnapshot.followers_total,
    followers_end: endSnapshot.followers_total,
    followers_delta: delta,
    elapsed_hours: elapsedHours,
    followers_per_hour: delta / elapsedHours,
    followers_per_day: (delta / elapsedHours) * 24,
    snapshot_count: snapshotsInWindow,
    confidence: velocityConfidence({ elapsedHours, targetHours: window.hours, snapshotCount: snapshotsInWindow })
  };
}

export function calculateFollowerMomentum(
  snapshots,
  { windows = followerMomentumWindows, thresholds = followerGrowthThresholds } = {}
) {
  const latest = snapshots.at(-1) || null;
  const comparisons = {};
  for (const window of windows) {
    comparisons[window.label] = calculateMomentumWindow(snapshots, window, latest, thresholds);
  }

  const ranked = Object.values(comparisons).filter((item) => item.status !== null);
  const status = overallMomentumStatus(ranked);
  const confidence = ranked.length < windows.length || ranked.some((item) => item.confidence === 'low')
    ? 'low'
    : ranked.some((item) => item.confidence === 'medium')
      ? 'medium'
      : 'high';

  return {
    ...comparisons,
    status,
    confidence
  };
}

export function calculateMomentumWindow(snapshots, window, latest, thresholds = followerGrowthThresholds) {
  if (!latest) return emptyMomentumWindow(window);
  const currentStartTarget = latest.collected_time - window.hours * 36e5;
  const previousStartTarget = latest.collected_time - window.hours * 2 * 36e5;
  const currentStart = nearestSnapshotToTime(snapshots, currentStartTarget, window.toleranceHours);
  const previousStart = nearestSnapshotToTime(snapshots, previousStartTarget, window.toleranceHours);
  if (!currentStart || !previousStart) return emptyMomentumWindow(window);

  const current = rateBetween(currentStart, latest);
  const previous = rateBetween(previousStart, currentStart);
  if (!current || !previous) return emptyMomentumWindow(window);
  const absoluteChange = current.followers_per_hour - previous.followers_per_hour;
  const percentageChange = previous.followers_per_hour === 0
    ? (current.followers_per_hour === 0 ? 0 : null)
    : (absoluteChange / Math.abs(previous.followers_per_hour)) * 100;
  const classified = classifyMomentumChange(percentageChange, absoluteChange, thresholds);
  const snapshotCount =
    countSnapshotsBetween(snapshots, previousStart.collected_time, latest.collected_time);

  return {
    window: window.label,
    current_followers_per_hour: current.followers_per_hour,
    previous_followers_per_hour: previous.followers_per_hour,
    absolute_change: absoluteChange,
    percentage_change: percentageChange,
    status: classified.status,
    change_level: classified.change_level,
    confidence: velocityConfidence({
      elapsedHours: Math.min(current.elapsed_hours, previous.elapsed_hours),
      targetHours: window.hours,
      snapshotCount
    }),
    current_start: currentStart.collected_at,
    current_end: latest.collected_at,
    previous_start: previousStart.collected_at,
    previous_end: currentStart.collected_at
  };
}

export function calculateFollowerGoal(latest, first, targetFollowers = 10000) {
  const current = latest?.followers_total ?? null;
  const started = first?.followers_total ?? null;
  const remaining = current === null ? null : Math.max(targetFollowers - current, 0);
  return {
    current_followers: current,
    target_followers: targetFollowers,
    followers_remaining: remaining,
    percentage_completed: current === null || targetFollowers <= 0 ? null : (current / targetFollowers) * 100,
    followers_since_tracking_started:
      current === null || started === null ? null : current - started,
    tracking_started_at: first?.collected_at ?? null
  };
}

export function calculateGoalProjection(followersRemaining, velocity) {
  const map = {
    '24h_rate_days_to_10k': '24h',
    '3d_rate_days_to_10k': '3d',
    '7d_rate_days_to_10k': '7d'
  };
  return Object.fromEntries(
    Object.entries(map).map(([field, label]) => {
      const perDay = velocity[label]?.followers_per_day;
      return [
        field,
        {
          estimated_days_to_10k:
            followersRemaining !== null && perDay !== null && perDay !== undefined && perDay > 0
              ? followersRemaining / perDay
              : null,
          followers_per_day: perDay ?? null,
          confidence: velocity[label]?.confidence ?? 'low',
          basis: label,
          model: 'linear_extrapolation'
        }
      ];
    })
  );
}

export function calculateFollowerHistory(snapshots, thresholds = followerGrowthThresholds) {
  return snapshots.map((snapshot, index) => {
    const previous = snapshots[index - 1] || null;
    const elapsedHours = previous ? (snapshot.collected_time - previous.collected_time) / 36e5 : null;
    const delta = previous ? snapshot.followers_total - previous.followers_total : null;
    const lowConfidence = elapsedHours !== null && elapsedHours * 60 < thresholds.minVelocityMinutes;
    return {
      timestamp: snapshot.collected_at,
      followers_total: snapshot.followers_total,
      delta_from_previous: delta,
      elapsed_hours: elapsedHours,
      followers_per_hour:
        elapsedHours && elapsedHours > 0 && !lowConfidence && delta !== null ? delta / elapsedHours : null,
      low_confidence: lowConfidence
    };
  });
}

export function calculateGrowthAfterPublications({
  snapshots = [],
  media = [],
  mediaSnapshots = [],
  generatedAt = new Date().toISOString(),
  checkpoints = followerGrowthCheckpoints
} = {}) {
  const reels = media.filter(isReel).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const mediaSnapshotMap = groupMediaSnapshots(mediaSnapshots);
  return reels.map((reel) => {
    const publishedTime = new Date(reel.timestamp).getTime();
    if (Number.isNaN(publishedTime)) return publicationGrowthSkeleton(reel, null);
    const atPublish = nearestSnapshotToTime(snapshots, publishedTime, 6);
    const row = publicationGrowthSkeleton(reel, atPublish);
    row.published_at = reel.timestamp;
    row.age_hours = ageFromTimestamp(reel.timestamp, new Date(generatedAt)).age_hours;
    row.age_days = ageFromTimestamp(reel.timestamp, new Date(generatedAt)).age_days;

    for (const checkpoint of checkpoints) {
      const snapshot = nearestSnapshotToTime(snapshots, publishedTime + checkpoint.hours * 36e5, checkpoint.toleranceHours);
      row[`followers_${checkpoint.label}`] = snapshot?.followers_total ?? null;
      row[`followers_delta_${checkpoint.label}`] =
        atPublish && snapshot && snapshot.collected_time > atPublish.collected_time
          ? snapshot.followers_total - atPublish.followers_total
          : null;
      row[`followers_${checkpoint.label}_collected_at`] = snapshot?.collected_at ?? null;
    }

    const mediaCheckpoint = nearestMediaSnapshotByPublicationAge(
      mediaSnapshotMap.get(reel.media_id) || [],
      24,
      4
    );
    row.reach_24h = mediaCheckpoint?.reach ?? null;
    row.views_24h = mediaCheckpoint?.views ?? null;
    row.growth_after_24h_per_1000_reach = perThousand(row.followers_delta_24h, row.reach_24h);
    row.growth_after_24h_per_1000_views = perThousand(row.followers_delta_24h, row.views_24h);
    row.growth_metric_source = 'derived_proxy';
    row.has_sufficient_snapshots = atPublish !== null && ['6h', '12h', '24h', '48h'].some(
      (label) => row[`followers_delta_${label}`] !== null
    );
    return row;
  });
}

export function calculateLatestReelGrowth({ snapshots = [], media = [], generatedAt = new Date().toISOString() } = {}) {
  const latestReel = media
    .filter(isReel)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
  if (!latestReel) return null;

  const publishedTime = new Date(latestReel.timestamp).getTime();
  const atPublish = Number.isNaN(publishedTime) ? null : nearestSnapshotToTime(snapshots, publishedTime, 6);
  const latestSnapshot = snapshots.at(-1) || null;
  const elapsedHours = atPublish && latestSnapshot
    ? (latestSnapshot.collected_time - atPublish.collected_time) / 36e5
    : null;
  const growth = atPublish && latestSnapshot && latestSnapshot.collected_time > atPublish.collected_time
    ? latestSnapshot.followers_total - atPublish.followers_total
    : null;
  const seriesBaseline = calculateSeriesBaseline(media.filter((item) => isReel(item) && item.media_id !== latestReel.media_id));
  const derived = latestReel.derived || calculateMediaDerivedMetrics(latestReel);

  return {
    tema: latestReel.tema ?? null,
    tema_source: latestReel.tema_source ?? null,
    quadro: latestReel.quadro ?? null,
    quadro_source: latestReel.quadro_source ?? null,
    media_id: latestReel.media_id,
    published_at: latestReel.timestamp,
    age_hours: ageFromTimestamp(latestReel.timestamp, new Date(generatedAt)).age_hours,
    age_days: ageFromTimestamp(latestReel.timestamp, new Date(generatedAt)).age_days,
    views: numericOrNull(latestReel.views),
    reach: numericOrNull(latestReel.reach),
    likes: numericOrNull(latestReel.likes),
    comments: numericOrNull(latestReel.comments),
    shares: numericOrNull(latestReel.shares),
    saves: numericOrNull(latestReel.saves),
    engagement_rate: derived.engagement_rate.decimal,
    share_rate: derived.share_rate.decimal,
    save_rate: derived.save_rate.decimal,
    views_per_reached_account: derived.views_per_reached_account.decimal,
    followers_at_publish: atPublish?.followers_total ?? null,
    followers_at_publish_collected_at: atPublish?.collected_at ?? null,
    followers_now: latestSnapshot?.followers_total ?? null,
    followers_now_collected_at: latestSnapshot?.collected_at ?? null,
    account_growth_since_publish: growth,
    followers_per_hour_since_publish:
      elapsedHours && elapsedHours > 0 && growth !== null ? growth / elapsedHours : null,
    baseline_comparison: compareLatestWithBaseline(latestReel, seriesBaseline)
  };
}

export function detectFollowerGrowthSpikes(history, media, thresholds = followerGrowthThresholds) {
  const validRates = history
    .map((item) => item.followers_per_hour)
    .filter((value) => value !== null && Number.isFinite(value) && value >= 0);
  if (validRates.length < 3) return [];
  const baseline = median(validRates);
  if (!baseline || baseline <= 0) return [];

  return history
    .filter((item) => {
      const rate = item.followers_per_hour;
      return (
        rate !== null &&
        item.delta_from_previous >= thresholds.spikeMinDelta &&
        rate >= baseline * thresholds.spikeMultiplier
      );
    })
    .map((item) => {
      const startTime = new Date(item.timestamp).getTime() - (item.elapsed_hours || 0) * 36e5;
      const endTime = new Date(item.timestamp).getTime();
      return {
        growth_spike: true,
        start: new Date(startTime).toISOString(),
        end: item.timestamp,
        followers_delta: item.delta_from_previous,
        followers_per_hour: item.followers_per_hour,
        baseline_per_hour: baseline,
        multiplier_vs_baseline: item.followers_per_hour / baseline,
        recent_content: media
          .filter((content) => {
            const published = new Date(content.timestamp).getTime();
            return !Number.isNaN(published) && published <= endTime && published >= startTime - 48 * 36e5;
          })
          .map((content) => ({
            media_id: content.media_id,
            tema: content.tema ?? null,
            quadro: content.quadro ?? null,
            published_at: content.timestamp
          }))
      };
    });
}

export function nearestSnapshotToTime(snapshots, targetTime, toleranceHours) {
  const toleranceMs = toleranceHours * 36e5;
  return snapshots
    .map((snapshot) => ({ snapshot, distance: Math.abs(snapshot.collected_time - targetTime) }))
    .filter((item) => item.distance <= toleranceMs)
    .sort((a, b) => a.distance - b.distance)[0]?.snapshot ?? null;
}

function publicationGrowthSkeleton(reel, atPublish) {
  return {
    tema: reel.tema ?? null,
    tema_source: reel.tema_source ?? null,
    quadro: reel.quadro ?? null,
    quadro_source: reel.quadro_source ?? null,
    media_id: reel.media_id,
    published_at: reel.timestamp ?? null,
    followers_at_publish: atPublish?.followers_total ?? null,
    followers_at_publish_collected_at: atPublish?.collected_at ?? null
  };
}

function nearestMediaSnapshotByPublicationAge(snapshots, targetHours, toleranceHours) {
  return snapshots
    .map((snapshot) => ({
      snapshot,
      distance:
        numericOrNull(snapshot.hours_since_publication) === null
          ? null
          : Math.abs(numericOrNull(snapshot.hours_since_publication) - targetHours)
    }))
    .filter((item) => item.distance !== null && item.distance <= toleranceHours)
    .sort((a, b) => a.distance - b.distance)[0]?.snapshot ?? null;
}

function groupMediaSnapshots(snapshots) {
  const groups = new Map();
  for (const snapshot of snapshots) {
    if (!groups.has(snapshot.media_id)) groups.set(snapshot.media_id, []);
    groups.get(snapshot.media_id).push(snapshot);
  }
  return groups;
}

function rateBetween(start, end) {
  const elapsedHours = (end.collected_time - start.collected_time) / 36e5;
  if (elapsedHours <= 0) return null;
  const delta = end.followers_total - start.followers_total;
  return {
    followers_delta: delta,
    elapsed_hours: elapsedHours,
    followers_per_hour: delta / elapsedHours,
    followers_per_day: (delta / elapsedHours) * 24
  };
}

function classifyMomentumChange(percentageChange, absoluteChange, thresholds) {
  if (percentageChange === null || percentageChange === undefined) {
    if (absoluteChange === 0) return { status: 'stable', change_level: 'stable' };
    return {
      status: absoluteChange > 0 ? 'accelerating' : 'decelerating',
      change_level: 'unknown'
    };
  }

  const absPercent = Math.abs(percentageChange);
  const status = absPercent < thresholds.stablePercent
    ? 'stable'
    : percentageChange > 0
      ? 'accelerating'
      : 'decelerating';
  const changeLevel = absPercent < thresholds.stablePercent
    ? 'stable'
    : absPercent <= thresholds.mildChangePercent
      ? 'mild_change'
      : 'significant_change';
  return { status, change_level: changeLevel };
}

function overallMomentumStatus(items) {
  if (!items.length) return null;
  const significant = items.find((item) => item.change_level === 'significant_change');
  if (significant) return significant.status;
  const mild = items.find((item) => item.change_level === 'mild_change');
  if (mild) return mild.status;
  return 'stable';
}

function velocityConfidence({ elapsedHours, targetHours, snapshotCount }) {
  if (!elapsedHours || elapsedHours < targetHours * 0.75 || snapshotCount < 3) return 'low';
  if (snapshotCount < 5) return 'medium';
  return 'high';
}

function emptyVelocityWindow(window, endSnapshot = null) {
  return {
    window: window.label,
    target_hours: window.hours,
    tolerance_hours: window.toleranceHours,
    start_collected_at: null,
    end_collected_at: endSnapshot?.collected_at ?? null,
    followers_start: null,
    followers_end: endSnapshot?.followers_total ?? null,
    followers_delta: null,
    elapsed_hours: null,
    followers_per_hour: null,
    followers_per_day: null,
    snapshot_count: 0,
    confidence: 'low'
  };
}

function emptyMomentumWindow(window) {
  return {
    window: window.label,
    current_followers_per_hour: null,
    previous_followers_per_hour: null,
    absolute_change: null,
    percentage_change: null,
    status: null,
    change_level: 'unknown',
    confidence: 'low'
  };
}

function countSnapshotsBetween(snapshots, startTime, endTime) {
  return snapshots.filter((snapshot) => snapshot.collected_time >= startTime && snapshot.collected_time <= endTime).length;
}

function perThousand(delta, denominator) {
  const n = numericOrNull(delta);
  const d = numericOrNull(denominator);
  if (n === null || d === null || d === 0) return null;
  return (n / d) * 1000;
}

function rankGrowthAfterPublication(rows) {
  return rows
    .filter((row) => row.has_sufficient_snapshots)
    .map((row) => ({
      tema: row.tema,
      quadro: row.quadro,
      media_id: row.media_id,
      data: row.published_at,
      followers_delta_6h: row.followers_delta_6h ?? null,
      followers_delta_12h: row.followers_delta_12h ?? null,
      followers_delta_24h: row.followers_delta_24h ?? null,
      followers_delta_48h: row.followers_delta_48h ?? null,
      reach_24h: row.reach_24h ?? null,
      views_24h: row.views_24h ?? null,
      growth_after_24h_per_1000_reach: row.growth_after_24h_per_1000_reach ?? null,
      metric: row.followers_delta_24h ?? row.followers_delta_12h ?? row.followers_delta_6h ?? row.followers_delta_48h
    }))
    .filter((row) => row.metric !== null)
    .sort((a, b) => Number(b.metric) - Number(a.metric))
    .slice(0, 10);
}

function calculateSeriesBaseline(reels) {
  return {
    views: median(reels.map((item) => item.views)),
    reach: median(reels.map((item) => item.reach)),
    engagement_rate: median(reels.map((item) => item.derived?.engagement_rate.decimal)),
    share_rate: median(reels.map((item) => item.derived?.share_rate.decimal)),
    save_rate: median(reels.map((item) => item.derived?.save_rate.decimal)),
    views_per_reached_account: median(reels.map((item) => item.derived?.views_per_reached_account.decimal))
  };
}

function compareLatestWithBaseline(latestReel, baseline) {
  const derived = latestReel.derived || calculateMediaDerivedMetrics(latestReel);
  return {
    views: compareValue(numericOrNull(latestReel.views), baseline.views),
    reach: compareValue(numericOrNull(latestReel.reach), baseline.reach),
    engagement_rate: compareValue(derived.engagement_rate.decimal, baseline.engagement_rate),
    share_rate: compareValue(derived.share_rate.decimal, baseline.share_rate),
    save_rate: compareValue(derived.save_rate.decimal, baseline.save_rate),
    views_per_reached_account: compareValue(
      derived.views_per_reached_account.decimal,
      baseline.views_per_reached_account
    )
  };
}

function compareValue(value, baseline) {
  const current = numericOrNull(value);
  const base = numericOrNull(baseline);
  if (current === null || base === null || base === 0) {
    return { value: current, baseline: base, status: 'unknown', ratio: null };
  }
  const ratio = current / base;
  return {
    value: current,
    baseline: base,
    ratio,
    status: ratio >= 1.15 ? 'above_baseline' : ratio <= 0.85 ? 'below_baseline' : 'near_baseline'
  };
}

function median(values) {
  const valid = values.map(numericOrNull).filter((value) => value !== null).sort((a, b) => a - b);
  if (!valid.length) return null;
  const middle = Math.floor(valid.length / 2);
  return valid.length % 2 ? valid[middle] : (valid[middle - 1] + valid[middle]) / 2;
}

function isReel(row) {
  return row.media_product_type === 'REELS' || row.media_product_type === 'REEL';
}
