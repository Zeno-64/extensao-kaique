/* ZapFlow — estrutura do painel lateral e componentes reutilizáveis */
(() => {
  'use strict';
  const ZF = window.ZF;
  const { h, icon, store } = ZF;

  const ui = {
    tabs: {},
    order: [],
    current: 'replies',
    open: false,
  };

  // Abas fixas do topo do painel (na ordem dos prints); as demais são telas abertas pela barra lateral
  const TOP = ['crm', 'replies', 'notes', 'bulk', 'settings'];
  ui.registerTab = (name, def) => {
    ui.tabs[name] = { top: TOP.includes(name), ...def };
    ui.order.push(name);
  };

  // Botões flutuantes na lateral do WhatsApp (de cima para baixo; o último fica colado no botão azul)
  const DOCK = [
    { key: 'ai', icon: 'sparkles', title: 'Assistente de IA', view: 'ai' },
    { key: 'kanban', icon: 'box', title: 'Quadro de atendimento (abas do CRM)', run: () => ZF.topbar && ZF.topbar.openKanban() },
    { key: 'crm', icon: 'contactCard', title: 'Contato e abas do CRM', view: 'crm' },
    { key: 'schedules', icon: 'calendarClock', title: 'Mensagens agendadas da conversa', view: 'schedules' },
    { key: 'notes', icon: 'clipboardEdit', title: 'Notas', view: 'notes' },
    { key: 'reminders', icon: 'alarm', title: 'Lembretes', view: 'reminders' },
    { key: 'panel', icon: 'zap', title: 'Abrir o painel do ZapFlow', run: () => ui.toggle() },
  ];
  // Folga entre os botões flutuantes e as bordas da área do WhatsApp
  const DOCK_GAP = 8;

  // Barra fixa à esquerda do WhatsApp (atalhos gerais, como no WaSpeed)
  const RAIL = [
    { key: 'kanban', icon: 'kanban', title: 'CRM — quadro de atendimento', run: () => ZF.topbar && ZF.topbar.openKanban() },
    { key: 'bulk', icon: 'send', title: 'Envio em massa', view: 'bulk' },
    { key: 'ai', icon: 'sparkles', title: 'Assistente IA', view: 'ai' },
    { key: 'schedules', icon: 'calendar', title: 'Agendamentos', view: 'schedules' },
    { key: 'replies', icon: 'zap', title: 'Respostas rápidas', view: 'replies' },
    { key: 'crm', icon: 'contactCard', title: 'Contato e abas do CRM', view: 'crm' },
    { key: 'notes', icon: 'clipboardEdit', title: 'Notas', view: 'notes' },
    { key: 'gcal', icon: 'calendarDays', title: 'Google Agenda', run: () => ui.eventForActiveChat() },
    { key: 'filter', icon: 'filter', title: 'Mostrar/ocultar a barra de abas', run: () => store.saveSettings({ topBar: !(ui.settings && ui.settings.topBar !== false) }) },
    { key: 'reminders', icon: 'bell', title: 'Lembretes', view: 'reminders' },
  ];
  const RAIL_W = 56;

  /* ---------------- erros ---------------- */
  ui.errorMessage = (e) => {
    const msg = (e && e.message) || String(e);
    if (/Extension context invalidated|context invalidated/i.test(msg)) return 'A extensão foi atualizada. Recarregue a página do WhatsApp (F5).';
    return msg;
  };
  /** A extensao foi recarregada: este painel e o fantasma da versao antiga */
  ui.staleBanner = () => {
    if (ui.staleEl || !ui.wrap) return;
    ui.staleEl = h('div', { class: 'zf-stale zf-keep' },
      icon('refresh', 17),
      h('span', { class: 'zf-grow' }, 'O ZapFlow foi atualizado. Recarregue a página do WhatsApp para voltar a usar.'),
      h('button', { class: 'zf-btn sm primary', onclick: () => location.reload() }, 'Recarregar'),
      h('button', { class: 'zf-iconbtn', title: 'Fechar aviso', onclick: () => ui.staleEl.remove() }, icon('x', 16)));
    ui.wrap.appendChild(ui.staleEl);
  };

  /** Envolve handlers de eventos: mostra erros como toast */
  ui.safe = (fn) => async (...args) => {
    try {
      return await fn(...args);
    } catch (e) {
      if (ZF.isContextGone(e)) ZF.shutdown();
      else if (e && e.zfUser) console.warn('[ZapFlow]', e.message);
      else console.error('[ZapFlow]', e);
      ui.toast(ui.errorMessage(e), 'error', 5000);
    }
  };

  /* ---------------- montagem ---------------- */
  ui.mount = async () => {
    if (document.getElementById('zapflow-root')) return;
    const host = document.createElement('div');
    host.id = 'zapflow-root';
    host.style.cssText = 'position:fixed;top:0;right:0;width:0;height:0;z-index:2147483000;';
    document.documentElement.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    ui.root = root;

    const cssUrl = chrome.runtime.getURL('src/content/panel.css');
    try {
      const style = document.createElement('style');
      style.textContent = await fetch(cssUrl).then((r) => r.text());
      root.appendChild(style);
    } catch (e) {
      root.appendChild(h('link', { rel: 'stylesheet', href: cssUrl }));
    }

    ui.wrap = h('div', { class: 'zf' });
    root.appendChild(ui.wrap);

    // lançador simples (só aparece se os botões flutuantes estiverem desligados)
    ui.launcher = h('button', { class: 'zf-launcher zf-keep', title: 'Abrir ZapFlow', onclick: () => ui.toggle(true) }, icon('zap', 20));
    ui.wrap.appendChild(ui.launcher);
    ui.buildRail();
    ui.buildDock();

    ui.tabBtns = {};
    const top = h('div', { class: 'zf-top' },
      TOP.filter((name) => ui.tabs[name]).map((name) => {
        const t = ui.tabs[name];
        // a engrenagem abre o menu rápido ("Menu Lateral Configurações"); as demais trocam de aba
        const b = h('button', {
          class: 'zf-tab', title: t.title,
          onclick: (e) => (name === 'settings' ? ui.quickSettings(e.currentTarget) : ui.setTab(name)),
        }, icon(t.icon, 20));
        ui.tabBtns[name] = b;
        return b;
      }),
      h('button', { class: 'zf-tab zf-close', title: 'Fechar painel', onclick: () => ui.toggle(false) }, icon('x', 20)),
    );
    ui.body = h('div', { class: 'zf-body' });
    ui.busyEl = h('div', { class: 'zf-status' });
    ui.statusEl = h('div', { class: 'zf-status' });
    ui.panel = h('div', { class: 'zf-panel' }, top, ui.body, ui.busyEl, ui.statusEl);
    ui.toasts = h('div', { class: 'zf-toasts zf-keep' });
    ui.wrap.appendChild(ui.toasts);

    // Layout: painel "empurra" o WhatsApp; a barra de abas desce o WhatsApp
    const layout = document.createElement('style');
    layout.id = 'zapflow-layout';
    layout.textContent = [
      'html.zapflow-push #app{width:calc(100% - var(--zapflow-w,380px))!important;min-width:0!important;}',
      'html.zapflow-rail #app{left:var(--zapflow-rail,56px)!important;width:calc(100% - var(--zapflow-rail,56px))!important;min-width:0!important;}',
      'html.zapflow-rail.zapflow-push #app{width:calc(100% - var(--zapflow-w,380px) - var(--zapflow-rail,56px))!important;}',
      'html.zapflow-bar #app{top:var(--zapflow-bar-h,40px)!important;height:calc(100% - var(--zapflow-bar-h,40px))!important;min-height:0!important;}',
    ].join('\n');
    (document.head || document.documentElement).appendChild(layout);

    // Acompanha o tema claro/escuro do WhatsApp
    const syncTheme = () => {
      const theme = (ui.settings && ui.settings.theme) || 'auto';
      const waDark = document.body.classList.contains('dark') || document.documentElement.classList.contains('dark');
      ui.wrap.classList.toggle('dark', theme === 'dark' || (theme === 'auto' && waDark));
    };
    ui.syncTheme = syncTheme;
    syncTheme();
    new MutationObserver(syncTheme).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    new MutationObserver(syncTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    // Fecha menus ao clicar fora (dentro ou fora do ZapFlow)
    root.addEventListener('mousedown', (e) => {
      if (ui.menuEl && !e.composedPath().includes(ui.menuEl)) ui.closeMenu();
    });
    document.addEventListener('mousedown', (e) => {
      if (ui.menuEl && !e.composedPath().includes(host)) ui.closeMenu();
    }, true);
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape') { ui.closeMenu(); ui.toggleDock(false); } });

    const settings = await store.settings();
    ui.settings = settings;
    // Configurações abrem numa janela própria; o painel volta para as respostas
    ui.current = settings.lastTab && ui.tabs[settings.lastTab] && settings.lastTab !== 'settings' ? settings.lastTab : 'replies';
    ui.applySettings(settings);
    ui.toggle(settings.panelOpen, false);

    store.onChange(['settings'], async () => {
      ui.settings = await store.settings();
      ui.applySettings(ui.settings);
    });
    store.onChange(['schedules', 'campaigns', 'reminders'], () => ui.updateBadges());
    ui.updateBadges();
    ZF.every(30000, ui.updateBadges);

    ZF.on('runner', (st) => ui.renderStatus(st));
    ZF.every(1000, () => ui.renderStatus(ZF.runner && ZF.runner.state));
  };

  ui.applySettings = (s) => {
    const w = Math.max(380, Math.min(600, Number(s.panelWidth) || 380));
    ui.wrap.style.setProperty('--w', w + 'px');
    document.documentElement.style.setProperty('--zapflow-w', w + 'px');
    document.documentElement.classList.toggle('zapflow-push', !!(ui.open && s.pushLayout));
    ui.wrap.classList.toggle('zf-open', !!ui.open);
    if (ui.dock) ui.dock.style.display = s.dock === false ? 'none' : '';
    if (ui.launcher) ui.launcher.style.display = s.dock === false && !ui.open ? '' : 'none';
    ui.applyRail(s);
    ui.placeDock(s);
    if (ui.syncTheme) ui.syncTheme();
    ZF.emit('settings', s);
  };

  ui.toggle = (open = !ui.open, persist = true) => {
    ui.open = open;
    if (open) {
      if (!ui.panel.isConnected) ui.wrap.appendChild(ui.panel);
      ui.render();
    } else {
      ui.panel.remove();
      ui.closeMenu();
    }
    ui.applySettings(ui.settings || store.DEFAULT_SETTINGS);
    ui.renderDock();
    if (persist) store.saveSettings({ panelOpen: open });
    // o WhatsApp recalcula o layout quando a janela "muda de tamanho"
    window.dispatchEvent(new Event('resize'));
  };

  ui.setTab = (name) => {
    if (!ui.tabs[name]) return;
    ui.current = name;
    ui.closeMenu();
    ui.render();
    ui.renderDock();
    store.saveSettings({ lastTab: name });
  };
  /** Abre o painel numa tela (aba do topo ou tela da barra lateral) */
  ui.openView = (name) => {
    if (!ui.tabs[name]) return;
    if (!ui.open) {
      ui.current = name;
      ui.toggle(true);
      store.saveSettings({ lastTab: name });
      return;
    }
    ui.setTab(name);
  };

  const viewHead = (def) => (!def.top && !def.noHeader ? h('div', { class: 'zf-h2 zf-viewhead' }, icon(def.icon, 18), def.title) : null);
  ui.render = () => {
    if (!ui.open) return;
    Object.entries(ui.tabBtns).forEach(([n, b]) => b.classList.toggle('active', n === ui.current));
    ui.body.replaceChildren();
    ui.body.scrollTop = 0;
    const def = ui.tabs[ui.current];
    ZF.append(ui.body, viewHead(def));
    def.render(ui.body);
  };

  /** Re-renderiza a aba atual mantendo a rolagem */
  ui.rerender = (tabName) => {
    if (!ui.open || (tabName && tabName !== ui.current)) return;
    const top = ui.body.scrollTop;
    ui.body.replaceChildren();
    const def = ui.tabs[ui.current];
    ZF.append(ui.body, viewHead(def));
    def.render(ui.body);
    ui.body.scrollTop = top;
  };

  /* ---------------- barra lateral flutuante ---------------- */
  ui.dockBtns = {};
  /** Mostra/esconde as opções, que sobem a partir do botão azul */
  ui.toggleDock = (open = !ui.dockOpen) => {
    if (!ui.dock) return;
    ui.dockOpen = !!open;
    ui.dock.classList.toggle('open', ui.dockOpen);
    ui.placeDock();
  };
  ui.buildDock = () => {
    const items = h('div', { class: 'zf-dock-items' });
    DOCK.forEach((d) => {
      const b = h('button', {
        class: 'zf-dock-btn', 'aria-label': d.title,
        onclick: ui.safe(async () => {
          ui.toggleDock(false);
          if (d.view) {
            if (ui.open && ui.current === d.view) ui.toggle(false);
            else ui.openView(d.view);
          } else await d.run();
        }),
      }, icon(d.icon, 20), h('span', { class: 'zf-tip' }, d.title));
      ui.dockBtns[d.key] = b;
      items.appendChild(b);
    });
    // o botão azul só sobe/desce as opções; o painel abre pelo botão "Abrir o painel" (ou pela barra da esquerda)
    const logo = h('button', { class: 'zf-dock-logo', 'aria-label': 'Opções do ZapFlow', onclick: () => ui.toggleDock() },
      h('span', { class: 'zf-dock-ico' }, icon('logo', 26)),
      h('span', { class: 'zf-dock-ico zf-dock-ico-x' }, icon('x', 24)),
      h('span', { class: 'zf-tip' }, 'ZapFlow — opções (arraste para mover)'));
    ui.dockLogo = logo;
    ui.dock = h('div', { class: 'zf-dock zf-keep' }, items, logo);
    ui.dockOpen = false;
    try { localStorage.removeItem('zapflow-dock-collapsed'); } catch (e) { /* ignora */ }
    ui.wrap.appendChild(ui.dock);
    enableDockDrag(ui.dock);
    // clicar em qualquer outro lugar (no WhatsApp ou no painel) desce as opções
    document.addEventListener('mousedown', (e) => {
      if (ui.dockOpen && !e.composedPath().includes(ui.dock)) ui.toggleDock(false);
    }, true);
    window.addEventListener('resize', () => ui.placeDock());
  };

  /** Altura da barra de abas do topo (0 quando ela está escondida) */
  const barH = () => {
    const b = ui.wrap && ui.wrap.querySelector('.zf-topbar');
    return b && b.style.display !== 'none' ? b.offsetHeight : 0;
  };

  /** Área do WhatsApp (sem a barra da esquerda, sem a barra do topo e sem o painel): referência da posição dos botões */
  const waArea = () => {
    const left = ui.railShown ? RAIL_W : 0;
    const w = Math.max(380, Math.min(600, Number((ui.settings || {}).panelWidth) || 380));
    return { left, right: window.innerWidth - (ui.open ? w : 0), top: barH() };
  };

  /**
   * Posição dos botões flutuantes: lado de referência (direita/esquerda da área do WhatsApp),
   * distância até esse lado e altura. Ficam onde foram soltos.
   */
  ui.placeDock = (s = ui.settings || {}) => {
    if (!ui.dock) return;
    ui.wrap.classList.toggle('dock-left', s.dockSide === 'left');
    // janela minimizada tem tamanho ~0: não limita (recalcula no próximo "resize")
    const sized = window.innerHeight > 200 && window.innerWidth > 300;
    const a = waArea();
    let x = Number.isFinite(Number(s.dockX)) && s.dockX != null ? Number(s.dockX) : DOCK_GAP;
    if (sized) x = Math.min(Math.max(DOCK_GAP, x), Math.max(DOCK_GAP, a.right - a.left - ui.dock.offsetWidth - DOCK_GAP));
    ui.wrap.style.setProperty('--dock-x', Math.round(x) + 'px');
    const b = Number(s.dockBottom);
    if (s.dockBottom == null || !Number.isFinite(b)) { ui.dock.style.bottom = ''; return; }
    // com as opções abertas a lista cresce para cima: não deixa passar da barra do topo
    const max = sized ? Math.max(DOCK_GAP, window.innerHeight - ui.dock.offsetHeight - a.top - DOCK_GAP) : Infinity;
    ui.dock.style.bottom = Math.round(Math.min(Math.max(DOCK_GAP, b), max)) + 'px';
  };

  /**
   * Arrastar os botões flutuantes: segurar qualquer botão e mover. Ao soltar, ficam exatamente
   * ali (guardando a distância até o lado mais próximo da área do WhatsApp). Um clique simples continua funcionando.
   */
  function enableDockDrag(dock) {
    let start = null;
    let dragging = false;
    let draggedAt = 0;
    const clamp = (v, min, max) => Math.min(Math.max(v, min), Math.max(min, max));
    dock.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      start = { x: e.clientX, y: e.clientY, rect: dock.getBoundingClientRect(), id: e.pointerId };
      dragging = false;
    });
    dock.addEventListener('pointermove', (e) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!dragging) {
        if (Math.hypot(dx, dy) < 6) return;
        dragging = true;
        try { dock.setPointerCapture(e.pointerId); } catch (err) { /* ignora */ }
        dock.classList.add('dragging');
        ui.closeMenu();
      }
      const r = start.rect;
      const a = waArea();
      // segura os botões dentro da área do WhatsApp (sem passar por cima da barra da esquerda,
      // da barra do topo nem do painel aberto) — é onde eles vão ficar quando soltar
      dock.style.left = clamp(r.left + dx, a.left + DOCK_GAP, a.right - r.width - DOCK_GAP) + 'px';
      dock.style.top = clamp(r.top + dy, a.top + DOCK_GAP, window.innerHeight - r.height - DOCK_GAP) + 'px';
      dock.style.right = 'auto';
      dock.style.bottom = 'auto';
    });
    const end = () => {
      if (!start) return;
      const was = dragging;
      start = null;
      dragging = false;
      if (!was) return;
      draggedAt = Date.now();
      const r = dock.getBoundingClientRect();
      const a = waArea();
      const side = r.left + r.width / 2 < (a.left + a.right) / 2 ? 'left' : 'right';
      const x = Math.max(DOCK_GAP, Math.round(side === 'left' ? r.left - a.left : a.right - r.right));
      const bottom = Math.max(DOCK_GAP, Math.round(window.innerHeight - r.bottom));
      dock.classList.remove('dragging');
      ['left', 'top', 'right'].forEach((k) => (dock.style[k] = ''));
      ui.settings = { ...(ui.settings || {}), dockSide: side, dockX: x, dockBottom: bottom };
      ui.placeDock();
      store.saveSettings({ dockSide: side, dockX: x, dockBottom: bottom });
    };
    dock.addEventListener('pointerup', end);
    dock.addEventListener('pointercancel', end);
    // o clique que vem logo depois de arrastar não deve abrir nada
    dock.addEventListener('click', (e) => {
      if (Date.now() - draggedAt < 400) { e.stopPropagation(); e.preventDefault(); }
    }, true);
  }
  ui.renderDock = () => {
    DOCK.forEach((d) => {
      const b = ui.dockBtns[d.key];
      if (b) b.classList.toggle('active', !!(d.view && ui.open && ui.current === d.view));
    });
    RAIL.forEach((d) => {
      const b = ui.railBtns[d.key];
      if (b) b.classList.toggle('active', !!(d.view && ui.open && ui.current === d.view));
    });
  };

  /* ---------------- barra fixa à esquerda ---------------- */
  ui.railBtns = {};
  // A lista da barra rola, então a dica azul fica fora dela (posição fixa ao lado do botão)
  let railTip = null;
  const showRailTip = (btn, text) => {
    if (!railTip) { railTip = h('div', { class: 'zf-tip zf-rail-tip' }); ui.wrap.appendChild(railTip); }
    const r = btn.getBoundingClientRect();
    railTip.textContent = text;
    railTip.style.left = r.right + 10 + 'px';
    railTip.style.top = r.top + r.height / 2 + 'px';
    railTip.classList.add('show');
  };
  const hideRailTip = () => { if (railTip) railTip.classList.remove('show'); };
  const railButton = (d, onclick, cls = 'zf-rail-btn', size = 21) => h('button', {
    class: cls, 'aria-label': d.title, onclick: ui.safe(async () => { hideRailTip(); await onclick(); }),
    onmouseenter: (e) => showRailTip(e.currentTarget, d.title), onmouseleave: hideRailTip,
  }, icon(d.icon, size));
  ui.buildRail = () => {
    const items = h('div', { class: 'zf-rail-items' });
    RAIL.forEach((d) => {
      const b = railButton(d, async () => {
        if (d.view) {
          if (ui.open && ui.current === d.view) ui.toggle(false);
          else ui.openView(d.view);
        } else await d.run();
      });
      ui.railBtns[d.key] = b;
      items.appendChild(b);
    });
    const logo = railButton({ icon: 'logo', title: 'ZapFlow — abrir/fechar painel' }, () => ui.toggle(), 'zf-rail-logo', 24);
    const gear = railButton({ icon: 'settings', title: 'Configurações' }, () => ui.openSettings());
    ui.rail = h('div', { class: 'zf-rail zf-keep' }, logo, items,
      h('div', { class: 'zf-rail-foot' }, gear, h('div', { class: 'zf-rail-ver' }, 'v' + chrome.runtime.getManifest().version)));
    ui.wrap.appendChild(ui.rail);
  };
  /** Mostra a barra (e empurra o WhatsApp para a direita) só com o WhatsApp carregado */
  ui.applyRail = (s = ui.settings || {}) => {
    if (!ui.rail) return;
    const show = s.rail !== false && !!(ZF.wa && ZF.wa.isReady());
    ui.rail.style.display = show ? '' : 'none';
    ui.wrap.classList.toggle('rail-on', show);
    ui.wrap.style.setProperty('--rail-w', (show ? RAIL_W : 0) + 'px');
    const root = document.documentElement;
    root.style.setProperty('--zapflow-rail', RAIL_W + 'px');
    root.classList.toggle('zapflow-rail', show);
    if (show !== ui.railShown) {
      ui.railShown = show;
      window.dispatchEvent(new Event('resize'));
    }
  };

  /** Google Agenda a partir da conversa aberta */
  ui.eventForActiveChat = async () => {
    const info = await ZF.wa.activeChatInfo();
    const rec = info && ZF.crm ? ZF.crm.record(info) : null;
    const lastNote = rec && rec.notes && rec.notes.length ? rec.notes[rec.notes.length - 1].text : '';
    ui.openEventEditor(info ? {
      title: info.isGroup ? `Reunião — ${info.name}` : `Consulta — ${ZF.firstName(info.name) || info.name || ''}`,
      details: [info.name, info.phone ? ZF.fmtPhone(info.phone) : '', lastNote].filter(Boolean).join('\n'),
    } : {});
  };

  ui.updateBadges = ui.safe(async () => {
    if (!ui.tabBtns) return;
    const { schedules, campaigns, reminders } = await store.getMany(['schedules', 'campaigns', 'reminders']);
    const setBadge = (b, n) => {
      if (!b) return;
      const old = b.querySelector('.zf-dot');
      if (old) old.remove();
      if (n > 0) b.appendChild(h('span', { class: 'zf-dot' }, n > 99 ? '99+' : n));
    };
    const failed = schedules.filter((s) => s.status === 'failed').length;
    const running = campaigns.filter((c) => c.status === 'running').length;
    const due = reminders.filter((r) => r.status === 'pending' && r.dueAt <= Date.now()).length;
    setBadge(ui.dockBtns.schedules, failed);
    setBadge(ui.railBtns.schedules, failed);
    setBadge(ui.tabBtns.bulk, running);
    setBadge(ui.railBtns.bulk, running);
    setBadge(ui.dockBtns.reminders, due);
    setBadge(ui.railBtns.reminders, due);
    // com as opções escondidas, o aviso aparece no próprio botão azul
    setBadge(ui.dockLogo, failed + due);
  });

  /* ---------------- barra de status ---------------- */
  ui.renderStatus = (st) => {
    if (!ui.statusEl) return;
    const el = ui.statusEl;
    if (!st || st.phase === 'idle' || !st.text || (ui.settings && ui.settings.hideMonitor)) {
      el.className = 'zf-status';
      return;
    }
    let text = st.text;
    if (st.nextAt && st.nextAt > Date.now()) text += ` • próximo em ${ZF.fmtDuration(st.nextAt - Date.now())}`;
    el.className = 'zf-status show' + (st.phase === 'error' ? ' error' : '');
    el.replaceChildren();
    ZF.append(el,
      icon(st.phase === 'sending' ? 'loader' : st.phase === 'error' ? 'alert' : 'clock', 15, st.phase === 'sending' ? 'zf-spin' : ''),
      h('span', { class: 'zf-grow', title: text }, text),
    );
  };
  /** Linha de progresso de ações manuais (ex.: resposta rápida com várias ações) */
  ui.setBusy = (text) => {
    if (!ui.busyEl) return;
    if (!text) { ui.busyEl.className = 'zf-status'; ui.busyEl.replaceChildren(); return; }
    ui.busyEl.className = 'zf-status show';
    ui.busyEl.replaceChildren(icon('loader', 15, 'zf-spin'), h('span', { class: 'zf-grow', title: text }, text));
  };

  /* ---------------- toast ---------------- */
  ui.toast = (msg, type = 'info', ms = 2600) => {
    if (!ui.toasts) return;
    const t = h('div', { class: 'zf-toast ' + type },
      icon(type === 'error' ? 'alert' : type === 'ok' ? 'check' : 'zap', 15), h('span', {}, msg));
    ui.toasts.appendChild(t);
    setTimeout(() => t.remove(), ms);
  };

  /* ---------------- modal ---------------- */
  /** Abre dentro do painel; com o painel fechado (ou global:true) abre no meio da tela */
  ui.modal = ({ title, body, actions = [], onClose, global = false, wide = false }) => {
    ui.closeMenu();
    const inPanel = ui.open && !global;
    const overlay = h('div', { class: 'zf-overlay' + (inPanel ? '' : ' global') });
    const close = () => { overlay.remove(); if (onClose) onClose(); };
    const footer = h('div', { class: 'zf-modal-f' });
    actions.forEach((a) => {
      const btn = h('button', { class: 'zf-btn ' + (a.class || '') + (a.left ? ' zf-left' : '') }, a.icon ? icon(a.icon, 15) : null, a.label);
      btn.addEventListener('click', ui.safe(async () => {
        if (a.onClick) {
          btn.disabled = true;
          try {
            const res = await a.onClick(close);
            if (res !== false && a.close !== false) close();
          } finally { btn.disabled = false; }
        } else close();
      }));
      footer.appendChild(btn);
    });
    const modal = h('div', { class: 'zf-modal' + (wide ? ' wide' : '') },
      h('div', { class: 'zf-modal-h' }, h('div', { class: 'zf-grow' }, title),
        h('button', { class: 'zf-iconbtn', title: 'Fechar', onclick: close }, icon('x', 18))),
      h('div', { class: 'zf-modal-b' }, body),
      actions.length ? footer : null);
    overlay.appendChild(modal);
    if (!inPanel) overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    (inPanel ? ui.panel : ui.wrap).appendChild(overlay);
    const first = modal.querySelector('input:not([type=checkbox]):not([type=radio]), textarea, select');
    if (first) setTimeout(() => first.focus(), 30);
    return { close, overlay };
  };

  ui.confirm = (message, { okLabel = 'Confirmar', danger = false, title = 'Confirmar', global = false } = {}) => new Promise((resolve) => {
    let answered = false;
    ui.modal({
      title,
      global,
      body: h('div', { style: { whiteSpace: 'pre-wrap' } }, message),
      onClose: () => { if (!answered) resolve(false); },
      actions: [
        { label: 'Cancelar', onClick: () => { answered = true; resolve(false); } },
        { label: okLabel, class: danger ? 'primary danger-bg' : 'primary', onClick: () => { answered = true; resolve(true); } },
      ],
    });
  });

  /** Pede valores para variáveis personalizadas: {horario} → campo "horario" */
  ui.askVars = (names, title = 'Preencha os campos') => new Promise((resolve) => {
    let answered = false;
    const inputs = {};
    const body = h('div', {},
      h('div', { class: 'zf-hint', style: { marginBottom: '10px' } }, 'A mensagem tem campos personalizados. Preencha para continuar:'),
      names.map((n) => {
        inputs[n] = h('input', { class: 'zf-input', placeholder: n });
        return h('div', { class: 'zf-field' }, h('label', {}, `{${n}}`), inputs[n]);
      }));
    body.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); body.closest('.zf-modal').querySelector('.zf-btn.primary').click(); }
    });
    ui.modal({
      title,
      body,
      onClose: () => { if (!answered) resolve(null); },
      actions: [
        { label: 'Cancelar' },
        {
          label: 'Continuar', class: 'primary', onClick: () => {
            answered = true;
            const out = {};
            names.forEach((n) => (out[n] = inputs[n].value));
            resolve(out);
          },
        },
      ],
    });
  });

  /* ---------------- menus suspensos (posição fixa na tela) ---------------- */
  ui.closeMenu = () => {
    if (ui.menuEl) { ui.menuEl.remove(); ui.menuEl = null; }
  };
  const placeMenu = (menu, anchor, align = 'right') => {
    ui.wrap.appendChild(menu);
    const ar = anchor.getBoundingClientRect();
    const mr = menu.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    let top = ar.bottom + 4;
    if (top + mr.height > vh - 8) top = Math.max(8, ar.top - mr.height - 4);
    let left = align === 'left' ? ar.left : ar.right - mr.width;
    left = Math.max(8, Math.min(left, vw - mr.width - 8));
    menu.style.top = top + 'px';
    menu.style.left = left + 'px';
    ui.menuEl = menu;
  };
  const menuButton = (it) => h('button', {
    class: (it.danger ? 'danger ' : '') + (it.active ? 'active' : ''),
    onclick: ui.safe(async (e) => { e.stopPropagation(); ui.closeMenu(); await it.onClick(); }),
  }, it.icon ? icon(it.icon, 16) : null, h('span', {}, it.label), it.count != null ? h('span', { class: 'zf-menu-count' }, it.count) : null);

  ui.menu = (anchor, items, { align = 'right' } = {}) => {
    ui.closeMenu();
    const menu = h('div', { class: 'zf-menu' });
    items.filter(Boolean).forEach((it) => {
      if (it === '-') return menu.appendChild(h('hr'));
      if (it.title) return menu.appendChild(h('div', { class: 'zf-menu-title' }, it.title));
      menu.appendChild(menuButton(it));
    });
    placeMenu(menu, anchor, align);
  };

  /** Menu em "sanfona": grupos que abrem os itens (ex.: Adicionar Ação) */
  ui.accordionMenu = (anchor, groups, { align = 'left' } = {}) => {
    ui.closeMenu();
    const menu = h('div', { class: 'zf-menu zf-accordion' });
    let openKey = null;
    const render = () => {
      menu.replaceChildren();
      groups.forEach((g) => {
        const isOpen = openKey === g.key;
        menu.appendChild(h('button', {
          class: 'zf-acc-h' + (isOpen ? ' open' : ''),
          onclick: (e) => { e.stopPropagation(); openKey = isOpen ? null : g.key; render(); },
        }, icon(g.icon, 18), h('span', {}, g.label), icon(isOpen ? 'chevronUp' : 'chevronDown', 18, 'zf-acc-chev')));
        if (isOpen) menu.appendChild(h('div', { class: 'zf-acc-body' }, g.items.map(menuButton)));
      });
    };
    render();
    placeMenu(menu, anchor, align);
  };

  /** Seletor de emojis simples */
  const EMOJIS = '😀 😃 😄 😁 😊 🙂 😉 😍 🥰 😘 🤗 🤩 😎 🤔 😅 😂 🥲 😢 😭 😮 🙏 👏 👍 👎 👋 🤝 💪 ✌️ 👉 👇 ✅ ❌ ⚠️ ❗ ❓ ⭐ 🌟 ✨ 🔥 💯 🎉 🎁 🎂 ❤️ 💙 💚 💛 🧡 💜 📞 ☎️ 📱 💬 📩 📅 🗓️ ⏰ ⏳ 🕒 📍 🏥 🩺 💊 🍎 🥗 🥑 🏃 ⚖️ 💰 💳 💠 🧾 📄 📋 📝 📌 📎 🔗 🚀 💼 🏠 🚗 ☀️ 🌞 🌲 🌸 🍀 🔔 🔁 🆕 🆗'.split(' ');
  ui.emojiPicker = (anchor, onPick) => {
    ui.closeMenu();
    const menu = h('div', { class: 'zf-menu zf-emojis' },
      EMOJIS.map((em) => h('button', { onclick: (e) => { e.stopPropagation(); onPick(em); } }, em)));
    placeMenu(menu, anchor, 'right');
  };

  /* ---------------- componentes de formulário ---------------- */
  ui.field = (label, control, hint) => h('div', { class: 'zf-field' }, label ? h('label', {}, label) : null, control, hint ? h('div', { class: 'zf-hint' }, hint) : null);
  ui.input = (props = {}) => h('input', { class: 'zf-input', ...props });
  ui.select = (options, value, props = {}) => h('select', { class: 'zf-select', ...props },
    options.map((o) => h('option', { value: o.value, selected: String(o.value) === String(value) }, o.label)));
  ui.checkbox = (label, checked, onchange) => {
    const inp = h('input', { type: 'checkbox', checked, onchange: (e) => onchange && onchange(e.target.checked) });
    return h('label', { class: 'zf-check' }, inp, h('span', {}, label));
  };
  /** Interruptor liga/desliga (estilo dos prints) */
  ui.switch = (checked, onchange, { title } = {}) => h('label', { class: 'zf-switch', title },
    h('input', { type: 'checkbox', checked, onchange: (e) => onchange && onchange(e.target.checked) }),
    h('span', { class: 'zf-switch-track' }));
  ui.badge = (status, label) => h('span', { class: 'zf-badge ' + status }, label);

  ui.insertAtCursor = (ta, text) => {
    ta.focus();
    const s = ta.selectionStart ?? ta.value.length;
    const e = ta.selectionEnd ?? ta.value.length;
    ta.setRangeText(text, s, e, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  };

  /**
   * Editor de mensagem em blocos (textos e arquivos enviados em sequência).
   * Retorna { el, get() }.
   */
  ui.blocksEditor = (initial = [], { extraVars = [], spintaxHint = false } = {}) => {
    let blocks = initial.length ? ZF.clone(initial) : [{ type: 'text', text: '' }];
    let lastTa = null;
    const list = h('div');

    const move = (i, d) => {
      const j = i + d;
      if (j < 0 || j >= blocks.length) return;
      [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
      render();
    };
    const remove = (i) => {
      blocks.splice(i, 1);
      if (!blocks.length) blocks.push({ type: 'text', text: '' });
      render();
    };

    const fileBox = (b) => {
      const thumb = h('div');
      if ((b.mime || '').startsWith('image/')) {
        store.getFile(b.fileId).then((f) => { if (f) thumb.replaceWith(h('img', { src: f.data, alt: '' })); });
      } else {
        thumb.appendChild(icon(ZF.TYPE_ICONS[ZF.messageType([b])] || 'file', 22));
      }
      return h('div', { class: 'zf-filebox' }, thumb,
        h('div', { class: 'zf-grow' },
          h('div', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 } }, b.name),
          h('div', { class: 'zf-muted zf-small' }, ZF.fmtSize(b.size || 0))));
    };

    function render() {
      list.replaceChildren();
      blocks.forEach((b, i) => {
        const kind = b.type === 'text' ? 'Texto' : b.type === 'vcard' ? 'Contato' : 'Arquivo';
        const head = h('div', { class: 'zf-block-h' },
          h('div', { class: 'zf-grow' }, icon(b.type === 'text' ? 'message' : b.type === 'vcard' ? 'contactCard' : 'paperclip', 14),
            blocks.length > 1 ? `${i + 1}. ${kind}` : kind),
          blocks.length > 1 ? h('button', { class: 'zf-iconbtn', title: 'Subir', disabled: i === 0, onclick: () => move(i, -1) }, icon('arrowUp', 14)) : null,
          blocks.length > 1 ? h('button', { class: 'zf-iconbtn', title: 'Descer', disabled: i === blocks.length - 1, onclick: () => move(i, 1) }, icon('arrowDown', 14)) : null,
          blocks.length > 1 || b.type !== 'text' ? h('button', { class: 'zf-iconbtn', title: 'Remover', onclick: () => remove(i) }, icon('trash', 14)) : null);
        let content;
        if (b.type === 'text') {
          const ta = h('textarea', {
            class: 'zf-textarea', rows: 5, value: b.text,
            placeholder: 'Digite a mensagem… (*negrito*, _itálico_, emojis com Win + .)',
            oninput: (e) => { b.text = e.target.value; },
            onfocus: (e) => { lastTa = e.target; },
          });
          if (!lastTa) lastTa = ta;
          content = ta;
        } else if (b.type === 'vcard') {
          content = h('div', { class: 'zf-filebox' }, icon('contactCard', 22),
            h('div', { class: 'zf-grow' }, h('div', { style: { fontWeight: 600 } }, b.name || 'Contato'), h('div', { class: 'zf-muted zf-small' }, ZF.fmtPhone(b.phone))));
        } else if ((b.mime || '').startsWith('audio/')) {
          // áudio: pode ir como mensagem de voz (igual a um áudio gravado no WhatsApp)
          content = h('div', {}, fileBox(b),
            ui.checkbox('Enviar como mensagem de voz (áudio gravado)', b.asVoice !== false, (v) => { b.asVoice = v; }));
          if (b.asVoice === undefined) b.asVoice = true;
        } else {
          const cap = h('textarea', {
            class: 'zf-textarea', rows: 2, value: b.caption || '', style: { minHeight: '48px' },
            placeholder: 'Legenda (opcional)',
            oninput: (e) => { b.caption = e.target.value; },
            onfocus: (e) => { lastTa = e.target; },
          });
          content = h('div', {}, fileBox(b), cap);
        }
        list.appendChild(h('div', { class: 'zf-block' }, head, content));
      });
    }

    const varNames = [...ZF.BUILTIN_VARS, ...extraVars.filter((v) => !ZF.BUILTIN_VARS.includes(v))];
    const chips = h('div', { class: 'zf-varchips' },
      varNames.map((v) => h('button', {
        class: 'zf-varchip', title: ZF.VAR_HELP[v] || 'Coluna da lista',
        onclick: (e) => { e.preventDefault(); const ta = lastTa && lastTa.isConnected ? lastTa : list.querySelector('textarea'); if (ta) ui.insertAtCursor(ta, `{${v}}`); },
      }, `{${v}}`)),
      h('button', {
        class: 'zf-varchip', title: 'Campo que você preenche na hora do envio',
        onclick: async (e) => {
          e.preventDefault();
          const r = await ui.askVars(['nome_do_campo'], 'Novo campo personalizado');
          const key = r && ZF.normKey(r.nome_do_campo);
          const ta = lastTa && lastTa.isConnected ? lastTa : list.querySelector('textarea');
          if (key && ta) ui.insertAtCursor(ta, `{${key}}`);
        },
      }, '+ campo'));

    const pushFileBlock = async (file, extra = {}) => {
      ui.toast('Salvando arquivo…');
      const meta = await store.saveFile(file);
      const emptyIdx = blocks.length === 1 && blocks[0].type === 'text' && !blocks[0].text.trim() ? 0 : -1;
      const nb = { type: 'file', ...meta, caption: '', ...extra };
      if (emptyIdx === 0) blocks = [nb];
      else blocks.push(nb);
      render();
    };
    const addFile = ui.safe(async () => {
      const file = await ZF.pickFile('*/*');
      if (file) await pushFileBlock(file);
    });

    // Gravação de áudio pelo microfone (vira mensagem de voz)
    let recorder = null;
    const recBtn = h('button', { class: 'zf-btn sm' }, icon('mic', 14), 'Gravar áudio');
    const setRecLabel = (txt, danger) => {
      recBtn.replaceChildren(icon(danger ? 'stop' : 'mic', 14), txt);
      recBtn.classList.toggle('danger', !!danger);
    };
    recBtn.addEventListener('click', ui.safe(async (e) => {
      e.preventDefault();
      if (recorder) { recorder.stop(); return; }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm'].find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
      recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const chunks = [];
      const started = Date.now();
      const timer = setInterval(() => setRecLabel(`Parar (${ZF.fmtDuration(Date.now() - started)})`, true), 500);
      recorder.ondataavailable = (ev) => ev.data.size && chunks.push(ev.data);
      recorder.onstop = ui.safe(async () => {
        clearInterval(timer);
        stream.getTracks().forEach((t) => t.stop());
        recorder = null;
        setRecLabel('Gravar áudio');
        const mime = (type || 'audio/webm').split(';')[0];
        const blob = new Blob(chunks, { type: mime });
        if (blob.size < 500) return;
        const file = new File([blob], `audio-${ZF.fmtDate(Date.now()).replace(/\//g, '-')}.${mime.includes('ogg') ? 'ogg' : 'webm'}`, { type: mime });
        await pushFileBlock(file, { asVoice: true });
      });
      recorder.start(250);
      setRecLabel('Parar (0s)', true);
    }));

    const el = h('div', {},
      list,
      h('div', { class: 'zf-row', style: { gap: '6px', flexWrap: 'wrap' } },
        h('button', { class: 'zf-btn sm', onclick: (e) => { e.preventDefault(); blocks.push({ type: 'text', text: '' }); render(); } }, icon('plus', 14), 'Texto'),
        h('button', { class: 'zf-btn sm', onclick: (e) => { e.preventDefault(); addFile(); } }, icon('paperclip', 14), 'Arquivo'),
        recBtn),
      h('div', { class: 'zf-hint', style: { marginTop: '8px' } }, 'Variáveis (clique para inserir):'),
      chips,
      spintaxHint ? h('div', { class: 'zf-hint' }, 'Dica: use {Olá|Oi|E aí} para variar o texto entre os envios (ajuda a evitar bloqueios).') : null);
    render();

    return {
      el,
      get: () => blocks.filter(ZF.blockHasContent).map((b) => ({ ...b })),
      set: (nb) => { blocks = nb && nb.length ? ZF.clone(nb) : [{ type: 'text', text: '' }]; lastTa = null; render(); },
      /** texto do primeiro bloco de texto (usado pela IA) */
      focusText: () => { const ta = list.querySelector('textarea'); if (ta) ta.focus(); },
    };
  };

  /* ---------------- seletores de conversas / etiquetas ---------------- */
  /**
   * Lista as conversas do WhatsApp com busca e filtros e permite escolher várias.
   * filter: 'all' | 'groups' | 'contacts' | 'unread'. Resolve com [chatInfo] ou null.
   */
  ui.pickChats = ({ title = 'Escolher conversas', filter = 'all', multi = true, okLabel = 'Adicionar' } = {}) => new Promise(async (resolve) => {
    const r = await ZF.wa.bridge('listChats', {}, 20000);
    if (!r || !r.ok) {
      ui.toast('Não consegui ler suas conversas (recurso indisponível nesta versão do WhatsApp).', 'error', 5000);
      resolve(null);
      return;
    }
    let mode = filter;
    let answered = false;
    const selected = new Map();
    const search = h('input', { class: 'zf-input', placeholder: 'Pesquisar por nome ou número…' });
    const chipsEl = h('div', { class: 'zf-chips', style: { margin: '8px 0' } });
    const list = h('div', { class: 'zf-contacts', style: { maxHeight: '46vh' } });
    const countEl = h('span', { class: 'zf-muted zf-small' });
    let modalRef;

    const filtered = () => {
      const q = ZF.normKey(search.value);
      const qd = ZF.onlyDigits(search.value);
      return r.chats.filter((c) => {
        if (mode === 'groups' && !c.isGroup) return false;
        if (mode === 'contacts' && c.isGroup) return false;
        if (mode === 'unread' && !c.unread) return false;
        if (!q) return true;
        return ZF.normKey(c.name).includes(q) || (qd && (c.phone || '').includes(qd));
      });
    };
    const renderChips = () => {
      chipsEl.replaceChildren();
      [['all', 'Todas'], ['contacts', 'Contatos'], ['groups', 'Grupos'], ['unread', 'Não lidas']].forEach(([k, label]) => chipsEl.appendChild(
        h('button', { class: 'zf-chip' + (mode === k ? ' active' : ''), onclick: () => { mode = k; renderChips(); renderList(); } }, label)));
      if (multi) chipsEl.appendChild(h('button', {
        class: 'zf-chip', onclick: () => {
          const items = filtered();
          const all = items.every((c) => selected.has(c.chatId));
          items.forEach((c) => (all ? selected.delete(c.chatId) : selected.set(c.chatId, c)));
          renderList();
        },
      }, 'Marcar/desmarcar todos'));
    };
    const renderList = () => {
      list.replaceChildren();
      const items = filtered();
      items.slice(0, 400).forEach((c) => {
        const cb = h('input', { type: multi ? 'checkbox' : 'radio', checked: selected.has(c.chatId) });
        const row = h('label', { class: 'zf-contact', style: { cursor: 'pointer' } }, cb,
          icon(c.isGroup ? 'users' : 'user', 14),
          h('span', { class: 'zf-grow' }, c.name || ZF.fmtPhone(c.phone) || c.chatId),
          c.unread ? h('span', { class: 'zf-badge pending' }, c.unread) : null,
          h('span', { class: 'zf-muted zf-small' }, c.isGroup ? 'Grupo' : ZF.fmtPhone(c.phone)));
        cb.addEventListener('change', () => {
          if (!multi) selected.clear();
          if (cb.checked) selected.set(c.chatId, c); else selected.delete(c.chatId);
          if (!multi) { answered = true; resolve([c]); modalRef.close(); return; }
          countEl.textContent = `${selected.size} selecionada(s)`;
        });
        list.appendChild(row);
      });
      if (!items.length) list.appendChild(h('div', { class: 'zf-empty' }, 'Nenhuma conversa encontrada.'));
      if (items.length > 400) list.appendChild(h('div', { class: 'zf-hint', style: { padding: '8px' } }, `Mostrando 400 de ${items.length}. Refine a busca.`));
      countEl.textContent = `${selected.size} selecionada(s)`;
    };
    search.addEventListener('input', renderList);
    renderChips();
    renderList();
    modalRef = ui.modal({
      title,
      body: h('div', {}, search, chipsEl, list, multi ? h('div', { style: { marginTop: '6px' } }, countEl) : null),
      onClose: () => { if (!answered) resolve(null); },
      actions: multi ? [
        { label: 'Cancelar' },
        { label: okLabel, class: 'primary', onClick: () => { answered = true; resolve([...selected.values()]); } },
      ] : [],
    });
  });

  /** Escolher uma etiqueta/lista do WhatsApp (Business: etiquetas; pessoal: listas). Resolve com {label, chats} */
  ui.pickWaLabel = () => new Promise(async (resolve) => {
    const [lr, cr] = await Promise.all([ZF.wa.bridge('listLabels', {}, 15000), ZF.wa.bridge('listChats', {}, 20000)]);
    if (!lr || !lr.ok || !cr || !cr.ok) {
      ui.toast('Etiquetas indisponíveis nesta versão do WhatsApp.', 'error', 4500);
      resolve(null);
      return;
    }
    let answered = false;
    let modalRef;
    const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
    if (!lr.labels.length) body.appendChild(h('div', { class: 'zf-empty' }, 'Nenhuma etiqueta ou lista encontrada no seu WhatsApp.'));
    lr.labels.forEach((l) => body.appendChild(h('div', {
      class: 'zf-item', onclick: () => {
        answered = true;
        resolve({ label: l, chats: cr.chats.filter((c) => c.labels.includes(l.id)) });
        modalRef.close();
      },
    }, h('span', { style: { width: '12px', height: '12px', borderRadius: '50%', background: l.color || 'var(--border)', flexShrink: 0 } }),
    h('span', { class: 'zf-title' }, l.name),
    h('span', { class: 'zf-uses' }, l.count))));
    modalRef = ui.modal({ title: 'Etiquetas e listas do WhatsApp', body, onClose: () => { if (!answered) resolve(null); } });
  });

  /* ---------------- Google Agenda ---------------- */
  /** Formulário rápido que abre o Google Agenda já preenchido */
  ui.openEventEditor = (defaults = {}) => {
    const s = ui.settings || store.DEFAULT_SETTINGS;
    const start = defaults.start || (() => { const d = new Date(Date.now() + 86400000); d.setHours(9, 0, 0, 0); return d.getTime(); })();
    const title = ui.input({ value: defaults.title || '', placeholder: 'Ex.: Consulta — Maria' });
    const when = ui.input({ type: 'datetime-local', value: ZF.toLocalInput(start) });
    const dur = ui.select([15, 30, 45, 60, 90, 120, 180].map((m) => ({ value: m, label: m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${m % 60 ? m % 60 : ''}` })), defaults.minutes || s.eventMinutes || 60);
    const loc = ui.input({ value: defaults.location || '', placeholder: 'Endereço ou link da reunião (opcional)' });
    const details = h('textarea', { class: 'zf-textarea', rows: 3, value: defaults.details || '' });
    ui.modal({
      title: 'Evento no Google Agenda',
      body: h('div', {},
        ui.field('Título', title),
        h('div', { class: 'zf-grid2' }, ui.field('Início', when), ui.field('Duração', dur)),
        ui.field('Local', loc),
        ui.field('Descrição', details),
        h('div', { class: 'zf-hint' }, 'Abre o Google Agenda numa nova aba com tudo preenchido — é só conferir e salvar.')),
      actions: [
        { label: 'Cancelar' },
        {
          label: 'Abrir no Google Agenda', class: 'primary', icon: 'externalLink', onClick: () => {
            const st = ZF.fromLocalInput(when.value);
            if (!st) { ui.toast('Informe a data e hora', 'error'); return false; }
            ZF.openGcal({ title: title.value.trim() || 'Compromisso', details: details.value, location: loc.value, start: st, end: st + Number(dur.value) * 60000 });
            store.saveSettings({ eventMinutes: Number(dur.value) });
          },
        },
      ],
    });
  };

  /** Escolher uma resposta rápida salva (para agendamentos e campanhas) */
  ui.pickReply = ({ includeScripts = false, title = 'Escolher resposta rápida' } = {}) => new Promise(async (resolve) => {
    const data = await store.getMany(['replies', 'categories']);
    const categories = data.categories;
    const replies = data.replies.map(ZF.migrateReply).filter((r) => includeScripts || r.kind !== 'script');
    let answered = false;
    const catName = (id) => (categories.find((c) => c.id === id) || {}).name || 'Sem categoria';
    const list = h('div', { style: { maxHeight: '50vh', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' } });
    const search = h('input', { class: 'zf-input', placeholder: 'Pesquisar resposta…' });
    let modalRef;
    const renderList = () => {
      list.replaceChildren();
      const q = ZF.normKey(search.value);
      const items = replies.filter((r) => !q || ZF.normKey(ZF.replySearchText(r)).includes(q));
      if (!items.length) list.appendChild(h('div', { class: 'zf-empty' }, 'Nenhuma resposta encontrada.'));
      items.forEach((r) => list.appendChild(h('div', {
        class: 'zf-item', onclick: () => { answered = true; resolve({ ...r, blocks: ZF.actionsToBlocks(r.actions || []) }); modalRef.close(); },
      }, icon(ZF.TYPE_ICONS[ZF.replyType(r)], 16, 'zf-type'),
      h('span', { class: 'zf-title' }, r.title),
      h('span', { class: 'zf-catlabel' }, catName(r.categoryId)))));
    };
    search.addEventListener('input', renderList);
    renderList();
    modalRef = ui.modal({
      title,
      body: h('div', {}, h('div', { class: 'zf-field' }, search), list),
      onClose: () => { if (!answered) resolve(null); },
    });
  });

  ZF.ui = ui;
})();
