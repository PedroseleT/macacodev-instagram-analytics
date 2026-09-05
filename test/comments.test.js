import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { collectRecentComments, sendCommentReply } from '../src/commentService.js';
import {
  getInstagramComment,
  insertCommentReplyAction,
  listInstagramComments,
  openDatabase,
  upsertAccount,
  upsertInstagramComments,
  upsertMedia,
  upsertMediaMetadata
} from '../src/db.js';

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'macacodev-comments-'));
  return openDatabase(path.join(dir, 'test.sqlite'));
}

function seedMedia(db) {
  upsertAccount(db, { id: 'acct_1', username: 'macacodev' });
  upsertMedia(db, 'acct_1', {
    id: 'media_1',
    media_type: 'VIDEO',
    media_product_type: 'REELS',
    caption: 'Tema de hoje: API',
    timestamp: '2026-09-01T12:00:00.000Z'
  });
  upsertMediaMetadata(db, 'media_1', {
    tema: 'API',
    quadro: 'programacao_mas_explicada_por_macacos'
  });
}

test('comment upsert stores top-level comments and nested replies', () => {
  const db = tempDb();
  seedMedia(db);

  const result = upsertInstagramComments(db, 'media_1', [
    {
      id: 'comment_1',
      text: 'Muito bom',
      username: 'user_1',
      timestamp: '2026-09-01T13:00:00.000Z',
      like_count: 2,
      replies: {
        data: [
          {
            id: 'reply_1',
            text: 'Obrigado',
            username: 'macacodev',
            timestamp: '2026-09-01T13:05:00.000Z',
            like_count: 0
          }
        ]
      }
    }
  ]);

  assert.deepEqual(result, { stored: 1, replies: 1 });
  assert.equal(getInstagramComment(db, 'comment_1').text, 'Muito bom');
  assert.equal(getInstagramComment(db, 'reply_1').parent_comment_id, 'comment_1');
});

test('pending comments list excludes comments already replied by the system', () => {
  const db = tempDb();
  seedMedia(db);
  upsertInstagramComments(db, 'media_1', [
    { id: 'pending_1', text: 'Primeiro', username: 'user_1' },
    { id: 'answered_1', text: 'Segundo', username: 'user_2' }
  ]);
  insertCommentReplyAction(db, {
    comment_id: 'answered_1',
    message: 'Respondido',
    status: 'sent',
    response_comment_id: 'reply_sent_1'
  });

  assert.deepEqual(listInstagramComments(db, { onlyPending: true }).map((item) => item.comment_id), ['pending_1']);
  assert.deepEqual(
    listInstagramComments(db, { onlyPending: false }).map((item) => item.comment_id).sort(),
    ['answered_1', 'pending_1']
  );
});

test('comment collection fetches comments for recent stored media', async () => {
  const db = tempDb();
  seedMedia(db);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /media_1\/comments/);
    return jsonResponse({
      data: [
        {
          id: 'comment_api_1',
          text: 'Explicou bem',
          username: 'user_api',
          timestamp: '2026-09-01T14:00:00.000Z'
        }
      ]
    });
  };

  try {
    const result = await collectRecentComments('token-test', db, { mediaLimit: 1, commentLimit: 10 });
    assert.equal(result.commentsStored, 1);
    assert.equal(getInstagramComment(db, 'comment_api_1').username, 'user_api');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('comment reply sends explicit message and records sent action', async () => {
  const db = tempDb();
  seedMedia(db);
  upsertInstagramComments(db, 'media_1', [{ id: 'comment_reply_target', text: 'Duvida', username: 'user_1' }]);
  const originalFetch = globalThis.fetch;
  let postedBody = '';
  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /comment_reply_target\/replies/);
    assert.equal(options.method, 'POST');
    postedBody = String(options.body);
    return jsonResponse({ id: 'reply_created_1' });
  };

  try {
    const result = await sendCommentReply('token-test', db, 'comment_reply_target', 'Valeu pelo comentario!');
    assert.equal(result.responseCommentId, 'reply_created_1');
    assert.match(postedBody, /message=Valeu\+pelo\+comentario%21/);
    assert.match(postedBody, /access_token=token-test/);
    assert.equal(listInstagramComments(db, { onlyPending: true }).length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? 'OK' : 'Error',
    json: async () => payload
  };
}
