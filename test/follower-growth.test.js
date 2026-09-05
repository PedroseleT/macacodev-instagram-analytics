import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildFollowerGrowthMonitor,
  calculateFollowerMomentum,
  calculateFollowerVelocityWindow,
  calculateGoalProjection,
  calculateGrowthAfterPublications,
  calculateFollowerGoal,
  normalizeFollowerSnapshots
} from '../src/followerGrowth.js';
import {
  insertAccountSnapshot,
  insertMediaSnapshot,
  openDatabase,
  upsertAccount,
  upsertMedia,
  upsertMediaMetadata
} from '../src/db.js';
import { exportGrowthMarkdown } from '../src/exporters.js';

function snapshot(collectedAt, followers) {
  return { collected_at: collectedAt, seguidores_total: followers };
}

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'macacodev-growth-'));
  return openDatabase(path.join(dir, 'test.sqlite'));
}

test('follower velocity calculates delta per hour and per day', () => {
  const snapshots = normalizeFollowerSnapshots([
    snapshot('2026-09-01T00:00:00.000Z', 1000),
    snapshot('2026-09-01T03:00:00.000Z', 1030)
  ]);

  const velocity = calculateFollowerVelocityWindow(snapshots, {
    label: '3h',
    hours: 3,
    toleranceHours: 0.25
  });

  assert.equal(velocity.followers_start, 1000);
  assert.equal(velocity.followers_end, 1030);
  assert.equal(velocity.followers_delta, 30);
  assert.equal(velocity.followers_per_hour, 10);
  assert.equal(velocity.followers_per_day, 240);
});

test('follower velocity uses nearest snapshot inside tolerance', () => {
  const snapshots = normalizeFollowerSnapshots([
    snapshot('2026-08-31T23:50:00.000Z', 1000),
    snapshot('2026-09-01T03:00:00.000Z', 1031)
  ]);

  const velocity = calculateFollowerVelocityWindow(snapshots, {
    label: '3h',
    hours: 3,
    toleranceHours: 0.25
  });

  assert.equal(velocity.followers_delta, 31);
  assert.equal(Math.round(velocity.elapsed_hours * 100) / 100, 3.17);
});

test('follower velocity returns nulls when no compatible start snapshot exists', () => {
  const snapshots = normalizeFollowerSnapshots([
    snapshot('2026-09-01T00:00:00.000Z', 1000),
    snapshot('2026-09-01T10:00:00.000Z', 1100)
  ]);

  const velocity = calculateFollowerVelocityWindow(snapshots, {
    label: '3h',
    hours: 3,
    toleranceHours: 0.25
  });

  assert.equal(velocity.followers_delta, null);
  assert.equal(velocity.followers_per_hour, null);
  assert.equal(velocity.confidence, 'low');
});

test('momentum classifies accelerating, stable and decelerating windows', () => {
  const accelerating = normalizeFollowerSnapshots([
    snapshot('2026-09-01T00:00:00.000Z', 1000),
    snapshot('2026-09-01T06:00:00.000Z', 1012),
    snapshot('2026-09-01T12:00:00.000Z', 1048)
  ]);
  const stable = normalizeFollowerSnapshots([
    snapshot('2026-09-01T00:00:00.000Z', 1000),
    snapshot('2026-09-01T06:00:00.000Z', 1030),
    snapshot('2026-09-01T12:00:00.000Z', 1062)
  ]);
  const decelerating = normalizeFollowerSnapshots([
    snapshot('2026-09-01T00:00:00.000Z', 1000),
    snapshot('2026-09-01T06:00:00.000Z', 1048),
    snapshot('2026-09-01T12:00:00.000Z', 1060)
  ]);

  assert.equal(calculateFollowerMomentum(accelerating)['6h'].status, 'accelerating');
  assert.equal(calculateFollowerMomentum(stable)['6h'].status, 'stable');
  assert.equal(calculateFollowerMomentum(decelerating)['6h'].status, 'decelerating');
});

test('goal and projection calculate remaining followers with positive rates only', () => {
  const snapshots = normalizeFollowerSnapshots([
    snapshot('2026-09-01T00:00:00.000Z', 4900),
    snapshot('2026-09-02T00:00:00.000Z', 5000)
  ]);
  const goal = calculateFollowerGoal(snapshots.at(-1), snapshots[0], 10000);
  const projection = calculateGoalProjection(goal.followers_remaining, {
    '24h': { followers_per_day: 100, confidence: 'low' },
    '3d': { followers_per_day: 0, confidence: 'low' },
    '7d': { followers_per_day: -5, confidence: 'low' }
  });

  assert.equal(goal.followers_remaining, 5000);
  assert.equal(goal.percentage_completed, 50);
  assert.equal(projection['24h_rate_days_to_10k'].estimated_days_to_10k, 50);
  assert.equal(projection['3d_rate_days_to_10k'].estimated_days_to_10k, null);
  assert.equal(projection['7d_rate_days_to_10k'].estimated_days_to_10k, null);
});

test('growth after publication calculates account growth without attribution naming', () => {
  const snapshots = normalizeFollowerSnapshots([
    snapshot('2026-09-01T10:00:00.000Z', 5000),
    snapshot('2026-09-01T16:00:00.000Z', 5042),
    snapshot('2026-09-02T10:00:00.000Z', 5120)
  ]);
  const media = [{
    media_id: 'reel_1',
    media_product_type: 'REELS',
    timestamp: '2026-09-01T10:00:00.000Z',
    tema: 'API',
    quadro: 'programacao_mas_explicada_por_macacos'
  }];
  const mediaSnapshots = [{
    media_id: 'reel_1',
    hours_since_publication: 24,
    reach: 8000,
    views: 12000
  }];

  const rows = calculateGrowthAfterPublications({ snapshots, media, mediaSnapshots });

  assert.equal(rows[0].followers_delta_6h, 42);
  assert.equal(rows[0].followers_delta_24h, 120);
  assert.equal(rows[0].growth_after_24h_per_1000_reach, 15);
  assert.equal(rows[0].growth_metric_source, 'derived_proxy');
  assert.equal(Object.hasOwn(rows[0], 'followers_from_reel'), false);
});

test('monitor ranks reels by account growth after publication', () => {
  const snapshots = [
    snapshot('2026-09-01T10:00:00.000Z', 5000),
    snapshot('2026-09-01T16:00:00.000Z', 5020),
    snapshot('2026-09-02T10:00:00.000Z', 5100),
    snapshot('2026-09-03T10:00:00.000Z', 5120)
  ];
  const media = [
    { media_id: 'reel_1', media_product_type: 'REELS', timestamp: '2026-09-01T10:00:00.000Z', tema: 'API' },
    { media_id: 'reel_2', media_product_type: 'REELS', timestamp: '2026-09-02T10:00:00.000Z', tema: 'For' }
  ];

  const monitor = buildFollowerGrowthMonitor({
    accountSnapshots: snapshots,
    media,
    mediaSnapshots: [],
    generatedAt: '2026-09-03T10:00:00.000Z'
  });

  assert.equal(monitor.growth_rankings.top_reels_por_crescimento_pos_publicacao[0].media_id, 'reel_1');
});

test('growth export includes focused monitor sections', () => {
  const db = tempDb();
  upsertAccount(db, { id: 'acct_1', username: 'macacodev', followers_count: 5000 });
  for (const item of [
    snapshot('2026-09-01T00:00:00.000Z', 4900),
    snapshot('2026-09-01T06:00:00.000Z', 4930),
    snapshot('2026-09-01T12:00:00.000Z', 4960),
    snapshot('2026-09-02T00:00:00.000Z', 5000)
  ]) {
    insertAccountSnapshot(db, 'acct_1', {
      collected_at: item.collected_at,
      seguidores_total: item.seguidores_total,
      seguidores_ganhos: null,
      seguidores_perdidos: null,
      alcance_total: null,
      views: null,
      impressoes: null,
      visitas_ao_perfil: null,
      interacoes_total: null,
      cliques_no_link: null,
      contas_engajadas: null,
      quantidade_de_conteudos_publicados: 1,
      raw: {}
    });
  }
  upsertMedia(db, 'acct_1', {
    id: 'media_1',
    media_type: 'VIDEO',
    media_product_type: 'REELS',
    timestamp: '2026-09-01T00:00:00.000Z'
  });
  upsertMediaMetadata(db, 'media_1', { tema: 'API', quadro: 'programacao_mas_explicada_por_macacos' });
  insertMediaSnapshot(db, 'media_1', {
    collected_at: '2026-09-02T00:00:00.000Z',
    hours_since_publication: 24,
    views: 1000,
    reach: 800,
    likes: 100,
    comments: 5,
    shares: 20,
    saves: 30,
    reposts: null,
    interactions: 155,
    total_interactions: 155,
    watch_time: null,
    total_watch_time: null,
    average_watch_time: null,
    follows: null,
    profile_visits: null,
    raw: {}
  });

  const markdown = exportGrowthMarkdown(db);
  assert.match(markdown, /# MACACODEV GROWTH MONITOR/);
  assert.match(markdown, /## FOLLOWER GROWTH/);
  assert.match(markdown, /## META 10K/);
  assert.match(markdown, /## GROWTH MONITOR DATA/);
  assert.doesNotMatch(markdown, /## REELS/);
});
