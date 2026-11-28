# GestãoPro (app-clientes)

Antes de qualquer coisa, leia **`CONTEXTO-DO-PROJETO.md`**: é o documento principal do projeto (onde cada parte roda, como publicar, dados, armadilhas, onde paramos e histórico). Este arquivo só resume as regras.

## Regras do dono
- **Sempre salvar no repositório**: toda mudança publicada (site ou Workers) também vai para o GitHub e é juntada ao `main` (branch → pull request → merge). Ao mudar um Worker, atualizar `portal-worker.js` / `ai-worker.js` com a cópia EXATA do que está no ar (rota `?acao=exportar` do gestaopro-portal, conferindo o sha256).
- Ao mudar arquivos do app em cache, subir `CACHE_VERSION` em `sw.js` (e incluir arquivos novos em `STATIC_ASSETS`).
- Dados de clientes (nome, login, telefone, MAC, senha) não vão para a IA: só códigos e números; textos livres passam por limpeza antes.
- O repositório é público: nada de segredos ou dados de clientes em arquivos.
- O dono não é técnico: explicar em português simples, com passo a passo.
- No fim de cada sessão, atualizar "Onde paramos" e "Histórico" no `CONTEXTO-DO-PROJETO.md`.
