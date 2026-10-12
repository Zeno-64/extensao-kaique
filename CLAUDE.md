# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

ZapFlow é uma extensão do Chrome (Manifest V3) para o WhatsApp Web: CRM com abas, respostas rápidas com ações, scripts, agendamentos, disparos em massa e IA. **A extensão não tem build**: os arquivos de `src/` são carregados como estão. A interface e os textos são em português do Brasil.

## Comandos

```bash
npm install          # só para desenvolver (testes e reempacotar o SDK)
npm test             # todos os testes (node puro, sem framework)
node tests/waspeed.test.mjs   # um arquivo de teste só
npm run harness      # "WhatsApp falso" em http://localhost:5178 (?nomods=1 simula WhatsApp sem módulos internos)
npm run build:vendor # reempacota @anthropic-ai/sdk em vendor/ (só após atualizar o SDK)
```

Não há linter. Os testes carregam os content scripts com `vm.createContext` (veja `tests/waspeed.test.mjs`), então os arquivos de `src/content/` precisam continuar funcionando como scripts soltos, sem `import`.

## Testar no Chrome

A extensão é carregada "sem compactação" a partir de **uma pasta específica do usuário** (em `chrome://extensions` → Detalhes → "Carregado de"). Nesta máquina ela é `C:\Users\Kaique Gastim\Desktop\extensao-kaique-main`, **não** este repositório (`Documents\extensao-kaique`). Editar o repositório não muda o que o Chrome roda: é preciso copiar os arquivos alterados para essa pasta e recarregar a extensão (ícone de seta circular) e dar F5 no WhatsApp Web. Não troque a pasta carregada: o manifesto não fixa um ID, então mudar de pasta muda o ID da extensão e apaga as respostas e configurações salvas.

Em `.claude/settings.local.json` (ignorado pelo Git) há um hook PostToolUse que faz essa cópia automaticamente depois de cada Edit/Write em `src/`, `icons/`, `vendor/` e `manifest.json`. Alterações feitas por scripts/Bash não disparam o hook: copie à mão.

## Arquitetura

Três contextos de execução, que só se falam por mensagens/eventos:

- **`src/bridge.js`** roda no mundo `MAIN` da página (`document_start`). Usa os módulos internos do WhatsApp (`WAWeb*`) para enviar mensagens sem abrir a conversa, listar conversas/contatos/etiquetas etc. Os nomes dos módulos mudam quando o WhatsApp atualiza; a lista fica no topo do arquivo.
- **`src/content/*.js`** são content scripts (mundo isolado), carregados na ordem do `manifest.json`, todos compartilhando o objeto global `window.ZF` (`ZF.store`, `ZF.ui`, `ZF.wa`, `ZF.runner`, `ZF.waspeed`…). Cada arquivo é um IIFE que se registra em `ZF`. `main.js` inicia tudo.
- **`src/background.js`** é o service worker (módulo ES): alarmes, lembretes, notificações, abrir o WhatsApp na hora de um agendamento e chamadas à API do Claude (SDK em `vendor/`).

Pontos que exigem ler vários arquivos:

- **Envio em 3 camadas** (`whatsapp.js`): envio direto via bridge → automação pela interface (seletores no objeto `SEL`) → recarregar a página (opcional, desligado). Agendamentos, disparos e o botão ➤ passam por `runner.js`/`ZF.runActions` (`actions.js`).
- **Respostas rápidas = lista de ações** (`actions.js`: `ZF.ACTION_TYPES`, `runActions`): texto, arquivos, esperar, "digitando…", etiquetas etc. O editor é `ui.actionsEditor` (`action-editor.js`), reutilizado em `tab-replies.js`. Scripts (`kind: 'script'`) são listas de respostas.
- **Dados** ficam em `chrome.storage.local` via `store.js` (respostas, categorias, agendamentos, CRM; arquivos em chaves `file:<id>`). Backups são `{ app: 'ZapFlow', version: 2, parts?, data }`; `importAll` tem os modos `merge` (não sobrescreve ids existentes) e `replace` (num backup parcial troca só as partes presentes). Mudanças de formato entram em `store.migrate()`.
- **Importação do WaSpeed** (`import-waspeed.js`): o WaSpeed criptografa títulos e categorias; só os textos/ações vêm legíveis, e o título é gerado a partir do texto.
- **Botões flutuantes** (`ui.js`: `ui.placeDock`, `chatCorner`, `waArea`): ficam fixos no canto de baixo à esquerda da conversa (acima da barra de digitação); a posição acompanha o `#main` do WhatsApp e um poll de 700 ms.
- **Layout**: o painel e a barra à esquerda empurram o `#app` do WhatsApp por CSS injetado (`html.zapflow-push`/`zapflow-rail`), com `ui.squeezeApp` consertando contêineres `position: fixed`.
