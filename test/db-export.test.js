import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  getCapabilityMap,
  insertAccountSnapshot,
  insertMediaSnapshot,
  listMediaWithoutMetadata,
  openDatabase,
  upsertAccount,
  upsertMetricCapability,
  upsertMedia,
  upsertMediaMetadata
} from '../src/db.js';
import { exportCsv, exportJson, exportMarkdown } from '../src/exporters.js';

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'macacodev-analytics-'));
  return openDatabase(path.join(dir, 'test.sqlite'));
}

test('database stores snapshots without overwriting history', () => {
  const db = tempDb();
  upsertAccount(db, {
    id: 'acct_1',
    username: 'macacodev',
    followers_count: 10,
    media_count: 1
  });

  const firstId = insertAccountSnapshot(db, 'acct_1', {
    collected_at: '2026-08-30T00:00:00.000Z',
    seguidores_total: 10,
    seguidores_ganhos: null,
    seguidores_perdidos: null,
    alcance_total: 100,
    views: 200,
    impressoes: null,
    visitas_ao_perfil: null,
    interacoes_total: 20,
    cliques_no_link: null,
    contas_engajadas: null,
    quantidade_de_conteudos_publicados: 1,
    raw: {}
  });
  const secondId = insertAccountSnapshot(db, 'acct_1', {
    collected_at: '2026-08-31T00:00:00.000Z',
    seguidores_total: 12,
    seguidores_ganhos: 2,
    seguidores_perdidos: 0,
    alcance_total: 150,
    views: 250,
    impressoes: null,
    visitas_ao_perfil: null,
    interacoes_total: 25,
    cliques_no_link: null,
    contas_engajadas: null,
    quantidade_de_conteudos_publicados: 1,
    raw: {}
  });

  assert.notEqual(firstId, secondId);
  const count = db.prepare('SELECT COUNT(*) AS count FROM account_snapshots').get().count;
  assert.equal(count, 2);
});

test('media upsert deduplicates current media and preserves snapshots', () => {
  const db = tempDb();
  upsertAccount(db, { id: 'acct_1', username: 'macacodev' });
  upsertMedia(db, 'acct_1', {
    id: 'media_1',
    media_type: 'VIDEO',
    media_product_type: 'REELS',
    timestamp: '2026-08-30T10:00:00.000Z',
    like_count: 1,
    comments_count: 2
  });
  upsertMedia(db, 'acct_1', {
    id: 'media_1',
    media_type: 'VIDEO',
    media_product_type: 'REELS',
    timestamp: '2026-08-30T10:00:00.000Z',
    like_count: 3,
    comments_count: 4
  });
  insertMediaSnapshot(db, 'media_1', {
    collected_at: '2026-08-30T11:00:00.000Z',
    hours_since_publication: 1,
    views: 100,
    reach: 80,
    likes: 3,
    comments: 4,
    shares: 1,
    saves: 2,
    reposts: null,
    interactions: 10,
    total_interactions: 10,
    watch_time: null,
    total_watch_time: null,
    average_watch_time: null,
    follows: null,
    profile_visits: null,
    raw: {}
  });

  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM media').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM media_snapshots').get().count, 1);
  assert.equal(db.prepare('SELECT like_count FROM media WHERE media_id=?').get('media_1').like_count, 3);
});

test('metadata upsert and exports include manual dimensions', () => {
  const db = tempDb();
  upsertAccount(db, { id: 'acct_1', username: 'macacodev' });
  upsertMedia(db, 'acct_1', {
    id: 'media_1',
    media_type: 'VIDEO',
    media_product_type: 'REELS',
    timestamp: '2026-08-30T10:00:00.000Z'
  });
  upsertMediaMetadata(db, 'media_1', {
    quadro: 'quando_codigo_da_errado',
    tema: 'API',
    tema_source: 'caption_rule',
    usa_humor: true
  }, { source: 'caption_rule' });
  insertMediaSnapshot(db, 'media_1', {
    collected_at: '2026-08-30T11:00:00.000Z',
    hours_since_publication: 1,
    views: 100,
    reach: 80,
    likes: 10,
    comments: 2,
    shares: 4,
    saves: 8,
    reposts: null,
    interactions: 24,
    total_interactions: 24,
    watch_time: null,
    total_watch_time: null,
    average_watch_time: null,
    follows: null,
    profile_visits: null,
    raw: {}
  });

  assert.match(exportMarkdown(db), /quando_codigo_da_errado/);
  assert.match(exportMarkdown(db), /tema_source/);
  assert.match(exportJson(db), /"tema": "API"/);
  assert.match(exportJson(db), /"tema_source": "caption_rule"/);
  assert.match(exportCsv(db), /por_quadro/);
});

test('metadata pending list only returns content missing required dimensions', () => {
  const db = tempDb();
  upsertAccount(db, { id: 'acct_1', username: 'macacodev' });
  upsertMedia(db, 'acct_1', {
    id: 'missing_meta',
    media_type: 'VIDEO',
    media_product_type: 'REELS',
    caption: 'API explicada',
    timestamp: '2026-08-30T10:00:00.000Z'
  });
  upsertMedia(db, 'acct_1', {
    id: 'complete_meta',
    media_type: 'VIDEO',
    media_product_type: 'REELS',
    timestamp: '2026-08-30T09:00:00.000Z'
  });
  upsertMediaMetadata(db, 'complete_meta', {
    tema: 'API',
    quadro: 'programacao_mas_explicada_por_macacos'
  });

  const pending = listMediaWithoutMetadata(db);
  assert.deepEqual(pending.map((item) => item.media_id), ['missing_meta']);
});

test('capability cache deduplicates unsupported metrics by media product type', () => {
  const db = tempDb();
  upsertMetricCapability(db, {
    entity_type: 'story',
    media_product_type: 'STORY',
    metric_name: 'likes',
    endpoint: '/{media-id}/insights',
    status: 'unsupported',
    error_message: 'not supported'
  });
  upsertMetricCapability(db, {
    entity_type: 'story',
    media_product_type: 'STORY',
    metric_name: 'likes',
    endpoint: '/{media-id}/insights',
    status: 'unsupported',
    error_message: 'still not supported'
  });

  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM metric_capabilities').get().count, 1);
  assert.equal(
    getCapabilityMap(db, {
      entityType: 'story',
      mediaProductType: 'STORY',
      endpoint: '/{media-id}/insights'
    }).get('likes'),
    'unsupported'
  );
});

test('markdown export includes rankings, content age and sample warnings', () => {
  const db = tempDb();
  upsertAccount(db, { id: 'acct_1', username: 'macacodev' });
  insertAccountSnapshot(db, 'acct_1', {
    collected_at: '2026-08-30T00:00:00.000Z',
    seguidores_total: 100,
    seguidores_ganhos: null,
    seguidores_perdidos: null,
    alcance_total: 1000,
    views: 2000,
    impressoes: null,
    visitas_ao_perfil: 100,
    interacoes_total: 200,
    cliques_no_link: null,
    contas_engajadas: 150,
    quantidade_de_conteudos_publicados: 1,
    raw: {}
  });
  upsertMedia(db, 'acct_1', {
    id: 'media_rank',
    media_type: 'VIDEO',
    media_product_type: 'REELS',
    timestamp: new Date().toISOString()
  });
  upsertMediaMetadata(db, 'media_rank', {
    quadro: 'programacao_mas_explicada_por_macacos',
    tema: 'API',
    categoria: 'educativo',
    programming_language: 'JavaScript'
  });
  insertMediaSnapshot(db, 'media_rank', {
    collected_at: new Date().toISOString(),
    hours_since_publication: 1,
    views: 1000,
    reach: 500,
    likes: 50,
    comments: 5,
    shares: 25,
    saves: 20,
    reposts: null,
    interactions: 100,
    total_interactions: 100,
    watch_time: null,
    total_watch_time: null,
    average_watch_time: null,
    follows: null,
    profile_visits: null,
    raw: {}
  });

  const markdown = exportMarkdown(db);
  assert.match(markdown, /## RANKINGS/);
  assert.match(markdown, /age_hours/);
  assert.match(markdown, /amostra insuficiente/);
  assert.match(markdown, /## ANALYST SUMMARY DATA/);
});
