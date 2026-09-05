function serializeMeta(meta = {}) {
  const copy = { ...meta };
  for (const key of Object.keys(copy)) {
    if (/token|secret|password|authorization/i.test(key)) {
      copy[key] = '[redacted]';
    }
  }
  return Object.keys(copy).length ? ` ${JSON.stringify(copy)}` : '';
}

export function logInfo(message, meta) {
  console.log(`[info] ${message}${serializeMeta(meta)}`);
}

export function logWarn(message, meta) {
  console.warn(`[warn] ${message}${serializeMeta(meta)}`);
}

export function logError(message, meta) {
  console.error(`[error] ${message}${serializeMeta(meta)}`);
}

export function classifyApiError(error) {
  const code = error?.payload?.error?.code || error?.code;
  const status = error?.status;

  if (status === 429 || code === 4 || code === 17 || code === 32) return 'rate_limit';
  if (status === 400 || code === 10 || code === 100 || code === 200) return 'permission_or_metric';
  if (status === 404) return 'not_found';
  return 'api_error';
}
