import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  classifyCaption,
  classifyThemeFromCaption,
  normalizeTheme
} from '../src/contentClassifier.js';
import {
  applyAutomaticContentClassification,
  applyAutomaticThemeClassification,
  classifyExistingContent,
  classifyExistingThemes
} from '../src/contentClassificationService.js';
import { collectInstagramAnalytics } from '../src/collector.js';
import { getMediaMetadata, openDatabase, upsertAccount, upsertMedia, upsertMediaMetadata } from '../src/db.js';

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'macacodev-classifier-'));
  return openDatabase(path.join(dir, 'test.sqlite'));
}

test('classifies Programacao mas explicada por macacos by trusted caption signature', () => {
  const result = classifyCaption(`
    Entendeu? Então o macacodev completou o serviço dele!
    Tema de hoje: Boolean
    SIGA PARA MAIS!
  `);
  assert.equal(result.quadro, 'programacao_mas_explicada_por_macacos');
  assert.equal(result.quadro_source, 'caption_rule');
  assert.equal(result.tema, 'Boolean');
  assert.equal(result.tema_source, 'caption_rule');
});

test('classifies Quando codigo da errado by trusted caption signature', () => {
  const result = classifyCaption('Mais um código quebrado com sucesso 💀🐒');
  assert.equal(result.quadro, 'quando_codigo_da_errado');
});

test('classification tolerates hashtags, line breaks and casing changes', () => {
  const result = classifyCaption(`
    ENTENDEU? então o macacodev completou o serviço dele!

    #programacao #dev
  `);
  assert.equal(result.quadro, 'programacao_mas_explicada_por_macacos');
});

test('classification keeps no-match captions unknown', () => {
  const result = classifyCaption('Resumo das areas de tecnologia para salvar.');
  assert.equal(result.quadro, null);
  assert.equal(result.quadro_source, 'unknown');
  assert.equal(result.status, 'sem_match');
});

test('classification detects conflicts instead of choosing arbitrarily', () => {
  const result = classifyCaption('alpha beta', [
    { quadro: 'um', captionIncludes: ['alpha'] },
    { quadro: 'dois', captionIncludes: ['beta'] }
  ]);

  assert.equal(result.quadro, null);
  assert.equal(result.quadro_source, 'classification_conflict');
});

test('theme extraction supports known aliases and canonical names', () => {
  assert.equal(classifyThemeFromCaption('Tema de hoje: Boolean').tema, 'Boolean');
  assert.equal(classifyThemeFromCaption('Tema de hoje: API').tema, 'API');
  assert.equal(classifyThemeFromCaption('Tema de hoje: If/Else').tema, 'If/Else');
  assert.equal(classifyThemeFromCaption('Tema de hoje: Variáveis').tema, 'Variáveis');
  assert.equal(classifyThemeFromCaption('tema DE hoje:   funcao').tema, 'Função');
  assert.equal(classifyThemeFromCaption('Tema de hoje: if else').tema, 'If/Else');
});

test('theme extraction captures only the signature line and ignores hashtags on the same line', () => {
  const result = classifyThemeFromCaption(`
    Entendeu? Então o macacodev completou o serviço dele!

    Tema de hoje:   API   #programacao #dev

    SIGA PARA MAIS!
  `);

  assert.equal(result.tema, 'API');
  assert.equal(result.tema_source, 'caption_rule');
});

test('theme extraction preserves future themes not present in aliases', () => {
  assert.equal(classifyThemeFromCaption('Tema de hoje: Docker').tema, 'Docker');
});

test('theme extraction keeps no-match captions unknown', () => {
  const result = classifyThemeFromCaption('Resumo das areas de tecnologia para salvar.');
  assert.equal(result.tema, null);
  assert.equal(result.tema_source, 'unknown');
  assert.equal(result.status, 'sem_match');
});

test('theme extraction detects multiple distinct themes as conflict', () => {
  const result = classifyThemeFromCaption(`
    Tema de hoje: API
    Tema de hoje: While
  `);

  assert.equal(result.tema, null);
  assert.equal(result.tema_source, 'classification_conflict');
  assert.deepEqual(result.matchedThemes.map((item) => item.tema), ['API', 'While']);
});

test('theme normalization uses aliases without aggressive guessing', () => {
  assert.equal(normalizeTheme(' api '), 'API');
  assert.equal(normalizeTheme('boolean'), 'Boolean');
  assert.equal(normalizeTheme('if/else'), 'If/Else');
  assert.equal(normalizeTheme('while'), 'While');
  assert.equal(normalizeTheme('Docker Compose'), 'Docker Compose');
});

test('manual metadata is not overwritten by automatic classification', () => {
  const db = tempDb();
  upsertAccount(db, { id: 'acct_1', username: 'macacodev' });
  upsertMedia(db, 'acct_1', {
    id: 'media_manual',
    media_type: 'VIDEO',
    media_product_type: 'REELS',
    caption: 'Entendeu? Então o macacodev completou o serviço dele!'
  });
  upsertMediaMetadata(db, 'media_manual', {
    quadro: 'quadro_manual',
    tema: 'API'
  });

  const result = applyAutomaticContentClassification(db, {
    media_id: 'media_manual',
    caption: 'Mais um código quebrado com sucesso'
  });

  assert.equal(result.status, 'ignorados_por_metadata_manual');
  assert.equal(getMediaMetadata(db, 'media_manual').quadro, 'quadro_manual');
  assert.equal(getMediaMetadata(db, 'media_manual').tema, 'API');
  assert.equal(getMediaMetadata(db, 'media_manual').tema_source, 'manual');
});

test('retroactive classification fills only quadro and preserves other metadata', () => {
  const db = tempDb();
  upsertAccount(db, { id: 'acct_1', username: 'macacodev' });
  upsertMedia(db, 'acct_1', {
    id: 'media_retro',
    media_type: 'VIDEO',
    media_product_type: 'REELS',
    caption: 'Mais um código quebrado com sucesso #dev'
  });
  upsertMediaMetadata(db, 'media_retro', { tema: 'Loop infinito' });

  const result = classifyExistingContent(db);
  const metadata = getMediaMetadata(db, 'media_retro');

  assert.equal(result.summary.quando_codigo_da_errado, 1);
  assert.equal(metadata.quadro, 'quando_codigo_da_errado');
  assert.equal(metadata.quadro_source, 'caption_rule');
  assert.equal(metadata.tema, 'Loop infinito');
  assert.equal(metadata.tema_source, 'manual');
});

test('manual theme metadata is not overwritten by automatic theme classification', () => {
  const db = tempDb();
  upsertAccount(db, { id: 'acct_1', username: 'macacodev' });
  upsertMedia(db, 'acct_1', {
    id: 'theme_manual',
    media_type: 'VIDEO',
    media_product_type: 'REELS',
    caption: 'Tema de hoje: API'
  });
  upsertMediaMetadata(db, 'theme_manual', { tema: 'Boolean' });

  const result = applyAutomaticThemeClassification(db, {
    media_id: 'theme_manual',
    caption: 'Tema de hoje: While'
  });

  const metadata = getMediaMetadata(db, 'theme_manual');
  assert.equal(result.status, 'ignorados_por_tema_manual');
  assert.equal(metadata.tema, 'Boolean');
  assert.equal(metadata.tema_source, 'manual');
});

test('caption-rule theme can update when caption changes to another valid theme', () => {
  const db = tempDb();
  upsertAccount(db, { id: 'acct_1', username: 'macacodev' });
  upsertMedia(db, 'acct_1', {
    id: 'theme_update',
    media_type: 'VIDEO',
    media_product_type: 'REELS',
    caption: 'Tema de hoje: While'
  });
  upsertMediaMetadata(db, 'theme_update', {
    tema: 'While',
    tema_source: 'caption_rule'
  }, { source: 'caption_rule' });

  applyAutomaticThemeClassification(db, {
    media_id: 'theme_update',
    caption: 'Tema de hoje: Loop infinito'
  });

  const metadata = getMediaMetadata(db, 'theme_update');
  assert.equal(metadata.tema, 'Loop infinito');
  assert.equal(metadata.tema_source, 'caption_rule');
});

test('retroactive theme dry-run previews changes without writing', () => {
  const db = tempDb();
  upsertAccount(db, { id: 'acct_1', username: 'macacodev' });
  upsertMedia(db, 'acct_1', {
    id: 'theme_dry_run',
    media_type: 'VIDEO',
    media_product_type: 'REELS',
    caption: 'Tema de hoje: API'
  });

  const result = classifyExistingThemes(db, { dryRun: true });

  assert.equal(result.summary.API, 1);
  assert.equal(getMediaMetadata(db, 'theme_dry_run'), null);
});

test('retroactive theme classification stores detected theme and source', () => {
  const db = tempDb();
  upsertAccount(db, { id: 'acct_1', username: 'macacodev' });
  upsertMedia(db, 'acct_1', {
    id: 'theme_retro',
    media_type: 'VIDEO',
    media_product_type: 'REELS',
    caption: 'Tema de hoje: For'
  });

  const result = classifyExistingThemes(db);
  const metadata = getMediaMetadata(db, 'theme_retro');

  assert.equal(result.summary.For, 1);
  assert.equal(metadata.tema, 'For');
  assert.equal(metadata.tema_source, 'caption_rule');
});

test('collection automatically classifies newly collected media by caption', async () => {
  const db = tempDb();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const text = String(url);
    if (text.includes('/me?fields=')) {
      return jsonResponse({ id: 'acct_1', username: 'macacodev', followers_count: 10, media_count: 1 });
    }
    if (text.includes('/me/media')) {
      return jsonResponse({
        data: [
          {
            id: 'media_collected',
            media_type: 'VIDEO',
            media_product_type: 'REELS',
            caption: 'Entendeu? Então o macacodev completou o serviço dele!\n\nTema de hoje: API',
            timestamp: '2026-08-31T00:00:00.000Z'
          }
        ]
      });
    }
    if (text.includes('/me/stories')) return jsonResponse({ data: [] });
    if (text.includes('/insights')) return jsonResponse({ data: [] });
    return jsonResponse({});
  };

  try {
    await collectInstagramAnalytics('token-test', db, { mediaLimit: 1, storyLimit: 0 });
  } finally {
    globalThis.fetch = originalFetch;
  }

  const metadata = getMediaMetadata(db, 'media_collected');
  assert.equal(metadata.quadro, 'programacao_mas_explicada_por_macacos');
  assert.equal(metadata.quadro_source, 'caption_rule');
  assert.equal(metadata.tema, 'API');
  assert.equal(metadata.tema_source, 'caption_rule');
});

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? 'OK' : 'Error',
    json: async () => payload
  };
}
