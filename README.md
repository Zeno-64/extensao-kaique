# ZapFlow — extensão do Chrome para WhatsApp Web

Painel lateral dentro do WhatsApp Web com CRM, respostas rápidas, agendamentos, lembretes, disparos em massa, exportação de contatos e assistente de IA.

| Aba | O que faz |
|---|---|
| 👤 **Contato** | Notas por conversa, etiquetas próprias para organizar os chats, atalhos (agendar, lembrete, Google Agenda) e exportação para Excel |
| ⚡ **Respostas rápidas** | Categorias coloridas, busca e filtros; texto, imagem, vídeo, documento e **áudio como mensagem de voz**, com 1 clique |
| 🕐 **Agendamentos** | Para contatos ou **grupos**; texto, áudio, vídeo e documento; repete todo dia, dias úteis, semana, mês ou ano |
| 🔔 **Lembretes** | Alerta na tela do WhatsApp + notificação do Windows com botões "Concluir" e "Adiar"; vínculo com a conversa; Google Agenda |
| 📣 **Disparos em massa** | Para lista colada, **planilha Excel/CSV**, conversas, **grupos**, **participantes de grupos**, **etiquetas/listas do WhatsApp** e etiquetas próprias |
| ✨ **IA** | Sugere resposta lendo a conversa, resume, melhora, corrige, encurta e traduz o texto do campo, e aceita pedidos livres (Claude, da Anthropic) |
| ⚙ **Configurações** | Layout, envio, padrões dos disparos, backup e **Diagnóstico** |

Tudo fica salvo **só no seu navegador** (`chrome.storage.local`). O único serviço externo é a API do Claude, e só se você ativar a IA.

---

## Instalação (modo desenvolvedor)

1. Abra `chrome://extensions` (ou `edge://extensions`).
2. Ative **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e selecione esta pasta (onde está o `manifest.json`).
4. Abra/recarregue o **https://web.whatsapp.com** — o painel aparece à direita.

> Depois de atualizar o código, clique em **↻ Recarregar** no card da extensão; a aba do WhatsApp recarrega sozinha.
> Não é preciso rodar `npm` para usar a extensão — o SDK da IA já vem empacotado em `vendor/`.

---

## Como os envios funcionam (sem recarregar a página)

Agendamentos, disparos e o botão ➤ usam, nesta ordem:

1. **Envio direto** pelas funções internas do próprio WhatsApp Web — a mensagem sai **sem abrir a conversa e sem mexer no que você está digitando**.
2. Se isso não estiver disponível (ex.: depois de uma atualização do WhatsApp), a extensão **abre a conversa na tela** (sem recarregar) e envia como um humano, depois volta para a conversa em que você estava.
3. **Recarregar a página** pelo link `web.whatsapp.com/send?phone=` só acontece se você ativar essa opção em Configurações (vem **desligada**).

Use **Configurações → Diagnóstico → Testar integração** para ver quais recursos estão ativos no seu WhatsApp.

---

## Uso rápido

### Respostas rápidas
- **Clique** no título → coloca o texto no campo para revisar. **➤** → envia na hora. **👁** → pré-visualiza. **•••** → editar, duplicar, mover, agendar, usar em disparo, excluir.
- Blocos: uma resposta pode ter vários textos e arquivos, enviados em sequência. Áudios têm a opção **"Enviar como mensagem de voz"**; dá para **gravar o áudio** direto no editor.

### Variáveis
| Variável | Valor |
|---|---|
| `{saudacao}` | Bom dia / Boa tarde / Boa noite |
| `{nome}`, `{primeiro_nome}`, `{telefone}` | Dados do contato |
| `{data}`, `{hora}`, `{dia_semana}`, `{amanha}` | Data e hora do envio |
| `{qualquer_coisa}` | Campo personalizado: perguntado na hora (ex.: `{horario}`); nos disparos vem da coluna da planilha com o mesmo nome |
| `{Olá\|Oi\|E aí}` | Sorteia uma opção a cada envio |

### Contato (CRM)
- Com uma conversa aberta: escreva **notas** (Ctrl+Enter salva), aplique **etiquetas** e use os atalhos **Agendar**, **Lembrete** e **Google Agenda**.
- **Organizar conversas**: clique numa etiqueta para ver as conversas dela, abrir, exportar ou fazer um disparo só para ela.
- **Exportar para Excel (.xlsx)**: contatos salvos, todos os contatos, participantes de grupos, conversas de uma etiqueta/lista do WhatsApp.

### Google Agenda
Os botões "Google Agenda" abrem o formulário de novo evento do Google Agenda **já preenchido** (título, data, duração, descrição) numa nova aba — é só conferir e salvar. Não precisa fazer login na extensão.

### Lembretes
Na hora marcada aparece um **alerta na tela** e uma **notificação do Windows** (com "Concluir" e "Adiar 10 min"). Clicar na notificação abre o WhatsApp na conversa vinculada. Funciona com o Chrome aberto.

### Disparos em massa
1. **Destinatários**: cole a lista, importe uma **planilha (.xlsx ou .csv)** ou use **Do WhatsApp** → conversas, grupos (envia no grupo), participantes de grupos, etiquetas/listas do WhatsApp ou suas etiquetas. Repetidos são ignorados.
2. **Mensagem**: escreva ou carregue uma resposta rápida.
3. **Ritmo**: intervalo aleatório entre mensagens e pausas longas.
4. **Iniciar** (ou agendar o início). Acompanhe, pause, retome, baixe o relatório e reenvie as falhas.

> ⚠️ **Risco de bloqueio**: envio em massa pode fazer o WhatsApp restringir o número. Envie só para quem conhece você, use intervalos longos (15–60 s), pausas e varie o texto com `{a|b}`.

### Assistente de IA
1. Crie uma chave em **console.anthropic.com → API Keys** (o uso é cobrado pela Anthropic na sua conta).
2. Na aba **IA**, cole a chave. Ela fica só neste navegador e **não vai para os backups**.
3. Em "Configurar assistente", descreva seu negócio (a IA usa em todas as respostas), escolha o modelo e a velocidade.

O modelo padrão é o **Claude Opus 5**, com o recurso de *fallback* do servidor ativado: se o filtro de segurança recusar um pedido por engano, a própria API tenta de novo com o modelo recomendado. Você pode trocar para Sonnet 5 (mais rápido/barato) ou Haiku 4.5 (o mais barato). Nada é enviado sozinho — você revisa e clica em "Colocar no campo", "Substituir" ou "Enviar".

---

## Estrutura

```
manifest.json
src/background.js          service worker: alarmes, lembretes/notificações, abrir o WhatsApp na hora, IA (SDK oficial)
src/bridge.js              contexto da página: envio direto, abrir conversas, contatos, etiquetas, grupos, mensagens
src/content/whatsapp.js    envio (direto → interface → recarregar opcional) e automação do DOM (seletores no objeto SEL)
src/content/runner.js      fila de agendamentos e disparos
src/content/ui.js          painel, modais, menus, editor de blocos, seletor de conversas, Google Agenda
src/content/tab-*.js       abas: crm, replies, schedules, reminders, bulk, ai, settings
src/content/util.js        utilitários, variáveis, CSV, planilhas .xlsx (leitura/escrita), ícones
src/content/store.js       dados (chrome.storage.local), arquivos, backup
vendor/anthropic-sdk.mjs   SDK oficial da Anthropic empacotado (gerado por `npm run build:vendor`)
tests/                     testes automatizados (`npm test`)
dev/                       "WhatsApp falso" para testar o painel sem o WhatsApp real (`npm run harness`)
```

## Desenvolvimento

```bash
npm install          # só para desenvolver (testes e reempacotar o SDK)
npm test             # lógica (telefones, planilhas, variáveis…) + service worker (chamada da IA, lembretes, alarmes)
npm run harness      # abre um WhatsApp falso em http://localhost:5178 (?nomods=1 simula WhatsApp sem módulos internos)
npm run build:vendor # reempacota o SDK da Anthropic em vendor/ após atualizar @anthropic-ai/sdk
```

### Se algo parar de funcionar depois de uma atualização do WhatsApp
1. Rode **Configurações → Diagnóstico** com uma conversa aberta.
2. Itens de "módulo interno" com ❌: ajuste os nomes em `src/bridge.js` (a lista de módulos verificados está no topo do arquivo). Enquanto isso, a extensão continua enviando pela interface.
3. Itens de "campo de mensagem"/"anexo" com ❌: ajuste o objeto `SEL` em `src/content/whatsapp.js` (use "Inspecionar elemento" no WhatsApp).

---

Uso por sua conta e risco. Não é afiliado ao WhatsApp/Meta nem ao WaSpeed. Respeite a LGPD e os Termos do WhatsApp: envie mensagens apenas para quem consentiu em recebê-las.
