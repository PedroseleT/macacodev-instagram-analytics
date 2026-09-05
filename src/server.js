import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import session from 'express-session';
import { collectInstagramAnalytics } from './collector.js';
import {
  listInstagramComments,
  listMediaWithoutMetadata,
  listStoriesWithoutMetadata,
  openDatabase,
  upsertMediaMetadata,
  updateStoryMetadata
} from './db.js';
import { config, hasOAuthConfig, persistMetaAccessToken } from './env.js';
import { exportCsv, exportJson, exportMarkdown } from './exporters.js';
import { collectRecentComments, sendCommentReply } from './commentService.js';
import {
  buildInstagramAuthUrl,
  exchangeCodeForShortToken,
  exchangeShortForLongToken,
  getAccountInsights,
  getMedia,
  getMediaInsights,
  getProfile,
  normalizeError
} from './metaClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const db = openDatabase();

app.use(express.json());
app.use(
  session({
    name: 'analytics_instagram.sid',
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      maxAge: 1000 * 60 * 60 * 24 * 30
    }
  })
);
app.use(express.static(path.join(__dirname, '..', 'public')));

function getAccessToken(req) {
  return req.session.accessToken || config.meta.accessToken || null;
}

function requireToken(req, res, next) {
  if (!getAccessToken(req)) {
    res.status(401).json({
      error: 'Configure META_ACCESS_TOKEN no .env ou conecte uma conta do Instagram.'
    });
    return;
  }

  next();
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function exportFilename(extension) {
  return `macacodev-analytics-${new Date().toISOString().replaceAll(':', '-')}.${extension}`;
}

app.get('/api/status', (req, res) => {
  const tokenSource = req.session.accessToken ? 'session' : config.meta.accessToken ? 'env' : null;

  res.json({
    connected: Boolean(tokenSource),
    tokenSource,
    oauthConfigured: hasOAuthConfig(),
    graphVersion: config.meta.graphVersion,
    scopes: config.meta.scopes.split(',').map((scope) => scope.trim())
  });
});

app.get('/auth/instagram', (req, res) => {
  if (!hasOAuthConfig()) {
    res.status(400).send('Configure META_APP_ID, META_APP_SECRET e META_REDIRECT_URI no .env.');
    return;
  }

  const state = crypto.randomBytes(24).toString('hex');
  req.session.oauthState = state;
  res.redirect(buildInstagramAuthUrl(state));
});

app.get(
  '/auth/instagram/callback',
  asyncRoute(async (req, res) => {
    const { code, state, error, error_description: description } = req.query;

    if (error) {
      res.redirect(`/?error=${encodeURIComponent(description || error)}`);
      return;
    }

    if (!code || !state || state !== req.session.oauthState) {
      res.status(400).send('Callback OAuth invalido.');
      return;
    }

    const shortToken = await exchangeCodeForShortToken(String(code));
    const longToken = await exchangeShortForLongToken(shortToken.access_token);

    req.session.accessToken = longToken.access_token;
    req.session.tokenExpiresAt = longToken.expires_in
      ? Date.now() + Number(longToken.expires_in) * 1000
      : null;
    persistMetaAccessToken(longToken.access_token);
    delete req.session.oauthState;

    res.redirect('/');
  })
);

app.post('/api/token', (req, res) => {
  const accessToken = req.body?.accessToken?.trim();

  if (!accessToken) {
    res.status(400).json({ error: 'accessToken e obrigatorio.' });
    return;
  }

  req.session.accessToken = accessToken;
  req.session.tokenExpiresAt = null;
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('analytics_instagram.sid');
    res.json({ ok: true });
  });
});

app.get(
  '/api/profile',
  requireToken,
  asyncRoute(async (req, res) => {
    res.json(await getProfile(getAccessToken(req)));
  })
);

app.get(
  '/api/insights/account',
  requireToken,
  asyncRoute(async (req, res) => {
    const accessToken = getAccessToken(req);
    const profile = await getProfile(accessToken);
    const insights = await getAccountInsights(accessToken, profile.id, {
      since: req.query.since,
      until: req.query.until
    });

    res.json({
      profile,
      ...insights
    });
  })
);

app.get(
  '/api/media',
  requireToken,
  asyncRoute(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit || 25), 1), 50);
    res.json(await getMedia(getAccessToken(req), limit));
  })
);

app.get(
  '/api/media/:id/insights',
  requireToken,
  asyncRoute(async (req, res) => {
    res.json(await getMediaInsights(getAccessToken(req), req.params.id));
  })
);

app.get(
  '/api/dashboard',
  requireToken,
  asyncRoute(async (req, res) => {
    const accessToken = getAccessToken(req);
    const limit = Math.min(Math.max(Number(req.query.limit || 12), 1), 25);
    const profile = await getProfile(accessToken);
    const [accountInsights, media] = await Promise.all([
      getAccountInsights(accessToken, profile.id, {
        since: req.query.since,
        until: req.query.until
      }),
      getMedia(accessToken, limit)
    ]);

    const mediaItems = media.data || [];
    const mediaInsights = await Promise.all(
      mediaItems.map((item) => getMediaInsights(accessToken, item.id))
    );

    res.json({
      profile,
      accountInsights,
      media: mediaItems.map((item) => ({
        ...item,
        insights: mediaInsights.find((result) => result.mediaId === item.id)?.metrics || [],
        insightWarnings:
          mediaInsights.find((result) => result.mediaId === item.id)?.warnings || []
      })),
      warnings: [
        ...(accountInsights.warnings || []),
        ...mediaInsights.flatMap((result) => result.warnings || [])
      ]
    });
  })
);

app.post(
  '/api/collect',
  requireToken,
  asyncRoute(async (req, res) => {
    const result = await collectInstagramAnalytics(getAccessToken(req), db, {
      since: req.body?.since,
      until: req.body?.until,
      mediaLimit: req.body?.mediaLimit,
      storyLimit: req.body?.storyLimit
    });
    res.json(result);
  })
);

app.post(
  '/api/comments/collect',
  requireToken,
  asyncRoute(async (req, res) => {
    const result = await collectRecentComments(getAccessToken(req), db, {
      mediaLimit: req.body?.mediaLimit,
      commentLimit: req.body?.commentLimit
    });
    res.json(result);
  })
);

app.get('/api/comments', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
  const onlyPending = req.query.pending !== 'false';
  res.json({
    data: listInstagramComments(db, { limit, onlyPending })
  });
});

app.post(
  '/api/comments/:id/reply',
  requireToken,
  asyncRoute(async (req, res) => {
    const message = req.body?.message;
    const result = await sendCommentReply(getAccessToken(req), db, req.params.id, message);
    res.json(result);
  })
);

app.get('/api/export/markdown', (req, res) => {
  res.attachment(exportFilename('md'));
  res.type('text/markdown').send(exportMarkdown(db));
});

app.get('/api/export/json', (req, res) => {
  res.attachment(exportFilename('json'));
  res.type('application/json').send(exportJson(db));
});

app.get('/api/export/csv', (req, res) => {
  res.attachment(exportFilename('csv'));
  res.type('text/csv').send(exportCsv(db));
});

app.get('/api/media/metadata/missing', (req, res) => {
  res.json({ data: listMediaWithoutMetadata(db) });
});

app.patch('/api/media/:id/metadata', (req, res) => {
  upsertMediaMetadata(db, req.params.id, req.body || {});
  res.json({ ok: true });
});

app.get('/api/stories/metadata/missing', (req, res) => {
  res.json({ data: listStoriesWithoutMetadata(db) });
});

app.patch('/api/stories/:id/metadata', (req, res) => {
  updateStoryMetadata(db, req.params.id, req.body || {});
  res.json({ ok: true });
});

app.use((error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  console.error(error);
  res.status(error.status || 500).json({
    error: normalizeError(error)
  });
});

app.listen(config.port, () => {
  console.log(`Analytics Instagram rodando em http://localhost:${config.port}`);
});
