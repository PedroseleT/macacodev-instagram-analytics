const statusText = document.querySelector('#statusText');
const connectButton = document.querySelector('#connectButton');
const collectButton = document.querySelector('#collectButton');
const logoutButton = document.querySelector('#logoutButton');
const tokenForm = document.querySelector('#tokenForm');
const message = document.querySelector('#message');
const refreshButton = document.querySelector('#refreshButton');
const sinceInput = document.querySelector('#sinceInput');
const untilInput = document.querySelector('#untilInput');
const limitInput = document.querySelector('#limitInput');
const profileImage = document.querySelector('#profileImage');
const profileName = document.querySelector('#profileName');
const profileMeta = document.querySelector('#profileMeta');
const metricGrid = document.querySelector('#metricGrid');
const mediaList = document.querySelector('#mediaList');
const mediaCount = document.querySelector('#mediaCount');
const warningsList = document.querySelector('#warningsList');
const loadMetadataButton = document.querySelector('#loadMetadataButton');
const metadataList = document.querySelector('#metadataList');
const storyMetadataList = document.querySelector('#storyMetadataList');
const collectCommentsButton = document.querySelector('#collectCommentsButton');
const loadCommentsButton = document.querySelector('#loadCommentsButton');
const commentsList = document.querySelector('#commentsList');

const metricLabels = {
  views: 'Visualizacoes',
  reach: 'Alcance',
  total_interactions: 'Interacoes',
  accounts_engaged: 'Contas engajadas',
  profile_links_taps: 'Cliques no perfil',
  likes: 'Curtidas',
  comments: 'Comentarios',
  saved: 'Salvos',
  shares: 'Compartilhamentos'
};

function setDefaultDates() {
  const until = new Date();
  const since = new Date();
  since.setDate(until.getDate() - 30);
  untilInput.value = until.toISOString().slice(0, 10);
  sinceInput.value = since.toISOString().slice(0, 10);
}

function showMessage(text) {
  if (!text) {
    message.hidden = true;
    message.textContent = '';
    return;
  }

  message.hidden = false;
  message.textContent = text;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error?.message || payload.error || 'Falha na requisicao.');
  }

  return payload;
}

function totalValue(metric) {
  if (metric.total_value?.value !== undefined) {
    return Number(metric.total_value.value) || 0;
  }

  return (metric.values || []).reduce((sum, item) => sum + (Number(item.value) || 0), 0);
}

function formatNumber(value) {
  return new Intl.NumberFormat('pt-BR').format(Number(value) || 0);
}

function renderProfile(profile) {
  profileImage.src = profile.profile_picture_url || '';
  profileName.textContent = profile.username ? `@${profile.username}` : 'Conta conectada';
  profileMeta.textContent = [
    profile.account_type,
    profile.followers_count !== undefined
      ? `${formatNumber(profile.followers_count)} seguidores`
      : null,
    profile.media_count !== undefined ? `${formatNumber(profile.media_count)} midias` : null
  ]
    .filter(Boolean)
    .join(' • ');
}

function renderMetrics(metrics) {
  const important = ['views', 'reach', 'total_interactions', 'accounts_engaged'];
  const byName = new Map(metrics.map((metric) => [metric.name, totalValue(metric)]));
  const cards = important.map((name) => ({
    name,
    value: byName.get(name) || 0
  }));

  metricGrid.innerHTML = cards
    .map(
      (metric) => `
        <article class="metric-card">
          <p class="metric-label">${metricLabels[metric.name] || metric.name}</p>
          <p class="metric-value">${formatNumber(metric.value)}</p>
        </article>
      `
    )
    .join('');
}

function metricMap(metrics = []) {
  return new Map(metrics.map((metric) => [metric.name, totalValue(metric)]));
}

function renderMedia(items) {
  mediaCount.textContent = `${items.length} itens`;

  if (!items.length) {
    mediaList.innerHTML = '<p class="muted">Nenhuma publicacao retornada.</p>';
    return;
  }

  mediaList.innerHTML = items
    .map((item) => {
      const metrics = metricMap(item.insights);
      const image = item.thumbnail_url || item.media_url || '';
      const caption = item.caption || item.media_product_type || item.media_type || 'Sem legenda';
      const date = item.timestamp
        ? new Intl.DateTimeFormat('pt-BR').format(new Date(item.timestamp))
        : '';
      const stats = [
        ['views', metrics.get('views')],
        ['reach', metrics.get('reach')],
        ['likes', item.like_count ?? metrics.get('likes')],
        ['comments', item.comments_count ?? metrics.get('comments')],
        ['saved', metrics.get('saved')]
      ];

      return `
        <article class="media-item">
          <img class="media-thumb" src="${image}" alt="" loading="lazy" />
          <div>
            <p class="media-caption">${escapeHtml(caption)}</p>
            <p class="muted">${date}</p>
            <div class="media-stats">
              ${stats
                .filter(([, value]) => value !== undefined)
                .map(
                  ([name, value]) =>
                    `<span class="stat-pill">${metricLabels[name] || name}: ${formatNumber(value)}</span>`
                )
                .join('')}
            </div>
          </div>
        </article>
      `;
    })
    .join('');
}

function renderWarnings(warnings = []) {
  const unique = new Map();
  warnings.forEach((warning) => {
    if (warning?.message) unique.set(warning.message, warning);
  });

  if (!unique.size) {
    warningsList.innerHTML = '<p class="muted">Sem avisos ate agora.</p>';
    return;
  }

  warningsList.innerHTML = [...unique.values()]
    .map(
      (warning) => `
        <article class="warning-item">
          <strong>${warning.code ? `Codigo ${warning.code}` : 'Aviso'}</strong>
          <p>${escapeHtml(warning.message)}</p>
        </article>
      `
    )
    .join('');
}

function renderMetadataForms(items = []) {
  if (!items.length) {
    metadataList.innerHTML = '<p class="muted">Nenhuma midia pendente.</p>';
    return;
  }

  metadataList.innerHTML = items
    .map((item) => `
      <form class="metadata-card" data-media-id="${item.media_id}">
        <p class="media-caption">${escapeHtml(item.caption || 'Sem legenda')}</p>
        <p class="muted">${item.data_publicacao || 'sem data'} • ${item.media_product_type || item.media_type || 'tipo indisponivel'} • ${item.media_id}</p>
        <p class="muted">Tema atual: ${escapeHtml(metadataValueLabel(item.tema, item.tema_source))} • Origem: ${escapeHtml(metadataSourceLabel(item.tema_source))}</p>
        ${item.tema_source === 'classification_conflict' ? `<p class="muted">Opcoes detectadas: ${escapeHtml(item.tema_conflict_options || 'null')}</p>` : ''}
        <p class="muted">Quadro atual: ${escapeHtml(metadataValueLabel(item.quadro, item.quadro_source))} • Origem: ${escapeHtml(metadataSourceLabel(item.quadro_source))}</p>
        <div class="metadata-grid">
          <label>Tema<input name="tema" value="${escapeHtml(item.tema || '')}" placeholder="API, For, Boolean..." /></label>
          <label>Quadro<input name="quadro" value="${escapeHtml(item.quadro || '')}" placeholder="programacao_mas_explicada_por_macacos" /></label>
          <label>Categoria<input name="categoria" /></label>
          <label>Linguagem<input name="programming_language" placeholder="Python, JavaScript..." /></label>
          <label>Hook<input name="hook" /></label>
          <label>CTA<input name="cta" /></label>
          <label>Duracao manual<input name="duracao_manual" type="number" step="0.1" /></label>
        </div>
        <div class="checkbox-grid">
          ${metadataCheckbox('usa_macaco')}
          ${metadataCheckbox('usa_codigo')}
          ${metadataCheckbox('usa_humor')}
          ${metadataCheckbox('usa_historia')}
          ${metadataCheckbox('usa_analogia')}
          ${metadataCheckbox('usa_narracao')}
          ${metadataCheckbox('possui_texto_na_tela')}
        </div>
        <label>Observacoes<input name="observacoes" /></label>
        <button type="submit">Salvar metadata</button>
      </form>
    `)
    .join('');
}

function renderStoryMetadataForms(items = []) {
  if (!items.length) {
    storyMetadataList.innerHTML = '<p class="muted">Nenhum story pendente.</p>';
    return;
  }

  const types = [
    'quiz',
    'enquete',
    'teaser_reel',
    'repost_reel',
    'bastidores',
    'pessoal',
    'educativo',
    'chamada_para_comentarios',
    'caixinha_de_perguntas',
    'outro'
  ];

  storyMetadataList.innerHTML = items
    .map((item) => `
      <form class="metadata-card" data-story-id="${item.media_id}">
        <p class="muted">${item.data || 'sem data'} • ${item.hora || ''} • ${item.media_id}</p>
        <label>Tipo story
          <select name="tipo_story">
            ${types.map((type) => `<option value="${type}">${type}</option>`).join('')}
          </select>
        </label>
        <button type="submit">Salvar story</button>
      </form>
    `)
    .join('');
}

function renderComments(items = []) {
  if (!items.length) {
    commentsList.innerHTML = '<p class="muted">Nenhum comentario pendente no banco.</p>';
    return;
  }

  commentsList.innerHTML = items
    .map((item) => {
      const date = item.timestamp
        ? new Intl.DateTimeFormat('pt-BR', {
            dateStyle: 'short',
            timeStyle: 'short'
          }).format(new Date(item.timestamp))
        : 'sem data';
      const context = [item.tema, item.quadro, item.media_id].filter(Boolean).join(' • ');

      return `
        <article class="comment-card">
          <div class="comment-meta">
            <span class="stat-pill">${escapeHtml(date)}</span>
            <span class="stat-pill">@${escapeHtml(item.username || 'usuario')}</span>
            <span class="stat-pill">${escapeHtml(context || 'midia sem metadata')}</span>
          </div>
          <p class="comment-text">${escapeHtml(item.text || '')}</p>
          <div class="comment-status">
            <span class="muted">${formatNumber(item.like_count || 0)} curtidas</span>
            <span class="muted">${formatNumber(item.replies_count || 0)} respostas existentes</span>
          </div>
          <form class="comment-reply-form" data-comment-id="${escapeHtml(item.comment_id)}">
            <textarea name="message" maxlength="1000" placeholder="Escreva a resposta que sera enviada ao Instagram"></textarea>
            <button type="submit">Responder comentario</button>
          </form>
        </article>
      `;
    })
    .join('');
}

function metadataCheckbox(name) {
  return `<label><input name="${name}" type="checkbox" /> ${name}</label>`;
}

function metadataSourceLabel(source) {
  const labels = {
    manual: 'Manual',
    caption_rule: 'Detectado automaticamente pela legenda',
    unknown: 'Sem regra correspondente',
    classification_conflict: 'Conflito de regras'
  };
  return labels[source] || 'unknown';
}

function metadataValueLabel(value, source) {
  if (source === 'classification_conflict') return 'Conflito de classificacao';
  return value || 'Nao classificado';
}

async function loadMetadataPending() {
  loadMetadataButton.disabled = true;
  showMessage('');

  try {
    const [mediaPayload, storyPayload] = await Promise.all([
      api('/api/media/metadata/missing'),
      api('/api/stories/metadata/missing')
    ]);
    renderMetadataForms(mediaPayload.data || []);
    renderStoryMetadataForms(storyPayload.data || []);
  } catch (error) {
    showMessage(error.message);
  } finally {
    loadMetadataButton.disabled = false;
  }
}

async function loadCommentsPending() {
  loadCommentsButton.disabled = true;
  showMessage('');

  try {
    const payload = await api('/api/comments?pending=true&limit=50');
    renderComments(payload.data || []);
  } catch (error) {
    showMessage(error.message);
  } finally {
    loadCommentsButton.disabled = false;
  }
}

async function collectComments() {
  collectCommentsButton.disabled = true;
  showMessage('');

  try {
    const result = await api('/api/comments/collect', {
      method: 'POST',
      body: JSON.stringify({
        mediaLimit: 25,
        commentLimit: 50
      })
    });
    showMessage(
      `Comentarios coletados: ${result.commentsStored}. Respostas existentes: ${result.repliesStored}. Midias verificadas: ${result.mediaScanned}.`
    );
    await loadCommentsPending();
  } catch (error) {
    showMessage(error.message);
  } finally {
    collectCommentsButton.disabled = false;
  }
}

function formPayload(form) {
  const data = new FormData(form);
  const payload = {};
  for (const [key, value] of data.entries()) {
    if (value !== '') payload[key] = value;
  }
  for (const input of form.querySelectorAll('input[type="checkbox"]')) {
    payload[input.name] = input.checked;
  }
  if (payload.duracao_manual !== undefined) payload.duracao_manual = Number(payload.duracao_manual);
  return payload;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function refreshDashboard() {
  refreshButton.disabled = true;
  showMessage('');

  try {
    const params = new URLSearchParams({
      since: sinceInput.value,
      until: untilInput.value,
      limit: limitInput.value
    });
    const dashboard = await api(`/api/dashboard?${params}`);
    renderProfile(dashboard.profile);
    renderMetrics(dashboard.accountInsights.metrics || []);
    renderMedia(dashboard.media || []);
    renderWarnings(dashboard.warnings || []);
  } catch (error) {
    showMessage(error.message);
  } finally {
    refreshButton.disabled = false;
  }
}

async function loadStatus() {
  const status = await api('/api/status');
  connectButton.hidden = status.connected || !status.oauthConfigured;
  collectButton.hidden = !status.connected;
  collectCommentsButton.hidden = !status.connected;
  logoutButton.hidden = !status.connected;

  if (status.connected) {
    statusText.textContent =
      status.tokenSource === 'env'
        ? `Conta conectada por variavel META_ACCESS_TOKEN usando Graph API ${status.graphVersion}.`
        : `Conta conectada usando Graph API ${status.graphVersion}.`;
    await refreshDashboard();
    return;
  }

  if (!status.oauthConfigured) {
    statusText.textContent =
      'Configure META_ACCESS_TOKEN no .env ou use um token manual para testar.';
    return;
  }

  statusText.textContent = `Pronto para conectar com ${status.scopes.join(', ')}.`;
}

connectButton.addEventListener('click', () => {
  window.location.href = '/auth/instagram';
});

collectButton.addEventListener('click', async () => {
  collectButton.disabled = true;
  showMessage('');

  try {
    const result = await api('/api/collect', {
      method: 'POST',
      body: JSON.stringify({
        since: sinceInput.value,
        until: untilInput.value,
        mediaLimit: 100,
        storyLimit: 100
      })
    });
    showMessage(`Snapshot coletado. Run #${result.runId}, midias: ${result.mediaCount}, stories: ${result.storyCount}.`);
    await refreshDashboard();
  } catch (error) {
    showMessage(error.message);
  } finally {
    collectButton.disabled = false;
  }
});

logoutButton.addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  window.location.reload();
});

refreshButton.addEventListener('click', refreshDashboard);

loadMetadataButton.addEventListener('click', loadMetadataPending);
loadCommentsButton.addEventListener('click', loadCommentsPending);
collectCommentsButton.addEventListener('click', collectComments);

metadataList.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target.closest('form[data-media-id]');
  if (!form) return;
  await api(`/api/media/${form.dataset.mediaId}/metadata`, {
    method: 'PATCH',
    body: JSON.stringify(formPayload(form))
  });
  showMessage(`Metadata salva para ${form.dataset.mediaId}.`);
  await loadMetadataPending();
});

storyMetadataList.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target.closest('form[data-story-id]');
  if (!form) return;
  await api(`/api/stories/${form.dataset.storyId}/metadata`, {
    method: 'PATCH',
    body: JSON.stringify(formPayload(form))
  });
  showMessage(`Metadata de story salva para ${form.dataset.storyId}.`);
  await loadMetadataPending();
});

commentsList.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target.closest('form[data-comment-id]');
  if (!form) return;
  const replyMessage = new FormData(form).get('message');
  await api(`/api/comments/${encodeURIComponent(form.dataset.commentId)}/reply`, {
    method: 'POST',
    body: JSON.stringify({ message: replyMessage })
  });
  showMessage(`Resposta enviada para ${form.dataset.commentId}.`);
  await loadCommentsPending();
});

tokenForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const accessToken = new FormData(tokenForm).get('accessToken');
  await api('/api/token', {
    method: 'POST',
    body: JSON.stringify({ accessToken })
  });
  tokenForm.reset();
  await loadStatus();
});

setDefaultDates();
loadStatus().catch((error) => showMessage(error.message));
