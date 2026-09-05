import { classifyCaption, classifyThemeFromCaption } from './contentClassifier.js';
import { getMediaMetadata, upsertMediaMetadata } from './db.js';
import { logInfo, logWarn } from './logger.js';

export function applyAutomaticContentClassification(db, media) {
  const mediaId = media.media_id || media.id;
  const existing = getMediaMetadata(db, mediaId);
  const result = {
    status: 'sem_match',
    media_id: mediaId,
    quadro: existing?.quadro ?? null,
    quadro_source: existing?.quadro_source ?? null,
    tema: existing?.tema ?? null,
    tema_source: existing?.tema_source ?? null
  };

  const quadroResult = applyAutomaticQuadroClassification(db, media, existing);
  const themeResult = applyAutomaticThemeClassification(db, media, existing);

  return {
    ...result,
    ...quadroResult,
    tema_status: themeResult.status,
    tema: themeResult.tema,
    tema_source: themeResult.tema_source,
    captured_theme: themeResult.captured_theme,
    caption_excerpt: themeResult.caption_excerpt
  };
}

function applyAutomaticQuadroClassification(db, media, existing) {
  const mediaId = media.media_id || media.id;

  if (existing?.quadro && (existing.quadro_source === 'manual' || !existing.quadro_source)) {
    return { status: 'ignorados_por_metadata_manual', media_id: mediaId, quadro: existing.quadro };
  }

  if (existing?.quadro) {
    return { status: 'ja_classificado', media_id: mediaId, quadro: existing.quadro };
  }

  const classification = classifyCaption(media.caption);
  upsertMediaMetadata(
    db,
    mediaId,
    {
      quadro: classification.quadro,
      quadro_source: classification.quadro_source
    },
    { source: classification.quadro_source }
  );

  return {
    status: classification.status,
    media_id: mediaId,
    quadro: classification.quadro,
    quadro_source: classification.quadro_source
  };
}

export function applyAutomaticThemeClassification(db, media, existingMetadata = null, options = {}) {
  const mediaId = media.media_id || media.id;
  const existing = existingMetadata || getMediaMetadata(db, mediaId);

  if (existing?.tema && (existing.tema_source === 'manual' || !existing.tema_source)) {
    return {
      status: 'ignorados_por_tema_manual',
      media_id: mediaId,
      tema: existing.tema,
      tema_source: existing.tema_source || 'manual'
    };
  }

  const classification = classifyThemeFromCaption(media.caption);
  const firstMatch = classification.matchedThemes?.[0] || null;

  if (classification.tema_source === 'unknown') {
    if (!existing?.tema) {
      upsertMediaMetadata(
        db,
        mediaId,
        {
          tema: null,
          tema_source: 'unknown',
          tema_conflict_options: null
        },
        { source: 'unknown' }
      );
    }
    if (options.logNoMatch) {
      logInfo('theme_classification_no_match', { mediaId });
    }
    return {
      status: 'sem_match',
      media_id: mediaId,
      tema: existing?.tema ?? null,
      tema_source: existing?.tema_source ?? 'unknown',
      captured_theme: null,
      caption_excerpt: null
    };
  }

  if (classification.tema_source === 'classification_conflict') {
    if (!options.dryRun) {
      upsertMediaMetadata(
        db,
        mediaId,
        {
          tema: null,
          tema_source: 'classification_conflict',
          tema_conflict_options: classification.matchedThemes.map((match) => match.tema).join(', ')
        },
        { source: 'classification_conflict' }
      );
    }
    logWarn('theme_classification_conflict_media', {
      mediaId,
      themes: classification.matchedThemes.map((match) => match.tema)
    });
    return {
      status: 'classification_conflict',
      media_id: mediaId,
      tema: null,
      tema_source: 'classification_conflict',
      captured_theme: null,
      caption_excerpt: classification.matchedThemes.map((match) => match.excerpt).join(' | ')
    };
  }

  if (existing?.tema && existing.tema_source === 'caption_rule' && existing.tema !== classification.tema) {
    logInfo('automatic_theme_update', {
      mediaId,
      oldTheme: existing.tema,
      newTheme: classification.tema,
      source: 'caption_rule'
    });
  } else {
    logInfo('automatic_theme_detected', {
      mediaId,
      tema: classification.tema,
      source: 'caption_rule'
    });
  }

  if (!options.dryRun) {
    upsertMediaMetadata(
      db,
      mediaId,
        {
          tema: classification.tema,
          tema_source: 'caption_rule',
          tema_conflict_options: null
        },
      { source: 'caption_rule' }
    );
  }

  return {
    status: classification.status,
    media_id: mediaId,
    tema: classification.tema,
    tema_source: classification.tema_source,
    captured_theme: firstMatch?.tema ?? null,
    caption_excerpt: firstMatch?.excerpt ?? null
  };
}

export function classifyExistingContent(db) {
  const rows = db.prepare(`
    SELECT m.media_id, m.caption
    FROM media m
    LEFT JOIN stories s ON s.media_id = m.media_id
    WHERE s.media_id IS NULL
    ORDER BY m.timestamp DESC
  `).all();

  const summary = {
    programacao_mas_explicada_por_macacos: 0,
    quando_codigo_da_errado: 0,
    sem_match: 0,
    ignorados_por_metadata_manual: 0,
    classification_conflict: 0,
    ja_classificado: 0,
    total: rows.length
  };
  const results = [];

  for (const row of rows) {
    const result = applyAutomaticContentClassification(db, row);
    const key = result.status || 'sem_match';
    summary[key] = (summary[key] || 0) + 1;
    results.push(result);
  }

  return { summary, results };
}

export function classifyExistingThemes(db, options = {}) {
  const rows = db.prepare(`
    SELECT m.media_id, m.caption, mm.tema, mm.tema_source
    FROM media m
    LEFT JOIN stories s ON s.media_id = m.media_id
    LEFT JOIN media_metadata mm ON mm.media_id = m.media_id
    WHERE s.media_id IS NULL
    ORDER BY m.timestamp DESC
  `).all();

  const summary = {
    Boolean: 0,
    API: 0,
    For: 0,
    While: 0,
    'Função': 0,
    Listas: 0,
    'If/Else': 0,
    'Variáveis': 0,
    'Loop infinito': 0,
    outros: 0,
    sem_match: 0,
    ignorados_por_tema_manual: 0,
    classification_conflict: 0,
    total: rows.length
  };
  const results = [];

  for (const row of rows) {
    const result = applyAutomaticThemeClassification(
      db,
      row,
      { tema: row.tema, tema_source: row.tema_source },
      { dryRun: options.dryRun, logNoMatch: true }
    );
    const key = summaryKeyForTheme(result);
    summary[key] = (summary[key] || 0) + 1;
    results.push(result);
  }

  return { summary, results };
}

function summaryKeyForTheme(result) {
  if (result.status === 'ignorados_por_tema_manual') return 'ignorados_por_tema_manual';
  if (result.status === 'classification_conflict') return 'classification_conflict';
  if (result.status === 'sem_match') return 'sem_match';
  return Object.hasOwn({
    Boolean: true,
    API: true,
    For: true,
    While: true,
    'Função': true,
    Listas: true,
    'If/Else': true,
    'Variáveis': true,
    'Loop infinito': true
  }, result.tema) ? result.tema : 'outros';
}
