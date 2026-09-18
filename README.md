# ZapFlow — extensão do Chrome para WhatsApp Web

Painel lateral dentro do WhatsApp Web com:

- **⚡ Respostas rápidas** — categorias coloridas, busca, filtros (Tudo, Por Tipo, Sem Categoria, Por Categoria, Mais Usadas), textos + arquivos (PDF, imagem, vídeo…) enviados em sequência.
- **🕐 Mensagens agendadas** — para um número, para a conversa aberta ou para um grupo; com repetição (diária, dias úteis, semanal, mensal).
- **👥 Envio em massa** — cole uma lista ou importe CSV, personalize com variáveis, intervalos aleatórios, pausas longas, relatório CSV e reenvio das falhas.

Tudo fica salvo **só no seu navegador** (`chrome.storage.local`). Nenhum servidor externo.

---

## Instalação (modo desenvolvedor)

1. Abra `chrome://extensions` no Chrome (ou Edge: `edge://extensions`).
2. Ative **Modo do desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação** e selecione esta pasta (`extensao`, onde está o `manifest.json`).
4. Abra/recarregue o **https://web.whatsapp.com** — o painel aparece à direita.
   - O ícone ⚡ da extensão na barra do Chrome abre/fecha o painel.
   - Com o painel fechado, há uma aba azul ⚡ na borda direita para reabrir.

> Depois de editar o código, clique em **↻ Recarregar** no card da extensão. A aba do WhatsApp é recarregada automaticamente.

---

## Como usar

### Respostas rápidas
- **Clique na resposta** → insere o texto no campo (para você revisar). Configurável para "enviar direto".
- **➤** → envia na hora na conversa aberta. **👁** → pré-visualiza. **•••** → editar, duplicar, mover, agendar, usar em massa, excluir.
- Botão de camadas (ao lado da busca) → nova resposta / nova categoria / expandir ou recolher tudo.
- Na busca: **Enter** insere o primeiro resultado, **Ctrl+Enter** envia.
- Uma resposta pode ter vários **blocos** (texto, arquivo com legenda, outro texto…) que são enviados em sequência.

### Variáveis
| Variável | Valor |
|---|---|
| `{saudacao}` | Bom dia / Boa tarde / Boa noite |
| `{nome}`, `{primeiro_nome}` | Nome do contato (da conversa aberta ou da lista) |
| `{telefone}` | Telefone do contato |
| `{data}`, `{hora}`, `{dia_semana}` | Data, hora e dia da semana no momento do envio |
| `{amanha}` | Data de amanhã |
| `{qualquer_coisa}` | **Campo personalizado**: a extensão pergunta o valor na hora (ex.: `{horario}`). Em massa, vem da coluna do CSV com o mesmo nome. |
| `{Olá\|Oi\|E aí}` | **Spintax**: sorteia uma opção a cada envio |

Formatação do WhatsApp funciona normalmente: `*negrito*`, `_itálico_`, `~riscado~`.

### Agendamentos
- **Novo agendamento** já preenche a conversa aberta (botão "Usar conversa aberta" também serve para grupos).
- É preciso o **Chrome aberto** na hora marcada. Se o WhatsApp Web estiver fechado, a extensão abre uma aba fixada sozinha.
- Se o computador estava desligado, o envio atrasado acontece até o limite de tolerância (padrão: 12 h; ajustável em Configurações). Passou disso, vira "Perdido".
- Se você estiver digitando no WhatsApp, o envio automático espera alguns segundos para não atrapalhar, e depois volta para a conversa em que você estava.

### Envio em massa
1. **Nova campanha** → cole os contatos (um por linha: `11987654321;Maria` ou `Maria, 11 98765-4321`) ou **Importar CSV**.
   - CSV com cabeçalho: a coluna de telefone é detectada (`telefone`, `celular`, `whatsapp`…), `nome` vira `{nome}` e **qualquer outra coluna vira variável** (`horario` → `{horario}`).
   - Números com até 11 dígitos recebem o DDI `+55` (configurável). Para outros países, comece com `+`.
2. Escreva a mensagem (ou carregue uma resposta rápida).
3. Ajuste o ritmo: intervalo aleatório entre mensagens e pausa longa a cada N mensagens.
4. **Iniciar envio** (ou agendar o início). Acompanhe o progresso, pause/retome/cancele, baixe o relatório CSV e use **Reenviar falhas**.
- Números sem WhatsApp são marcados como "Sem WhatsApp". Após 5 falhas seguidas a campanha pausa sozinha.

> ⚠️ **Risco de bloqueio**: envio em massa pode fazer o WhatsApp restringir ou banir o número. Envie só para quem conhece você (pacientes, clientes), use intervalos longos (15–60 s), pausas, varie o texto com `{a|b}` e evite muitos links.

### Configurações
Layout (empurrar ou sobrepor), largura, ação do clique, DDI padrão, modo rápido, tolerância de atraso, padrões do envio em massa, **backup** (exportar / juntar / restaurar JSON) e **Diagnóstico**.

---

## Como funciona por dentro

```
manifest.json
src/background.js          service worker: alarmes, abre o WhatsApp na hora, notificações
src/bridge.js              roda no contexto da página: abre conversas sem recarregar (módulos internos do WA)
src/content/util.js        utilitários, variáveis, CSV, ícones
src/content/store.js       dados em chrome.storage.local (+ arquivos em base64, backup)
src/content/whatsapp.js    automação do DOM do WhatsApp (SELETORES ficam no objeto SEL)
src/content/runner.js      fila de envios (agendamentos e campanhas), retomada após recarregar
src/content/ui.js          painel, modais, menus, editor de blocos
src/content/tab-*.js       as quatro abas
src/content/panel.css      visual (Shadow DOM, segue o tema claro/escuro do WhatsApp)
```

**Abrir conversa de um número** tem dois modos:
1. **Rápido** (padrão): usa módulos internos do WhatsApp Web para abrir a conversa sem recarregar.
2. **Seguro** (fallback automático): abre `web.whatsapp.com/send?phone=…`, que recarrega a página; o envio continua sozinho depois do carregamento.

**Enviar** é feito como um humano faria: escreve no campo de mensagem (evento de colar), clica em enviar, e para arquivos cola o arquivo e envia pela tela de pré-visualização (com fallback pelo botão de anexo).

### Se parar de funcionar depois de uma atualização do WhatsApp
1. Abra **Configurações → Diagnóstico → Testar integração** com uma conversa aberta.
2. O que aparecer com ❌ indica o seletor a ajustar em `src/content/whatsapp.js` (objeto `SEL`) — use o "Inspecionar elemento" do Chrome no WhatsApp para achar o novo seletor.
3. Se a "abertura rápida" falhar, desmarque **modo rápido** nas Configurações: tudo continua funcionando pelo modo seguro (só fica mais lento).

### Dicas
- Deixe a aba do WhatsApp **fixada** e, durante campanhas grandes, **visível** (abas em segundo plano ficam mais lentas).
- Arquivos anexados ficam guardados no navegador (limite de 30 MB por arquivo). Faça backup de vez em quando.

---

Uso por sua conta e risco. Não é afiliado ao WhatsApp/Meta. Respeite a LGPD e os Termos do WhatsApp: envie mensagens apenas para quem consentiu em recebê-las.
