import fs from 'node:fs';
import path from 'node:path';
import { config } from './env.js';
import { getExportData } from './db.js';
import { buildFollowerGrowthMonitor } from './followerGrowth.js';
import {
  aggregateMedia,
  ageFromTimestamp,
  calculateAccountDerivedMetrics,
  calculateAccountGrowth,
  calculateGrowthCurve,
  calculateMediaDerivedMetrics,
  nearestCheckpoints,
  publicationHour,
  timeBucket,
  weekday
} from './metrics.js';

const booleanFeatures = [
  'usa_humor',
  'usa_historia',
  'usa_analogia',
  'usa_codigo',
  'usa_macaco',
  'usa_narracao',
  'possui_texto_na_tela'
];

export function buildAnalyticsExport(db, options = {}) {
  const generatedAt = new Date().toISOString();
  const data = getExportData(db, options);
  const media = enrichMedia(data.media || []);
  const storyIds = new Set((data.stories || []).map((story) => story.media_id));
  const reelRows = media.filter(isReel);
  const postRows = media.filter((item) => !isReel(item) && !storyIds.has(item.media_id));
  const contentRows = media.filter((item) => !storyIds.has(item.media_id));
  const snapshots = getMediaSnapshots(db, data.account?.id);
  const growthCurves = buildGrowthCurves(snapshots);
  const latestSnapshot = data.accountSnapshots?.[0] || null;
  const accountGrowth = calculateAccountGrowth(data.accountSnapshots || []);
  const followerGrowth = buildFollowerGrowthMonitor({
    accountSnapshots: data.accountSnapshots || [],
    media: contentRows,
    mediaSnapshots: snapshots,
    generatedAt
  });

  return {
    generated_at: generatedAt,
    period: inferPeriod(data.accountSnapshots, media),
    account: data.account,
    latest_account_snapshot: latestSnapshot,
    account_snapshots: data.accountSnapshots || [],
    account_growth: accountGrowth,
    follower_growth: followerGrowth,
    account_derived: calculateAccountDerivedMetrics(latestSnapshot, accountGrowth),
    reels: reelRows,
    posts: postRows,
    stories: enrichStories(db, data.stories || []),
    audience: data.audience || [],
    aggregates: {
      por_quadro: aggregateMedia(reelRows, 'quadro'),
      por_tema: aggregateMedia(contentRows, 'tema'),
      por_categoria: aggregateMedia(contentRows, 'categoria'),
      por_linguagem: aggregateMedia(contentRows, 'programming_language'),
      por_dia_da_semana: aggregateMedia(contentRows, 'dia_da_semana'),
      por_hora_publicacao: aggregateMedia(contentRows, 'hora_publicacao_grupo'),
      por_faixa_horaria: aggregateMedia(contentRows, 'faixa_horaria'),
      por_caracteristicas: aggregateBooleanFeatures(contentRows)
    },
    rankings: buildRankings(reelRows, postRows, growthCurves),
    recent_content: contentRows.filter((item) => item.age_days !== null && item.age_days <= 7),
    growth_curves: growthCurves,
    data_quality: summarizeDataQuality(data.dataQuality || [], data.capabilities || []),
    data_quality_detailed: data.dataQuality || [],
    capabilities: data.capabilities || []
  };
}

export function exportMarkdown(db, options = {}) {
  const report = buildAnalyticsExport(db, options);
  return renderMarkdown(report, options);
}

export function exportGrowthMarkdown(db, options = {}) {
  const report = buildAnalyticsExport(db, options);
  return renderGrowthMarkdown(report, options);
}

export function exportJson(db, options = {}) {
  return JSON.stringify(buildAnalyticsExport(db, options), null, 2);
}

export function exportCsv(db, options = {}) {
  const report = buildAnalyticsExport(db, options);
  const rows = [
    ['section', 'group', 'metric', 'value_decimal', 'value_percent', 'entity_id', 'date']
  ];

  for (const reel of report.reels) {
    rows.push(['reel', reel.media_id, 'views', reel.views ?? '', '', reel.media_id, reel.data_publicacao ?? '']);
    rows.push(['reel', reel.media_id, 'reach', reel.reach ?? '', '', reel.media_id, reel.data_publicacao ?? '']);
    rows.push([
      'reel',
      reel.media_id,
      'engagement_rate',
      reel.derived.engagement_rate.decimal ?? '',
      reel.derived.engagement_rate.percent ?? '',
      reel.media_id,
      reel.data_publicacao ?? ''
    ]);
    rows.push([
      'reel',
      reel.media_id,
      'save_rate',
      reel.derived.save_rate.decimal ?? '',
      reel.derived.save_rate.percent ?? '',
      reel.media_id,
      reel.data_publicacao ?? ''
    ]);
  }

  for (const [section, groups] of Object.entries(report.aggregates)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      rows.push([section, group.group, 'total_conteudos', group.total_conteudos, '', '', '']);
      rows.push([section, group.group, 'views_media', group.views_media ?? '', '', '', '']);
      rows.push([section, group.group, 'reach_medio', group.reach_medio ?? '', '', '', '']);
      rows.push([section, group.group, 'engagement_rate_medio', group.engagement_rate_medio ?? '', '', '', '']);
      rows.push([section, group.group, 'share_rate_medio', group.share_rate_medio ?? '', '', '', '']);
      rows.push([section, group.group, 'save_rate_medio', group.save_rate_medio ?? '', '', '', '']);
      rows.push([section, group.group, 'follow_rate_medio', group.follow_rate_medio ?? '', '', '', '']);
      rows.push([section, group.group, 'watch_ratio_medio', group.watch_ratio_medio ?? '', '', '', '']);
    }
  }

  return rows.map((row) => row.map(csvCell).join(',')).join('\n');
}

export function writeExport(format, content, { exportsDir = config.exportsDir } = {}) {
  fs.mkdirSync(exportsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const extension = format === 'markdown' ? 'md' : format;
  const filePath = path.join(exportsDir, `macacodev-analytics-${timestamp}.${extension}`);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

export function writeGrowthExport(content, { exportsDir = config.exportsDir } = {}) {
  fs.mkdirSync(exportsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(exportsDir, `macacodev-growth-monitor-${timestamp}.md`);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

function enrichMedia(rows) {
  const now = new Date();
  return rows.map((row) => {
    const hour = publicationHour(row.timestamp);
    const age = ageFromTimestamp(row.timestamp, now);
    const enriched = {
      ...row,
      likes: normalizeNumber(row.likes ?? row.like_count),
      comments: normalizeNumber(row.comments ?? row.comments_count),
      saves: normalizeNumber(row.saves),
      shares: normalizeNumber(row.shares),
      views: normalizeNumber(row.views),
      reach: normalizeNumber(row.reach),
      follows: normalizeNumber(row.follows),
      profile_visits: normalizeNumber(row.profile_visits),
      reposts: normalizeNumber(row.reposts),
      average_watch_time: normalizeNumber(row.average_watch_time),
      duracao_video: normalizeNumber(row.duracao_video),
      duracao_manual: normalizeNumber(row.duracao_manual),
      dia_da_semana: weekday(row.timestamp),
      hora_publicacao_grupo: hour === null ? 'indisponivel' : String(hour).padStart(2, '0'),
      faixa_horaria: timeBucket(hour),
      age_hours: age.age_hours,
      age_days: age.age_days
    };

    return {
      ...enriched,
      derived: calculateMediaDerivedMetrics(enriched)
    };
  });
}

function enrichStories(db, stories) {
  return stories.map((story) => {
    const rows = db.prepare(`
      SELECT metric_name, value, raw_json
      FROM story_insights
      WHERE media_id=?
        AND collected_at = (
          SELECT MAX(collected_at) FROM story_insights WHERE media_id=?
        )
    `).all(story.media_id, story.media_id);
    const byName = new Map(rows.map((row) => [row.metric_name, row.value]));
    return {
      ...story,
      views: byName.get('views') ?? byName.get('impressions') ?? null,
      reach: byName.get('reach') ?? null,
      likes: byName.get('likes') ?? null,
      replies: byName.get('replies') ?? null,
      shares: byName.get('shares') ?? null,
      total_interactions: byName.get('total_interactions') ?? null,
      taps_forward: byName.get('taps_forward') ?? null,
      taps_back: byName.get('taps_back') ?? null,
      exits: byName.get('exits') ?? null,
      next_story: byName.get('next_story') ?? null,
      swipe_forward: byName.get('swipe_forward') ?? null,
      profile_activity: byName.get('profile_activity') ?? null,
      link_clicks: byName.get('link_clicks') ?? null
    };
  });
}

function aggregateBooleanFeatures(media) {
  return booleanFeatures.flatMap((feature) => {
    const rows = media.map((item) => ({
      ...item,
      feature_group: item[feature] === null || item[feature] === undefined ? 'indisponivel' : `${feature}=${Boolean(item[feature])}`
    }));
    return aggregateMedia(rows, 'feature_group').map((group) => ({
      feature,
      ...group
    }));
  });
}

function buildGrowthCurves(snapshots) {
  const groups = new Map();
  for (const snapshot of snapshots) {
    if (!groups.has(snapshot.media_id)) groups.set(snapshot.media_id, []);
    groups.get(snapshot.media_id).push(snapshot);
  }

  return [...groups.entries()].map(([mediaId, rows]) => ({
    media_id: mediaId,
    snapshots: calculateGrowthCurve(rows),
    checkpoints: nearestCheckpoints(rows)
  }));
}

function buildRankings(reels, posts, growthCurves) {
  return {
    top_reels_por_views: topBy(reels, (item) => item.views),
    top_reels_por_reach: topBy(reels, (item) => item.reach),
    top_reels_por_engagement_rate: topBy(reels, (item) => item.derived.engagement_rate.decimal),
    top_reels_por_share_rate: topBy(reels, (item) => item.derived.share_rate.decimal),
    top_reels_por_save_rate: topBy(reels, (item) => item.derived.save_rate.decimal),
    top_reels_por_comments: topBy(reels, (item) => item.comments),
    top_reels_por_views_per_reached_account: topBy(
      reels,
      (item) => item.derived.views_per_reached_account.decimal
    ),
    top_posts_carrosseis_por_save_rate: topBy(posts, (item) => item.derived.save_rate.decimal),
    top_reels_por_crescimento_24h: topGrowth(reels, growthCurves, 24),
    top_reels_por_velocidade_inicial: topInitialVelocity(reels, growthCurves)
  };
}

function topBy(rows, getter, limit = 5) {
  return rows
    .map((item) => ({ item, metric: getter(item) }))
    .filter((row) => row.metric !== null && row.metric !== undefined && Number.isFinite(Number(row.metric)))
    .sort((a, b) => Number(b.metric) - Number(a.metric))
    .slice(0, limit)
    .map(({ item, metric }) => rankingRow(item, metric));
}

function topGrowth(reels, growthCurves, checkpointHours) {
  const reelMap = new Map(reels.map((item) => [item.media_id, item]));
  return growthCurves
    .map((curve) => {
      const ordered = [...curve.snapshots].sort((a, b) => a.hours_since_publication - b.hours_since_publication);
      const before = ordered.findLast((snapshot) => snapshot.hours_since_publication <= checkpointHours);
      const after = ordered.find((snapshot) => snapshot.hours_since_publication >= checkpointHours);
      const baseline = ordered[0];
      const target = after || before;
      const item = reelMap.get(curve.media_id);
      if (!item || !baseline || !target || target.views === null || baseline.views === null) return null;
      return rankingRow(item, target.views - baseline.views);
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.metric) - Number(a.metric))
    .slice(0, 5);
}

function topInitialVelocity(reels, growthCurves) {
  const reelMap = new Map(reels.map((item) => [item.media_id, item]));
  return growthCurves
    .map((curve) => {
      const candidates = curve.snapshots.filter(
        (snapshot) => snapshot.views_per_hour !== null && snapshot.hours_since_publication <= 24
      );
      const best = candidates.sort((a, b) => b.views_per_hour - a.views_per_hour)[0];
      const item = reelMap.get(curve.media_id);
      return item && best ? rankingRow(item, best.views_per_hour) : null;
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.metric) - Number(a.metric))
    .slice(0, 5);
}

function rankingRow(item, metric) {
  return {
    tema: item.tema ?? null,
    tema_source: item.tema_source ?? null,
    quadro: item.quadro ?? null,
    quadro_source: item.quadro_source ?? null,
    media_id: item.media_id,
    data: item.data_publicacao ?? null,
    age_hours: item.age_hours,
    age_days: item.age_days,
    metric
  };
}

function summarizeDataQuality(rows, capabilities) {
  const summarized = new Map();
  for (const row of rows) {
    if (isObsoleteStoryNavigationCapability(row)) continue;
    const key = [row.entity_type, row.metric_name, row.media_product_type || '', row.endpoint].join('|');
    mergeQualityRow(summarized, key, {
      entity_type: row.entity_type,
      metric_name: row.metric_name,
      media_product_type: row.media_product_type || null,
      endpoint: row.endpoint,
      status: row.status || (row.available ? 'supported' : 'unknown'),
      available: row.available,
      error_code: row.error_code,
      error_message: row.error_message,
      limitations: row.limitations,
      last_updated_at: row.last_updated_at
    });
  }

  for (const capability of capabilities) {
    if (isObsoleteStoryNavigationCapability(capability)) continue;
    const key = [
      capability.entity_type,
      capability.metric_name,
      capability.media_product_type || '',
      capability.endpoint
    ].join('|');
    mergeQualityRow(summarized, key, {
      entity_type: capability.entity_type,
      metric_name: capability.metric_name,
      media_product_type: capability.media_product_type || null,
      endpoint: capability.endpoint,
      status: capability.status,
      available: capability.status === 'supported',
      error_code: capability.error_code,
      error_message: capability.error_message,
      limitations: capability.error_message,
      last_updated_at: capability.last_checked_at
    });
  }
  return [...summarized.values()].sort((a, b) =>
    `${a.entity_type}:${a.metric_name}`.localeCompare(`${b.entity_type}:${b.metric_name}`)
  );
}

function mergeQualityRow(map, key, row) {
  const current = map.get(key);
  if (!current || qualityRank(row.status) >= qualityRank(current.status)) {
    map.set(key, row);
  }
}

function qualityRank(status) {
  return {
    unknown: 0,
    conditional: 1,
    temporary_error: 2,
    permission_error: 3,
    unsupported: 4,
    supported: 5
  }[status || 'unknown'] ?? 0;
}

function isObsoleteStoryNavigationCapability(row) {
  return (
    row.entity_type === 'story' &&
    ['exits', 'taps_forward', 'taps_back', 'swipe_forward', 'next_story'].includes(row.metric_name) &&
    (row.status || '').toLowerCase() === 'unsupported'
  );
}

function summarizeAudienceRows(rows = []) {
  const latest = rows
    .map((row) => ({ ...row, time: new Date(row.collected_at).getTime() }))
    .filter((row) => !Number.isNaN(row.time))
    .sort((a, b) => b.time - a.time);
  const latestTime = latest[0]?.time;
  const currentRows = latestTime ? latest.filter((row) => row.time === latestTime) : latest;
  const byKey = new Map();

  for (const row of currentRows) {
    const key = [row.metric_name, row.breakdown_name || '', row.breakdown_value || ''].join('|');
    if (!byKey.has(key) || row.value !== null) byKey.set(key, row);
  }

  return [...byKey.values()]
    .filter((row) => row.value !== null || !hasNonNullMetric(byKey, row.metric_name))
    .sort((a, b) =>
      `${a.metric_name}:${a.breakdown_name}:${a.breakdown_value}`.localeCompare(
        `${b.metric_name}:${b.breakdown_name}:${b.breakdown_value}`
      )
    );
}

function hasNonNullMetric(rowsByKey, metricName) {
  return [...rowsByKey.values()].some((row) => row.metric_name === metricName && row.value !== null);
}

function getMediaSnapshots(db, accountId) {
  if (!accountId) return [];
  return db.prepare(`
    SELECT ms.*
    FROM media_snapshots ms
    JOIN media m ON m.media_id = ms.media_id
    WHERE m.account_id=?
    ORDER BY ms.media_id, ms.collected_at
  `).all(accountId);
}

function renderMarkdown(report, options = {}) {
  const lines = [];
  lines.push('# MACACODEV ANALYTICS');
  lines.push('');
  lines.push(`Gerado em: ${formatDateTime(report.generated_at)}`);
  lines.push(`Periodo: ${report.period.start || 'indisponivel'} -> ${report.period.end || 'indisponivel'}`);
  lines.push('');

  lines.push('## CONTA');
  if (!report.account) {
    lines.push('Nenhuma conta coletada ainda.');
  } else {
    const snapshot = report.latest_account_snapshot || {};
    lines.push(`- username: ${report.account.username ?? 'null'}`);
    lines.push(`- seguidores: ${value(snapshot.seguidores_total)}`);
    lines.push(`- seguidores_ganhos: ${value(snapshot.seguidores_ganhos)}`);
    lines.push(`- seguidores_perdidos: ${value(snapshot.seguidores_perdidos)}`);
    lines.push(`- reach: ${value(snapshot.alcance_total)}`);
    lines.push(`- views: ${value(snapshot.views)}`);
    lines.push(`- impressoes: ${value(snapshot.impressoes)}`);
    lines.push(`- visitas_ao_perfil: ${value(snapshot.visitas_ao_perfil)}`);
    lines.push(`- interacoes_total: ${value(snapshot.interacoes_total)}`);
    lines.push(`- cliques_no_link: ${value(snapshot.cliques_no_link)}`);
    lines.push(`- contas_engajadas: ${value(snapshot.contas_engajadas)}`);
    lines.push(`- quantidade_de_conteudos_publicados: ${value(snapshot.quantidade_de_conteudos_publicados)}`);
    lines.push(`- seguidores_delta_local: ${value(report.account_growth.seguidores_delta)}`);
    lines.push(`- seguidores_por_dia_local: ${value(round(report.account_growth.seguidores_por_dia))}`);
    lines.push(`- profile_visit_rate: ${percent(report.account_derived.profile_visit_rate.percent)}`);
    lines.push(`- engaged_account_rate: ${percent(report.account_derived.engaged_account_rate.percent)}`);
    lines.push(`- interactions_per_reached_account: ${round(report.account_derived.interactions_per_reached_account.decimal) ?? 'null'}`);
    lines.push(`- views_per_reached_account: ${round(report.account_derived.views_per_reached_account.decimal) ?? 'null'}`);
  }
  lines.push('');

  lines.push(...renderFollowerGrowthSections(report.follower_growth));

  lines.push('## REELS');
  lines.push(table(
    ['published_at', 'age_hours', 'age_days', 'media_id', 'tema', 'tema_source', 'quadro', 'quadro_source', 'views', 'reach', 'likes', 'comments', 'shares', 'saves', 'engagement_rate', 'share_rate', 'save_rate', 'views_per_reached_account', 'watch_ratio'],
    report.reels.map((item) => [
      item.timestamp,
      round(item.age_hours),
      round(item.age_days),
      item.media_id,
      item.tema,
      item.tema_source,
      item.quadro,
      item.quadro_source,
      item.views,
      item.reach,
      item.likes,
      item.comments,
      item.shares,
      item.saves,
      percent(item.derived.engagement_rate.percent),
      percent(item.derived.share_rate.percent),
      percent(item.derived.save_rate.percent),
      round(item.derived.views_per_reached_account.decimal),
      percent(item.derived.watch_ratio.percent)
    ])
  ));
  lines.push('');

  lines.push('## CONTEUDOS RECENTES');
  lines.push(table(
    ['data', 'idade_dias', 'tipo', 'tema', 'tema_source', 'quadro', 'quadro_source', 'views', 'reach', 'shares', 'saves', 'engagement_rate', 'share_rate', 'save_rate'],
    report.recent_content.map((item) => [
      item.data_publicacao,
      round(item.age_days),
      item.media_product_type || item.media_type,
      item.tema,
      item.tema_source,
      item.quadro,
      item.quadro_source,
      item.views,
      item.reach,
      item.shares,
      item.saves,
      percent(item.derived.engagement_rate.percent),
      percent(item.derived.share_rate.percent),
      percent(item.derived.save_rate.percent)
    ])
  ));
  lines.push('');

  lines.push('## RANKINGS');
  for (const [name, rows] of Object.entries(report.rankings)) {
    lines.push(`### ${rankingTitle(name)}`);
    lines.push(rankingTable(rows));
    lines.push('');
  }

  lines.push('## PERFORMANCE POR QUADRO');
  lines.push(aggregateTable(report.aggregates.por_quadro));
  lines.push('');

  lines.push('## PERFORMANCE POR TEMA');
  lines.push(aggregateTable(report.aggregates.por_tema));
  lines.push('');

  lines.push('## PERFORMANCE POR CATEGORIA');
  lines.push(aggregateTable(report.aggregates.por_categoria));
  lines.push('');

  lines.push('## PERFORMANCE POR LINGUAGEM');
  lines.push(aggregateTable(report.aggregates.por_linguagem));
  lines.push('');

  lines.push('## PERFORMANCE POR HORARIO');
  lines.push(aggregateTable(report.aggregates.por_faixa_horaria));
  lines.push('');

  lines.push('## PERFORMANCE POR DIA DA SEMANA');
  lines.push(aggregateTable(report.aggregates.por_dia_da_semana));
  lines.push('');

  lines.push('## STORIES');
  lines.push(table(
    ['media_id', 'data', 'hora', 'tipo_story', 'views', 'reach', 'replies', 'shares', 'interactions', 'taps_forward', 'taps_back', 'exits', 'next_story', 'swipe_forward'],
    report.stories.map((story) => [
      story.media_id,
      story.data,
      story.hora,
      story.tipo_story,
      story.views,
      story.reach,
      story.replies,
      story.shares,
      story.total_interactions,
      story.taps_forward,
      story.taps_back,
      story.exits,
      story.next_story,
      story.swipe_forward
    ])
  ));
  lines.push('');

  lines.push('## POSTS');
  lines.push(table(
    ['data', 'media_id', 'media_type', 'slides', 'views', 'reach', 'likes', 'comments', 'shares', 'saves', 'engagement_rate', 'share_rate', 'save_rate', 'comment_rate', 'views_per_reached_account'],
    report.posts.map((item) => [
      item.data_publicacao,
      item.media_id,
      item.media_type,
      item.carousel_slide_count,
      item.views,
      item.reach,
      item.likes,
      item.comments,
      item.shares,
      item.saves,
      percent(item.derived.engagement_rate.percent),
      percent(item.derived.share_rate.percent),
      percent(item.derived.save_rate.percent),
      percent(item.derived.comment_rate.percent),
      round(item.derived.views_per_reached_account.decimal)
    ])
  ));
  lines.push('');

  lines.push('## AUDIENCIA');
  lines.push(table(
    ['metric_name', 'breakdown_name', 'breakdown_value', 'value', 'collected_at'],
    summarizeAudienceRows(report.audience).map((item) => [
      item.metric_name,
      item.breakdown_name,
      item.breakdown_value,
      item.value,
      item.collected_at
    ])
  ));
  lines.push('');

  lines.push('## SNAPSHOTS / CRESCIMENTO DOS REELS');
  for (const curve of report.growth_curves) {
    lines.push(`### ${curve.media_id}`);
    lines.push(table(
      ['collected_at', 'hours_since_publication', 'delta_minutes', 'low_confidence', 'views', 'views_increment', 'views_per_hour', 'reach', 'reach_increment', 'reach_per_hour'],
      curve.snapshots.map((snapshot) => [
        snapshot.collected_at,
        round(snapshot.hours_since_publication),
        round(snapshot.delta_minutes),
        snapshot.velocity_low_confidence,
        snapshot.views,
        snapshot.views_increment,
        round(snapshot.views_per_hour),
        snapshot.reach,
        snapshot.reach_increment,
        round(snapshot.reach_per_hour)
      ])
    ));
    lines.push('');
    lines.push(table(
      ['checkpoint', 'target_hours', 'tolerance_hours', 'collected_at', 'hours_since_publication', 'views', 'reach'],
      curve.checkpoints
        .filter((checkpoint) => checkpoint.collected_at)
        .map((checkpoint) => [
          checkpoint.checkpoint,
          checkpoint.target_hours,
          checkpoint.tolerance_hours,
          checkpoint.collected_at,
          round(checkpoint.hours_since_publication),
          checkpoint.views,
          checkpoint.reach
        ])
    ));
    lines.push('');
  }

  lines.push('## METRICAS CALCULADAS');
  lines.push('- engagement_rate = (likes + comments + saves + shares) / reach');
  lines.push('- share_rate = shares / reach');
  lines.push('- save_rate = saves / reach');
  lines.push('- comment_rate = comments / reach');
  lines.push('- like_rate = likes / reach');
  lines.push('- follow_rate = follows / reach');
  lines.push('- profile_visit_rate = profile_visits / reach');
  lines.push('- profile_to_follow_conversion = follows / profile_visits');
  lines.push('- watch_ratio = average_watch_time / duracao_video_ou_manual');
  lines.push('- views_per_reached_account = views / reach');
  lines.push('- repost_rate = reposts / reach');
  lines.push('- Qualquer indicador sem dados-base suficientes retorna null.');
  lines.push('');

  lines.push('## QUALIDADE DOS DADOS');
  lines.push(table(
    ['entity', 'media_product_type', 'metric', 'status', 'endpoint', 'limitation'],
    report.data_quality.map((item) => [
      item.entity_type,
      item.media_product_type,
      item.metric_name,
      item.status || (item.available ? 'supported' : 'unknown'),
      item.endpoint,
      item.limitations
    ])
  ));
  lines.push('');

  if (options.verbose) {
    lines.push('## DATA QUALITY DETALHADO');
    lines.push(table(
      ['entity', 'entity_id', 'media_product_type', 'metric', 'status', 'endpoint', 'error_code', 'error_message', 'last_updated_at'],
      report.data_quality_detailed.map((item) => [
        item.entity_type,
        item.entity_id,
        item.media_product_type,
        item.metric_name,
        item.status || (item.available ? 'supported' : 'unknown'),
        item.endpoint,
        item.error_code,
        item.error_message,
        item.last_updated_at
      ])
    ));
    lines.push('');
  }

  lines.push('## GROWTH MONITOR DATA');
  lines.push('```json');
  lines.push(JSON.stringify(growthMonitorData(report.follower_growth), null, 2));
  lines.push('```');
  lines.push('');

  lines.push('## ANALYST SUMMARY DATA');
  lines.push('```json');
  lines.push(JSON.stringify(compactSummary(report), null, 2));
  lines.push('```');
  lines.push('');

  return lines.join('\n');
}

function renderGrowthMarkdown(report) {
  const lines = [];
  const growth = report.follower_growth;
  lines.push('# MACACODEV GROWTH MONITOR');
  lines.push('');
  lines.push(`Gerado em: ${formatDateTime(report.generated_at)}`);
  lines.push('');
  lines.push(...renderFollowerGrowthSections(growth));
  lines.push('## LIMITACOES');
  for (const limitation of growth.limitations || []) {
    lines.push(`- ${limitation}`);
  }
  lines.push('');
  lines.push('## GROWTH MONITOR DATA');
  lines.push('```json');
  lines.push(JSON.stringify(growthMonitorData(growth), null, 2));
  lines.push('```');
  lines.push('');
  return lines.join('\n');
}

function renderFollowerGrowthSections(growth) {
  const lines = [];
  if (!growth) return lines;

  lines.push('## FOLLOWER GROWTH');
  const goal = growth.goal || {};
  lines.push(`- seguidores_atuais: ${value(goal.current_followers)}`);
  lines.push(`- meta: ${value(goal.target_followers)}`);
  lines.push(`- faltam: ${value(goal.followers_remaining)}`);
  lines.push(`- percentual_da_meta: ${percent(goal.percentage_completed)}`);
  lines.push(`- seguidores_desde_inicio_do_tracking: ${value(goal.followers_since_tracking_started)}`);
  lines.push('');
  lines.push(table(
    ['janela', 'followers_start', 'followers_end', 'followers_delta', 'elapsed_hours', 'followers_per_hour', 'followers_per_day', 'snapshot_count', 'confidence'],
    Object.values(growth.velocity || {}).map((item) => [
      item.window,
      item.followers_start,
      item.followers_end,
      item.followers_delta,
      round(item.elapsed_hours),
      round(item.followers_per_hour),
      round(item.followers_per_day),
      item.snapshot_count,
      item.confidence
    ])
  ));
  lines.push('');

  lines.push('## FOLLOWER MOMENTUM');
  lines.push(`- status_geral: ${value(growth.momentum?.status)}`);
  lines.push(`- confidence: ${value(growth.momentum?.confidence)}`);
  lines.push(`- thresholds: stable < ${growth.thresholds.stablePercent}%, mild_change ate ${growth.thresholds.mildChangePercent}%, significant_change > ${growth.thresholds.mildChangePercent}%`);
  lines.push('');
  lines.push(table(
    ['janela', 'current_followers_per_hour', 'previous_followers_per_hour', 'absolute_change', 'percentage_change', 'status', 'change_level', 'confidence'],
    ['6h', '12h', '24h'].map((label) => {
      const item = growth.momentum?.[label] || {};
      return [
        label,
        round(item.current_followers_per_hour),
        round(item.previous_followers_per_hour),
        round(item.absolute_change),
        percent(item.percentage_change),
        item.status,
        item.change_level,
        item.confidence
      ];
    })
  ));
  lines.push('');

  lines.push('## META 10K');
  lines.push(`- seguidores_atuais: ${value(goal.current_followers)}`);
  lines.push(`- meta: ${value(goal.target_followers)}`);
  lines.push(`- faltam: ${value(goal.followers_remaining)}`);
  lines.push(`- percentual: ${percent(goal.percentage_completed)}`);
  lines.push('');
  lines.push(table(
    ['base', 'followers_per_day', 'estimated_days_to_10k', 'confidence', 'model'],
    Object.values(growth.projection || {}).map((item) => [
      item.basis,
      round(item.followers_per_day),
      round(item.estimated_days_to_10k),
      item.confidence,
      item.model
    ])
  ));
  lines.push('');

  lines.push('## CRESCIMENTO APOS PUBLICACOES');
  lines.push('Esses dados mostram crescimento da conta apos a publicacao, nao seguidores diretamente atribuidos ao Reel.');
  lines.push('');
  lines.push(table(
    ['tema', 'quadro', 'published_at', 'followers_at_publish', 'followers_6h', 'delta_6h', 'followers_12h', 'delta_12h', 'followers_24h', 'delta_24h', 'followers_48h', 'delta_48h', 'reach_24h', 'views_24h', 'growth_per_1000_reach'],
    (growth.growth_after_publications || [])
      .filter((item) => item.has_sufficient_snapshots)
      .map((item) => [
        item.tema,
        item.quadro,
        item.published_at,
        item.followers_at_publish,
        item.followers_6h,
        item.followers_delta_6h,
        item.followers_12h,
        item.followers_delta_12h,
        item.followers_24h,
        item.followers_delta_24h,
        item.followers_48h,
        item.followers_delta_48h,
        item.reach_24h,
        item.views_24h,
        round(item.growth_after_24h_per_1000_reach)
      ])
  ));
  lines.push('');

  lines.push('## RANKING CRESCIMENTO POS-PUBLICACAO');
  lines.push('Esses dados mostram crescimento da conta apos a publicacao, nao seguidores diretamente atribuidos ao Reel.');
  lines.push('');
  lines.push(table(
    ['tema', 'quadro', 'data', 'followers_delta_6h', 'followers_delta_12h', 'followers_delta_24h', 'followers_delta_48h', 'reach_24h', 'views_24h', 'growth_per_1000_reach'],
    (growth.growth_rankings?.top_reels_por_crescimento_pos_publicacao || []).map((item) => [
      item.tema,
      item.quadro,
      item.data,
      item.followers_delta_6h,
      item.followers_delta_12h,
      item.followers_delta_24h,
      item.followers_delta_48h,
      item.reach_24h,
      item.views_24h,
      round(item.growth_after_24h_per_1000_reach)
    ])
  ));
  lines.push('');

  lines.push('## ULTIMO REEL');
  lines.push(latestReelTable(growth.latest_reel));
  lines.push('');

  lines.push('## COMPARACAO DO ULTIMO REEL COM HISTORICO');
  lines.push(latestReelBaselineTable(growth.latest_reel));
  lines.push('');

  lines.push('## PICOS DE CRESCIMENTO');
  lines.push(table(
    ['start', 'end', 'followers_delta', 'followers_per_hour', 'baseline_per_hour', 'multiplier_vs_baseline', 'recent_content_count'],
    (growth.spikes || []).map((item) => [
      item.start,
      item.end,
      item.followers_delta,
      round(item.followers_per_hour),
      round(item.baseline_per_hour),
      round(item.multiplier_vs_baseline),
      item.recent_content?.length ?? 0
    ])
  ));
  lines.push('');

  lines.push('## HISTORICO DE FOLLOWERS');
  lines.push(table(
    ['timestamp', 'followers_total', 'delta_from_previous', 'elapsed_hours', 'followers_per_hour', 'low_confidence'],
    (growth.history || []).map((item) => [
      item.timestamp,
      item.followers_total,
      item.delta_from_previous,
      round(item.elapsed_hours),
      round(item.followers_per_hour),
      item.low_confidence
    ])
  ));
  lines.push('');

  return lines;
}

function latestReelTable(latest) {
  if (!latest) return '_Sem Reels coletados._';
  return table(
    ['tema', 'quadro', 'media_id', 'idade_horas', 'idade_dias', 'views', 'reach', 'likes', 'comments', 'shares', 'saves', 'followers_at_publish', 'followers_now', 'account_growth_since_publish', 'followers_per_hour_since_publish'],
    [[
      latest.tema,
      latest.quadro,
      latest.media_id,
      round(latest.age_hours),
      round(latest.age_days),
      latest.views,
      latest.reach,
      latest.likes,
      latest.comments,
      latest.shares,
      latest.saves,
      latest.followers_at_publish,
      latest.followers_now,
      latest.account_growth_since_publish,
      round(latest.followers_per_hour_since_publish)
    ]]
  );
}

function latestReelBaselineTable(latest) {
  if (!latest?.baseline_comparison) return '_Sem baseline historico suficiente._';
  return table(
    ['metric', 'latest_value', 'baseline_median', 'ratio', 'status'],
    Object.entries(latest.baseline_comparison).map(([metric, item]) => [
      metric,
      round(item.value),
      round(item.baseline),
      round(item.ratio),
      item.status
    ])
  );
}

function aggregateTable(rows = []) {
  return table(
    ['grupo', 'sample_size', 'sample_warning', 'views_media', 'views_mediana', 'views_min', 'views_max', 'views_stddev', 'reach_medio', 'reach_mediana', 'engagement_rate_medio', 'share_rate_medio', 'save_rate_medio', 'comment_rate_medio', 'like_rate_medio', 'views_per_reached_account_medio', 'follow_rate_medio', 'watch_ratio_medio'],
    rows.map((row) => [
      row.group,
      row.sample_size,
      row.sample_warning,
      round(row.views_media),
      round(row.views_mediana),
      round(row.views_min),
      round(row.views_max),
      round(row.views_stddev),
      round(row.reach_medio),
      round(row.reach_mediana),
      percent(row.engagement_rate_medio == null ? null : row.engagement_rate_medio * 100),
      percent(row.share_rate_medio == null ? null : row.share_rate_medio * 100),
      percent(row.save_rate_medio == null ? null : row.save_rate_medio * 100),
      percent(row.comment_rate_medio == null ? null : row.comment_rate_medio * 100),
      percent(row.like_rate_medio == null ? null : row.like_rate_medio * 100),
      round(row.views_per_reached_account_medio),
      percent(row.follow_rate_medio == null ? null : row.follow_rate_medio * 100),
      percent(row.watch_ratio_medio == null ? null : row.watch_ratio_medio * 100)
    ])
  );
}

function rankingTable(rows = []) {
  return table(
    ['tema', 'tema_source', 'quadro', 'quadro_source', 'media_id', 'data', 'age_hours', 'age_days', 'metric'],
    rows.map((row) => [
      row.tema,
      row.tema_source,
      row.quadro,
      row.quadro_source,
      row.media_id,
      row.data,
      round(row.age_hours),
      round(row.age_days),
      round(row.metric)
    ])
  );
}

function rankingTitle(name) {
  return name.replaceAll('_', ' ').toUpperCase();
}

function compactSummary(report) {
  return {
    account: {
      username: report.account?.username ?? null,
      latest_snapshot: report.latest_account_snapshot,
      growth: report.account_growth,
      follower_growth: growthMonitorData(report.follower_growth),
      derived: report.account_derived
    },
    reels: report.reels.map(summaryContentRow),
    stories: report.stories.map((story) => ({
      media_id: story.media_id,
      data: story.data,
      tipo_story: story.tipo_story,
      views: story.views,
      reach: story.reach,
      replies: story.replies,
      shares: story.shares,
      taps_forward: story.taps_forward,
      taps_back: story.taps_back,
      exits: story.exits
    })),
    posts: report.posts.map(summaryContentRow),
    rankings: report.rankings,
    groups: report.aggregates,
    recent_snapshots: report.growth_curves.map((curve) => ({
      media_id: curve.media_id,
      latest: curve.snapshots.at(-1) ?? null,
      checkpoints: curve.checkpoints.filter((checkpoint) => checkpoint.collected_at)
    }))
  };
}

function growthMonitorData(growth) {
  if (!growth) return null;
  return {
    generated_at: growth.generated_at,
    followers: {
      current: growth.goal?.current_followers ?? null,
      target: growth.goal?.target_followers ?? 10000,
      remaining: growth.goal?.followers_remaining ?? null,
      percentage_completed: growth.goal?.percentage_completed ?? null,
      followers_since_tracking_started: growth.goal?.followers_since_tracking_started ?? null
    },
    velocity: growth.velocity,
    momentum: {
      '6h': growth.momentum?.['6h'] ?? null,
      '12h': growth.momentum?.['12h'] ?? null,
      '24h': growth.momentum?.['24h'] ?? null,
      status: growth.momentum?.status ?? null,
      confidence: growth.momentum?.confidence ?? null
    },
    projection: growth.projection,
    latest_reel: growth.latest_reel
      ? {
          tema: growth.latest_reel.tema,
          quadro: growth.latest_reel.quadro,
          media_id: growth.latest_reel.media_id,
          published_at: growth.latest_reel.published_at,
          age_hours: growth.latest_reel.age_hours,
          views: growth.latest_reel.views,
          reach: growth.latest_reel.reach,
          likes: growth.latest_reel.likes,
          comments: growth.latest_reel.comments,
          shares: growth.latest_reel.shares,
          saves: growth.latest_reel.saves,
          account_growth_since_publish: growth.latest_reel.account_growth_since_publish,
          followers_per_hour_since_publish: growth.latest_reel.followers_per_hour_since_publish,
          baseline_comparison: growth.latest_reel.baseline_comparison
        }
      : null,
    growth_after_publications: (growth.growth_after_publications || [])
      .filter((item) => item.has_sufficient_snapshots)
      .map((item) => ({
        tema: item.tema,
        quadro: item.quadro,
        media_id: item.media_id,
        published_at: item.published_at,
        followers_at_publish: item.followers_at_publish,
        followers_delta_6h: item.followers_delta_6h ?? null,
        followers_delta_12h: item.followers_delta_12h ?? null,
        followers_delta_24h: item.followers_delta_24h ?? null,
        followers_delta_48h: item.followers_delta_48h ?? null,
        reach_24h: item.reach_24h ?? null,
        views_24h: item.views_24h ?? null,
        growth_after_24h_per_1000_reach: item.growth_after_24h_per_1000_reach ?? null,
        growth_metric_source: item.growth_metric_source
      })),
    spikes: growth.spikes
  };
}

function summaryContentRow(item) {
  return {
    media_id: item.media_id,
    published_at: item.timestamp,
    age_days: round(item.age_days),
    tema: item.tema,
    tema_source: item.tema_source,
    quadro: item.quadro,
    quadro_source: item.quadro_source,
    categoria: item.categoria,
    linguagem: item.programming_language,
    media_type: item.media_type,
    media_product_type: item.media_product_type,
    views: item.views,
    reach: item.reach,
    likes: item.likes,
    comments: item.comments,
    shares: item.shares,
    saves: item.saves,
    engagement_rate: item.derived.engagement_rate.decimal,
    share_rate: item.derived.share_rate.decimal,
    save_rate: item.derived.save_rate.decimal,
    views_per_reached_account: item.derived.views_per_reached_account.decimal
  };
}

function table(headers, rows) {
  if (!rows.length) return '_Sem dados coletados._';
  const safeRows = rows.map((row) => row.map(value));
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...safeRows.map((row) => `| ${row.join(' | ')} |`)
  ].join('\n');
}

function isReel(row) {
  return row.media_product_type === 'REELS' || row.media_product_type === 'REEL';
}

function inferPeriod(accountSnapshots, media) {
  const dates = [
    ...(accountSnapshots || []).map((item) => item.collected_at),
    ...(media || []).map((item) => item.timestamp)
  ]
    .filter(Boolean)
    .map((item) => new Date(item))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => a - b);

  return {
    start: dates[0]?.toISOString().slice(0, 10) ?? null,
    end: dates[dates.length - 1]?.toISOString().slice(0, 10) ?? null
  };
}

function normalizeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function value(input) {
  if (input === null || input === undefined || input === '') return 'null';
  return String(input).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function round(input) {
  if (input === null || input === undefined) return null;
  return Math.round(Number(input) * 100) / 100;
}

function percent(input) {
  if (input === null || input === undefined) return 'null';
  return `${round(input)}%`;
}

function formatDateTime(input) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'America/Sao_Paulo'
  }).format(new Date(input));
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}
