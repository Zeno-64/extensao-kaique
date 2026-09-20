/*
 * ZapFlow — Configurações.
 * A engrenagem do painel abre o menu rápido ("Menu Lateral Configurações"); a janela completa
 * (Geral, Notificações, Funcionalidades do Menu/do Chat, Diagnóstico) abre pela barra da esquerda
 * ou pelo botão "Todas as configurações".
 */
(() => {
  'use strict';
  const ZF = window.ZF;
  const { h, icon, store, ui } = ZF;

  // valores recém-alterados aqui valem até as configurações chegarem de volta do storage
  let pending = {};
  ZF.on('settings', () => { pending = {}; });
  const cur = () => ({ ...store.DEFAULT_SETTINGS, ...(ui.settings || {}), ...pending });
  const save = (patch, { quiet = false } = {}) => {
    Object.assign(pending, patch);
    return store.saveSettings(patch).then(() => { if (!quiet) ui.toast('Configuração salva', 'ok', 1200); });
  };

  /* ---------------- peças ---------------- */
  /** Linha: ícone + texto (+ explicação) + controle à direita. Com onClick vira um botão. */
  function row({ icon: ic, label, hint, control, onClick }) {
    const kids = [
      ic ? h('span', { class: 'zf-srow-icon' }, icon(ic, 18)) : null,
      h('div', { class: 'zf-srow-text' }, h('div', { class: 'zf-srow-label' }, label), hint ? h('div', { class: 'zf-srow-hint' }, hint) : null),
      control ? h('div', { class: 'zf-srow-ctl' }, control) : null,
    ];
    if (onClick) return h('button', { class: 'zf-srow click', onclick: ui.safe(onClick) }, kids, icon('chevronRight', 16));
    return h('div', { class: 'zf-srow' }, kids);
  }
  const card = (title, ...rows) => h('div', { class: 'zf-scard' }, title ? h('div', { class: 'zf-scard-title' }, title) : null, rows);
  const sw = (key, { invert = false, after } = {}) => ui.switch(invert ? !cur()[key] : !!cur()[key], (v) => {
    save({ [key]: invert ? !v : v });
    if (after) after(v);
  });
  const select = (key, options, { after } = {}) => ui.select(options, cur()[key], {
    onchange: (e) => { save({ [key]: e.target.value }); if (after) after(e.target.value); },
  });
  const number = (key, min, max, width = '90px') => ui.input({
    type: 'number', min, max, value: cur()[key], style: { width },
    onchange: (e) => {
      const v = Math.max(min, Math.min(max, Number(e.target.value) || min));
      e.target.value = v;
      save({ [key]: v });
    },
  });
  /** "Tamanho do Menu Lateral": muda a largura do painel ao vivo e salva ao soltar */
  function widthSlider() {
    const w = Math.max(380, Math.min(600, Number(cur().panelWidth) || 380));
    const val = h('b', {}, `${w} px`);
    const input = h('input', {
      type: 'range', class: 'zf-range', min: 380, max: 600, step: 10, value: w,
      oninput: (e) => {
        val.textContent = `${e.target.value} px`;
        ui.wrap.style.setProperty('--w', e.target.value + 'px');
        document.documentElement.style.setProperty('--zapflow-w', e.target.value + 'px');
      },
      onchange: (e) => save({ panelWidth: Number(e.target.value) }, { quiet: true }),
    });
    return { val, input };
  }
  const version = () => chrome.runtime.getManifest().version;

  /** Nome que vai na assinatura (para mostrar ao usuário) */
  async function signatureHint(el) {
    const s = cur();
    if (s.signatureCustom && String(s.signatureName || '').trim()) {
      el.textContent = `As mensagens começam com *${s.signatureName.trim()}:*`;
      return;
    }
    const r = await ZF.wa.bridge('me', {}, 3000);
    el.textContent = r && r.ok && r.name
      ? `Usando o nome do seu perfil do WhatsApp: *${r.name}:*`
      : 'Não encontrei o nome do seu perfil — ligue "Personalizar o nome" e escreva o nome.';
  }

  /* ---------------- menu rápido da engrenagem ---------------- */
  let quickEl = null;
  let quickBtn = null;
  function closeQuick() {
    if (quickEl) quickEl.remove();
    quickEl = null;
    if (quickBtn) quickBtn.classList.remove('active');
  }
  ui.quickSettings = (anchor) => {
    if (quickEl && quickEl.isConnected) return closeQuick();
    closeQuick();
    ui.closeMenu();
    quickBtn = anchor;
    const nameInput = ui.input({
      value: cur().signatureName || '', placeholder: 'Nome na assinatura (ex.: Kaique)',
      onchange: (e) => save({ signatureName: e.target.value.trim() }, { quiet: true }),
    });
    const nameBox = h('div', { class: 'zf-qs-name', style: { display: cur().signatureCustom ? '' : 'none' } }, nameInput);
    const line = (label, control) => h('div', { class: 'zf-qs-row' }, h('span', {}, label), control);
    const slider = widthSlider();
    quickEl = h('div', { class: 'zf-qs' },
      h('div', { class: 'zf-qs-title' }, 'Menu Lateral Configurações'),
      line('Desabilitar monitor de envios', sw('hideMonitor')),
      line('Assinar as mensagens', sw('signature')),
      line('Personalizar o nome da assinatura', sw('signatureCustom', { after: (v) => { nameBox.style.display = v ? '' : 'none'; if (v) nameInput.focus(); } })),
      nameBox,
      h('div', { class: 'zf-qs-slider' }, h('div', {}, 'Tamanho do Menu Lateral: ', slider.val), slider.input),
      h('div', { class: 'zf-qs-actions' },
        h('button', { class: 'zf-btn sm', onclick: () => { closeQuick(); ui.openSettings(); } }, icon('settings', 14), 'Todas as configurações'),
        h('button', { class: 'zf-btn sm zf-btn-outline-danger', onclick: closeQuick }, 'Fechar Menu')));
    ui.panel.appendChild(quickEl);
    anchor.classList.add('active');
  };
  // clicar fora fecha o menu rápido
  const outside = (e) => {
    if (!quickEl) return;
    const path = e.composedPath();
    if (!path.includes(quickEl) && !path.includes(quickBtn)) closeQuick();
  };
  document.addEventListener('mousedown', outside, true);

  /* ---------------- janela de Configurações ---------------- */
  function buildGeneral(close) {
    return [
      card(null,
        row({
          icon: 'moon', label: 'Modo escuro', hint: 'Automático = igual ao tema do WhatsApp',
          control: select('theme', [{ value: 'auto', label: 'Automático' }, { value: 'light', label: 'Claro' }, { value: 'dark', label: 'Escuro' }]),
        })),
      card(null,
        row({ icon: 'download', label: 'Criar backup do sistema', hint: 'Escolha o que salvar e baixe o arquivo', onClick: () => ZF.backup.exportFlow() }),
        row({ icon: 'upload', label: 'Importar backup', hint: 'Juntar ou substituir pelos dados de um arquivo de backup', onClick: () => ZF.backup.importFlow() }),
        row({ icon: 'cloud', label: 'Backup automático', hint: 'Manda um arquivo com tudo para o seu próprio WhatsApp', control: select('backupFreq', ZF.backup.FREQS) }),
        ZF.backup.autoBox()),
      h('div', { class: 'zf-sgrid' },
        card(null, row({ icon: 'bot', label: 'Assistente IA', hint: 'Chave da API, modelo e instruções', onClick: () => { close(); ui.openView('ai'); } })),
        card(null, row({ icon: 'contactCard', label: 'Exportar todos os perfis do contato', hint: 'Planilha do Excel com nome e telefone', onClick: () => ZF.exportContacts.allContacts() }))),
    ];
  }

  function buildNotifications() {
    return [
      card(null,
        row({ icon: 'bell', label: 'Notificações do Windows', hint: 'Lembretes, campanha concluída, falhas de envio e backup automático', control: sw('notifications') }),
        row({ icon: 'activity', label: 'Monitor de envios', hint: 'Linha no rodapé do painel mostrando os envios automáticos em andamento', control: sw('hideMonitor', { invert: true }) }),
        row({ icon: 'externalLink', label: 'Abrir o WhatsApp Web sozinho', hint: 'Quando houver envio programado e o WhatsApp Web estiver fechado', control: sw('autoOpenWhatsApp') })),
    ];
  }

  function buildMenu() {
    const slider = widthSlider();
    return [
      card('Barra lateral',
        row({ icon: 'panelLeft', label: 'Barra fixa à esquerda do WhatsApp', hint: 'Atalhos do ZapFlow ao lado da barra de ícones do WhatsApp', control: sw('rail') })),
      card('Botão flutuante',
        row({ icon: 'move', label: 'Mostrar o botão flutuante', hint: 'Clique nele para as opções subirem; segure e arraste para colocar onde quiser na tela', control: sw('dock') }),
        row({ icon: 'refresh', label: 'Voltar o botão para a posição padrão', onClick: () => save({ dockSide: 'right', dockX: 14, dockBottom: null }) })),
      card('Barra de abas no topo',
        row({ icon: 'folderArrow', label: 'Mostrar a barra de abas', control: sw('topBar') }),
        row({
          icon: 'filter', label: 'A barra mostra',
          control: select('barMode', [{ value: 'tabs', label: 'Abas do CRM (ZapFlow)' }, { value: 'labels', label: 'Etiquetas do WhatsApp' }]),
        })),
      card('Painel',
        row({ icon: 'sliders', label: h('span', {}, 'Tamanho do menu lateral: ', slider.val), control: slider.input }),
        row({ icon: 'layers', label: 'Empurrar o WhatsApp para o lado', hint: 'Desligado, o painel fica por cima da conversa', control: sw('pushLayout') }),
        row({
          icon: 'zap', label: 'Ao clicar numa resposta rápida', hint: 'O botão ➤ sempre envia. Na busca: Enter insere, Ctrl+Enter envia.',
          control: select('clickAction', [{ value: 'insert', label: 'Inserir no campo' }, { value: 'send', label: 'Enviar direto' }]),
        })),
    ];
  }

  function buildChat(close, rerender) {
    const hint = h('span', {}, '…');
    signatureHint(hint).catch(() => {});
    const s = cur();
    return [
      card('Assinatura',
        row({ icon: 'signature', label: 'Assinar as mensagens enviadas pelo ZapFlow', hint: 'Respostas rápidas, agendamentos, disparos e IA começam com *Seu nome:*', control: sw('signature', { after: rerender }) }),
        row({ icon: 'edit', label: 'Personalizar o nome da assinatura', hint, control: sw('signatureCustom', { after: rerender }) }),
        s.signatureCustom ? row({
          label: 'Nome na assinatura',
          control: ui.input({ value: s.signatureName || '', placeholder: 'Ex.: Kaique', style: { width: '200px' }, onchange: (e) => save({ signatureName: e.target.value.trim() }).then(() => signatureHint(hint)) }),
        }) : null),
      card('Envios',
        row({ icon: 'globe', label: 'DDI padrão', hint: 'Adicionado a números com até 11 dígitos (ex.: 11 98765-4321)', control: ui.input({ value: s.countryCode, style: { width: '80px' }, onchange: (e) => save({ countryCode: ZF.onlyDigits(e.target.value) || '55' }) }) }),
        row({ icon: 'send', label: 'Enviar direto, sem abrir a conversa', hint: 'Recomendado. Usa as funções internas do WhatsApp Web', control: sw('directSend') }),
        row({ icon: 'corner', label: 'Voltar para a conversa em que eu estava', hint: 'Quando um envio precisar abrir outra conversa', control: sw('restoreChat') }),
        row({ icon: 'refresh', label: 'Recarregar a página se não houver outro jeito', hint: 'Último recurso para abrir a conversa pelo link. Deixe desligado', control: sw('allowReload') }),
        row({ icon: 'clock', label: 'Tolerância de atraso dos agendamentos (minutos)', hint: 'Se o computador estava desligado na hora, envia com atraso até esse limite. 0 = sempre', control: number('lateToleranceMin', 0, 10080) })),
      card('Padrões do envio em massa',
        row({ icon: 'timer', label: 'Intervalo entre mensagens (segundos)', control: number('bulkDelay', 3, 3600) }),
        row({ icon: 'pause', label: 'Pausa longa', hint: 'A cada tantos contatos, pausa por tantos segundos', control: h('div', { class: 'zf-row', style: { gap: '6px' } }, number('bulkPauseEvery', 0, 1000, '74px'), 'contatos /', number('bulkPauseSeconds', 0, 3600, '74px'), 's') })),
    ];
  }

  function buildDiagnostics() {
    const out = h('div', { class: 'zf-diag' }, 'Clique em "Testar integração" com uma conversa aberta.');
    let report = '';
    const copy = h('button', {
      class: 'zf-btn sm', style: { display: 'none' },
      onclick: ui.safe(async () => { await navigator.clipboard.writeText(report); ui.toast('Relatório copiado', 'ok'); }),
    }, icon('copy', 14), 'Copiar relatório');
    const run = ui.safe(async () => {
      out.textContent = 'Verificando…';
      const d = await ZF.wa.diagnostics();
      const yes = (v) => (v ? '✅' : '❌');
      const m = d.bridge || {};
      const s = d.signals || {};
      const direct = m.chats && m.sendText && m.widFactory && m.findChat;
      report = JSON.stringify({ versao: chrome.runtime.getManifest().version, ...d, ua: navigator.userAgent }, null, 2);
      copy.style.display = '';
      out.textContent = [
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
        `${yes(m.me)} Seu número (backup automático) e nome (assinatura)`,
        `${yes(!!d.activeChat)} Conversa aberta pelo WhatsApp${d.activeChat ? ` (${d.activeChat.name || d.activeChat.chatId})` : ''}`,
        `${yes(d.chatOpen)} Conversa aberta na tela (painel:${yes(s.painel)} cabeçalho:${yes(s.cabecalho)})`,
        `${yes(d.compose)} Campo de mensagem encontrado (envio pela interface)`,
        `${yes(d.attach)} Botão de anexo encontrado`,
        `   rodapés visíveis: ${s.rodapes} • campos editáveis: ${s.editaveis}`,
        '',
        direct ? 'Envio direto disponível: agendamentos e disparos não recarregam nem trocam a conversa aberta.'
          : d.compose ? 'Envio direto indisponível: a extensão vai abrir a conversa e enviar pela interface (sem recarregar).'
            : 'Envio direto indisponível. Abra uma conversa e rode de novo para testar o envio pela interface.',
      ].join('\n');
    });
    return [
      card(null,
        row({ icon: 'activity', label: 'Testar integração', hint: 'Se algo parar de funcionar depois de uma atualização do WhatsApp, rode o teste e veja o que falhou', control: h('button', { class: 'zf-btn sm primary', onclick: run }, icon('check', 14), 'Testar') }),
        out,
        h('div', { class: 'zf-row', style: { marginTop: '8px' } }, copy)),
    ];
  }

  const SECTIONS = [
    { key: 'geral', icon: 'settings', label: 'Geral', build: buildGeneral },
    { key: 'notificacoes', icon: 'bell', label: 'Notificações', build: buildNotifications },
    { key: 'menu', icon: 'sliders', label: 'Funcionalidades do Menu', build: buildMenu },
    { key: 'chat', icon: 'messageSquare', label: 'Funcionalidades do Chat', build: buildChat },
    { key: 'diagnostico', icon: 'activity', label: 'Diagnóstico', build: buildDiagnostics },
  ];

  let openEl = null;
  ui.openSettings = (sectionKey = 'geral') => {
    closeQuick();
    ui.closeMenu();
    if (openEl) openEl.remove();
    let current = SECTIONS.find((x) => x.key === sectionKey) || SECTIONS[0];
    const sub = h('span', { class: 'zf-set-sub' });
    const nav = h('div', { class: 'zf-set-nav' });
    const content = h('div', { class: 'zf-set-content' });
    const overlay = h('div', { class: 'zf-overlay global zf-set-overlay' });
    const close = () => { overlay.remove(); openEl = null; };
    const render = () => {
      sub.textContent = current.label;
      nav.replaceChildren(...SECTIONS.map((x) => h('button', {
        class: 'zf-set-navbtn' + (x === current ? ' active' : ''),
        onclick: () => { current = x; render(); },
      }, icon(x.icon, 18), h('span', {}, x.label))));
      const top = content.scrollTop;
      content.replaceChildren();
      ZF.append(content, current.build(close, () => setTimeout(render, 60)),
        h('div', { class: 'zf-set-foot' }, h('span', {}, 'ZapFlow'), h('span', {}, `Versão ${version()}`)));
      content.scrollTop = top;
    };
    const win = h('div', { class: 'zf-set' },
      h('div', { class: 'zf-set-head' },
        h('span', { class: 'zf-set-hicon' }, icon('settings', 20)),
        h('span', { class: 'zf-set-title' }, 'Configurações'), h('span', { class: 'zf-set-bar' }, '|'), sub,
        h('button', { class: 'zf-iconbtn zf-set-x', title: 'Fechar', onclick: close }, icon('x', 20))),
      h('div', { class: 'zf-set-main' }, nav, content));
    overlay.appendChild(win);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !ui.menuEl) close(); });
    overlay.tabIndex = -1;
    ui.wrap.appendChild(overlay);
    openEl = overlay;
    render();
    overlay.focus();
  };

  // A aba "settings" continua registrada (é ela que cria a engrenagem no topo do painel)
  ui.registerTab('settings', {
    icon: 'settings',
    title: 'Configurações',
    render(body) {
      ZF.append(body,
        h('div', { class: 'zf-h2' }, icon('settings', 18), 'Configurações'),
        h('button', { class: 'zf-btn primary block', onclick: () => ui.openSettings() }, icon('settings', 15), 'Abrir as configurações'));
    },
  });
})();
