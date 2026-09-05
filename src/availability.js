export const metricCatalog = [
  {
    entity: 'account',
    metric: 'seguidores_total',
    apiMetric: 'followers_count',
    endpoint: 'GET /me?fields=followers_count',
    availability: 'available_field',
    limitation: 'Valor atual do perfil; histórico vem dos snapshots locais.'
  },
  {
    entity: 'account',
    metric: 'seguidores_ganhos',
    apiMetric: 'follows_and_unfollows',
    endpoint: 'GET /{ig-user-id}/insights',
    availability: 'conditional',
    limitation: 'Depende de suporte da métrica e breakdown na versão/permissão da API.'
  },
  {
    entity: 'account',
    metric: 'seguidores_perdidos',
    apiMetric: 'follows_and_unfollows',
    endpoint: 'GET /{ig-user-id}/insights',
    availability: 'conditional',
    limitation: 'Depende de suporte da métrica e breakdown na versão/permissão da API.'
  },
  {
    entity: 'account',
    metric: 'alcance_total',
    apiMetric: 'reach',
    endpoint: 'GET /{ig-user-id}/insights',
    availability: 'available_metric',
    limitation: 'Disponibilidade temporal depende do período aceito pela API.'
  },
  {
    entity: 'account',
    metric: 'views',
    apiMetric: 'views',
    endpoint: 'GET /{ig-user-id}/insights',
    availability: 'available_metric',
    limitation: 'Métrica atual da Meta para visualizações em superfícies suportadas.'
  },
  {
    entity: 'account',
    metric: 'impressoes',
    apiMetric: 'impressions',
    endpoint: 'GET /{ig-user-id}/insights',
    availability: 'conditional_or_deprecated',
    limitation: 'Pode não existir em versões recentes; o sistema tenta e registra indisponibilidade.'
  },
  {
    entity: 'account',
    metric: 'visitas_ao_perfil',
    apiMetric: 'profile_views',
    endpoint: 'GET /{ig-user-id}/insights',
    availability: 'conditional',
    limitation: 'Pode aparecer como profile_views na conta e profile_visits em mídia.'
  },
  {
    entity: 'account',
    metric: 'interacoes_total',
    apiMetric: 'total_interactions',
    endpoint: 'GET /{ig-user-id}/insights',
    availability: 'available_metric',
    limitation: 'Conta interações suportadas pela API no período solicitado.'
  },
  {
    entity: 'account',
    metric: 'cliques_no_link',
    apiMetric: 'profile_links_taps',
    endpoint: 'GET /{ig-user-id}/insights',
    availability: 'conditional',
    limitation: 'Disponível quando há links/botões e permissão compatível.'
  },
  {
    entity: 'account',
    metric: 'contas_engajadas',
    apiMetric: 'accounts_engaged',
    endpoint: 'GET /{ig-user-id}/insights',
    availability: 'available_metric',
    limitation: 'Pode retornar vazio quando não houver dados.'
  },
  {
    entity: 'media',
    metric: 'views',
    apiMetric: 'views',
    endpoint: 'GET /{media-id}/insights',
    availability: 'available_metric',
    limitation: 'Substitui métricas antigas como video_views em versões recentes.'
  },
  {
    entity: 'media',
    metric: 'plays',
    apiMetric: null,
    endpoint: 'GET /{media-id}/insights',
    availability: 'unavailable',
    limitation: 'Não foi exposta como métrica separada no fluxo Instagram Login usado aqui.'
  },
  {
    entity: 'media',
    metric: 'reach',
    apiMetric: 'reach',
    endpoint: 'GET /{media-id}/insights',
    availability: 'available_metric',
    limitation: 'Conta alcance único da mídia suportada.'
  },
  {
    entity: 'media',
    metric: 'saves',
    apiMetric: 'saved',
    endpoint: 'GET /{media-id}/insights',
    availability: 'available_metric',
    limitation: 'Nome da API é saved; exportação apresenta saves/salvos.'
  },
  {
    entity: 'media',
    metric: 'reposts',
    apiMetric: 'reposts',
    endpoint: 'GET /{media-id}/insights',
    availability: 'conditional',
    limitation: 'Disponível apenas em tipos/superfícies suportados.'
  },
  {
    entity: 'media',
    metric: 'watch_time',
    apiMetric: 'ig_reels_video_view_total_time',
    endpoint: 'GET /{media-id}/insights',
    availability: 'conditional',
    limitation: 'Voltado a Reels; outros tipos podem retornar métrica não suportada.'
  },
  {
    entity: 'media',
    metric: 'average_watch_time',
    apiMetric: 'ig_reels_avg_watch_time',
    endpoint: 'GET /{media-id}/insights',
    availability: 'conditional',
    limitation: 'Voltado a Reels; exige que a API retorne a métrica.'
  },
  {
    entity: 'media',
    metric: 'retention',
    apiMetric: null,
    endpoint: 'GET /{media-id}/insights',
    availability: 'unavailable',
    limitation: 'Não há curva de retenção granular exposta no endpoint usado.'
  },
  {
    entity: 'media',
    metric: 'audience_followers_vs_non_followers',
    apiMetric: null,
    endpoint: 'GET /{media-id}/insights',
    availability: 'unavailable',
    limitation: 'A API oficial usada não fornece breakdown por seguidores/não seguidores por Reel.'
  },
  {
    entity: 'media',
    metric: 'reach_source',
    apiMetric: null,
    endpoint: 'GET /{media-id}/insights',
    availability: 'unavailable',
    limitation: 'Origem do alcance por reels_tab/explore/feed/profile/other não está exposta nesse fluxo.'
  },
  {
    entity: 'story',
    metric: 'navigation',
    apiMetric: 'navigation',
    endpoint: 'GET /{story-id}/insights',
    availability: 'conditional',
    limitation: 'Pode ser quebrada por ação de navegação quando a API suporta breakdown.'
  },
  {
    entity: 'audience',
    metric: 'demographics',
    apiMetric: 'follower_demographics,reached_audience_demographics,engaged_audience_demographics',
    endpoint: 'GET /{ig-user-id}/insights',
    availability: 'conditional',
    limitation: 'Algumas métricas exigem mínimo de seguidores e retornam vazio quando não há dados.'
  },
  {
    entity: 'audience',
    metric: 'online_followers',
    apiMetric: 'online_followers',
    endpoint: 'GET /{ig-user-id}/insights',
    availability: 'conditional',
    limitation: 'Quando disponível, é preservada como série/valor bruto da API.'
  }
];

export function metricCatalogRows(collectedAt = new Date().toISOString()) {
  return metricCatalog.map((item) => ({
    entity_type: item.entity,
    entity_id: '',
    metric_name: item.metric,
    available: item.availability !== 'unavailable',
    endpoint: item.endpoint,
    last_updated_at: collectedAt,
    limitations: item.limitation,
    error_code: item.availability === 'unavailable' ? 'unavailable_by_api' : null,
    error_message: item.availability === 'unavailable' ? 'Metrica nao exposta pela API oficial usada.' : null
  }));
}
