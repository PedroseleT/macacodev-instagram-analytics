import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateGrowthCurve,
  calculateAccountGrowth,
  calculateMediaDerivedMetrics,
  divideOrNull,
  expandComplexMetrics,
  metricValue,
  nearestCheckpoints,
  normalizeMetricValues,
  sampleWarning,
  standardDeviation
} from '../src/metrics.js';

test('divideOrNull returns null for missing or zero denominators', () => {
  assert.equal(divideOrNull(10, 0), null);
  assert.equal(divideOrNull(null, 10), null);
  assert.equal(divideOrNull(10, null), null);
  assert.equal(divideOrNull(10, 2), 5);
});

test('derived metrics only calculate when base values exist', () => {
  const metrics = calculateMediaDerivedMetrics({
    likes: 10,
    comments: 2,
    saves: 3,
    shares: 5,
    reach: 100,
    follows: null,
    profile_visits: 20,
    views: 180,
    reposts: 1,
    average_watch_time: 5,
    duracao_video: 10
  });

  assert.equal(metrics.engagement_rate.decimal, 0.2);
  assert.equal(metrics.share_rate.decimal, 0.05);
  assert.equal(metrics.follow_rate.decimal, null);
  assert.equal(metrics.profile_to_follow_conversion.decimal, null);
  assert.equal(metrics.watch_ratio.decimal, 0.5);
  assert.equal(metrics.views_per_reached_account.decimal, 1.8);
});

test('metricValue parses total_value and temporal values', () => {
  assert.equal(metricValue({ total_value: { value: 12 } }), 12);
  assert.equal(metricValue({ total_value: { value: { 0: 3, 1: 4 } } }), 7);
  assert.equal(metricValue({ values: [{ value: 2 }, { value: 3 }] }), 5);
  assert.equal(metricValue({}), null);
});

test('normalizeMetricValues parses breakdown values', () => {
  const values = normalizeMetricValues({
    total_value: {
      breakdowns: [
        {
          dimension_keys: ['country'],
          results: [{ dimension_values: ['BR'], value: 100 }]
        }
      ]
    }
  });

  assert.deepEqual(values, [
    {
      breakdown_name: 'country',
      breakdown_value: 'BR',
      value: 100,
      end_time: null
    }
  ]);
});

test('growth curve calculates deltas and velocities', () => {
  const curve = calculateGrowthCurve([
    { collected_at: '2026-08-30T00:00:00.000Z', views: 100, reach: 80 },
    { collected_at: '2026-08-30T02:00:00.000Z', views: 300, reach: 180 }
  ]);

  assert.equal(curve[0].views_increment, null);
  assert.equal(curve[1].views_increment, 200);
  assert.equal(curve[1].views_per_hour, 100);
  assert.equal(curve[1].reach_per_hour, 50);
  assert.equal(curve[1].views_growth_percent, 200);
});

test('growth curve suppresses low-confidence velocities under ten minutes', () => {
  const curve = calculateGrowthCurve([
    { collected_at: '2026-08-30T00:00:00.000Z', views: 100, reach: 80 },
    { collected_at: '2026-08-30T00:01:00.000Z', views: 102, reach: 81 }
  ]);

  assert.equal(curve[1].delta_minutes, 1);
  assert.equal(curve[1].velocity_low_confidence, true);
  assert.equal(curve[1].views_per_hour, null);
});

test('nearest checkpoints keeps only snapshots inside tolerance', () => {
  const checkpoints = nearestCheckpoints([
    { media_id: 'm1', hours_since_publication: 0.8, collected_at: 'a', views: 10, reach: 8 },
    { media_id: 'm1', hours_since_publication: 6.2, collected_at: 'b', views: 100, reach: 80 }
  ]);

  assert.equal(checkpoints.find((item) => item.checkpoint === '1h').views, 10);
  assert.equal(checkpoints.find((item) => item.checkpoint === '6h').views, 100);
  assert.equal(checkpoints.find((item) => item.checkpoint === '24h').views, null);
});

test('navigation metric expands official action breakdowns', () => {
  const expanded = expandComplexMetrics([
    {
      name: 'navigation',
      total_value: {
        breakdowns: [
          {
            dimension_keys: ['story_navigation_action_type'],
            results: [
              { dimension_values: ['tap_forward'], value: 7 },
              { dimension_values: ['tap_back'], value: 2 },
              { dimension_values: ['tap_exit'], value: 1 }
            ]
          }
        ]
      }
    }
  ]);

  assert.equal(expanded.find((item) => item.name === 'taps_forward').values[0].value, 7);
  assert.equal(expanded.find((item) => item.name === 'taps_back').values[0].value, 2);
  assert.equal(expanded.find((item) => item.name === 'exits').values[0].value, 1);
});

test('demographics parser flattens nested breakdown responses', () => {
  const values = normalizeMetricValues({
    name: 'follower_demographics',
    total_value: {
      breakdowns: [
        {
          dimension_keys: ['age'],
          results: [
            { dimension_values: ['18-24'], value: 123 },
            { dimension_values: ['25-34'], value: 456 }
          ]
        }
      ]
    }
  });

  assert.deepEqual(values.map((item) => item.breakdown_value), ['18-24', '25-34']);
  assert.deepEqual(values.map((item) => item.value), [123, 456]);
});

test('account growth uses local snapshots', () => {
  const growth = calculateAccountGrowth([
    { collected_at: '2026-08-30T00:00:00.000Z', seguidores_total: 100, alcance_total: 200, views: 300 },
    { collected_at: '2026-09-01T00:00:00.000Z', seguidores_total: 130, alcance_total: 500, views: 900 }
  ]);

  assert.equal(growth.seguidores_delta, 30);
  assert.equal(growth.seguidores_por_dia, 15);
  assert.equal(growth.reach_delta, 300);
  assert.equal(growth.views_delta, 600);
});

test('sample warnings and standard deviation are calculated', () => {
  assert.equal(sampleWarning(1), 'amostra insuficiente');
  assert.equal(sampleWarning(3), 'amostra pequena');
  assert.equal(sampleWarning(10), 'amostra utilizavel');
  assert.equal(Math.round(standardDeviation([10, 20, 30]) * 100) / 100, 8.16);
});
