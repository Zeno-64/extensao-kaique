# ZapFlow — extensão do Chrome para WhatsApp Web

CRM com abas, respostas rápidas com ações, scripts, agendamentos, lembretes, notas, disparos em massa, exportação de contatos e assistente de IA dentro do WhatsApp Web.

## O que aparece no WhatsApp

**Barra de abas no topo:** as abas do CRM (ex.: *P. Antigos*, *Retomar Contato*, *Lead Orgânico*) com a contagem de conversas, mais *Não lidas*, *Favoritos* e *Grupos*. Clicar numa aba mostra só as conversas dela, por cima da lista do WhatsApp.
- Ícone de funil: escolher entre **Abas** (do ZapFlow), **Etiquetas** (do WhatsApp) ou **Ocultar Exibição**.
- 📁+ cria uma aba. ☰ abre o **quadro de atendimento** (Kanban) e o gerenciamento das abas.
- Botão direito numa aba: editar, disparo em massa, exportar ou excluir.

**Botões flutuantes na lateral** (de cima para baixo). Segure e arraste para mudar de lado (direita ou esquerda) ou de altura; também dá para escolher em Configurações → Barra de abas e botões.

| Botão | Faz |
|---|---|
| ✨ | Assistente de IA |
| 📦 | Quadro de atendimento: arraste as conversas entre as abas |
| 👤 | Contato: abas e etiquetas da conversa aberta |
| 🗓⏰ | Mensagens agendadas |
| 📅 | Evento no Google Agenda para a conversa aberta |
| 📝 | Notas |
| ⏰ | Lembretes |
| Logo | Abre ou fecha o painel |

**Painel** (abas no topo do painel):

| Aba | O que faz |
|---|---|
| 👤 **Contato** | Coloca ou tira a conversa das abas do CRM e das etiquetas do WhatsApp. Atalhos para agendar, lembrete e Google Agenda. Gerencia as abas (cor, ordem, disparo, exportação) e exporta contatos para Excel |
| ⚡ **Respostas rápidas** | Categorias, busca e filtros (Tudo, Por Tipo, Sem Categoria, Por Categoria, Mais Usadas). O ⊞ cria **Respostas Rápidas**, **Scripts** e **Categorias** |
| 📝 **Notas** | Notas da conversa aberta e busca em todas as notas |
| 📥 **Disparos em massa** | Para lista colada, **planilha Excel/CSV**, conversas, **grupos**, **participantes de grupos**, **etiquetas do WhatsApp** e **abas do CRM** |
| ⚙ **Configurações** | **Backup** (automático para o seu WhatsApp e importação), barra de abas e botões, envio, padrões dos disparos e **Diagnóstico** |

Tudo fica salvo **só no seu navegador** (`chrome.storage.local`). O único serviço externo é a API do Claude, e só se você ativar a IA.

---

## Respostas rápidas com ações

Uma resposta rápida é uma **sequência de ações**, executadas em ordem pelo botão ➤ na conversa aberta. Em **Adicionar Ação**:

| Grupo | Ações |
|---|---|
| **Enviar Mensagem** | Texto, Imagem, Vídeo, Áudio (arquivo ou gravado na hora, como mensagem de voz), Documentos, **Pix** (código copia e cola gerado na hora), Convite para Grupo, **Contato** (cartão de contato), Link com Banner, Figurinha, Lista de opções, Localização |
| **Aba do CRM** | Adicionar a um CRM, Remover de um CRM, Remover de todos CRMs |
| **Etiquetas** | Adicionar/remover etiqueta do WhatsApp, remover todas |
| **Temporizadores** | Aguardar, "Digitando…", "Gravando áudio…" (o contato vê o status) |
| **Utilitários** | Agendar mensagem de retorno, criar lembrete, adicionar nota, evento no Google Agenda, marcar como não lida, arquivar, fixar |
| **Transferir Atendimento** | Avisa o cliente, manda os dados dele para o WhatsApp do atendente e move para uma aba. "Finalizar atendimento": despedida, sai das abas, marca como lida e arquiva (opcional) |

- **Clique** no título: coloca o texto no campo para revisar. **➤**: executa tudo. **👁**: mostra as ações. **•••**: editar, duplicar, mover, agendar, usar em disparo, excluir.
- **#Tags** insere variáveis no campo selecionado.
- **Scripts**: sequência de respostas rápidas (ex.: boas-vindas → valores → agendamento). Dá para enviar etapa por etapa ou todas, com intervalo entre elas.

### Variáveis
| Variável | Valor |
|---|---|
| `{saudacao}` | Bom dia / Boa tarde / Boa noite |
| `{nome}`, `{primeiro_nome}`, `{telefone}`, `{numero}` | Dados do contato (`{numero}` só com dígitos, para links wa.me) |
| `{data}`, `{hora}`, `{dia_semana}`, `{amanha}` | Data e hora do envio |
| `{atendente}` | Nome do atendente (na transferência) |
| `{qualquer_coisa}` | Campo personalizado: perguntado na hora (ex.: `{horario}`); nos disparos vem da coluna da planilha com o mesmo nome |
| `{Olá\|Oi\|E aí}` | Sorteia uma opção a cada envio |

---

## Instalação (modo desenvolvedor)

1. Abra `chrome://extensions` (ou `edge://extensions`).
2. Ative **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e selecione esta pasta (onde está o `manifest.json`).
4. Abra/recarregue o **https://web.whatsapp.com**.

> Depois de atualizar o código, clique em **↻ Recarregar** no card da extensão; a aba do WhatsApp recarrega sozinha.
> Não é preciso rodar `npm` para usar a extensão — o SDK da IA já vem empacotado em `vendor/`.
> Ao atualizar da v1.1, as respostas rápidas antigas são convertidas automaticamente para o formato de ações, e as "etiquetas próprias" viram **abas do CRM**.

---

## Como os envios funcionam (sem recarregar a página)

Agendamentos, disparos e o botão ➤ usam, nesta ordem:

1. **Envio direto** pelas funções internas do próprio WhatsApp Web — a mensagem sai **sem abrir a conversa e sem mexer no que você está digitando**.
2. Se isso não estiver disponível (ex.: depois de uma atualização do WhatsApp), a extensão **abre a conversa na tela** (sem recarregar) e envia como um humano, depois volta para a conversa em que você estava. Nesse caso o cartão de contato vai como texto e a figurinha como foto.
3. **Recarregar a página** pelo link `web.whatsapp.com/send?phone=` só acontece se você ativar essa opção em Configurações (vem **desligada**).

Use **Configurações → Diagnóstico → Testar integração** para ver quais recursos estão ativos no seu WhatsApp.

---

## Outros recursos

### Backup automático
Todo mês (ou toda semana), o ZapFlow manda um arquivo `zapflow-backup-AAAA-MM-DD.json` com tudo (respostas rápidas, scripts, abas, notas, agendamentos, lembretes, campanhas e arquivos) para a conversa **"Você"** do seu próprio WhatsApp. Configure em **Configurações → Backup**:
- **Backup automático**: todo mês (padrão), toda semana ou desligado. O primeiro sai logo depois de instalar/atualizar. Se o computador estiver desligado na data, sai na próxima vez que o WhatsApp Web for aberto; se falhar, tenta de novo a cada hora (e avisa por notificação).
- **Enviar para**: vazio = seu próprio número. Dá para colocar outro número (ex.: o celular da clínica).
- **Enviar backup agora** e **Baixar** (salva o arquivo no computador).
- A chave da IA **não** vai para o backup.

**Importar backup** (em outro computador ou depois de reinstalar): no WhatsApp, abra a conversa "Você", baixe o arquivo do backup e clique em **Importar backup** (ou arraste o arquivo para o quadro Backup). A tela mostra o que tem no arquivo e pergunta como importar:
- **Juntar com os dados atuais** (recomendado): mantém o que já existe e adiciona o que falta.
- **Substituir tudo**: deixa tudo igual ao backup. Antes, baixa uma cópia dos dados atuais por segurança.

### Google Agenda
Os botões de Google Agenda abrem o formulário de novo evento **já preenchido** (título, data, duração, descrição) numa nova aba — é só conferir e salvar. Não precisa fazer login na extensão.

### Lembretes
Na hora marcada aparece um **alerta na tela** e uma **notificação do Windows** (com "Concluir" e "Adiar 10 min"). Clicar na notificação abre o WhatsApp na conversa vinculada. Funciona com o Chrome aberto.

### Disparos em massa
1. **Destinatários**: cole a lista, importe uma **planilha (.xlsx ou .csv)** ou use **Do WhatsApp** → conversas, grupos (envia no grupo), participantes de grupos, etiquetas do WhatsApp ou abas do CRM. Repetidos são ignorados.
2. **Mensagem**: escreva ou carregue uma resposta rápida (as mensagens dela entram; automações ficam de fora).
3. **Ritmo**: intervalo aleatório entre mensagens e pausas longas.
4. **Iniciar** (ou agendar o início). Acompanhe, pause, retome, baixe o relatório e reenvie as falhas.

> ⚠️ **Risco de bloqueio**: envio em massa pode fazer o WhatsApp restringir o número. Envie só para quem conhece você, use intervalos longos (15–60 s), pausas e varie o texto com `{a|b}`.

### Assistente de IA
1. Crie uma chave em **console.anthropic.com → API Keys** (o uso é cobrado pela Anthropic na sua conta).
2. No botão ✨, cole a chave. Ela fica só neste navegador e **não vai para os backups**.
3. Em "Configurar assistente", descreva seu negócio (a IA usa em todas as respostas), escolha o modelo e a velocidade.

O modelo padrão é o **Claude Opus 5**, com o recurso de *fallback* do servidor ativado: se o filtro de segurança recusar um pedido por engano, a própria API tenta de novo com o modelo recomendado. Você pode trocar para Sonnet 5 (mais rápido/barato) ou Haiku 4.5 (o mais barato). Nada é enviado sozinho — você revisa e clica em "Colocar no campo", "Substituir" ou "Enviar".

---

## Estrutura

```
manifest.json
src/background.js           service worker: alarmes, lembretes/notificações, abrir o WhatsApp na hora, IA (SDK oficial)
src/bridge.js               contexto da página: envio direto (texto, mídia, figurinha, contato, banner), abrir conversas,
                            etiquetas, arquivar/fixar/não lida, "digitando…", contatos, grupos, mensagens
src/content/actions.js      catálogo das ações, Pix copia e cola, vCard, conversões e execução das respostas rápidas
src/content/action-editor.js editor "Ação do Resposta Rápida" (Adicionar Ação, #Tags, campos de cada ação)
src/content/topbar.js       barra de abas no topo, lista filtrada de conversas e quadro de atendimento (Kanban)
src/content/whatsapp.js     envio (direto → interface → recarregar opcional) e automação do DOM (seletores no objeto SEL)
src/content/runner.js       fila de agendamentos e disparos
src/content/backup.js       backup automático (documento para o seu WhatsApp) e importação
src/content/ui.js           painel, botões flutuantes, modais, menus (inclusive em sanfona), emojis, seletores
src/content/tab-*.js        telas: crm (Contato), replies, notes, schedules, reminders, bulk, ai, settings
src/content/util.js         utilitários, variáveis, CSV, planilhas .xlsx (leitura/escrita), ícones, imagens
src/content/store.js        dados (chrome.storage.local), arquivos, backup e migração de versões
vendor/anthropic-sdk.mjs    SDK oficial da Anthropic empacotado (gerado por `npm run build:vendor`)
tests/                      testes automatizados (`npm test`)
dev/                        "WhatsApp falso" para testar o painel sem o WhatsApp real (`npm run harness`)
```

## Desenvolvimento

```bash
npm install          # só para desenvolver (testes e reempacotar o SDK)
npm test             # lógica (telefones, planilhas, variáveis, Pix, ações, backup…) + service worker (IA, lembretes, alarmes)
npm run harness      # abre um WhatsApp falso em http://localhost:5178 (?nomods=1 simula WhatsApp sem módulos internos)
npm run build:vendor # reempacota o SDK da Anthropic em vendor/ após atualizar @anthropic-ai/sdk
```

### Se algo parar de funcionar depois de uma atualização do WhatsApp
1. Rode **Configurações → Diagnóstico** com uma conversa aberta.
2. Itens de "módulo interno" com ❌: ajuste os nomes em `src/bridge.js` (a lista de módulos verificados está no topo do arquivo). Enquanto isso, a extensão continua enviando pela interface.
3. Itens de "campo de mensagem"/"anexo" com ❌: ajuste o objeto `SEL` em `src/content/whatsapp.js` (use "Inspecionar elemento" no WhatsApp).

---

Uso por sua conta e risco. Não é afiliado ao WhatsApp/Meta nem ao WaSpeed. Respeite a LGPD e os Termos do WhatsApp: envie mensagens apenas para quem consentiu em recebê-las.
