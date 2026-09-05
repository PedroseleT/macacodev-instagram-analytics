import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

function env(name, fallback = '') {
  return process.env[name]?.trim() || fallback;
}

function normalizeVersion(version) {
  return version.replace(/^\/+|\/+$/g, '');
}

export const config = {
  port: Number(env('PORT', '3000')),
  sessionSecret: env('SESSION_SECRET', 'analytics-instagram-local-dev'),
  databasePath: env('DATABASE_PATH', path.resolve('data', 'analytics.sqlite')),
  exportsDir: env('EXPORTS_DIR', path.resolve('exports')),
  meta: {
    appId: env('META_APP_ID'),
    appSecret: env('META_APP_SECRET'),
    instagramAppId: env('INSTAGRAM_APP_ID', env('META_APP_ID')),
    instagramAppSecret: env('INSTAGRAM_APP_SECRET', env('META_APP_SECRET')),
    redirectUri: env('META_REDIRECT_URI', 'http://localhost:3000/auth/instagram/callback'),
    graphBaseUrl: env('META_GRAPH_BASE_URL', 'https://graph.instagram.com').replace(/\/+$/g, ''),
    graphVersion: normalizeVersion(env('META_GRAPH_VERSION', 'v26.0')),
    scopes: env(
      'META_SCOPES',
      'instagram_business_basic,instagram_business_manage_insights'
    ),
    accessToken: env('META_ACCESS_TOKEN')
  }
};

export function hasOAuthConfig() {
  return Boolean(config.meta.instagramAppId && config.meta.instagramAppSecret && config.meta.redirectUri);
}

export function persistMetaAccessToken(accessToken, envPath = path.resolve('.env')) {
  const token = String(accessToken || '').trim();
  if (!token) {
    throw new Error('Access token vazio nao pode ser salvo.');
  }

  const nextLine = `META_ACCESS_TOKEN=${token}`;
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const updated = /^META_ACCESS_TOKEN=.*$/m.test(existing)
    ? existing.replace(/^META_ACCESS_TOKEN=.*$/m, nextLine)
    : `${existing.replace(/\s*$/, '')}\n${nextLine}\n`;

  fs.writeFileSync(envPath, updated);
  process.env.META_ACCESS_TOKEN = token;
}
