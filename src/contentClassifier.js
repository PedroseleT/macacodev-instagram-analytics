import {
  contentClassificationRules,
  themeAliases,
  themeSignatureRegex
} from './contentClassificationRules.js';
import { logWarn } from './logger.js';

export function normalizeCaptionForClassification(caption) {
  return String(caption || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizeLookupKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function normalizeTheme(theme, aliases = themeAliases) {
  const trimmed = String(theme || '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;

  const aliasMap = new Map(
    Object.entries(aliases).map(([key, value]) => [normalizeLookupKey(key), value])
  );
  return aliasMap.get(normalizeLookupKey(trimmed)) || trimmed;
}

export function extractThemesFromCaption(caption, options = {}) {
  const regex = new RegExp(options.regex || themeSignatureRegex);
  const matches = [];
  const text = String(caption || '');

  for (const match of text.matchAll(regex)) {
    const captured = cleanThemeCapture(match[1]);
    const normalized = normalizeTheme(captured, options.aliases || themeAliases);
    if (normalized) {
      matches.push({
        raw: captured,
        tema: normalized,
        excerpt: match[0].trim()
      });
    }
  }

  return matches;
}

function cleanThemeCapture(value) {
  return String(value || '')
    .replace(/\s+#.*$/, '')
    .trim()
    .replace(/\s+/g, ' ');
}

export function classifyThemeFromCaption(caption, options = {}) {
  const matches = extractThemesFromCaption(caption, options);
  const uniqueThemes = [...new Set(matches.map((match) => match.tema))];

  if (uniqueThemes.length > 1) {
    logWarn('theme_classification_conflict', {
      matchedThemes: uniqueThemes,
      captionPreview: String(caption || '').slice(0, 160)
    });
    return {
      tema: null,
      tema_source: 'classification_conflict',
      matchedThemes: matches,
      status: 'classification_conflict'
    };
  }

  if (uniqueThemes.length === 1) {
    return {
      tema: uniqueThemes[0],
      tema_source: 'caption_rule',
      matchedThemes: matches,
      status: uniqueThemes[0]
    };
  }

  return {
    tema: null,
    tema_source: 'unknown',
    matchedThemes: [],
    status: 'sem_match'
  };
}

export function classifyCaption(caption, rules = contentClassificationRules) {
  const normalizedCaption = normalizeCaptionForClassification(caption);
  const themeClassification = classifyThemeFromCaption(caption);
  if (!normalizedCaption) {
    return {
      quadro: null,
      quadro_source: 'unknown',
      tema: themeClassification.tema,
      tema_source: themeClassification.tema_source,
      matchedRules: [],
      matchedThemes: themeClassification.matchedThemes,
      status: 'sem_match'
    };
  }

  const matches = rules.filter((rule) =>
    (rule.captionIncludes || []).some((snippet) =>
      normalizedCaption.includes(normalizeCaptionForClassification(snippet))
    )
  );
  const uniqueQuadros = [...new Set(matches.map((rule) => rule.quadro))];

  if (uniqueQuadros.length > 1) {
    logWarn('classification_conflict', {
      matchedQuadros: uniqueQuadros,
      captionPreview: String(caption || '').slice(0, 160)
    });
    return {
      quadro: null,
      quadro_source: 'classification_conflict',
      tema: themeClassification.tema,
      tema_source: themeClassification.tema_source,
      matchedRules: matches,
      matchedThemes: themeClassification.matchedThemes,
      status: 'classification_conflict'
    };
  }

  if (uniqueQuadros.length === 1) {
    return {
      quadro: uniqueQuadros[0],
      quadro_source: 'caption_rule',
      tema: themeClassification.tema,
      tema_source: themeClassification.tema_source,
      matchedRules: matches,
      matchedThemes: themeClassification.matchedThemes,
      status: uniqueQuadros[0]
    };
  }

  return {
    quadro: null,
    quadro_source: 'unknown',
    tema: themeClassification.tema,
    tema_source: themeClassification.tema_source,
    matchedRules: [],
    matchedThemes: themeClassification.matchedThemes,
    status: 'sem_match'
  };
}
