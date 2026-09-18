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

  ui.registerTab = (name, def) => {
    ui.tabs[name] = def;
    ui.order.push(name);
  };

  /* ---------------- erros ---------------- */
  ui.errorMessage = (e) => {
    const msg = (e && e.message) || String(e);
    if (/Extension context invalidated|context invalidated/i.test(msg)) return 'A extensão foi atualizada. Recarregue a página do WhatsApp (F5).';
    return msg;
  };
  /** Envolve handlers de eventos: mostra erros como toast */
  ui.safe = (fn) => async (...args) => {
    try {
      return await fn(...args);
    } catch (e) {
      console.error('[ZapFlow]', e);
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

    ui.launcher = h('button', { class: 'zf-launcher', title: 'Abrir ZapFlow', onclick: () => ui.toggle(true) }, icon('zap', 20));
    ui.tabBtns = {};
    const top = h('div', { class: 'zf-top' },
      ui.order.map((name) => {
        const t = ui.tabs[name];
        const b = h('button', { class: 'zf-tab', title: t.title, onclick: () => ui.setTab(name) }, icon(t.icon, 20));
        ui.tabBtns[name] = b;
        return b;
      }),
      h('button', { class: 'zf-tab zf-close', title: 'Fechar painel', onclick: () => ui.toggle(false) }, icon('x', 20)),
    );
    ui.body = h('div', { class: 'zf-body' });
    ui.statusEl = h('div', { class: 'zf-status' });
    ui.toasts = h('div', { class: 'zf-toasts' });
    ui.panel = h('div', { class: 'zf-panel' }, top, ui.body, ui.statusEl, ui.toasts);

    // Layout "empurrar": reduz a largura do WhatsApp para o painel não cobrir a conversa
    const layout = document.createElement('style');
    layout.id = 'zapflow-layout';
    layout.textContent = 'html.zapflow-push #app{width:calc(100% - var(--zapflow-w,380px))!important;min-width:0!important;}';
    (document.head || document.documentElement).appendChild(layout);

    // Acompanha o tema claro/escuro do WhatsApp
    const syncTheme = () => {
      const dark = document.body.classList.contains('dark') || document.documentElement.classList.contains('dark');
      ui.wrap.classList.toggle('dark', dark);
    };
    syncTheme();
    new MutationObserver(syncTheme).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    new MutationObserver(syncTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    // Fecha menus ao clicar fora
    root.addEventListener('mousedown', (e) => {
      if (ui.menuEl && !e.composedPath().includes(ui.menuEl)) ui.closeMenu();
    });
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape') ui.closeMenu(); });

    const settings = await store.settings();
    ui.settings = settings;
    ui.current = settings.lastTab && ui.tabs[settings.lastTab] ? settings.lastTab : 'replies';
    ui.applySettings(settings);
    ui.toggle(settings.panelOpen, false);

    store.onChange(['settings'], async () => {
      ui.settings = await store.settings();
      ui.applySettings(ui.settings);
    });
    store.onChange(['schedules', 'campaigns'], () => ui.updateBadges());
    ui.updateBadges();

    ZF.on('runner', (st) => ui.renderStatus(st));
    setInterval(() => ui.renderStatus(ZF.runner && ZF.runner.state), 1000);
  };

  ui.applySettings = (s) => {
    const w = Math.max(320, Math.min(560, Number(s.panelWidth) || 380));
    ui.wrap.style.setProperty('--w', w + 'px');
    document.documentElement.style.setProperty('--zapflow-w', w + 'px');
    document.documentElement.classList.toggle('zapflow-push', !!(ui.open && s.pushLayout));
  };

  ui.toggle = (open = !ui.open, persist = true) => {
    ui.open = open;
    ui.wrap.replaceChildren();
    ui.wrap.appendChild(open ? ui.panel : ui.launcher);
    ui.applySettings(ui.settings || store.DEFAULT_SETTINGS);
    if (open) ui.render();
    if (persist) store.saveSettings({ panelOpen: open });
    // o WhatsApp recalcula o layout quando a janela "muda de tamanho"
    window.dispatchEvent(new Event('resize'));
  };

  ui.setTab = (name) => {
    if (!ui.tabs[name]) return;
    ui.current = name;
    ui.closeMenu();
    ui.render();
    store.saveSettings({ lastTab: name });
  };

  ui.render = () => {
    if (!ui.open) return;
    Object.entries(ui.tabBtns).forEach(([n, b]) => b.classList.toggle('active', n === ui.current));
    ui.body.replaceChildren();
    ui.body.scrollTop = 0;
    ui.tabs[ui.current].render(ui.body);
  };

  /** Re-renderiza a aba atual mantendo a rolagem */
  ui.rerender = (tabName) => {
    if (!ui.open || (tabName && tabName !== ui.current)) return;
    const top = ui.body.scrollTop;
    ui.body.replaceChildren();
    ui.tabs[ui.current].render(ui.body);
    ui.body.scrollTop = top;
  };

  ui.updateBadges = ui.safe(async () => {
    if (!ui.tabBtns) return;
    const { schedules, campaigns } = await store.getMany(['schedules', 'campaigns']);
    const setBadge = (name, n) => {
      const b = ui.tabBtns[name];
      if (!b) return;
      const old = b.querySelector('.zf-dot');
      if (old) old.remove();
      if (n > 0) b.appendChild(h('span', { class: 'zf-dot' }, n > 99 ? '99+' : n));
    };
    setBadge('schedules', schedules.filter((s) => s.status === 'failed').length);
    setBadge('bulk', campaigns.filter((c) => c.status === 'running').length);
  });

  /* ---------------- barra de status ---------------- */
  ui.renderStatus = (st) => {
    if (!ui.statusEl) return;
    const el = ui.statusEl;
    if (!st || st.phase === 'idle' || !st.text) {
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

  /* ---------------- toast ---------------- */
  ui.toast = (msg, type = 'info', ms = 2600) => {
    if (!ui.toasts) return;
    const t = h('div', { class: 'zf-toast ' + type },
      icon(type === 'error' ? 'alert' : type === 'ok' ? 'check' : 'zap', 15), h('span', {}, msg));
    ui.toasts.appendChild(t);
    setTimeout(() => t.remove(), ms);
  };

  /* ---------------- modal ---------------- */
  ui.modal = ({ title, body, actions = [], onClose }) => {
    ui.closeMenu();
    const overlay = h('div', { class: 'zf-overlay' });
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
    const modal = h('div', { class: 'zf-modal' },
      h('div', { class: 'zf-modal-h' }, h('div', { class: 'zf-grow' }, title),
        h('button', { class: 'zf-iconbtn', title: 'Fechar', onclick: close }, icon('x', 18))),
      h('div', { class: 'zf-modal-b' }, body),
      actions.length ? footer : null);
    overlay.appendChild(modal);
    ui.panel.appendChild(overlay);
    const first = modal.querySelector('input:not([type=checkbox]):not([type=radio]), textarea, select');
    if (first) setTimeout(() => first.focus(), 30);
    return { close, overlay };
  };

  ui.confirm = (message, { okLabel = 'Confirmar', danger = false, title = 'Confirmar' } = {}) => new Promise((resolve) => {
    let answered = false;
    ui.modal({
      title,
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

  /* ---------------- menu suspenso ---------------- */
  ui.closeMenu = () => {
    if (ui.menuEl) { ui.menuEl.remove(); ui.menuEl = null; }
  };
  ui.menu = (anchor, items) => {
    ui.closeMenu();
    const menu = h('div', { class: 'zf-menu' });
    items.filter(Boolean).forEach((it) => {
      if (it === '-') return menu.appendChild(h('hr'));
      if (it.title) return menu.appendChild(h('div', { class: 'zf-menu-title' }, it.title));
      menu.appendChild(h('button', {
        class: (it.danger ? 'danger ' : '') + (it.active ? 'active' : ''),
        onclick: ui.safe(async (e) => { e.stopPropagation(); ui.closeMenu(); await it.onClick(); }),
      }, it.icon ? icon(it.icon, 15) : null, h('span', {}, it.label)));
    });
    ui.panel.appendChild(menu);
    const pr = ui.panel.getBoundingClientRect();
    const ar = anchor.getBoundingClientRect();
    const mr = menu.getBoundingClientRect();
    let top = ar.bottom - pr.top + 4;
    if (top + mr.height > pr.height - 8) top = Math.max(8, ar.top - pr.top - mr.height - 4);
    let left = ar.right - pr.left - mr.width;
    left = Math.max(8, Math.min(left, pr.width - mr.width - 8));
    menu.style.top = top + 'px';
    menu.style.left = left + 'px';
    ui.menuEl = menu;
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
        const head = h('div', { class: 'zf-block-h' },
          h('div', { class: 'zf-grow' }, icon(b.type === 'text' ? 'message' : 'paperclip', 14),
            blocks.length > 1 ? `${i + 1}. ${b.type === 'text' ? 'Texto' : 'Arquivo'}` : b.type === 'text' ? 'Texto' : 'Arquivo'),
          blocks.length > 1 ? h('button', { class: 'zf-iconbtn', title: 'Subir', disabled: i === 0, onclick: () => move(i, -1) }, icon('arrowUp', 14)) : null,
          blocks.length > 1 ? h('button', { class: 'zf-iconbtn', title: 'Descer', disabled: i === blocks.length - 1, onclick: () => move(i, 1) }, icon('arrowDown', 14)) : null,
          blocks.length > 1 || b.type === 'file' ? h('button', { class: 'zf-iconbtn', title: 'Remover', onclick: () => remove(i) }, icon('trash', 14)) : null);
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

    const addFile = ui.safe(async () => {
      const file = await ZF.pickFile('*/*');
      if (!file) return;
      ui.toast('Salvando arquivo…');
      const meta = await store.saveFile(file);
      const emptyIdx = blocks.length === 1 && blocks[0].type === 'text' && !blocks[0].text.trim() ? 0 : -1;
      const nb = { type: 'file', ...meta, caption: '' };
      if (emptyIdx === 0) blocks = [nb];
      else blocks.push(nb);
      render();
    });

    const el = h('div', {},
      list,
      h('div', { class: 'zf-row', style: { gap: '6px' } },
        h('button', { class: 'zf-btn sm', onclick: (e) => { e.preventDefault(); blocks.push({ type: 'text', text: '' }); render(); } }, icon('plus', 14), 'Texto'),
        h('button', { class: 'zf-btn sm', onclick: (e) => { e.preventDefault(); addFile(); } }, icon('paperclip', 14), 'Arquivo')),
      h('div', { class: 'zf-hint', style: { marginTop: '8px' } }, 'Variáveis (clique para inserir):'),
      chips,
      spintaxHint ? h('div', { class: 'zf-hint' }, 'Dica: use {Olá|Oi|E aí} para variar o texto entre os envios (ajuda a evitar bloqueios).') : null);
    render();

    return {
      el,
      get: () => blocks
        .filter((b) => (b.type === 'file' ? !!b.fileId : !!(b.text || '').trim()))
        .map((b) => ({ ...b })),
      set: (nb) => { blocks = nb && nb.length ? ZF.clone(nb) : [{ type: 'text', text: '' }]; lastTa = null; render(); },
    };
  };

  /** Escolher uma resposta rápida salva (para agendamentos e campanhas) */
  ui.pickReply = () => new Promise(async (resolve) => {
    const { replies, categories } = await store.getMany(['replies', 'categories']);
    let answered = false;
    const catName = (id) => (categories.find((c) => c.id === id) || {}).name || 'Sem categoria';
    const list = h('div', { style: { maxHeight: '50vh', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' } });
    const search = h('input', { class: 'zf-input', placeholder: 'Pesquisar resposta…' });
    let modalRef;
    const renderList = () => {
      list.replaceChildren();
      const q = ZF.normKey(search.value);
      const items = replies.filter((r) => !q || ZF.normKey(r.title + ' ' + ZF.blocksPreview(r.blocks, 500)).includes(q));
      if (!items.length) list.appendChild(h('div', { class: 'zf-empty' }, 'Nenhuma resposta encontrada.'));
      items.forEach((r) => list.appendChild(h('div', {
        class: 'zf-item', onclick: () => { answered = true; resolve(r); modalRef.close(); },
      }, icon(ZF.TYPE_ICONS[ZF.messageType(r.blocks)], 16, 'zf-type'),
      h('span', { class: 'zf-title' }, r.title),
      h('span', { class: 'zf-catlabel' }, catName(r.categoryId)))));
    };
    search.addEventListener('input', renderList);
    renderList();
    modalRef = ui.modal({
      title: 'Escolher resposta rápida',
      body: h('div', {}, h('div', { class: 'zf-field' }, search), list),
      onClose: () => { if (!answered) resolve(null); },
    });
  });

  ZF.ui = ui;
})();
