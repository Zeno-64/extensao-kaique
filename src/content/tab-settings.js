/* ZapFlow — aba "Configurações" */
(() => {
  'use strict';
  const ZF = window.ZF;
  const { h, icon, store, ui } = ZF;

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
        `${yes(m.groups)} Participantes de grupos`,
        `${yes(d.chatOpen)} Conversa aberta`,
        `${yes(d.compose)} Campo de mensagem encontrado (envio pela interface)`,
        `${yes(d.attach)} Botão de anexo encontrado`,
        '',
        direct ? 'Envio direto disponível: agendamentos e disparos não recarregam nem trocam a conversa aberta.'
          : d.compose ? 'Envio direto indisponível: a extensão vai abrir a conversa e enviar pela interface (sem recarregar).'
            : 'Envio direto indisponível. Abra uma conversa e rode de novo para testar o envio pela interface.',
      ].join('\n');
    });

    const exportBackup = ui.safe(async () => {
      const json = await store.exportAll();
      ZF.downloadText(`zapflow-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(json), 'application/json');
    });
    const importBackup = ui.safe(async () => {
      const f = await ZF.pickFile('.json,application/json');
      if (!f) return;
      const json = JSON.parse(await ZF.readFileAsText(f));
      const replace = await ui.confirm('Como importar?\n\n• Confirmar = SUBSTITUIR tudo pelos dados do backup\n• Cancelar = não importar\n\n(Para juntar com os dados atuais, use "Juntar backup").', { okLabel: 'Substituir tudo', danger: true, title: 'Importar backup' });
      if (!replace) return;
      await store.importAll(json, 'replace');
      ui.toast('Backup importado', 'ok');
      ui.rerender();
    });
    const mergeBackup = ui.safe(async () => {
      const f = await ZF.pickFile('.json,application/json');
      if (!f) return;
      await store.importAll(JSON.parse(await ZF.readFileAsText(f)), 'merge');
      ui.toast('Backup combinado com os dados atuais', 'ok');
    });

    ZF.append(body, 
      h('div', { class: 'zf-h2' }, icon('settings', 18), 'Configurações'),

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
        h('div', { class: 'zf-h3' }, 'Backup'),
        h('div', { class: 'zf-hint', style: { marginBottom: '8px' } }, 'Os dados ficam só neste navegador. Faça backup para levar para outro computador.'),
        h('div', { class: 'zf-row', style: { flexWrap: 'wrap', gap: '6px' } },
          h('button', { class: 'zf-btn sm', onclick: exportBackup }, icon('download', 14), 'Exportar backup'),
          h('button', { class: 'zf-btn sm', onclick: mergeBackup }, icon('upload', 14), 'Juntar backup'),
          h('button', { class: 'zf-btn sm danger', onclick: importBackup }, icon('upload', 14), 'Restaurar (substituir)'))),

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
