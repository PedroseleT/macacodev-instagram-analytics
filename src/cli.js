import {
  listInstagramComments,
  listMediaWithoutMetadata,
  listStoriesWithoutMetadata,
  openDatabase,
  upsertMediaMetadata,
  updateStoryMetadata
} from './db.js';
import { config } from './env.js';
import { collectInstagramAnalytics } from './collector.js';
import { collectRecentComments, sendCommentReply } from './commentService.js';
import {
  classifyExistingContent,
  classifyExistingThemes
} from './contentClassificationService.js';
import {
  exportCsv,
  exportGrowthMarkdown,
  exportJson,
  exportMarkdown,
  writeExport,
  writeGrowthExport
} from './exporters.js';

const [command, ...args] = process.argv.slice(2);

async function main() {
  const db = openDatabase();

  if (command === 'init') {
    console.log(`Banco inicializado em ${config.databasePath}`);
    return;
  }

  if (command === 'collect') {
    const token = config.meta.accessToken;
    if (!token) {
      throw new Error('Defina META_ACCESS_TOKEN no .env para usar npm run collect.');
    }

    const options = parseOptions(args);
    const result = await collectInstagramAnalytics(token, db, options);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'comments:collect') {
    const token = config.meta.accessToken;
    if (!token) {
      throw new Error('Defina META_ACCESS_TOKEN no .env para coletar comentarios.');
    }

    const options = parseOptions(args);
    const result = await collectRecentComments(token, db, options);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'comments:list') {
    const options = parseOptions(args);
    printRows(listInstagramComments(db, {
      limit: options.limit || 50,
      onlyPending: options.pending !== false
    }), [
      'comment_id',
      'media_id',
      'timestamp',
      'username',
      'tema',
      'quadro',
      'replies_count',
      'sent_reply_count',
      'text'
    ]);
    return;
  }

  if (command === 'comments:reply') {
    const token = config.meta.accessToken;
    if (!token) {
      throw new Error('Defina META_ACCESS_TOKEN no .env para responder comentarios.');
    }

    const [commentId, ...messageParts] = args;
    const replyMessage = messageParts.join(' ').trim();
    if (!commentId || !replyMessage) {
      throw new Error('Uso: node src/cli.js comments:reply <comment_id> "mensagem"');
    }

    const result = await sendCommentReply(token, db, commentId, replyMessage);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'export') {
    const options = parseOptions(args);
    const format = options.format || 'markdown';
    const content = render(format, db, options);
    const filePath = writeExport(format, content);
    console.log(filePath);
    return;
  }

  if (command === 'export:growth') {
    const options = parseOptions(args);
    const content = exportGrowthMarkdown(db, options);
    const filePath = writeGrowthExport(content);
    console.log(filePath);
    return;
  }

  if (command === 'metadata:list') {
    printRows(listMediaWithoutMetadata(db), [
      'media_id',
      'data_publicacao',
      'hora_publicacao',
      'media_type',
      'media_product_type',
      'tema',
      'tema_source',
      'quadro',
      'quadro_source',
      'caption'
    ]);
    return;
  }

  if (command === 'classify:themes') {
    const options = parseOptions(args);
    const result = classifyExistingThemes(db, { dryRun: options.dryRun });
    console.log(options.dryRun ? 'Dry-run de classificacao de temas:' : 'Classificacao de temas concluida:');
    for (const item of result.results) {
      console.log('---');
      console.log(`media_id: ${item.media_id}`);
      console.log(`captured_theme: ${item.captured_theme ?? item.tema ?? 'null'}`);
      console.log(`tema_source: ${item.tema_source ?? 'null'}`);
      console.log(`status: ${item.status}`);
      console.log(`caption_excerpt: ${item.caption_excerpt ?? 'null'}`);
    }
    console.log('');
    for (const [key, value] of Object.entries(result.summary)) {
      console.log(`${key}: ${value}`);
    }
    return;
  }

  if (command === 'story-metadata:list') {
    printRows(listStoriesWithoutMetadata(db), ['media_id', 'data', 'hora', 'tipo_story']);
    return;
  }

  if (command === 'classify:content') {
    const result = classifyExistingContent(db);
    console.log('Classificacao concluida:');
    for (const [key, value] of Object.entries(result.summary)) {
      console.log(`${key}: ${value}`);
    }
    return;
  }

  if (command === 'metadata') {
    const [mediaId, json] = args;
    if (!mediaId || !json) {
      throw new Error('Uso: node src/cli.js metadata <media_id> <json>');
    }
    upsertMediaMetadata(db, mediaId, JSON.parse(json));
    console.log(`Metadados atualizados para ${mediaId}`);
    return;
  }

  if (command === 'story-metadata') {
    const [mediaId, json] = args;
    if (!mediaId || !json) {
      throw new Error('Uso: node src/cli.js story-metadata <media_id> <json>');
    }
    updateStoryMetadata(db, mediaId, JSON.parse(json));
    console.log(`Metadados de story atualizados para ${mediaId}`);
    return;
  }

  printHelp();
}

function render(format, db, options) {
  if (format === 'json') return exportJson(db, options);
  if (format === 'csv') return exportCsv(db, options);
  if (format === 'markdown' || format === 'md') return exportMarkdown(db, options);
  throw new Error(`Formato nao suportado: ${format}`);
}

function parseOptions(args) {
  const options = {};
  for (const arg of args) {
    const [key, value] = arg.replace(/^--/, '').split('=');
    if (key === 'format') options.format = value;
    if (key === 'mediaLimit') options.mediaLimit = Number(value);
    if (key === 'storyLimit') options.storyLimit = Number(value);
    if (key === 'commentLimit') options.commentLimit = Number(value);
    if (key === 'limit') options.limit = Number(value);
    if (key === 'pending') options.pending = value === undefined || value === 'true';
    if (key === 'since') options.since = value;
    if (key === 'until') options.until = value;
    if (key === 'verbose') options.verbose = value === undefined || value === 'true';
    if (key === 'dry-run' || key === 'dryRun') options.dryRun = value === undefined || value === 'true';
  }
  return options;
}

function printRows(rows, fields) {
  if (!rows.length) {
    console.log('Nenhum item pendente.');
    return;
  }

  for (const row of rows) {
    console.log('---');
    for (const field of fields) {
      const rawValue = row[field];
      const value = field === 'caption' && rawValue ? String(rawValue).slice(0, 220) : rawValue;
      console.log(`${field}: ${value ?? 'null'}`);
    }
  }
}

function printHelp() {
  console.log(`
Uso:
  npm run db:init
  npm run collect -- --mediaLimit=100 --storyLimit=100
  npm run comments:collect -- --mediaLimit=25 --commentLimit=50
  npm run comments:list
  npm run export:md
  npm run export:md -- --verbose
  npm run export:json
  npm run export:csv
  npm run export:growth
  npm run classify:content
  npm run classify:themes -- --dry-run
  npm run classify:themes
  node src/cli.js metadata:list
  node src/cli.js story-metadata:list
  node src/cli.js metadata <media_id> '{"quadro":"quando_codigo_da_errado","tema":"API"}'
  node src/cli.js story-metadata <media_id> '{"tipo_story":"quiz"}'
  node src/cli.js comments:reply <comment_id> "Obrigado pelo comentario!"
`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
