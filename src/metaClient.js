import { config } from './env.js';
import { classifyApiError, logInfo, logWarn } from './logger.js';

export class GraphApiError extends Error {
  constructor(message, response, payload) {
    super(message);
    this.name = 'GraphApiError';
    this.status = response?.status;
    this.payload = payload;
  }
}

function graphUrl(pathname, params = {}, { versioned = true } = {}) {
  const cleanPath = String(pathname).replace(/^\/+/, '');
  const version = versioned && config.meta.graphVersion ? `${config.meta.graphVersion}/` : '';
  const url = new URL(`${config.meta.graphBaseUrl}/${version}${cleanPath}`);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  return url;
}

async function requestJson(url, options = {}) {
  logInfo('meta_api_call', { endpoint: sanitizeUrl(url) });
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.error) {
    const apiMessage = payload.error?.message || response.statusText || 'Erro na Graph API';
    throw new GraphApiError(apiMessage, response, payload);
  }

  return payload;
}

export async function exchangeCodeForShortToken(code) {
  const body = new URLSearchParams({
    client_id: config.meta.instagramAppId,
    client_secret: config.meta.instagramAppSecret,
    grant_type: 'authorization_code',
    redirect_uri: config.meta.redirectUri,
    code
  });

  return requestJson('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
}

export async function exchangeShortForLongToken(shortLivedToken) {
  const url = graphUrl(
    'access_token',
    {
      grant_type: 'ig_exchange_token',
      client_secret: config.meta.instagramAppSecret,
      access_token: shortLivedToken
    },
    { versioned: false }
  );

  return requestJson(url);
}

export function buildInstagramAuthUrl(state) {
  const url = new URL('https://www.instagram.com/oauth/authorize');
  url.searchParams.set('enable_fb_login', '0');
  url.searchParams.set('force_authentication', '1');
  url.searchParams.set('client_id', config.meta.instagramAppId);
  url.searchParams.set('redirect_uri', config.meta.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', config.meta.scopes);
  url.searchParams.set('state', state);
  return url.toString();
}

export async function graphGet(accessToken, pathname, params = {}) {
  const url = graphUrl(pathname, {
    ...params,
    access_token: accessToken
  });

  return requestJson(url);
}

export async function graphPost(accessToken, pathname, body = {}) {
  const url = graphUrl(pathname);
  const payload = new URLSearchParams({
    ...Object.fromEntries(
      Object.entries(body).filter(([, value]) => value !== undefined && value !== null)
    ),
    access_token: accessToken
  });

  return requestJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: payload
  });
}

async function graphGetRawUrl(url) {
  return requestJson(url);
}

export async function getProfile(accessToken) {
  const fieldSets = [
    [
      'id',
      'user_id',
      'username',
      'name',
      'account_type',
      'profile_picture_url',
      'followers_count',
      'follows_count',
      'media_count'
    ],
    ['id', 'user_id', 'username', 'account_type', 'media_count'],
    ['id', 'username']
  ];

  let lastError;

  for (const fields of fieldSets) {
    try {
      return await graphGet(accessToken, 'me', {
        fields: fields.join(',')
      });
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

async function tryInsights(accessToken, instagramUserId, metricGroup, params = {}) {
  try {
    const payload = await graphGet(accessToken, `${instagramUserId}/insights`, {
      metric: metricGroup.join(','),
      ...params
    });

    return {
      ok: true,
      metrics: payload.data || [],
      raw: payload,
      error: null
    };
  } catch (error) {
    logWarn('meta_metric_not_supported', {
      endpoint: `/${instagramUserId}/insights`,
      metrics: metricGroup.join(','),
      reason: classifyApiError(error),
      status: error.status,
      code: error.payload?.error?.code,
      message: error.message
    });
    return {
      ok: false,
      metrics: [],
      error: {
        metrics: metricGroup,
        endpoint: `/${instagramUserId}/insights`,
        statusCategory: insightErrorStatus(error),
        ...normalizeError(error)
      }
    };
  }
}

async function collectInsightMetrics(
  accessToken,
  ownerId,
  groups,
  { params = {}, endpoint = `/${ownerId}/insights`, capabilities = new Map(), metricParams = {} } = {}
) {
  const metrics = [];
  const warnings = [];
  const capabilityEvents = [];
  const rawResponses = [];

  for (const group of groups) {
    const candidates = group.filter((metric) => capabilities.get(metric) !== 'unsupported');
    if (!candidates.length) continue;

    const canBatch = candidates.every((metric) => !metricParams[metric]);
    const result = canBatch
      ? await tryInsights(accessToken, ownerId, candidates, params)
      : null;

    if (result?.ok) {
      metrics.push(...result.metrics);
      rawResponses.push(result.raw);
      for (const metric of candidates) {
        const returned = result.metrics.some((item) => item.name === metric);
        capabilityEvents.push({
          metric,
          status: returned ? 'supported' : 'conditional',
          endpoint,
          raw: returned ? result.metrics.find((item) => item.name === metric) : result.raw
        });
      }
      continue;
    }

    if (result && candidates.length === 1) {
      warnings.push(result.error);
      capabilityEvents.push({
        metric: candidates[0],
        status: result.error.statusCategory,
        endpoint,
        error: result.error
      });
      continue;
    }

    const singles = await Promise.all(
      candidates.map((metric) =>
        tryInsights(accessToken, ownerId, [metric], {
          ...params,
          ...(metricParams[metric] || {})
        })
      )
    );

    for (const single of singles) {
      if (single.ok) {
        metrics.push(...single.metrics);
        rawResponses.push(single.raw);
        const metric = single.metrics[0]?.name || single.raw?.data?.[0]?.name;
        if (metric) {
          capabilityEvents.push({
            metric,
            status: 'supported',
            endpoint,
            raw: single.metrics[0] || single.raw
          });
        }
      } else {
        warnings.push(single.error);
        for (const metric of single.error.metrics || []) {
          capabilityEvents.push({
            metric,
            status: single.error.statusCategory,
            endpoint,
            error: single.error
          });
        }
      }
    }
  }

  return { metrics, warnings, capabilityEvents, rawResponses, endpoint };
}

export async function getAccountInsights(accessToken, instagramUserId, { since, until } = {}) {
  const baseParams = {
    period: 'day',
    metric_type: 'total_value',
    since,
    until
  };

  const groups = [
    ['views', 'reach', 'total_interactions', 'accounts_engaged'],
    ['profile_links_taps']
  ];

  const results = await Promise.all(
    groups.map((metrics) => tryInsights(accessToken, instagramUserId, metrics, baseParams))
  );

  return {
    metrics: results.flatMap((result) => result.metrics),
    warnings: results.filter((result) => !result.ok).map((result) => result.error)
  };
}

export async function getAccountInsightsExpanded(accessToken, instagramUserId, { since, until } = {}) {
  const baseParams = {
    period: 'day',
    metric_type: 'total_value',
    since,
    until
  };
  const groups = [
    ['views', 'reach', 'total_interactions', 'accounts_engaged'],
    ['profile_links_taps'],
    ['profile_views'],
    ['impressions'],
    ['follows_and_unfollows']
  ];

  return collectInsightMetrics(accessToken, instagramUserId, groups, {
    params: baseParams,
    endpoint: `/${instagramUserId}/insights`
  });
}

export async function getAudienceInsights(accessToken, instagramUserId) {
  const demographicMetrics = [
    'follower_demographics',
    'reached_audience_demographics',
    'engaged_audience_demographics'
  ];
  const demographicBreakdowns = ['gender', 'age', 'city', 'country'];
  const attempts = [
    ...demographicMetrics.flatMap((metric) =>
      demographicBreakdowns.flatMap((breakdown) => [
        {
          metrics: [metric],
          params: {
            period: 'lifetime',
            metric_type: 'total_value',
            timeframe: 'last_30_days',
            breakdown
          }
        },
        {
          metrics: [metric],
          params: {
            period: 'lifetime',
            metric_type: 'total_value',
            timeframe: 'last_30_days',
            breakdowns: breakdown
          }
        }
      ])
    ),
    {
      metrics: ['online_followers'],
      params: {
        period: 'lifetime'
      }
    }
  ];

  const results = await Promise.all(
    attempts.map((attempt) => tryInsights(accessToken, instagramUserId, attempt.metrics, attempt.params))
  );

  return summarizeInsightResults(results, `/${instagramUserId}/insights`);
}

export async function getMedia(accessToken, limit = 25) {
  const fieldSets = [
    [
      'id',
      'caption',
      'media_type',
      'media_product_type',
      'media_url',
      'thumbnail_url',
      'permalink',
      'timestamp',
      'like_count',
      'comments_count',
      'duration',
      'children{id,media_type}'
    ],
    [
      'id',
      'caption',
      'media_type',
      'media_product_type',
      'media_url',
      'thumbnail_url',
      'permalink',
      'timestamp',
      'like_count',
      'comments_count',
      'children{id,media_type}'
    ],
    [
      'id',
      'caption',
      'media_type',
      'media_product_type',
      'media_url',
      'thumbnail_url',
      'permalink',
      'timestamp',
      'like_count',
      'comments_count'
    ]
  ];

  let lastError;
  for (const fields of fieldSets) {
    try {
      return await graphGet(accessToken, 'me/media', {
        limit,
        fields: fields.join(',')
      });
    } catch (error) {
      lastError = error;
      logWarn('media_fieldset_failed', {
        reason: classifyApiError(error),
        message: error.message
      });
    }
  }

  throw lastError;
}

export async function getAllMedia(accessToken, limit = 100) {
  const firstPage = await getMedia(accessToken, Math.min(limit, 100));
  const items = [...(firstPage.data || [])];
  let next = firstPage.paging?.next;

  while (next && items.length < limit) {
    const page = await graphGetRawUrl(next);
    items.push(...(page.data || []));
    next = page.paging?.next;
  }

  return {
    data: items.slice(0, limit),
    paging: firstPage.paging
  };
}

export async function getMediaComments(accessToken, mediaId, { limit = 50 } = {}) {
  const pageLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const firstPage = await graphGet(accessToken, `${mediaId}/comments`, {
    limit: pageLimit,
    fields: [
      'id',
      'text',
      'username',
      'timestamp',
      'like_count',
      'replies{id,text,username,timestamp,like_count}'
    ].join(',')
  });

  const items = [...(firstPage.data || [])];
  let next = firstPage.paging?.next;

  while (next && items.length < limit) {
    const page = await graphGetRawUrl(next);
    items.push(...(page.data || []));
    next = page.paging?.next;
  }

  return {
    data: items.slice(0, limit),
    paging: firstPage.paging
  };
}

export async function replyToComment(accessToken, commentId, message) {
  return graphPost(accessToken, `${commentId}/replies`, { message });
}

export async function getMediaInsights(accessToken, mediaId) {
  const groups = [
    ['views', 'reach', 'likes', 'comments', 'saved', 'shares', 'total_interactions']
  ];

  const results = await Promise.all(
    groups.map((metrics) => tryMediaInsights(accessToken, mediaId, metrics))
  );

  return {
    mediaId,
    metrics: results.flatMap((result) => result.metrics),
    warnings: results.filter((result) => !result.ok).map((result) => result.error)
  };
}

export async function getMediaInsightsExpanded(accessToken, mediaId, options = {}) {
  const groups = [
    ['views', 'reach', 'likes', 'comments', 'saved', 'shares', 'total_interactions'],
    ['reposts'],
    ['ig_reels_video_view_total_time', 'ig_reels_avg_watch_time'],
    ['profile_activity', 'profile_visits', 'follows'],
    ['impressions'],
    ['replies'],
    ['navigation'],
    ['link_clicks']
  ];

  return {
    mediaId,
    ...(await collectMediaInsightMetrics(accessToken, mediaId, groups, options))
  };
}

export async function getStories(accessToken, limit = 100) {
  try {
    return await graphGet(accessToken, 'me/stories', {
      limit,
      fields: [
        'id',
        'caption',
        'media_type',
        'media_product_type',
        'media_url',
        'thumbnail_url',
        'permalink',
        'timestamp'
      ].join(',')
    });
  } catch (error) {
    return {
      data: [],
      warnings: [
        {
          metric: 'stories',
          endpoint: '/me/stories',
          error: normalizeError(error)
        }
      ]
    };
  }
}

export async function getStoryInsights(accessToken, storyId, options = {}) {
  const groups = [
    ['views', 'reach', 'likes', 'replies', 'shares', 'total_interactions'],
    ['impressions'],
    ['navigation'],
    ['link_clicks'],
    ['profile_activity']
  ];

  return {
    mediaId: storyId,
    ...(await collectMediaInsightMetrics(accessToken, storyId, groups, {
      ...options,
      metricParams: {
        navigation: { breakdown: 'story_navigation_action_type' },
        ...(options.metricParams || {})
      }
    }))
  };
}

async function collectMediaInsightMetrics(accessToken, mediaId, groups, options = {}) {
  const metrics = [];
  const warnings = [];
  const capabilityEvents = [];
  const rawResponses = [];
  const endpoint = `/${mediaId}/insights`;
  const endpointTemplate = '/{media-id}/insights';
  const capabilities = options.capabilities || new Map();
  const metricParams = options.metricParams || {};

  for (const group of groups) {
    const candidates = group.filter((metric) => capabilities.get(metric) !== 'unsupported');
    if (!candidates.length) continue;

    const canBatch = candidates.every((metric) => !metricParams[metric]);
    const result = canBatch ? await tryMediaInsights(accessToken, mediaId, candidates) : null;

    if (result?.ok) {
      metrics.push(...result.metrics);
      rawResponses.push(result.raw);
      markReturnedCapabilities(capabilityEvents, candidates, result.metrics, endpointTemplate, result.raw);
      continue;
    }

    if (result && candidates.length === 1) {
      warnings.push({ ...result.error, endpoint: endpointTemplate });
      capabilityEvents.push(capabilityEvent(candidates[0], result.error, endpointTemplate));
      continue;
    }

    const singles = await Promise.all(
      candidates.map((metric) =>
        tryMediaInsights(accessToken, mediaId, [metric], metricParams[metric] || {})
      )
    );

    for (const single of singles) {
      if (single.ok) {
        metrics.push(...single.metrics);
        rawResponses.push(single.raw);
        markReturnedCapabilities(
          capabilityEvents,
          single.metrics.map((metric) => metric.name),
          single.metrics,
          endpointTemplate,
          single.raw
        );
      } else {
        warnings.push({ ...single.error, endpoint: endpointTemplate });
        for (const metric of single.error.metrics || []) {
          capabilityEvents.push(capabilityEvent(metric, single.error, endpointTemplate));
        }
      }
    }
  }

  return { metrics, warnings, capabilityEvents, rawResponses, endpoint, endpointTemplate };
}

async function tryMediaInsights(accessToken, mediaId, metricGroup, params = {}) {
  try {
    const payload = await graphGet(accessToken, `${mediaId}/insights`, {
      metric: metricGroup.join(','),
      ...params
    });

    return {
      ok: true,
      metrics: payload.data || [],
      raw: payload,
      error: null
    };
  } catch (error) {
    logWarn('meta_metric_not_supported', {
      endpoint: `/${mediaId}/insights`,
      metrics: metricGroup.join(','),
      reason: classifyApiError(error),
      status: error.status,
      code: error.payload?.error?.code,
      message: error.message
    });
    return {
      ok: false,
      metrics: [],
      error: {
        metrics: metricGroup,
        endpoint: `/${mediaId}/insights`,
        statusCategory: insightErrorStatus(error),
        ...normalizeError(error)
      }
    };
  }
}

function summarizeInsightResults(results, endpoint) {
  return {
    metrics: results.flatMap((result) => result.metrics),
    warnings: results.filter((result) => !result.ok).map((result) => result.error),
    capabilityEvents: results.flatMap((result) =>
      result.ok
        ? (result.metrics || []).map((metric) => ({ metric: metric.name, status: 'supported', endpoint, raw: metric }))
        : (result.error?.metrics || []).map((metric) => ({
            metric,
            status: result.error.statusCategory,
            endpoint,
            error: result.error
          }))
    ),
    rawResponses: results.filter((result) => result.ok).map((result) => result.raw),
    endpoint
  };
}

function markReturnedCapabilities(events, requestedMetrics, returnedMetrics, endpoint, raw) {
  for (const metric of requestedMetrics) {
    const returned = returnedMetrics.find((item) => item.name === metric);
    events.push({
      metric,
      status: returned ? 'supported' : 'conditional',
      endpoint,
      raw: returned || raw
    });
  }
}

function capabilityEvent(metric, error, endpoint) {
  return {
    metric,
    status: error.statusCategory || 'unknown',
    endpoint,
    error
  };
}

function insightErrorStatus(error) {
  const status = error?.status;
  const code = error?.payload?.error?.code;
  const message = String(error?.message || '').toLowerCase();

  if (status === 429 || code === 4 || code === 17 || code === 32) return 'temporary_error';
  if (status >= 500 || message.includes('timeout') || message.includes('temporar')) return 'temporary_error';
  if (code === 10 || code === 200 || message.includes('permission')) return 'permission_error';
  if (
    message.includes('does not support') ||
    message.includes('not available') ||
    message.includes('unsupported') ||
    message.includes('must be one of the following values')
  ) {
    return 'unsupported';
  }
  return 'unknown';
}

function sanitizeUrl(url) {
  const copy = new URL(String(url));
  if (copy.searchParams.has('access_token')) {
    copy.searchParams.set('access_token', '[redacted]');
  }
  if (copy.searchParams.has('client_secret')) {
    copy.searchParams.set('client_secret', '[redacted]');
  }
  return copy.toString();
}

export function normalizeError(error) {
  if (error instanceof GraphApiError) {
    return {
      message: error.message,
      status: error.status,
      code: error.payload?.error?.code,
      type: error.payload?.error?.type,
      details: error.payload?.error
    };
  }

  return {
    message: error?.message || 'Erro inesperado'
  };
}
