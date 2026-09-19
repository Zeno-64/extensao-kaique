/* ZapFlow — aba "Configurações" */
(() => {
  'use strict';
  const ZF = window.ZF;
  const { h, icon, store, ui } = ZF;

  /** Backup: automático para o próprio WhatsApp, enviar agora, baixar e importar (também arrastando o arquivo) */
  function backupSection(s, save) {
    const B = ZF.backup;
    const ICONS = { ok: 'check', error: 'alert', warn: 'alert', info: 'clock' };
    const statusEl = h('div', { class: 'zf-backup-status' });
    const paint = async () => {
      const [settings, st] = [await store.settings(), await B.getState()];
      statusEl.replaceChildren(...B.statusLines(settings.backupFreq, st).map((l) =>
        h('div', { class: 'zf-backup-line ' + l.type }, icon(ICONS[l.type], 14), h('span', {}, l.text))));
    };
    paint();
    const off = store.onChange(['backupState', 'settings'], () => (statusEl.isConnected ? paint() : off()));

    const meHint = h('span', {}, 'Deixe vazio para mandar para você mesmo (a conversa "Você" do WhatsApp).');
    B.myPhone().then((me) => {
      if (me) meHint.textContent = `Deixe vazio para mandar para você mesmo: ${ZF.fmtPhone(me.phone)} (a conversa "Você" do WhatsApp).`;
    }).catch(() => {});
    const toInput = ui.input({
      value: s.backupTo || '', placeholder: 'Seu número (automático)', style: { width: '210px' },
      onchange: (e) => {
        const raw = e.target.value.trim();
        if (raw && !ZF.normalizePhone(raw, s.countryCode)) return ui.toast('Número inválido', 'error');
        save({ backupTo: raw });
      },
    });

    const download = ui.safe(async () => {
      ZF.downloadText(B.fileName(Date.now()), JSON.stringify(await store.exportAll()), 'application/json');
    });

    const sec = h('div', { class: 'zf-section zf-drop' },
      h('div', { class: 'zf-h3' }, 'Backup'),
      h('div', { class: 'zf-hint', style: { marginBottom: '10px' } },
        'Os dados do ZapFlow ficam só neste navegador. O backup automático manda um arquivo com tudo para o seu WhatsApp; com ele você restaura em qualquer computador.'),
      ui.field('Backup automático', ui.select(B.FREQS, s.backupFreq || 'monthly', { onchange: (e) => save({ backupFreq: e.target.value }) })),
      ui.field('Enviar para', toInput, meHint),
      statusEl,
      h('div', { class: 'zf-row', style: { flexWrap: 'wrap', gap: '6px', marginTop: '10px' } },
        h('button', { class: 'zf-btn sm primary', onclick: ui.safe(() => B.sendNow()) }, icon('send', 14), 'Enviar backup agora'),
        h('button', { class: 'zf-btn sm', onclick: download }, icon('download', 14), 'Baixar'),
        h('button', { class: 'zf-btn sm', onclick: ui.safe(() => B.importFlow()) }, icon('upload', 14), 'Importar backup')),
      h('div', { class: 'zf-hint', style: { marginTop: '8px' } },
        'Para restaurar: no WhatsApp, abra a conversa "Você", baixe o arquivo zapflow-backup….json e clique em Importar backup (ou arraste o arquivo para este quadro).'));

    // arrastar o arquivo do backup para o quadro
    const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    sec.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); sec.classList.add('over'); });
    sec.addEventListener('dragleave', (e) => { if (!sec.contains(e.relatedTarget)) sec.classList.remove('over'); });
    sec.addEventListener('drop', ui.safe(async (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      sec.classList.remove('over');
      const f = e.dataTransfer.files[0];
      if (f) await B.importFlow(f);
    }));
    return sec;
  }

  function render(body) {
    const s = ui.settings;
    const save = (patch) => store.saveSettings(patch).then(() => ui.toast('Configuração salva', 'ok', 1400));
    const num = (key, min, max) => ui.input({
      type: 'number', min, max, value: s[key],
      onchange: (e) => {
        const v = Math.max(min, Math.min(max, Number(e.target.value) || min));
        e.target.value = v;
        save({ [key]: v });
      },
    });

    const diagOut = h('div', { class: 'zf-hint', style: { whiteSpace: 'pre-wrap' } });
    const runDiag = ui.safe(async () => {
      diagOut.textContent = 'Verificando…';
      const d = await ZF.wa.diagnostics();
      const yes = (v) => (v ? '✅' : '❌');
      const m = d.bridge || {};
      const direct = m.chats && m.sendText && m.widFactory && m.findChat;
      diagOut.textContent = [
        `${yes(d.appReady)} WhatsApp Web carregado`,
        `${yes(m.chats)} Lista de conversas (módulo interno)`,
        `${yes(m.sendText)} Envio de texto direto`,
        `${yes(m.sendMedia)} Envio de arquivos e áudio de voz direto`,
        `${yes(m.cmd)} Abrir conversas sem recarregar`,
        `${yes(m.widFactory && m.findChat && m.queryExists)} Números novos e verificação de WhatsApp`,
        `${yes(m.contacts)} Contatos (exportar)`,
        `${yes(m.labels)} Etiquetas e listas do WhatsApp`,
        `${yes(m.labelEdit)} Colocar/tirar etiquetas pelas respostas rápidas`,
        `${yes(m.vcard)} Cartão de contato`,
        `${yes(m.presence)} "Digitando…" e "gravando áudio…"`,
        `${yes(m.groups)} Participantes de grupos`,
        `${yes(m.me)} Seu número (backup automático)`,
        `${yes(d.chatOpen)} Conversa aberta`,
        `${yes(d.compose)} Campo de mensagem encontrado (envio pela interface)`,
        `${yes(d.attach)} Botão de anexo encontrado`,
        '',
        direct ? 'Envio direto disponível: agendamentos e disparos não recarregam nem trocam a conversa aberta.'
          : d.compose ? 'Envio direto indisponível: a extensão vai abrir a conversa e enviar pela interface (sem recarregar).'
            : 'Envio direto indisponível. Abra uma conversa e rode de novo para testar o envio pela interface.',
      ].join('\n');
    });

    ZF.append(body,
      h('div', { class: 'zf-h2' }, icon('settings', 18), 'Configurações'),

      backupSection(s, save),

      h('div', { class: 'zf-section' },
        h('div', { class: 'zf-h3' }, 'Barra de abas e botões'),
        ui.checkbox('Mostrar a barra de abas no topo do WhatsApp', s.topBar !== false, (v) => save({ topBar: v })),
        ui.field('A barra mostra', ui.select([
          { value: 'tabs', label: 'Abas do CRM (ZapFlow)' },
          { value: 'labels', label: 'Etiquetas do WhatsApp' },
        ], s.barMode || 'tabs', { onchange: (e) => save({ barMode: e.target.value }) })),
        ui.checkbox('Mostrar os botões flutuantes na lateral (IA, quadro, contato, agendamentos, agenda, notas, lembretes)', s.dock !== false, (v) => save({ dock: v }))),

      h('div', { class: 'zf-section' },
        h('div', { class: 'zf-h3' }, 'Painel'),
        ui.checkbox('Empurrar o WhatsApp para o lado (não cobrir a conversa)', s.pushLayout, (v) => save({ pushLayout: v })),
        ui.field('Largura do painel', ui.select([380, 420, 480].map((v) => ({ value: v, label: `${v}px` })), s.panelWidth, { onchange: (e) => save({ panelWidth: Number(e.target.value) }) })),
        ui.field('Ao clicar numa resposta rápida', ui.select([
          { value: 'insert', label: 'Inserir no campo (para revisar antes)' },
          { value: 'send', label: 'Enviar direto' },
        ], s.clickAction, { onchange: (e) => save({ clickAction: e.target.value }) }), 'O botão ➤ sempre envia direto. Na busca: Enter insere, Ctrl+Enter envia.')),

      h('div', { class: 'zf-section' },
        h('div', { class: 'zf-h3' }, 'Envios automáticos'),
        ui.field('DDI padrão', ui.input({ value: s.countryCode, style: { width: '90px' }, onchange: (e) => save({ countryCode: ZF.onlyDigits(e.target.value) || '55' }) }), 'Adicionado a números com até 11 dígitos (ex.: 11 98765-4321).'),
        ui.checkbox('Enviar direto pelo WhatsApp, sem abrir a conversa (recomendado)', s.directSend, (v) => save({ directSend: v })),
        ui.checkbox('Se não der para enviar sem recarregar, recarregar a página e abrir a conversa pelo link (último recurso)', s.allowReload, (v) => save({ allowReload: v })),
        ui.checkbox('Voltar para a conversa em que eu estava quando um envio precisar abrir outra conversa', s.restoreChat, (v) => save({ restoreChat: v })),
        ui.checkbox('Abrir o WhatsApp Web automaticamente quando houver envio programado', s.autoOpenWhatsApp, (v) => save({ autoOpenWhatsApp: v })),
        ui.checkbox('Mostrar notificações (campanha concluída, falhas)', s.notifications, (v) => save({ notifications: v })),
        ui.field('Tolerância de atraso dos agendamentos (minutos)', num('lateToleranceMin', 0, 10080), 'Se o computador estava desligado na hora marcada, envia com atraso até esse limite. 0 = sempre envia.')),

      h('div', { class: 'zf-section' },
        h('div', { class: 'zf-h3' }, 'Padrões do envio em massa'),
        h('div', { class: 'zf-grid2' }, ui.field('Intervalo mínimo (s)', num('bulkMinDelay', 3, 3600)), ui.field('Intervalo máximo (s)', num('bulkMaxDelay', 3, 3600))),
        h('div', { class: 'zf-grid2' }, ui.field('Pausa a cada (msgs)', num('bulkPauseEvery', 0, 1000)), ui.field('Pausa de (min)', num('bulkPauseMinutes', 0, 600)))),

      h('div', { class: 'zf-section' },
        h('div', { class: 'zf-h3' }, 'Diagnóstico'),
        h('div', { class: 'zf-hint', style: { marginBottom: '8px' } }, 'Se algo parar de funcionar depois de uma atualização do WhatsApp, rode o teste e veja o que falhou.'),
        h('button', { class: 'zf-btn sm', onclick: runDiag }, icon('check', 14), 'Testar integração'),
        diagOut),

      h('div', { class: 'zf-muted zf-small', style: { textAlign: 'center', margin: '8px 0' } }, `ZapFlow v${chrome.runtime.getManifest().version}`),
    );
  }

  ui.registerTab('settings', { icon: 'settings', title: 'Configurações', render });
})();
