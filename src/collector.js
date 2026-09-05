import {
  finishCollectionRun,
  createCollectionRun,
  insertAccountSnapshot,
  insertAudienceRows,
  insertInsightValues,
  insertMediaSnapshot,
  getCapabilityMap,
  upsertAccount,
  upsertDataQuality,
  upsertMedia,
  upsertMetricCapability,
  upsertStory
} from './db.js';
import { metricCatalogRows } from './availability.js';
import { applyAutomaticContentClassification } from './contentClassificationService.js';
import { logError, logInfo, logWarn } from './logger.js';
import {
  getAccountInsightsExpanded,
  getAllMedia,
  getAudienceInsights,
  getMediaInsightsExpanded,
  getProfile,
  getStories,
  getStoryInsights
} from './metaClient.js';
import {
  expandComplexMetrics,
  insightRows,
  metricValue,
  metricsByName,
  normalizeMetricValues
} from './metrics.js';

export async function collectInstagramAnalytics(accessToken, db, options = {}) {
  const collectedAt = new Date().toISOString();
  const runId = createCollectionRun(db);
  const warnings = [];
  let accountId = null;
  let mediaCount = 0;
  let storyCount = 0;

  try {
    for (const row of metricCatalogRows(collectedAt)) {
      upsertDataQuality(db, row);
    }

    const profile = await getProfile(accessToken);
    accountId = profile.id;
    upsertAccount(db, profile);
    logInfo('profile_collected', { accountId: profile.id, username: profile.username });

    const [accountInsights, mediaPayload, storiesPayload, audienceInsights] = await Promise.all([
      getAccountInsightsExpanded(accessToken, profile.id, {
        since: options.since,
        until: options.until
      }),
      getAllMedia(accessToken, options.mediaLimit ?? 100),
      getStories(accessToken, options.storyLimit ?? 100),
      getAudienceInsights(accessToken, profile.id)
    ]);

    warnings.push(...(accountInsights.warnings || []));
    warnings.push(...(storiesPayload.warnings || []));
    warnings.push(...(audienceInsights.warnings || []));

    const accountSnapshot = buildAccountSnapshot(profile, accountInsights.metrics, collectedAt);
    const accountSnapshotId = insertAccountSnapshot(db, profile.id, accountSnapshot);
    insertInsightValues(
      db,
      'account_insight_values',
      insightRows(accountInsights.metrics, {
        accountId: profile.id,
        accountSnapshotId,
        endpoint: accountInsights.endpoint,
        collectedAt
      })
    );

    markWarnings(db, 'account', profile.id, accountInsights.warnings || [], collectedAt);

    const audienceRows = buildAudienceRows(profile.id, audienceInsights, collectedAt);
    insertAudienceRows(db, audienceRows);
    markWarnings(db, 'audience', profile.id, audienceInsights.warnings || [], collectedAt);

    for (const media of mediaPayload.data || []) {
      upsertMedia(db, profile.id, media);
      applyAutomaticContentClassification(db, media);
      const mediaProductType = media.media_product_type || media.media_type || '';
      const capabilities = getCapabilityMap(db, {
        entityType: 'media',
        mediaProductType,
        endpoint: '/{media-id}/insights'
      });
      const insights = await getMediaInsightsExpanded(accessToken, media.id, { capabilities });
      warnings.push(...(insights.warnings || []));
      markCapabilities(db, 'media', mediaProductType, insights.capabilityEvents || [], collectedAt);
      persistMediaInsights(db, media, insights, collectedAt);
      markWarnings(db, 'media', media.id, insights.warnings || [], collectedAt, mediaProductType);
      mediaCount += 1;
    }

    for (const story of storiesPayload.data || []) {
      upsertMedia(db, profile.id, story, { includePost: false });
      upsertStory(db, profile.id, story);
      const mediaProductType = story.media_product_type || 'STORY';
      const capabilities = getCapabilityMap(db, {
        entityType: 'story',
        mediaProductType,
        endpoint: '/{media-id}/insights'
      });
      const insights = await getStoryInsights(accessToken, story.id, { capabilities });
      warnings.push(...(insights.warnings || []));
      markCapabilities(db, 'story', mediaProductType, insights.capabilityEvents || [], collectedAt);
      const expandedMetrics = expandComplexMetrics(insights.metrics);
      insertInsightValues(
        db,
        'story_insights',
        insightRows(expandedMetrics, {
          entityId: story.id,
          endpoint: insights.endpoint,
          collectedAt
        })
      );
      markWarnings(db, 'story', story.id, insights.warnings || [], collectedAt, mediaProductType);
      storyCount += 1;
    }

    finishCollectionRun(db, runId, {
      accountId,
      status: 'success',
      mediaCount,
      storyCount,
      warnings
    });

    return {
      ok: true,
      runId,
      accountId,
      collectedAt,
      mediaCount,
      storyCount,
      warnings
    };
  } catch (error) {
    logError('collection_failed', { message: error.message });
    finishCollectionRun(db, runId, {
      accountId,
      status: 'failed',
      mediaCount,
      storyCount,
      warnings,
      errorMessage: error.message
    });
    throw error;
  }
}

function buildAccountSnapshot(profile, metrics, collectedAt) {
  const byName = metricsByName(metrics);
  const follows = getFollowsAndUnfollows(metrics);

  return {
    collected_at: collectedAt,
    seguidores_total: profile.followers_count ?? null,
    seguidores_ganhos: follows.gained,
    seguidores_perdidos: follows.lost,
    alcance_total: byName.get('reach') ?? null,
    views: byName.get('views') ?? null,
    impressoes: byName.get('impressions') ?? null,
    visitas_ao_perfil: byName.get('profile_views') ?? byName.get('profile_visits') ?? null,
    interacoes_total: byName.get('total_interactions') ?? null,
    cliques_no_link: byName.get('profile_links_taps') ?? null,
    contas_engajadas: byName.get('accounts_engaged') ?? null,
    quantidade_de_conteudos_publicados: profile.media_count ?? null,
    raw: { profile, metrics }
  };
}

function getFollowsAndUnfollows(metrics) {
  const metric = (metrics || []).find((item) => item.name === 'follows_and_unfollows');
  if (!metric?.total_value?.breakdowns) return { gained: null, lost: null };

  let gained = null;
  let lost = null;
  for (const breakdown of metric.total_value.breakdowns) {
    for (const result of breakdown.results || []) {
      const label = (result.dimension_values || []).join(',').toLowerCase();
      if (label.includes('follow')) gained = Number(result.value) || 0;
      if (label.includes('unfollow')) lost = Number(result.value) || 0;
    }
  }

  return { gained, lost };
}

function persistMediaInsights(db, media, insights, collectedAt) {
  const rows = insightRows(insights.metrics, {
    entityId: media.id,
    endpoint: insights.endpoint,
    collectedAt
  });
  insertInsightValues(db, 'media_insight_values', rows);

  const byName = metricsByName(insights.metrics);
  const likes = media.like_count ?? byName.get('likes') ?? null;
  const comments = media.comments_count ?? byName.get('comments') ?? null;
  const saves = byName.get('saved') ?? null;
  const shares = byName.get('shares') ?? null;
  const reposts = byName.get('reposts') ?? null;
  const totalInteractions = byName.get('total_interactions') ?? null;
  const interactions = sumIfAllPresent([likes, comments, saves, shares]);

  insertMediaSnapshot(db, media.id, {
    collected_at: collectedAt,
    hours_since_publication: hoursSince(media.timestamp, collectedAt),
    views: byName.get('views') ?? null,
    reach: byName.get('reach') ?? null,
    likes,
    comments,
    shares,
    saves,
    reposts,
    interactions,
    total_interactions: totalInteractions,
    watch_time: byName.get('watch_time') ?? byName.get('ig_reels_video_view_total_time') ?? null,
    total_watch_time: byName.get('ig_reels_video_view_total_time') ?? null,
    average_watch_time: byName.get('ig_reels_avg_watch_time') ?? null,
    follows: byName.get('follows') ?? null,
    profile_visits: byName.get('profile_visits') ?? null,
    raw: insights
  });
}

function buildAudienceRows(accountId, insights, collectedAt) {
  const rows = [];
  for (const metric of insights.metrics || []) {
    for (const item of normalizeMetricValues(metric)) {
      rows.push({
        account_id: accountId,
        collected_at: collectedAt,
        metric_name: metric.name,
        breakdown_name: item.breakdown_name ?? null,
        breakdown_value: item.breakdown_value ?? null,
        value: item.value ?? metricValue(metric),
        endpoint: insights.endpoint,
        available: true,
        raw: metric
      });
    }
  }
  return rows;
}

function markCapabilities(db, entityType, mediaProductType, events, collectedAt) {
  for (const event of events || []) {
    upsertMetricCapability(db, {
      entity_type: entityType,
      media_product_type: mediaProductType || '',
      metric_name: event.metric,
      endpoint: event.endpoint || '/{media-id}/insights',
      status: event.status || 'unknown',
      checked_at: collectedAt,
      error_code: event.error?.code ?? null,
      error_message: event.error?.message ?? null,
      raw_response: event.raw || event.error?.details || null
    });
  }
}

function markWarnings(db, entityType, entityId, warnings, collectedAt, mediaProductType = null) {
  for (const warning of warnings || []) {
    for (const metricName of warning.metrics || ['unknown']) {
      const status = warning.statusCategory || 'unknown';
      upsertDataQuality(db, {
        entity_type: entityType,
        entity_id: status === 'temporary_error' ? entityId : '',
        metric_name: metricName,
        available: false,
        endpoint: warning.endpoint || 'unknown',
        last_updated_at: collectedAt,
        limitations: warning.message || 'Metrica nao suportada, sem permissao ou sem dados no momento.',
        error_code: warning.code ?? null,
        error_message: warning.message ?? null,
        status,
        media_product_type: mediaProductType,
        raw_response: warning.details || null
      });
      logWarn('data_quality_unavailable', {
        entityType,
        entityId,
        metricName,
        endpoint: warning.endpoint,
        message: warning.message
      });
    }
  }
}

function hoursSince(timestamp, collectedAt) {
  if (!timestamp) return null;
  const published = new Date(timestamp);
  const collected = new Date(collectedAt);
  if (Number.isNaN(published.getTime()) || Number.isNaN(collected.getTime())) return null;
  return (collected - published) / 36e5;
}

function sumIfAllPresent(values) {
  if (values.some((value) => value === null || value === undefined)) return null;
  return values.reduce((sum, value) => sum + Number(value), 0);
}
