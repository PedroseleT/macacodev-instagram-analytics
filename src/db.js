import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './env.js';

function toJson(value) {
  return value === undefined ? null : JSON.stringify(value);
}

function bool(value) {
  if (value === undefined || value === null || value === '') return null;
  return value ? 1 : 0;
}

function nowIso() {
  return new Date().toISOString();
}

export function openDatabase(dbPath = config.databasePath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

export function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      username TEXT,
      name TEXT,
      account_type TEXT,
      profile_picture_url TEXT,
      followers_count INTEGER,
      follows_count INTEGER,
      media_count INTEGER,
      raw_json TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS collection_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      status TEXT NOT NULL,
      media_count INTEGER DEFAULT 0,
      story_count INTEGER DEFAULT 0,
      warnings_json TEXT,
      error_message TEXT,
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    );

    CREATE TABLE IF NOT EXISTS account_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL,
      collected_at TEXT NOT NULL,
      seguidores_total INTEGER,
      seguidores_ganhos INTEGER,
      seguidores_perdidos INTEGER,
      alcance_total INTEGER,
      views INTEGER,
      impressoes INTEGER,
      visitas_ao_perfil INTEGER,
      interacoes_total INTEGER,
      cliques_no_link INTEGER,
      contas_engajadas INTEGER,
      quantidade_de_conteudos_publicados INTEGER,
      raw_json TEXT,
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    );

    CREATE INDEX IF NOT EXISTS idx_account_snapshots_account_collected
      ON account_snapshots(account_id, collected_at);

    CREATE TABLE IF NOT EXISTS account_insight_values (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_snapshot_id INTEGER,
      account_id TEXT NOT NULL,
      metric_name TEXT NOT NULL,
      period TEXT,
      value REAL,
      end_time TEXT,
      breakdown_name TEXT,
      breakdown_value TEXT,
      endpoint TEXT NOT NULL,
      available INTEGER NOT NULL,
      raw_json TEXT,
      collected_at TEXT NOT NULL,
      FOREIGN KEY (account_snapshot_id) REFERENCES account_snapshots(id),
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    );

    CREATE INDEX IF NOT EXISTS idx_account_insights_metric_time
      ON account_insight_values(account_id, metric_name, end_time, collected_at);

    CREATE TABLE IF NOT EXISTS media (
      media_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      permalink TEXT,
      caption TEXT,
      timestamp TEXT,
      data_publicacao TEXT,
      hora_publicacao TEXT,
      media_type TEXT,
      media_product_type TEXT,
      media_url TEXT,
      thumbnail_url TEXT,
      like_count INTEGER,
      comments_count INTEGER,
      duracao_video REAL,
      carousel_slide_count INTEGER,
      raw_json TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    );

    CREATE INDEX IF NOT EXISTS idx_media_account_timestamp ON media(account_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_media_product_type ON media(media_product_type);

    CREATE TABLE IF NOT EXISTS instagram_comments (
      comment_id TEXT PRIMARY KEY,
      media_id TEXT NOT NULL,
      parent_comment_id TEXT,
      text TEXT,
      username TEXT,
      timestamp TEXT,
      like_count INTEGER,
      is_reply INTEGER NOT NULL DEFAULT 0,
      raw_json TEXT,
      collected_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (media_id) REFERENCES media(media_id),
      FOREIGN KEY (parent_comment_id) REFERENCES instagram_comments(comment_id)
    );

    CREATE INDEX IF NOT EXISTS idx_instagram_comments_media
      ON instagram_comments(media_id, timestamp);

    CREATE INDEX IF NOT EXISTS idx_instagram_comments_parent
      ON instagram_comments(parent_comment_id);

    CREATE TABLE IF NOT EXISTS comment_reply_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      comment_id TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL,
      response_comment_id TEXT,
      error_message TEXT,
      raw_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (comment_id) REFERENCES instagram_comments(comment_id)
    );

    CREATE INDEX IF NOT EXISTS idx_comment_reply_actions_comment
      ON comment_reply_actions(comment_id, created_at);

    CREATE TABLE IF NOT EXISTS media_metadata (
      media_id TEXT PRIMARY KEY,
      content_id TEXT,
      tema TEXT,
      tema_source TEXT,
      tema_conflict_options TEXT,
      formato TEXT,
      quadro TEXT,
      quadro_source TEXT,
      categoria TEXT,
      programming_language TEXT,
      hook TEXT,
      cta TEXT,
      duracao_manual REAL,
      usa_macaco INTEGER,
      usa_codigo INTEGER,
      usa_humor INTEGER,
      usa_historia INTEGER,
      usa_analogia INTEGER,
      usa_narracao INTEGER,
      possui_texto_na_tela INTEGER,
      observacoes TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (media_id) REFERENCES media(media_id)
    );

    CREATE INDEX IF NOT EXISTS idx_media_metadata_quadro ON media_metadata(quadro);
    CREATE INDEX IF NOT EXISTS idx_media_metadata_tema ON media_metadata(tema);

    CREATE TABLE IF NOT EXISTS media_insight_values (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      media_id TEXT NOT NULL,
      metric_name TEXT NOT NULL,
      period TEXT,
      value REAL,
      end_time TEXT,
      endpoint TEXT NOT NULL,
      available INTEGER NOT NULL,
      raw_json TEXT,
      collected_at TEXT NOT NULL,
      FOREIGN KEY (media_id) REFERENCES media(media_id)
    );

    CREATE INDEX IF NOT EXISTS idx_media_insights_media_metric
      ON media_insight_values(media_id, metric_name, collected_at);

    CREATE TABLE IF NOT EXISTS media_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      media_id TEXT NOT NULL,
      collected_at TEXT NOT NULL,
      hours_since_publication REAL,
      views REAL,
      reach REAL,
      likes REAL,
      comments REAL,
      shares REAL,
      saves REAL,
      reposts REAL,
      interactions REAL,
      total_interactions REAL,
      watch_time REAL,
      total_watch_time REAL,
      average_watch_time REAL,
      follows REAL,
      profile_visits REAL,
      raw_json TEXT,
      FOREIGN KEY (media_id) REFERENCES media(media_id)
    );

    CREATE INDEX IF NOT EXISTS idx_media_snapshots_media_collected
      ON media_snapshots(media_id, collected_at);

    CREATE TABLE IF NOT EXISTS stories (
      media_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      timestamp TEXT,
      data TEXT,
      hora TEXT,
      tipo_story TEXT,
      raw_json TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (media_id) REFERENCES media(media_id)
    );

    CREATE INDEX IF NOT EXISTS idx_stories_timestamp ON stories(timestamp);

    CREATE TABLE IF NOT EXISTS story_insights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      media_id TEXT NOT NULL,
      metric_name TEXT NOT NULL,
      value REAL,
      period TEXT,
      end_time TEXT,
      endpoint TEXT NOT NULL,
      available INTEGER NOT NULL,
      raw_json TEXT,
      collected_at TEXT NOT NULL,
      FOREIGN KEY (media_id) REFERENCES stories(media_id)
    );

    CREATE INDEX IF NOT EXISTS idx_story_insights_media_metric
      ON story_insights(media_id, metric_name, collected_at);

    CREATE TABLE IF NOT EXISTS posts (
      media_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      media_type TEXT,
      carousel_slide_count INTEGER,
      tema TEXT,
      raw_json TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (media_id) REFERENCES media(media_id)
    );

    CREATE TABLE IF NOT EXISTS audience_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL,
      collected_at TEXT NOT NULL,
      metric_name TEXT NOT NULL,
      breakdown_name TEXT,
      breakdown_value TEXT,
      value REAL,
      endpoint TEXT NOT NULL,
      available INTEGER NOT NULL,
      raw_json TEXT,
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    );

    CREATE INDEX IF NOT EXISTS idx_audience_account_metric
      ON audience_snapshots(account_id, metric_name, collected_at);

    CREATE TABLE IF NOT EXISTS data_quality (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      metric_name TEXT NOT NULL,
      available INTEGER NOT NULL,
      endpoint TEXT NOT NULL,
      last_updated_at TEXT NOT NULL,
      limitations TEXT,
      error_code TEXT,
      error_message TEXT,
      UNIQUE(entity_type, entity_id, metric_name, endpoint)
    );

    CREATE TABLE IF NOT EXISTS metric_capabilities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      media_product_type TEXT NOT NULL DEFAULT '',
      metric_name TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      api_version TEXT NOT NULL,
      status TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_checked_at TEXT NOT NULL,
      error_code TEXT,
      error_message TEXT,
      raw_response_json TEXT,
      UNIQUE(entity_type, media_product_type, metric_name, endpoint, api_version)
    );

    CREATE INDEX IF NOT EXISTS idx_metric_capabilities_lookup
      ON metric_capabilities(entity_type, media_product_type, api_version, metric_name);
  `);

  addColumnIfMissing(db, 'data_quality', 'status', 'TEXT');
  addColumnIfMissing(db, 'data_quality', 'first_seen_at', 'TEXT');
  addColumnIfMissing(db, 'data_quality', 'api_version', 'TEXT');
  addColumnIfMissing(db, 'data_quality', 'media_product_type', 'TEXT');
  addColumnIfMissing(db, 'data_quality', 'raw_response_json', 'TEXT');
  addColumnIfMissing(db, 'media_metadata', 'quadro_source', 'TEXT');
  addColumnIfMissing(db, 'media_metadata', 'tema_source', 'TEXT');
  addColumnIfMissing(db, 'media_metadata', 'tema_conflict_options', 'TEXT');
}

export function upsertAccount(db, profile) {
  db.prepare(`
    INSERT INTO accounts (
      id, username, name, account_type, profile_picture_url, followers_count,
      follows_count, media_count, raw_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      username=excluded.username,
      name=excluded.name,
      account_type=excluded.account_type,
      profile_picture_url=excluded.profile_picture_url,
      followers_count=excluded.followers_count,
      follows_count=excluded.follows_count,
      media_count=excluded.media_count,
      raw_json=excluded.raw_json,
      updated_at=excluded.updated_at
  `).run(
    profile.id,
    profile.username ?? null,
    profile.name ?? null,
    profile.account_type ?? null,
    profile.profile_picture_url ?? null,
    profile.followers_count ?? null,
    profile.follows_count ?? null,
    profile.media_count ?? null,
    toJson(profile),
    nowIso()
  );
}

export function createCollectionRun(db, accountId = null) {
  const result = db
    .prepare('INSERT INTO collection_runs (account_id, started_at, status) VALUES (?, ?, ?)')
    .run(accountId, nowIso(), 'running');
  return Number(result.lastInsertRowid);
}

export function finishCollectionRun(db, runId, values) {
  db.prepare(`
    UPDATE collection_runs
    SET account_id=?, ended_at=?, status=?, media_count=?, story_count=?, warnings_json=?, error_message=?
    WHERE id=?
  `).run(
    values.accountId ?? null,
    nowIso(),
    values.status,
    values.mediaCount ?? 0,
    values.storyCount ?? 0,
    toJson(values.warnings || []),
    values.errorMessage ?? null,
    runId
  );
}

export function insertAccountSnapshot(db, accountId, snapshot) {
  const result = db.prepare(`
    INSERT INTO account_snapshots (
      account_id, collected_at, seguidores_total, seguidores_ganhos, seguidores_perdidos,
      alcance_total, views, impressoes, visitas_ao_perfil, interacoes_total,
      cliques_no_link, contas_engajadas, quantidade_de_conteudos_publicados, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    accountId,
    snapshot.collected_at,
    snapshot.seguidores_total,
    snapshot.seguidores_ganhos,
    snapshot.seguidores_perdidos,
    snapshot.alcance_total,
    snapshot.views,
    snapshot.impressoes,
    snapshot.visitas_ao_perfil,
    snapshot.interacoes_total,
    snapshot.cliques_no_link,
    snapshot.contas_engajadas,
    snapshot.quantidade_de_conteudos_publicados,
    toJson(snapshot.raw)
  );
  return Number(result.lastInsertRowid);
}

export function insertInsightValues(db, table, rows) {
  const statement = db.prepare(`
    INSERT INTO ${table} (
      ${table === 'account_insight_values' ? 'account_snapshot_id, account_id,' : ''}
      ${table === 'media_insight_values' || table === 'story_insights' ? 'media_id,' : ''}
      metric_name, period, value, end_time,
      ${table === 'account_insight_values' ? 'breakdown_name, breakdown_value,' : ''}
      endpoint, available, raw_json, collected_at
    ) VALUES (
      ${table === 'account_insight_values' ? '?, ?,' : ''}
      ${table === 'media_insight_values' || table === 'story_insights' ? '?,' : ''}
      ?, ?, ?, ?,
      ${table === 'account_insight_values' ? '?, ?,' : ''}
      ?, ?, ?, ?
    )
  `);

  for (const row of rows) {
    if (table === 'account_insight_values') {
      statement.run(
        row.accountSnapshotId,
        row.accountId,
        row.metric_name,
        row.period ?? null,
        row.value ?? null,
        row.end_time ?? null,
        row.breakdown_name ?? null,
        row.breakdown_value ?? null,
        row.endpoint,
        row.available ? 1 : 0,
        toJson(row.raw),
        row.collected_at
      );
    } else {
      statement.run(
        row.media_id,
        row.metric_name,
        row.period ?? null,
        row.value ?? null,
        row.end_time ?? null,
        row.endpoint,
        row.available ? 1 : 0,
        toJson(row.raw),
        row.collected_at
      );
    }
  }
}

export function upsertMedia(db, accountId, media, { includePost = true } = {}) {
  const published = splitTimestamp(media.timestamp);
  const carouselCount = Array.isArray(media.children?.data) ? media.children.data.length : null;
  db.prepare(`
    INSERT INTO media (
      media_id, account_id, permalink, caption, timestamp, data_publicacao, hora_publicacao,
      media_type, media_product_type, media_url, thumbnail_url, like_count, comments_count,
      duracao_video, carousel_slide_count, raw_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(media_id) DO UPDATE SET
      account_id=excluded.account_id,
      permalink=excluded.permalink,
      caption=excluded.caption,
      timestamp=excluded.timestamp,
      data_publicacao=excluded.data_publicacao,
      hora_publicacao=excluded.hora_publicacao,
      media_type=excluded.media_type,
      media_product_type=excluded.media_product_type,
      media_url=excluded.media_url,
      thumbnail_url=excluded.thumbnail_url,
      like_count=excluded.like_count,
      comments_count=excluded.comments_count,
      duracao_video=excluded.duracao_video,
      carousel_slide_count=excluded.carousel_slide_count,
      raw_json=excluded.raw_json,
      updated_at=excluded.updated_at
  `).run(
    media.id,
    accountId,
    media.permalink ?? null,
    media.caption ?? null,
    media.timestamp ?? null,
    published.date,
    published.time,
    media.media_type ?? null,
    media.media_product_type ?? null,
    media.media_url ?? null,
    media.thumbnail_url ?? null,
    media.like_count ?? null,
    media.comments_count ?? null,
    media.duration ?? null,
    carouselCount,
    toJson(media),
    nowIso()
  );

  if (
    includePost &&
    (media.media_type === 'CAROUSEL_ALBUM' || media.media_type === 'IMAGE' || media.media_type === 'VIDEO')
  ) {
    db.prepare(`
      INSERT INTO posts (media_id, account_id, media_type, carousel_slide_count, raw_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(media_id) DO UPDATE SET
        media_type=excluded.media_type,
        carousel_slide_count=excluded.carousel_slide_count,
        raw_json=excluded.raw_json,
        updated_at=excluded.updated_at
    `).run(media.id, accountId, media.media_type ?? null, carouselCount, toJson(media), nowIso());
  }
}

export function upsertStory(db, accountId, story) {
  const published = splitTimestamp(story.timestamp);
  db.prepare(`
    INSERT INTO stories (media_id, account_id, timestamp, data, hora, raw_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(media_id) DO UPDATE SET
      timestamp=excluded.timestamp,
      data=excluded.data,
      hora=excluded.hora,
      raw_json=excluded.raw_json,
      updated_at=excluded.updated_at
  `).run(story.id, accountId, story.timestamp ?? null, published.date, published.time, toJson(story), nowIso());
}

export function getMediaMetadata(db, mediaId) {
  return db.prepare('SELECT * FROM media_metadata WHERE media_id=?').get(mediaId) || null;
}

export function upsertMediaMetadata(db, mediaId, metadata, options = {}) {
  const source = options.source || 'manual';
  const existing = getMediaMetadata(db, mediaId) || {};
  const merged = mergeMetadata(existing, metadata, source);

  db.prepare(`
    INSERT INTO media_metadata (
      media_id, content_id, tema, tema_source, tema_conflict_options, formato, quadro, quadro_source, categoria, programming_language,
      hook, cta, duracao_manual, usa_macaco, usa_codigo, usa_humor, usa_historia,
      usa_analogia, usa_narracao, possui_texto_na_tela, observacoes, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(media_id) DO UPDATE SET
      content_id=excluded.content_id,
      tema=excluded.tema,
      tema_source=excluded.tema_source,
      tema_conflict_options=excluded.tema_conflict_options,
      formato=excluded.formato,
      quadro=excluded.quadro,
      quadro_source=excluded.quadro_source,
      categoria=excluded.categoria,
      programming_language=excluded.programming_language,
      hook=excluded.hook,
      cta=excluded.cta,
      duracao_manual=excluded.duracao_manual,
      usa_macaco=excluded.usa_macaco,
      usa_codigo=excluded.usa_codigo,
      usa_humor=excluded.usa_humor,
      usa_historia=excluded.usa_historia,
      usa_analogia=excluded.usa_analogia,
      usa_narracao=excluded.usa_narracao,
      possui_texto_na_tela=excluded.possui_texto_na_tela,
      observacoes=excluded.observacoes,
      updated_at=excluded.updated_at
  `).run(
    mediaId,
    merged.content_id ?? null,
    merged.tema ?? null,
    merged.tema_source ?? null,
    merged.tema_conflict_options ?? null,
    merged.formato ?? null,
    merged.quadro ?? null,
    merged.quadro_source ?? null,
    merged.categoria ?? null,
    merged.programming_language ?? null,
    merged.hook ?? null,
    merged.cta ?? null,
    merged.duracao_manual ?? null,
    bool(merged.usa_macaco),
    bool(merged.usa_codigo),
    bool(merged.usa_humor),
    bool(merged.usa_historia),
    bool(merged.usa_analogia),
    bool(merged.usa_narracao),
    bool(merged.possui_texto_na_tela),
    merged.observacoes ?? null,
    nowIso()
  );
}

function mergeMetadata(existing, metadata, source) {
  const merged = { ...existing };
  for (const key of Object.keys(metadata || {})) {
    merged[key] = metadata[key];
  }

  if (Object.hasOwn(metadata || {}, 'quadro')) {
    merged.quadro_source = metadata.quadro_source || (source === 'manual' ? 'manual' : source);
  } else if (Object.hasOwn(metadata || {}, 'quadro_source')) {
    merged.quadro_source = metadata.quadro_source;
  }

  if (Object.hasOwn(metadata || {}, 'tema')) {
    merged.tema_source = metadata.tema_source || (source === 'manual' ? 'manual' : source);
    if (!Object.hasOwn(metadata || {}, 'tema_conflict_options')) {
      merged.tema_conflict_options = null;
    }
  } else if (Object.hasOwn(metadata || {}, 'tema_source')) {
    merged.tema_source = metadata.tema_source;
  }

  return merged;
}

export function updateStoryMetadata(db, mediaId, metadata) {
  db.prepare('UPDATE stories SET tipo_story=?, updated_at=? WHERE media_id=?').run(
    metadata.tipo_story ?? null,
    nowIso(),
    mediaId
  );
}

export function listMediaWithoutMetadata(db) {
  return db.prepare(`
    SELECT m.media_id, m.timestamp, m.data_publicacao, m.hora_publicacao,
      m.media_type, m.media_product_type, m.caption, m.permalink,
      mm.quadro, mm.quadro_source, mm.tema, mm.tema_source, mm.tema_conflict_options
    FROM media m
    LEFT JOIN media_metadata mm ON mm.media_id = m.media_id
    LEFT JOIN stories s ON s.media_id = m.media_id
    WHERE s.media_id IS NULL
      AND (
        mm.media_id IS NULL
        OR mm.tema IS NULL
        OR mm.quadro IS NULL
      )
    ORDER BY m.timestamp DESC
  `).all();
}

export function listStoriesWithoutMetadata(db) {
  return db.prepare(`
    SELECT media_id, timestamp, data, hora, tipo_story, raw_json
    FROM stories
    WHERE tipo_story IS NULL OR tipo_story = ''
    ORDER BY timestamp DESC
  `).all();
}

export function listCommentableMedia(db, limit = 25) {
  return db.prepare(`
    SELECT m.media_id, m.caption, m.timestamp, m.media_type, m.media_product_type, m.permalink
    FROM media m
    LEFT JOIN stories s ON s.media_id = m.media_id
    WHERE s.media_id IS NULL
    ORDER BY m.timestamp DESC
    LIMIT ?
  `).all(Math.min(Math.max(Number(limit) || 25, 1), 100));
}

export function upsertInstagramComment(db, mediaId, comment, options = {}) {
  const collectedAt = options.collectedAt || nowIso();
  const parentCommentId = options.parentCommentId ?? null;
  const isReply = parentCommentId ? 1 : 0;

  db.prepare(`
    INSERT INTO instagram_comments (
      comment_id, media_id, parent_comment_id, text, username, timestamp,
      like_count, is_reply, raw_json, collected_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(comment_id) DO UPDATE SET
      media_id=excluded.media_id,
      parent_comment_id=excluded.parent_comment_id,
      text=excluded.text,
      username=excluded.username,
      timestamp=excluded.timestamp,
      like_count=excluded.like_count,
      is_reply=excluded.is_reply,
      raw_json=excluded.raw_json,
      collected_at=excluded.collected_at,
      updated_at=excluded.updated_at
  `).run(
    comment.id,
    mediaId,
    parentCommentId,
    comment.text ?? null,
    comment.username ?? null,
    comment.timestamp ?? null,
    comment.like_count ?? null,
    isReply,
    toJson(comment),
    collectedAt,
    nowIso()
  );
}

export function upsertInstagramComments(db, mediaId, comments, options = {}) {
  const collectedAt = options.collectedAt || nowIso();
  let stored = 0;
  let replies = 0;

  for (const comment of comments || []) {
    if (!comment?.id) continue;
    upsertInstagramComment(db, mediaId, comment, { collectedAt });
    stored += 1;

    for (const reply of comment.replies?.data || []) {
      if (!reply?.id) continue;
      upsertInstagramComment(db, mediaId, reply, {
        collectedAt,
        parentCommentId: comment.id
      });
      replies += 1;
    }
  }

  return { stored, replies };
}

export function listInstagramComments(db, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 200);
  const onlyPending = options.onlyPending !== false;
  const rows = db.prepare(`
    SELECT
      c.comment_id,
      c.media_id,
      c.parent_comment_id,
      c.text,
      c.username,
      c.timestamp,
      c.like_count,
      c.is_reply,
      c.collected_at,
      m.caption AS media_caption,
      m.permalink,
      m.timestamp AS media_timestamp,
      mm.tema,
      mm.quadro,
      (
        SELECT COUNT(*)
        FROM instagram_comments child
        WHERE child.parent_comment_id = c.comment_id
      ) AS replies_count,
      (
        SELECT COUNT(*)
        FROM comment_reply_actions action
        WHERE action.comment_id = c.comment_id
          AND action.status = 'sent'
      ) AS sent_reply_count,
      (
        SELECT action.message
        FROM comment_reply_actions action
        WHERE action.comment_id = c.comment_id
          AND action.status = 'sent'
        ORDER BY action.created_at DESC
        LIMIT 1
      ) AS last_sent_reply
    FROM instagram_comments c
    JOIN media m ON m.media_id = c.media_id
    LEFT JOIN media_metadata mm ON mm.media_id = c.media_id
    WHERE c.is_reply = 0
      AND (? = 0 OR NOT EXISTS (
        SELECT 1
        FROM comment_reply_actions action
        WHERE action.comment_id = c.comment_id
          AND action.status = 'sent'
      ))
    ORDER BY c.timestamp DESC, c.collected_at DESC
    LIMIT ?
  `).all(onlyPending ? 1 : 0, limit);

  return rows.map((row) => ({
    ...row,
    is_reply: Boolean(row.is_reply),
    replies_count: Number(row.replies_count) || 0,
    sent_reply_count: Number(row.sent_reply_count) || 0
  }));
}

export function getInstagramComment(db, commentId) {
  return db.prepare('SELECT * FROM instagram_comments WHERE comment_id=?').get(commentId) || null;
}

export function insertCommentReplyAction(db, action) {
  const result = db.prepare(`
    INSERT INTO comment_reply_actions (
      comment_id, message, status, response_comment_id, error_message, raw_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    action.comment_id,
    action.message,
    action.status,
    action.response_comment_id ?? null,
    action.error_message ?? null,
    toJson(action.raw ?? null),
    action.created_at || nowIso()
  );
  return Number(result.lastInsertRowid);
}

export function insertMediaSnapshot(db, mediaId, snapshot) {
  db.prepare(`
    INSERT INTO media_snapshots (
      media_id, collected_at, hours_since_publication, views, reach, likes, comments,
      shares, saves, reposts, interactions, total_interactions, watch_time,
      total_watch_time, average_watch_time, follows, profile_visits, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    mediaId,
    snapshot.collected_at,
    snapshot.hours_since_publication,
    snapshot.views,
    snapshot.reach,
    snapshot.likes,
    snapshot.comments,
    snapshot.shares,
    snapshot.saves,
    snapshot.reposts,
    snapshot.interactions,
    snapshot.total_interactions,
    snapshot.watch_time,
    snapshot.total_watch_time,
    snapshot.average_watch_time,
    snapshot.follows,
    snapshot.profile_visits,
    toJson(snapshot.raw)
  );
}

export function insertAudienceRows(db, rows) {
  const statement = db.prepare(`
    INSERT INTO audience_snapshots (
      account_id, collected_at, metric_name, breakdown_name, breakdown_value,
      value, endpoint, available, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const row of rows) {
    statement.run(
      row.account_id,
      row.collected_at,
      row.metric_name,
      row.breakdown_name ?? null,
      row.breakdown_value ?? null,
      row.value ?? null,
      row.endpoint,
      row.available ? 1 : 0,
      toJson(row.raw)
    );
  }
}

export function upsertDataQuality(db, row) {
  db.prepare(`
    INSERT INTO data_quality (
      entity_type, entity_id, metric_name, available, endpoint, last_updated_at,
      limitations, error_code, error_message, status, first_seen_at, api_version,
      media_product_type, raw_response_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(entity_type, entity_id, metric_name, endpoint) DO UPDATE SET
      available=excluded.available,
      last_updated_at=excluded.last_updated_at,
      limitations=excluded.limitations,
      error_code=excluded.error_code,
      error_message=excluded.error_message,
      status=excluded.status,
      api_version=excluded.api_version,
      media_product_type=excluded.media_product_type,
      raw_response_json=excluded.raw_response_json
  `).run(
    row.entity_type,
    row.entity_id ?? '',
    row.metric_name,
    row.available ? 1 : 0,
    row.endpoint,
    nowIso(),
    row.limitations ?? null,
    row.error_code ?? null,
    row.error_message ?? null,
    row.status ?? (row.available ? 'supported' : 'unknown'),
    row.first_seen_at ?? nowIso(),
    row.api_version ?? config.meta.graphVersion,
    row.media_product_type ?? null,
    toJson(row.raw_response ?? null)
  );
}

export function getCapabilityMap(db, { entityType, mediaProductType = '', endpoint, apiVersion = config.meta.graphVersion }) {
  const rows = db.prepare(`
    SELECT metric_name, status
    FROM metric_capabilities
    WHERE entity_type=?
      AND media_product_type=?
      AND endpoint=?
      AND api_version=?
  `).all(entityType, mediaProductType || '', endpoint, apiVersion);
  return new Map(rows.map((row) => [row.metric_name, row.status]));
}

export function upsertMetricCapability(db, row) {
  const checkedAt = row.checked_at ?? nowIso();
  db.prepare(`
    INSERT INTO metric_capabilities (
      entity_type, media_product_type, metric_name, endpoint, api_version,
      status, first_seen_at, last_checked_at, error_code, error_message, raw_response_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(entity_type, media_product_type, metric_name, endpoint, api_version)
    DO UPDATE SET
      status=excluded.status,
      last_checked_at=excluded.last_checked_at,
      error_code=excluded.error_code,
      error_message=excluded.error_message,
      raw_response_json=excluded.raw_response_json
  `).run(
    row.entity_type,
    row.media_product_type ?? '',
    row.metric_name,
    row.endpoint,
    row.api_version ?? config.meta.graphVersion,
    row.status,
    row.first_seen_at ?? checkedAt,
    checkedAt,
    row.error_code ?? null,
    row.error_message ?? null,
    toJson(row.raw_response ?? null)
  );
}

export function getLatestAccount(db) {
  return db.prepare('SELECT * FROM accounts ORDER BY updated_at DESC LIMIT 1').get();
}

export function getExportData(db, { accountId } = {}) {
  const account =
    accountId
      ? db.prepare('SELECT * FROM accounts WHERE id=?').get(accountId)
      : getLatestAccount(db);

  if (!account) {
    return {
      account: null,
      accountSnapshots: [],
      media: [],
      stories: [],
      audience: [],
      dataQuality: []
    };
  }

  const media = db.prepare(`
    SELECT
      m.*,
      mm.content_id,
      mm.tema,
      mm.tema_source,
      mm.tema_conflict_options,
      mm.formato,
      mm.quadro,
      mm.quadro_source,
      mm.categoria,
      mm.programming_language,
      mm.hook,
      mm.cta,
      mm.duracao_manual,
      mm.usa_macaco,
      mm.usa_codigo,
      mm.usa_humor,
      mm.usa_historia,
      mm.usa_analogia,
      mm.usa_narracao,
      mm.possui_texto_na_tela,
      mm.observacoes,
      ms.views,
      ms.reach,
      ms.likes,
      ms.comments,
      ms.shares,
      ms.saves,
      ms.reposts,
      ms.interactions,
      ms.total_interactions,
      ms.watch_time,
      ms.total_watch_time,
      ms.average_watch_time,
      ms.follows,
      ms.profile_visits,
      ms.hours_since_publication,
      ms.collected_at AS snapshot_collected_at
    FROM media m
    LEFT JOIN media_metadata mm ON mm.media_id = m.media_id
    LEFT JOIN media_snapshots ms ON ms.id = (
      SELECT id FROM media_snapshots WHERE media_id = m.media_id ORDER BY collected_at DESC LIMIT 1
    )
    WHERE m.account_id=?
    ORDER BY m.timestamp DESC
  `).all(account.id);

  return {
    account,
    accountSnapshots: db
      .prepare('SELECT * FROM account_snapshots WHERE account_id=? ORDER BY collected_at DESC')
      .all(account.id),
    media,
    stories: db.prepare('SELECT * FROM stories WHERE account_id=? ORDER BY timestamp DESC').all(account.id),
    audience: db
      .prepare('SELECT * FROM audience_snapshots WHERE account_id=? ORDER BY collected_at DESC')
      .all(account.id),
    dataQuality: db.prepare('SELECT * FROM data_quality ORDER BY entity_type, metric_name').all(),
    capabilities: db.prepare('SELECT * FROM metric_capabilities ORDER BY entity_type, media_product_type, metric_name').all()
  };
}

function splitTimestamp(timestamp) {
  if (!timestamp) return { date: null, time: null };
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return { date: null, time: null };
  return {
    date: date.toISOString().slice(0, 10),
    time: date.toISOString().slice(11, 19)
  };
}

function addColumnIfMissing(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some((item) => item.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
