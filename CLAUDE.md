# GestãoPro (app-clientes)

PWA de gestão de clientes (revenda de assinaturas de TV), em português do Brasil. Firebase (Auth + Firestore) no navegador; hospedagem e backend na Cloudflare.

## Onde cada coisa roda (conta Cloudflare do dono)
- **muddy-cake-74a0** (Worker só de arquivos estáticos): o app (`index.html`, `*.js`, `style.css`, `sw.js`, `manifest.json`, `icons/`, `_headers`) e o portal do assinante (`portal.html`, `portal-config.js`). Não publicar: `portal-worker.js`, `ai-worker.js`, `firestore.rules`, `*.zip`, `*.txt`, `CLAUDE.md`.
- **gestaopro-portal** → código em `portal-worker.js`. Portal do assinante, ajuda com IA (foto e/ou relato), notificações Web Push (resumo diário 11:00 UTC e aviso de pedido de ajuda). Secrets: FIREBASE_SERVICE_ACCOUNT, GEMINI_API_KEY, VAPID_PRIVATE_JWK; KV: PIN_KV.
- **gestaopro-ai** → código em `ai-worker.js`. IA só da conta Master (análise da carteira, triagem, mensagens, relatório de suportes). Secret: GEMINI_API_KEY.

## Regras do dono
- **Sempre salvar no repositório**: toda mudança publicada (app ou Workers) também vai para o GitHub. Ao mudar um Worker, atualizar `portal-worker.js` / `ai-worker.js` com a cópia EXATA do que está no ar (rota `?acao=exportar` do gestaopro-portal com chave de uso único no KV, conferindo o sha256).
- Ao mudar arquivos do app em cache, subir `CACHE_VERSION` em `sw.js` (e incluir arquivos novos em `STATIC_ASSETS`).
- Dados de clientes (nome, login, telefone, MAC, senha) não vão para a IA: só códigos e números; textos livres passam por limpeza antes.
- O dono não é técnico: explicar em português simples, com passo a passo.
