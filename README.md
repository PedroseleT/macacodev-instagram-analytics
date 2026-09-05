# Analytics Instagram MacacoDev

Sistema local de analytics para coletar, armazenar, calcular e exportar dados do Instagram usando a API oficial da Meta.

O sistema nao decide estrategia de conteudo. Ele coleta dados, preserva historico, calcula indicadores derivados somente quando os dados-base existem e exporta material para analise externa.

## Visao geral

O MacacoDev Instagram Analytics e uma base propria de dados para acompanhar crescimento, performance de conteudos e evolucao da conta rumo a metas de seguidores. A aplicacao roda localmente, usa SQLite para manter historico e expoe tanto dashboard quanto CLI para coleta e exportacao.

Principais capacidades:

- OAuth com Instagram Login e uso automatico do token salvo em variavel de ambiente.
- Coleta de snapshots historicos da conta, midias, Reels, posts/carrosseis e Stories.
- Metricas derivadas com tratamento de `null`, divisao por zero e disponibilidade real da API.
- Classificacao automatica segura de `quadro` e `tema` por assinaturas textuais na legenda.
- Monitor de crescimento de seguidores rumo a 10k com velocidade, momentum e projecoes lineares.
- Exportacao em Markdown, JSON e CSV para analise externa.
- Painel local para coleta, metadados e comentarios quando a API disponibiliza os dados.
- Testes automatizados com `node:test`.

## Estrutura

```text
src/      backend, coleta, banco, metricas, exportadores e CLI
public/   dashboard local
test/     testes automatizados
data/     banco SQLite local ignorado pelo Git
exports/  relatorios gerados localmente ignorados pelo Git
```

## Stack

- Node.js + Express
- SQLite local via `node:sqlite`
- Meta Instagram Graph API
- Frontend simples em HTML/CSS/JS
- Testes com `node:test`

## Configuracao

Copie `.env.example` para `.env` e preencha:

```text
PORT=3000
SESSION_SECRET=troque-este-segredo-local
DATABASE_PATH=./data/analytics.sqlite
EXPORTS_DIR=./exports

META_APP_ID=
META_APP_SECRET=
META_REDIRECT_URI=http://localhost:3000/auth/instagram/callback
META_ACCESS_TOKEN=
META_GRAPH_VERSION=v26.0
META_GRAPH_BASE_URL=https://graph.instagram.com
META_SCOPES=instagram_business_basic,instagram_business_manage_insights,instagram_business_manage_comments
```

`META_ACCESS_TOKEN` e opcional, mas quando preenchido o backend usa esse token automaticamente na tela, na coleta e nas exportacoes. Assim o sistema nao pede token a cada analise. O token deve ficar somente no `.env`, que esta ignorado pelo Git.

Quando `META_APP_ID`, `META_APP_SECRET` e `META_REDIRECT_URI` estiverem configurados, o botao `Conectar Instagram` executa OAuth, troca o token curto por token longo e grava o novo `META_ACCESS_TOKEN` no `.env` automaticamente.

## Rodando

```bash
npm install
npm run dev
```

Abra:

```text
http://localhost:3000
```

## Banco

Inicializar banco:

```bash
npm run db:init
```

Tabelas principais:

- `accounts`: estado atual da conta.
- `account_snapshots`: snapshots historicos da conta.
- `account_insight_values`: serie temporal/bruta dos insights da conta.
- `media`: midias retornadas pela API.
- `instagram_comments`: comentarios coletados nas midias.
- `comment_reply_actions`: auditoria das respostas enviadas pelo sistema.
- `media_metadata`: classificacao manual e classificacao automatica segura de `quadro` e `tema`.
- `media_insight_values`: metricas brutas por midia.
- `media_snapshots`: snapshots historicos por midia/Reel.
- `stories`: stories disponiveis na janela retornada pela API.
- `story_insights`: metricas brutas por Story.
- `posts`: posts/carrosseis.
- `audience_snapshots`: audiencia/demografia quando a API retorna.
- `data_quality`: disponibilidade, origem e limitacoes por metrica.
- `metric_capabilities`: cache de suporte por `entity_type`, `media_product_type`, metrica, endpoint e versao da API.
- `collection_runs`: historico das execucoes de coleta.

Indices existem para `media_id`, `timestamp`, `collected_at`, `quadro` e `tema`.

## Coleta

Pela tela:

1. Configure `META_ACCESS_TOKEN` no `.env` ou conecte a conta pela tela.
2. Clique em `Coletar snapshot`.

Por CLI:

```bash
npm run collect -- --mediaLimit=100 --storyLimit=100
```

A coleta nunca sobrescreve snapshots historicos. Ela atualiza entidades atuais, como conta/midia/metadados, e cria novos registros em `account_snapshots` e `media_snapshots`.

## Exportacao

Gerar Markdown:

```bash
npm run export:md
```

Gerar JSON:

```bash
npm run export:json
```

Gerar CSV:

```bash
npm run export:csv
```

Gerar relatorio curto de crescimento rumo a 10k:

```bash
npm run export:growth
```

Os arquivos saem em `exports/`.

Relatorio Markdown detalhado, com linhas completas de data quality:

```bash
npm run export:md -- --verbose
```

Tambem existem endpoints:

- `GET /api/export/markdown`
- `GET /api/export/json`
- `GET /api/export/csv`

## Comentarios

O sistema pode coletar comentarios e enviar respostas usando somente a API oficial da Meta. Para isso, o token precisa incluir:

```text
instagram_business_manage_comments
```

Coletar comentarios das midias recentes ja salvas no banco:

```bash
npm run comments:collect -- --mediaLimit=25 --commentLimit=50
```

Listar comentarios pendentes de resposta:

```bash
npm run comments:list
```

Responder explicitamente um comentario:

```bash
node src/cli.js comments:reply <comment_id> "Obrigado pelo comentario!"
```

Pelo dashboard:

1. Clique em `Coletar comentarios`.
2. Clique em `Carregar pendentes`.
3. Escreva a resposta no card do comentario.
4. Clique em `Responder comentario`.

O sistema nao gera nem envia respostas automaticamente. Cada resposta exige uma acao explicita no dashboard ou no comando `comments:reply`.

Endpoints locais:

- `POST /api/comments/collect`
- `GET /api/comments?pending=true`
- `POST /api/comments/:id/reply`

Dados armazenados:

- texto do comentario;
- usuario retornado pela API;
- horario do comentario;
- media relacionada;
- respostas ja existentes retornadas pela API;
- mensagem enviada pelo sistema e id da resposta criada, quando a Meta retorna.

Tokens, headers sensiveis e secrets nao sao salvos nem logados.

## Metadados e classificacao

## Classificacao automatica de quadro

As regras ficam centralizadas em [src/contentClassificationRules.js](C:/Users/pedro/Documents/ChatGPT/macacodev/src/contentClassificationRules.js). A logica de match fica em [src/contentClassifier.js](C:/Users/pedro/Documents/ChatGPT/macacodev/src/contentClassifier.js), e a aplicacao no banco em [src/contentClassificationService.js](C:/Users/pedro/Documents/ChatGPT/macacodev/src/contentClassificationService.js).

Regras atuais:

- caption contem `Entendeu? Então o macacodev completou o serviço dele!` -> `programacao_mas_explicada_por_macacos`
- caption contem `Mais um código quebrado com sucesso` -> `quando_codigo_da_errado`

A classificacao normaliza texto com `trim`, lowercase, multiplos espacos/quebras de linha e acentos para comparacao. Nao usa fuzzy matching, nao usa data, nao usa ordem, nao usa tema e nao usa IA.

Prioridade:

1. `quadro_source=manual`
2. `quadro_source=caption_rule`
3. `quadro_source=unknown`
4. `quadro_source=classification_conflict`

Rodar classificacao retroativa:

```bash
npm run classify:content
```

O comando preserva metadados existentes, preenche apenas `quadro`/`quadro_source` quando houver match confiavel, e nao sobrescreve `quadro` manual. Em conflito entre regras, o sistema registra log `classification_conflict`, deixa `quadro=null` e exige revisao manual.

## Classificacao automatica de tema

A classificacao de `tema` reutiliza os mesmos arquivos de classificacao:

- regras e aliases: [src/contentClassificationRules.js](C:/Users/pedro/Documents/ChatGPT/macacodev/src/contentClassificationRules.js)
- regex/parser: [src/contentClassifier.js](C:/Users/pedro/Documents/ChatGPT/macacodev/src/contentClassifier.js)
- aplicacao no banco: [src/contentClassificationService.js](C:/Users/pedro/Documents/ChatGPT/macacodev/src/contentClassificationService.js)

Regex usada:

```js
/tema de hoje:\s*([^\n\r]+)/gi
```

Ela ignora uppercase/lowercase, aceita espacos depois de `:`, captura somente ate o fim da linha e remove espacos extras. Hashtags no fim da mesma linha sao descartadas quando aparecem depois de espaco.

Aliases/canonicalizacao atuais:

- `api` -> `API`
- `boolean` -> `Boolean`
- `for` -> `For`
- `while` -> `While`
- `função`, `funcao` -> `Função`
- `listas`, `lista` -> `Listas`
- `if/else`, `if else` -> `If/Else`
- `variáveis`, `variaveis` -> `Variáveis`
- `loop infinito` -> `Loop infinito`

Se o tema nao estiver no mapa, o texto extraido e preservado com `trim`. Exemplo: `Tema de hoje: Docker` salva `Docker`.

Prioridade:

1. `tema_source=manual`
2. `tema_source=caption_rule`
3. `tema_source=unknown`
4. `tema_source=classification_conflict`

Rodar preview sem alterar banco:

```bash
npm run classify:themes -- --dry-run
```

Aplicar classificacao retroativa:

```bash
npm run classify:themes
```

O comando nao usa IA, data, ordem dos posts nem inferencia por assunto. Se houver duas assinaturas diferentes na mesma legenda, deixa `tema=null`, grava `tema_source=classification_conflict` e exige revisao manual. Durante a coleta, novas midias tambem passam por essa classificacao automaticamente depois do `quadro`.

Pela tela:

1. Abra o dashboard.
2. Clique em `Carregar pendentes` na area `Metadados pendentes`.
3. Preencha tema, quadro, categoria, linguagem e flags.
4. Salve cada midia ou story.

Listar midias sem `tema`/`quadro`:

```bash
npm run metadata:list
```

Listar Stories sem `tipo_story`:

```bash
npm run story-metadata:list
```

Atualizar por API:

```http
PATCH /api/media/:id/metadata
Content-Type: application/json

{
  "content_id": "conteudo-001",
  "tema": "API",
  "formato": "reel_explica_codigo",
  "quadro": "programacao_mas_explicada_por_macacos",
  "categoria": "educativo",
  "programming_language": "JavaScript",
  "hook": "pergunta",
  "cta": "seguir",
  "duracao_manual": 28,
  "usa_macaco": true,
  "usa_codigo": true,
  "usa_humor": true,
  "usa_historia": false,
  "usa_analogia": true,
  "usa_narracao": true,
  "possui_texto_na_tela": true,
  "observacoes": "classificacao manual"
}
```

Atualizar por CLI:

```bash
node src/cli.js metadata 18000000000000000 "{\"quadro\":\"quando_codigo_da_errado\",\"tema\":\"API\",\"usa_humor\":true}"
```

Valores atuais de `quadro` suportados:

- `programacao_mas_explicada_por_macacos`
- `quando_codigo_da_errado`

Novos quadros podem ser gravados livremente sem migracao estrutural.

Metadados de Story:

```bash
node src/cli.js story-metadata 18000000000000000 "{\"tipo_story\":\"quiz\"}"
```

Valores sugeridos para `tipo_story`:

- `quiz`
- `enquete`
- `teaser_reel`
- `repost_reel`
- `bastidores`
- `pessoal`
- `educativo`
- `chamada_para_comentarios`
- `caixinha_de_perguntas`
- `outro`

Para os conteudos atuais conhecidos, nao associe automaticamente por ordem. Use `npm run metadata:list` ou a tela para conferir `caption`, data e `media_id`, entao aplique:

- Variaveis, Boolean, If/Else, Funcao, Listas, For, While e API: `programacao_mas_explicada_por_macacos`
- Loop infinito: `quando_codigo_da_errado`

## Metricas calculadas

Todas retornam `null` se faltar dado-base ou se o denominador for zero.

- `engagement_rate`: `(likes + comments + saves + shares) / reach`
- `share_rate`: `shares / reach`
- `save_rate`: `saves / reach`
- `comment_rate`: `comments / reach`
- `like_rate`: `likes / reach`
- `follow_rate`: `follows / reach`
- `profile_visit_rate`: `profile_visits / reach`
- `profile_to_follow_conversion`: `follows / profile_visits`
- `watch_ratio`: `average_watch_time / duracao_video_ou_manual`
- `views_per_reached_account`: `views / reach`
- `repost_rate`: `reposts / reach`

Nao existe `Performance Score` com pesos arbitrarios.

## Fallback e capability cache

A coleta tenta metricas em lote. Se a Meta recusar o lote por metrica incompativel, o sistema divide a chamada e testa metricas individualmente. As metricas que funcionarem sao persistidas normalmente; somente as que falharem entram como `unsupported`, `permission_error`, `temporary_error`, `conditional` ou `unknown`.

Quando uma metrica fica `unsupported` para um `media_product_type` em uma versao da API, isso e salvo em `metric_capabilities`. Nas proximas coletas, essa combinacao deixa de ser testada para reduzir chamadas invalidas. Mudanca de `META_GRAPH_VERSION` cria um novo escopo de cache.

Erros temporarios, rate limit e timeout nao sao tratados como incompatibilidade permanente.

## Stories e navigation

Para Stories, `navigation` e consultada separadamente com breakdown oficial `story_navigation_action_type`. Quando a API retorna breakdown, o sistema persiste os nomes internos abaixo:

- `tap_forward`, `taps_forward`, `story_taps_forward` -> `taps_forward`
- `tap_back`, `taps_back`, `story_taps_back` -> `taps_back`
- `tap_exit`, `taps_exit`, `story_exits`, `exit`, `exits` -> `exits`
- `swipe_forward`, `story_swipe_forward` -> `swipe_forward`
- `next_story` -> `next_story`

Se a Meta retornar nomenclatura diferente, o valor bruto continua preservado em `raw_json`.

## Checkpoints e velocidade

Snapshots de midia guardam `hours_since_publication`. O relatorio calcula checkpoints aproximados:

- `1h`, `3h`, `6h`, `12h`, `24h`, `48h`, `72h`, `7d`, `14d`, `30d`

Cada checkpoint aceita uma tolerancia clara, por exemplo `6h` aceita snapshot proximo dentro de 1 hora. Quando nao existe snapshot dentro da tolerancia, o valor fica `null`/ausente.

Velocidades entre snapshots incluem `delta_seconds`, `delta_minutes` e `delta_hours`. Se `delta_minutes < 10`, `views_per_hour` e `reach_per_hour` ficam `null` e `velocity_low_confidence=true`, para evitar comparacoes enganadoras com intervalos muito curtos.

## Crescimento de seguidores rumo a 10k

O sistema usa `account_snapshots.seguidores_total` como contador atual comparavel entre coletas. Esta camada nao calcula deltas de `reach`, `views`, `profile_views` ou `interactions`, porque essas metricas podem vir de janelas temporais diferentes da Meta.

Relatorio focado:

```bash
npm run export:growth
```

Arquivo gerado:

```text
exports/macacodev-growth-monitor-<timestamp>.md
```

O relatorio inclui:

- velocidade de seguidores nas janelas `1h`, `3h`, `6h`, `12h`, `24h`, `3d` e `7d`;
- comparacao de momentum em periodos equivalentes: `6h` vs `6h anteriores`, `12h` vs `12h anteriores`, `24h` vs `24h anteriores`;
- meta de `10.000` seguidores, faltantes e percentual concluido;
- projecoes lineares simples com base no ritmo de `24h`, `3d` e `7d`;
- historico cronologico de followers com delta e seguidores/h;
- crescimento da conta apos publicacoes, nomeado como `account_follower_growth_after_publication`;
- ranking de Reels por crescimento da conta apos publicacao;
- ultimo Reel com `account_growth_since_publish`;
- bloco `GROWTH MONITOR DATA` em JSON para analise externa.

Thresholds iniciais de momentum:

- variacao menor que `15%`: `stable`;
- `15%` ate `30%`: `mild_change`;
- acima de `30%`: `significant_change`.

Confianca da janela:

- `low`: janela sem snapshot adequado, intervalo muito incompleto ou menos de 3 snapshots;
- `medium`: janela suficiente, mas com poucos snapshots;
- `high`: janela com melhor cobertura temporal.

As projecoes ate 10k sao extrapolacoes lineares, nao previsao garantida. Se a taxa for zero, negativa ou ausente, o valor projetado fica `null`.

Crescimento apos publicacao nao significa seguidores gerados pelo Reel. O campo representa crescimento da conta depois do horario de publicacao e pode ter influencia de outros conteudos, Stories, perfil, recomendacao da plataforma ou fatores externos. Quando normalizado por `reach` ou `views`, o sistema marca como `derived_proxy`.

Para medir crescimento por hora com qualidade, configure coleta recorrente pelo menos a cada 1 hora. Nao use loop agressivo para evitar chamadas desnecessarias e risco de rate limit.

## Null e amostra

`null` significa dado ausente, nao retornado pela API, sem permissao, sem denominador valido ou sem snapshot proximo. O sistema nao cria proxy sem documentar.

Agrupamentos por tema, quadro, categoria, linguagem, dia e horario incluem `sample_size` e `sample_warning`:

- `amostra insuficiente`: `n < 3`
- `amostra pequena`: `3 <= n < 10`
- `amostra utilizavel`: `n >= 10`

## Endpoints da Meta usados

- `GET /me`
- `GET /me/media`
- `GET /me/stories`
- `GET /{ig-user-id}/insights`
- `GET /{media-id}/insights`
- `GET /{ig-media-id}/comments`
- `POST /{ig-comment-id}/replies`
- `GET /access_token` para troca de token curto por token longo
- `POST https://api.instagram.com/oauth/access_token` no OAuth

Documentacao oficial:

- https://developers.facebook.com/documentation/instagram-platform/insights
- https://developers.facebook.com/documentation/instagram-platform/api-reference/instagram-user/insights
- https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights
- https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/
- https://developers.facebook.com/docs/graph-api/changelog/version26.0/

## Metricas tratadas como disponiveis quando a API retorna

Conta:

- `followers_count`
- `media_count`
- `views`
- `reach`
- `total_interactions`
- `accounts_engaged`
- `profile_links_taps`
- `profile_views`
- `follows_and_unfollows`
- `impressions`, quando ainda suportada

Midia/Reels/Posts:

- `views`
- `reach`
- `likes`
- `comments`
- `shares`
- `saved`
- `total_interactions`
- `reposts`, quando suportada
- `profile_visits`, quando suportada pelo tipo de midia
- `follows`, quando suportada pelo tipo de midia
- `ig_reels_video_view_total_time`, quando suportada
- `ig_reels_avg_watch_time`, quando suportada

Stories:

- `views`
- `reach`
- `likes`
- `replies`
- `shares`
- `total_interactions`
- `impressions`, quando suportada
- `navigation`, quando suportada
- `link_clicks`, quando suportada
- `profile_activity`, quando suportada

Audiencia:

- `follower_demographics`
- `reached_audience_demographics`
- `engaged_audience_demographics`
- `online_followers`

## Metricas solicitadas mas registradas como indisponiveis ou condicionais

- `plays` separado de `views`: indisponivel no fluxo usado.
- `retention` granular: indisponivel.
- `percentage watched`/curva de retencao por percentual: indisponivel.
- `replays`: indisponivel.
- seguidores vs nao seguidores por Reel: indisponivel.
- origem de alcance por `reels_tab`, `explore`, `feed`, `profile`, `other`: indisponivel.
- `duracao_video`: tentada como campo de midia; quando a API nao retornar, use `duracao_manual`.
- `seguidores_ganhos` e `seguidores_perdidos`: dependem de `follows_and_unfollows`; ficam `null` se a API nao retornar breakdown utilizavel.

Cada falha/indisponibilidade e registrada em `data_quality`.

O Markdown padrao resume a qualidade dos dados por metrica/capability. Use `npm run export:md -- --verbose` para exportar a tabela detalhada.

## Coleta recorrente

No Windows, use o Agendador de Tarefas apontando para:

```text
Programa: npm.cmd
Argumentos: run collect -- --mediaLimit=100 --storyLimit=100
Iniciar em: C:\Users\pedro\Documents\ChatGPT\macacodev
```

Para snapshots de curva de Reels, rode com maior frequencia nas primeiras 24h apos publicar. O sistema calcula `hours_since_publication` automaticamente; nao precisa acertar exatamente +1h, +3h, +6h etc.

## Qualidade e seguranca

- Tokens nunca sao logados.
- `.env`, `data/*.sqlite` e `exports/` ficam fora do Git.
- Falha de uma metrica nao derruba a coleta inteira.
- Erros de permissao, rate limit, metrica nao suportada e falhas de persistencia sao registrados em log e/ou `data_quality`.

## Testes

```bash
npm test
```

Cobertura atual:

- calculos de metricas
- divisao por zero
- valores `null`
- insercao de snapshots
- atualizacao/deduplicacao de media
- exportacao Markdown/JSON/CSV
- parsing de respostas de insights
- classificacao automatica de `tema` por `Tema de hoje:`
- fallback/cache de capabilities
- parsing de `navigation`
- parsing de demographics
- rankings
- checkpoints
- velocidade com intervalo curto
- crescimento entre snapshots da conta
- velocidade de crescimento de seguidores
- momentum de seguidores
- meta/projecao ate 10k
- crescimento da conta apos publicacao
- exportacao `export:growth`
- agrupamentos por tema/quadro/horario/dia
- alerta de amostra pequena
