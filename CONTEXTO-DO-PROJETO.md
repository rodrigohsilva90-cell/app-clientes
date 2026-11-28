# CONTEXTO DO PROJETO — leia isto antes de qualquer coisa

> **Para a IA que está lendo:** este arquivo existe para que QUALQUER assistente (Claude, Gemini, ChatGPT etc.), em QUALQUER conta, consiga continuar o trabalho sem conhecer o projeto. Leia inteiro antes de mudar algo. No fim da sua sessão, **atualize a seção "Histórico" e "Onde paramos"** e salve no repositório.
>
> **Para o dono:** se a IA nova não tiver acesso ao GitHub, abra este arquivo no navegador, copie tudo e cole no começo da conversa, dizendo: "Este é o contexto do meu projeto. Continue a partir daqui."

⚠️ **O repositório é PÚBLICO.** Nunca escreva aqui (nem em nenhum arquivo do repositório) senhas, chaves de API, tokens, conteúdo de secrets ou dados de clientes.

---

## 1. O que é

**GestãoPro** — app (PWA) para um revendedor brasileiro de assinaturas de TV gerenciar clientes: vencimentos, cobrança por Pix e WhatsApp, suporte técnico, indicações, revendedores (sub-contas com teste de 7 dias e licença paga), relatórios e IA.

- Idioma de tudo (app, mensagens, commits, explicações): **português do Brasil**.
- O dono **não é programador**: explique em linguagem simples, com passo a passo, e confirme antes de ações arriscadas.
- O dono usa o app pelo celular, **instalado pelo Chrome** ("Instalar app"). Existe também um APK feito no AppsGeyser, mas ele **não recebe notificações** (WebView não suporta Web Push).

## 2. Onde cada coisa está

| Peça | Onde | Observação |
|---|---|---|
| Código-fonte | GitHub `rodrigohsilva90-cell/app-clientes`, branch **`main`** | Fonte da verdade. Toda mudança publicada precisa estar aqui. |
| App + portal (site) | Cloudflare Worker **`muddy-cake-74a0`** (só arquivos estáticos) | https://muddy-cake-74a0.rodrigo-h-silva90.workers.dev |
| Backend do portal, notificações | Cloudflare Worker **`gestaopro-portal`** | Código: `portal-worker.js` |
| IA do Master | Cloudflare Worker **`gestaopro-ai`** | Código: `ai-worker.js` |
| Banco de dados e login | Firebase, projeto **`gestao-clientes-2355c`** (Auth + Firestore) | Config pública em `firebase-config.js`; regras em `firestore.rules` |
| IA | Google Gemini (AI Studio), chamado **só pelos Workers** | Chave fica como secret nos Workers |
| Outros Workers da conta (não são deste app) | `livro-pdf`, `voz-livro-tts`, `old-pine-1a9c` | Não mexer |

### Secrets e ligações dos Workers (só os NOMES — os valores ficam na Cloudflare)
- `gestaopro-portal`: `FIREBASE_SERVICE_ACCOUNT` (secret), `GEMINI_API_KEY` (secret), `VAPID_PRIVATE_JWK` (secret, chave privada das notificações), `ALLOWED_ORIGIN` (texto, endereço do app), KV `PIN_KV`. Agendamento (cron): `0 11 * * *` (8h de Brasília).
- `gestaopro-ai`: `GEMINI_API_KEY` (secret), `GEMINI_MODEL`, `FIREBASE_PROJECT_ID`, `MASTER_EMAIL`, `ALLOWED_ORIGIN`.
- Ao publicar código novo num Worker pela API, **mantenha as ligações** (`keep_bindings: ["secret_text","plain_text","kv_namespace"]`), senão os secrets somem.

## 3. Arquivos do app (o que cada um faz)

| Arquivo | Função |
|---|---|
| `index.html` | Tela do app (abas, modais, cartões de Ajustes) |
| `style.css` | Estilos |
| `firebase-config.js` | Config do Firebase, `MASTER_ADMIN_EMAIL`, `MASTER_ADMIN_PHONE`, variáveis globais (`activeOwnerId`) |
| `auth.js` | Login, cadastro, revendedores, bloqueio por assinatura |
| `app.js` | Navegação, painel, botões do Master |
| `clients.js` | Núcleo: lista de clientes, Ações do Dia, cobrança, fila "Cobrar em sequência" (`startDailyQueueBilling`), suporte (abrir/fechar/histórico), indicações, backup. **Usa quebra de linha CRLF — preserve ao editar.** |
| `admin.js` | Painel Master (revendedores, feedbacks) |
| `utils.js` | Funções gerais (`openWhatsAppDirect`, `showToast`, datas) |
| `smart-paste.js` | Colar dados de cliente de forma inteligente |
| `ai-config.js` / `ai-report.js` | Endereço do Worker de IA / Análise da carteira com IA (só Master) |
| `support-report.js` | Relatório de suportes com IA (só Master) |
| `app-groups.js` | "📺 Clientes por App": agrupa por aplicativo, mensagem em sequência |
| `push.js` | Cartão de notificações em Ajustes; abre a fila de cobrança vinda da notificação (`?acao=cobrar`) |
| `whatsnew.js` | Tour de novidades |
| `sw.js` | Service worker: cache offline, recebe notificações. **Suba `CACHE_VERSION` a cada publicação** e inclua arquivos novos em `STATIC_ASSETS`. |
| `manifest.json`, `icons/` | Instalação do app (PWA) |
| `_headers` | Cabeçalhos de segurança/cache aplicados pela Cloudflare |
| `portal.html`, `portal-config.js` | Portal do assinante (o cliente final vê vencimento, Pix, dados de acesso, ajuda com IA) |
| `portal-worker.js`, `ai-worker.js` | **Cópias** do código dos Workers (não vão para o site) |
| `firestore.rules` | Regras de segurança do Firestore (publicadas no console do Firebase) |
| `referrals.js` | Vazio de propósito (lógica foi para `clients.js`) |
| `appstore-images.zip`, `notepadd++`, `*.txt` | Sobras, não fazem parte do app (não publicar) |

## 4. Dados no Firestore (principais)

- `clients/{id}`: `ownerId`, `name`, `username`, `phone`, `dueDate` (AAAA-MM-DD), `price`, `assignedServer`/`serverId`, `macApp` (aplicativo, texto livre), `macAddress`, `serverPassword`, `isArchived`, `isTrial`, `isDeleted`, `isBlocked`, `paymentHistory[]`, `supportHistory[]` (`date`, `reason`, `notes`, `durationHours`…), `supportOpenAt/Reason/Notes`, `lastChargedAt` (dia em que foi cobrado), `lastAppCheckAt` (dia em que recebeu a mensagem "está tudo bem?"), `portalLastAccess`, `referredBy`/`referredById`, `pendingDiscount`.
- `settings/{uid}`: `pixKey`, `pixKeyType`, `supportWhatsapp`, `servers[]`, `portalSettings`, `portalTutorials`, `referralGoal/Discount/FirstDiscount`, notificações: `pushEnabled`, `pushDaily`, `pushHelp`, `pushSubs{ s<hash>: {endpoint, p256dh, auth, device, at} }`.
- Outras coleções: `resellers`, `reseller_invites`, `portal_tokens` (hash do link do portal), `portal_ai_usage` (limite diário da ajuda com IA), `custom_apps`, `feedback`, `public_config`.

## 5. Regras do dono (obrigatórias)

1. **Sempre salvar no repositório.** Tudo que for publicado (site ou Workers) também vai para o GitHub, e o `main` fica igual ao que está no ar. Fluxo usado: commit num branch → pull request → merge no `main`.
2. Ao mudar um Worker, atualizar `portal-worker.js` / `ai-worker.js` com a **cópia exata** do que está no ar e conferir o sha256.
3. **Privacidade:** nome, login, telefone, MAC, senha e e-mail de clientes **não vão para a IA**. Só códigos (ex.: `c` + id) e números; textos livres passam por limpeza antes (veja `scrub` em `support-report.js`).
4. Explicar tudo em português simples para o dono.
5. Testar antes de publicar (o dono não sabe depurar).

## 6. Como publicar

### Site (`muddy-cake-74a0`)
- **Jeito simples (dono, pelo painel):** Cloudflare → Workers → `muddy-cake-74a0` → enviar os arquivos do site. Envie **todos** os arquivos do site de uma vez (inclusive `icons/`): a publicação substitui o conjunto inteiro, o que faltar some do ar.
- **Jeito por API (IA):** (1) `POST /accounts/{id}/workers/scripts/muddy-cake-74a0/assets-upload-session` com o manifesto `{ "/caminho": { hash: 32 hex, size } }` de TODOS os arquivos; (2) enviar os arquivos pedidos em `buckets` para `POST /accounts/{id}/workers/assets/upload?base64=true` com `Authorization: Bearer <jwt da sessão>` (corpo multipart: campo = hash, valor = arquivo em base64); (3) `PUT /accounts/{id}/workers/scripts/muddy-cake-74a0` com `metadata.assets = { jwt: <token final>, config: { html_handling: "auto-trailing-slash", not_found_handling: "none", _headers: <conteúdo do _headers> } }`. Não publicar: `portal-worker.js`, `ai-worker.js`, `firestore.rules`, `*.zip`, `*.txt`, `notepadd++`, arquivos `.md`.
- Obs.: `/index.html` redireciona para `/` (por causa do `auto-trailing-slash`). Para conferir o que está no ar, baixe `/`.

### Workers (`gestaopro-portal`, `gestaopro-ai`)
- Pegue o código **atual do ar** (`GET .../workers/scripts/{nome}/content/v2`), aplique a mudança e publique (`PUT .../workers/scripts/{nome}` com `main_module: "worker.js"`, mesma `compatibility_date` e `keep_bindings`).
- Para copiar o código exato para o repositório existe a rota `POST https://gestaopro-portal.rodrigo-h-silva90.workers.dev/?acao=exportar` com o cabeçalho `x-export-chave`: grave antes, no KV `PIN_KV`, a chave em `export-chave` e o texto em `export-blob` (expiram em 10 min; são apagados após a leitura).

### Depois de publicar
- O app guarda arquivos no celular: peça ao dono para fechar e abrir o app uma vez.

## 7. Funcionalidades prontas (resumo)

- **Cobrança:** Ações do Dia (vence em até 2 dias / atrasado até 7 dias), fila "Cobrar em sequência" (um toque por cliente no WhatsApp; marca `lastChargedAt`). O WhatsApp **não permite envio 100% automático** sem a API paga da Meta — decisão do dono: manter o toque manual.
- **Notificações no celular (Web Push com VAPID próprio, sem FCM):** resumo às 8h ("💬 X cobranças para enviar hoje" → toque abre a fila só com quem não foi cobrado) e aviso quando cliente pede ajuda no portal. Ativação em Ajustes → 🔔.
- **Portal do assinante:** dados de acesso, Pix copia e cola, indicações, tutoriais, PIN opcional, "Ajuda com a tela" (foto e/ou texto → Gemini; 3 por dia por cliente; mensagem ao suporte já leva o resumo).
- **IA do Master (`gestaopro-ai`):** análise da carteira, triagem de suporte, mensagens personalizadas, **relatório de suportes** (lê os comentários de abertura/fechamento, aponta causas, roteiros prontos).
- **Clientes por App:** agrupa por aplicativo (junta grafias diferentes), destaca apps com mais suporte que a média, manda "está tudo bem?" em sequência (`lastAppCheckAt`).

## 8. Armadilhas conhecidas

- `clients.js` usa **CRLF**: ao editar com script, preserve as quebras de linha (senão o diff mostra o arquivo inteiro mudado).
- Algumas ferramentas de escrita de arquivo transformam `\u0300` (texto de escape) em caracteres reais. Depois de escrever código com `\uXXXX`, confira.
- Toda mudança de arquivo em cache exige subir `CACHE_VERSION` no `sw.js`.
- Notificações não funcionam no APK do AppsGeyser nem com dados do Chrome apagados; no iPhone só com o app adicionado à Tela de Início.
- O Cloudflare pode levar até 15 min para ativar um agendamento (cron) novo.

## 9. Onde paramos

- Tudo que foi feito está publicado **e** no `main` (último merge: pull request #3 + este arquivo).
- Nada pendente em andamento.
- Ideias que o dono ainda não pediu para fazer: APK de verdade (TWA via PWABuilder) para notificações dentro do APK; backup automático diário dos clientes no R2; mais avisos (cadastro de revendedor, fim de teste, feedback); conferir se `firestore.rules` do repositório é a versão publicada no Firebase; apagar `notepadd++` e os `.txt` antigos do repositório.

## 10. Histórico (mais recente primeiro — acrescente uma linha a cada sessão)

- **28/11/2026** — Criado este arquivo de contexto (+ `GEMINI.md`, `AGENTS.md`, `CLAUDE.md` apontando para ele).
- **27/11/2026** — Dono conectou o Gemini ao MCP da Cloudflare (recomendado acesso "Read only"). Mudanças feitas pelo Gemini nos Workers precisam ser copiadas para o repositório.
- **26/11/2026** — "📺 Clientes por App" + links no relatório de suportes (PR #3).
- **24/11/2026** — Notificação das 8h abre a fila de cobrança (PR #2). Relatório de suportes com IA. Backup dos Workers no repositório + rota `exportar`. Notificações no celular (resumo 8h e pedido de ajuda). Portal: ajuda com IA aceita texto do cliente e manda resumo ao suporte. Publicação da versão nova do app (enviada pelo dono ao GitHub) no `muddy-cake-74a0` (PR #1).
