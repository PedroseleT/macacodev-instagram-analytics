import {
  getInstagramComment,
  insertCommentReplyAction,
  listCommentableMedia,
  upsertInstagramComments
} from './db.js';
import { logError, logInfo, logWarn } from './logger.js';
import { getMediaComments, normalizeError, replyToComment } from './metaClient.js';

export async function collectRecentComments(accessToken, db, options = {}) {
  const mediaLimit = Math.min(Math.max(Number(options.mediaLimit) || 25, 1), 100);
  const commentLimit = Math.min(Math.max(Number(options.commentLimit) || 50, 1), 100);
  const collectedAt = new Date().toISOString();
  const mediaItems = listCommentableMedia(db, mediaLimit);
  const warnings = [];
  const results = [];
  let commentsStored = 0;
  let repliesStored = 0;

  for (const media of mediaItems) {
    try {
      const payload = await getMediaComments(accessToken, media.media_id, { limit: commentLimit });
      const stored = upsertInstagramComments(db, media.media_id, payload.data || [], { collectedAt });
      commentsStored += stored.stored;
      repliesStored += stored.replies;
      results.push({
        media_id: media.media_id,
        comments: stored.stored,
        replies: stored.replies
      });
      logInfo('instagram_comments_collected', {
        mediaId: media.media_id,
        comments: stored.stored,
        replies: stored.replies
      });
    } catch (error) {
      const normalized = normalizeError(error);
      warnings.push({
        media_id: media.media_id,
        error: normalized
      });
      logWarn('instagram_comments_collect_failed', {
        mediaId: media.media_id,
        status: normalized.status,
        code: normalized.code,
        message: normalized.message
      });
    }
  }

  return {
    ok: warnings.length === 0,
    collectedAt,
    mediaScanned: mediaItems.length,
    commentsStored,
    repliesStored,
    results,
    warnings
  };
}

export async function sendCommentReply(accessToken, db, commentId, message) {
  const text = String(message || '').trim();
  if (!text) {
    throw new Error('Mensagem de resposta e obrigatoria.');
  }

  const comment = getInstagramComment(db, commentId);
  if (!comment) {
    throw new Error(`Comentario nao encontrado no banco: ${commentId}`);
  }

  try {
    const payload = await replyToComment(accessToken, commentId, text);
    insertCommentReplyAction(db, {
      comment_id: commentId,
      message: text,
      status: 'sent',
      response_comment_id: payload.id ?? null,
      raw: payload
    });
    logInfo('instagram_comment_reply_sent', {
      commentId,
      responseCommentId: payload.id ?? null
    });
    return {
      ok: true,
      commentId,
      responseCommentId: payload.id ?? null
    };
  } catch (error) {
    const normalized = normalizeError(error);
    insertCommentReplyAction(db, {
      comment_id: commentId,
      message: text,
      status: 'failed',
      error_message: normalized.message,
      raw: normalized.details || normalized
    });
    logError('instagram_comment_reply_failed', {
      commentId,
      status: normalized.status,
      code: normalized.code,
      message: normalized.message
    });
    throw error;
  }
}
