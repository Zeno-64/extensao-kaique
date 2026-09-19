/*
 * ZapFlow — barra de abas no topo do WhatsApp (abas do CRM ou etiquetas do WhatsApp),
 * lista filtrada de conversas por cima da lista do WhatsApp e quadro de atendimento (Kanban).
 */
(() => {
  'use strict';
  const ZF = window.ZF;
  const { h, icon, store, ui } = ZF;

  const BAR_H = 40;
  const tb = { kanbanOpen: false, selected: null, chats: [], labels: [], labelsOk: false };
  let barEl = null, chipsEl = null, filterBtn = null, handleEl = null, overlayEl = null, kanbanEl = null;
  let details = {}; // chatId → { preview, pic }
  let overlayQuery = '';
  let kanbanQuery = '';
  const settings = () => ui.settings || store.DEFAULT_SETTINGS;

  /* ---------------- dados ---------------- */
  const byChatId = () => new Map(tb.chats.map((c) => [c.chatId, c]));
  const byPhone = () => new Map(tb.chats.filter((c) => c.phone).map((c) => [c.phone, c]));

  let refreshing = false;
  let lastLabels = 0;
  async function refresh() {
    if (refreshing || !ZF.wa.isReady()) return;
    refreshing = true;
    try {
      const r = await ZF.wa.bridge('listChats', {}, 20000);
      if (r && r.ok) tb.chats = r.chats;
      if (Date.now() - lastLabels > 60000 || settings().barMode === 'labels') {
        const l = await ZF.wa.bridge('listLabels', {}, 15000);
        tb.labelsOk = !!(l && l.ok);
        tb.labels = tb.labelsOk ? l.labels : [];
        lastLabels = Date.now();
      }
      renderChips();
      if (tb.selected) await renderOverlay(true);
      if (tb.kanbanOpen) renderKanban();
    } catch (e) { /* ignora */ } finally { refreshing = false; }
  }

  /** Conversas de uma seleção: [{key, chatId, phone, name, isGroup, unread, t, favorite}] */
  function membersOf(sel) {
    if (!sel) return [];
    if (sel.kind === 'tab') {
      const ids = byChatId(), phones = byPhone();
      return ZF.crm.chatsInTab(sel.id).map((c) => {
        const live = (c.chatId && ids.get(c.chatId)) || (c.phone && phones.get(ZF.onlyDigits(c.phone))) || null;
        return { ...(live || {}), key: c.key, name: (live && live.name) || c.name, phone: c.phone || (live && live.phone), chatId: (live && live.chatId) || c.chatId, isGroup: c.isGroup, notes: c.notes || [] };
      });
    }
    if (sel.kind === 'label') return tb.chats.filter((c) => (c.labels || []).includes(sel.id));
    if (sel.id === 'unread') return tb.chats.filter((c) => c.unread > 0 && !c.archived);
    if (sel.id === 'favorites') return tb.chats.filter((c) => c.favorite);
    if (sel.id === 'groups') return tb.chats.filter((c) => c.isGroup && !c.archived);
    return [];
  }
  const BUILTINS = [
    { id: 'unread', name: 'Não lidas', color: '#e0245e' },
    { id: 'favorites', name: 'Favoritos', color: '#e8590c' },
    { id: 'groups', name: 'Grupos', color: '#0a8f5a' },
  ];
  function chipItems() {
    const out = [];
    if (settings().barMode === 'labels') {
      tb.labels.forEach((l) => out.push({ kind: 'label', id: l.id, name: l.name, color: l.color || '#8696a0', count: tb.chats.filter((c) => (c.labels || []).includes(l.id)).length }));
    } else if (ZF.crm) {
      ZF.crm.tabs().forEach((t) => out.push({ kind: 'tab', id: t.id, name: t.name, color: t.color, count: ZF.crm.countInTab(t.id) }));
    }
    BUILTINS.forEach((b) => out.push({ kind: 'builtin', id: b.id, name: b.name, color: b.color, count: membersOf({ kind: 'builtin', id: b.id }).length }));
    return out;
  }
  const selName = (sel) => {
    if (!sel) return '';
    if (sel.kind === 'tab') { const t = ZF.crm.tabById(sel.id); return t ? t.name : 'Aba'; }
    if (sel.kind === 'label') { const l = tb.labels.find((x) => x.id === sel.id); return l ? l.name : 'Etiqueta'; }
    return (BUILTINS.find((b) => b.id === sel.id) || {}).name || '';
  };
  const selColor = (sel) => {
    if (!sel) return '#2455e6';
    if (sel.kind === 'tab') { const t = ZF.crm.tabById(sel.id); return (t && t.color) || '#2455e6'; }
    if (sel.kind === 'label') { const l = tb.labels.find((x) => x.id === sel.id); return (l && l.color) || '#8696a0'; }
    return (BUILTINS.find((b) => b.id === sel.id) || {}).color || '#2455e6';
  };

  /* ---------------- barra ---------------- */
  function tabMenu(tab, anchor) {
    ui.menu(anchor, [
      { label: 'Editar aba', icon: 'edit', onClick: () => ZF.crm.openTabEditor(tab) },
      { label: 'Disparo em massa para esta aba', icon: 'inbox', onClick: () => { ZF.openCampaignEditor(null, { name: tab.name, recipients: ZF.crm.chatsInTab(tab.id) }); } },
      { label: 'Exportar (Excel)', icon: 'grid', onClick: () => ZF.exportContacts.tab(tab) },
      '-',
      { label: 'Excluir aba', icon: 'trash', danger: true, onClick: async () => { if (await ZF.crm.deleteTab(tab) && tb.selected && tb.selected.id === tab.id) select(null); } },
    ], { align: 'left' });
  }

  function renderChips() {
    if (!chipsEl) return;
    const items = chipItems();
    chipsEl.replaceChildren();
    if (settings().barMode === 'labels' && !tb.labels.length) {
      chipsEl.appendChild(h('span', { class: 'zf-tb-empty' }, tb.labelsOk ? 'Nenhuma etiqueta no seu WhatsApp' : 'Etiquetas do WhatsApp indisponíveis'));
    }
    if (settings().barMode !== 'labels' && ZF.crm && !ZF.crm.tabs().length) {
      chipsEl.appendChild(h('button', { class: 'zf-tb-empty link', onclick: () => ZF.crm.openTabEditor() }, icon('folderPlus', 14), 'Crie sua primeira aba'));
    }
    items.forEach((it) => {
      const active = tb.selected && tb.selected.kind === it.kind && tb.selected.id === it.id;
      const chip = h('button', {
        class: 'zf-tbchip' + (active ? ' active' : ''), style: { '--c': it.color }, title: `${it.name} — ${it.count} conversa(s)`,
        onclick: () => select(active ? null : { kind: it.kind, id: it.id }),
        oncontextmenu: (e) => { if (it.kind !== 'tab') return; e.preventDefault(); const t = ZF.crm.tabById(it.id); if (t) tabMenu(t, e.currentTarget); },
      }, h('span', { class: 'zf-tbchip-name' }, it.name), h('span', { class: 'zf-tbchip-n' }, it.count > 999 ? '999+' : it.count));
      chipsEl.appendChild(chip);
    });
    if (filterBtn) filterBtn.classList.toggle('has-sel', !!tb.selected);
  }

  function buildBar() {
    filterBtn = h('button', {
      class: 'zf-tb-btn zf-tb-filter', title: 'O que mostrar na barra',
      onclick: (e) => ui.menu(e.currentTarget, [
        { label: 'Abas', icon: 'folderArrow', active: settings().barMode !== 'labels', onClick: () => setMode('tabs') },
        { label: 'Etiquetas', icon: 'label', active: settings().barMode === 'labels', onClick: () => setMode('labels') },
        { label: 'Ocultar Exibição', icon: 'folderDown', onClick: () => store.saveSettings({ topBar: false }) },
      ], { align: 'left' }),
    }, icon('filter', 18), h('span', { class: 'zf-tb-dot' }));
    chipsEl = h('div', { class: 'zf-tb-chips' });
    chipsEl.addEventListener('wheel', (e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { chipsEl.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
    const addBtn = h('button', { class: 'zf-tb-btn', title: 'Nova aba do CRM', onclick: ui.safe(async () => { const id = await ZF.crm.openTabEditor(); if (id && settings().barMode === 'labels') setMode('tabs'); }) }, icon('folderPlus', 19));
    const menuBtn = h('button', {
      class: 'zf-tb-btn', title: 'Mais opções',
      onclick: (e) => ui.menu(e.currentTarget, [
        { label: 'Quadro de atendimento (Kanban)', icon: 'kanban', onClick: () => openKanban() },
        { label: 'Gerenciar abas', icon: 'folderArrow', onClick: () => ui.openView('crm') },
        { label: 'Atualizar contagens', icon: 'refresh', onClick: () => refresh() },
        '-',
        { label: 'Ocultar esta barra', icon: 'folderDown', onClick: () => store.saveSettings({ topBar: false }) },
      ]),
    }, icon('menu', 19));
    barEl = h('div', { class: 'zf-topbar zf-keep' }, filterBtn, chipsEl, addBtn, menuBtn);
    handleEl = h('button', { class: 'zf-tb-handle zf-keep', title: 'Mostrar a barra de abas', onclick: () => store.saveSettings({ topBar: true }) }, icon('folderArrow', 13), 'Abas', icon('chevronDown', 13));
    ui.wrap.appendChild(barEl);
    ui.wrap.appendChild(handleEl);
  }

  const setMode = (m) => { select(null); store.saveSettings({ barMode: m }).then(() => { lastLabels = 0; refresh(); }); };

  function applyVisibility() {
    if (!barEl) return;
    const ready = ZF.wa.isReady();
    const show = ready && settings().topBar !== false;
    barEl.style.display = show ? '' : 'none';
    handleEl.style.display = ready && !show ? '' : 'none';
    // na tela de login (QR code) os botões flutuantes ficam escondidos
    if (ui.dock) ui.dock.classList.toggle('zf-hidden', !ready);
    const root = document.documentElement;
    root.classList.toggle('zapflow-bar', show);
    root.style.setProperty('--zapflow-bar-h', BAR_H + 'px');
    if (show !== applyVisibility.last) { applyVisibility.last = show; window.dispatchEvent(new Event('resize')); }
  }

  /* ---------------- lista filtrada (por cima da lista do WhatsApp) ---------------- */
  function select(sel) {
    tb.selected = sel;
    overlayQuery = '';
    renderChips();
    if (!sel) { if (overlayEl) overlayEl.remove(); overlayEl = null; return; }
    renderOverlay(false);
    refresh();
  }

  function paneRect() {
    const pane = document.querySelector('#pane-side') || document.querySelector('#side');
    const r = pane && pane.getBoundingClientRect();
    if (r && r.width > 120 && r.height > 120) return { left: r.left, top: r.top, width: r.width, height: r.height };
    const side = document.querySelector('#side');
    const s = side && side.getBoundingClientRect();
    if (s && s.width > 120) return { left: s.left, top: s.top, width: s.width, height: s.height };
    const top = settings().topBar !== false ? BAR_H + 8 : 8;
    return { left: 8, top, width: Math.min(420, window.innerWidth - 16), height: window.innerHeight - top - 8 };
  }
  function positionOverlay() {
    if (!overlayEl) return;
    const r = paneRect();
    Object.assign(overlayEl.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  }
  setInterval(positionOverlay, 800);
  window.addEventListener('resize', () => setTimeout(positionOverlay, 50));

  const initials = (name) => (String(name || '?').replace(/[^\p{L}\p{N} ]/gu, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '#');
  const avatar = (c, size = 44) => {
    const d = c.chatId && details[c.chatId];
    const el = h('div', { class: 'zf-av', style: { width: size + 'px', height: size + 'px' } }, c.isGroup ? icon('users', size * 0.45) : initials(c.name));
    if (d && d.pic) {
      const img = h('img', { src: d.pic, alt: '', referrerpolicy: 'no-referrer' });
      img.onerror = () => img.remove();
      el.appendChild(img);
    }
    return el;
  };
  const timeLabel = (t) => {
    if (!t) return '';
    const d = new Date(t * 1000);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return ZF.fmtTime(d);
    const y = new Date(Date.now() - 86400000);
    if (d.toDateString() === y.toDateString()) return 'Ontem';
    return ZF.fmtDate(d).slice(0, 5);
  };

  async function openChatFrom(c) {
    const r = c.chatId ? await ZF.wa.bridge('openChat', { chatId: c.chatId }, 20000) : null;
    if (r && r.ok) return;
    await ZF.crm.openChat(c);
  }

  function rowMenu(c, anchor) {
    const sel = tb.selected;
    const tabs = ZF.crm.tabs();
    const info = { name: c.name, phone: c.phone, chatId: c.chatId, isGroup: c.isGroup };
    const items = [{ label: 'Abrir conversa', icon: 'message', onClick: () => openChatFrom(c) }];
    if (sel && sel.kind === 'tab') {
      items.push({ label: 'Remover desta aba', icon: 'folderMinus', danger: true, onClick: () => ZF.crm.toggleTab(info, sel.id, false) });
      const others = tabs.filter((t) => t.id !== sel.id);
      if (others.length) items.push('-', { title: 'Mover para' }, ...others.map((t) => ({ label: t.name, icon: 'folderArrow', onClick: () => ZF.crm.moveTab(info, sel.id, t.id) })));
    } else if (tabs.length) {
      items.push('-', { title: 'Adicionar à aba' }, ...tabs.map((t) => ({ label: t.name, icon: 'folderPlus', onClick: () => ZF.crm.toggleTab(info, t.id, true) })));
    }
    ui.menu(anchor, items);
  }

  async function renderOverlay(keepScroll) {
    const sel = tb.selected;
    if (!sel) return;
    const members = membersOf(sel).sort((a, b) => (b.t || 0) - (a.t || 0) || String(a.name).localeCompare(String(b.name)));
    // prévia da última mensagem e fotos (só das conversas mostradas)
    const need = members.filter((c) => c.chatId && !details[c.chatId]).slice(0, 150).map((c) => c.chatId);
    if (need.length) {
      const r = await ZF.wa.bridge('chatDetails', { chatIds: need }, 15000);
      if (r && r.ok) Object.assign(details, r.details);
    }
    if (!overlayEl) {
      overlayEl = h('div', { class: 'zf-chatlist zf-keep' });
      ui.wrap.appendChild(overlayEl);
    }
    const listEl = overlayEl.querySelector('.zf-cl-list');
    const scroll = keepScroll && listEl ? listEl.scrollTop : 0;
    const q = ZF.normKey(overlayQuery);
    const qd = ZF.onlyDigits(overlayQuery);
    const shown = members.filter((c) => !q || ZF.normKey(c.name).includes(q) || (qd && String(c.phone || '').includes(qd)));

    const search = h('input', { placeholder: 'Pesquisar nesta lista', value: overlayQuery });
    search.addEventListener('input', () => { overlayQuery = search.value; renderOverlay(false).then(() => { const s = overlayEl && overlayEl.querySelector('.zf-cl-search input'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }); });
    const tab = sel.kind === 'tab' ? ZF.crm.tabById(sel.id) : null;
    const list = h('div', { class: 'zf-cl-list' });
    shown.slice(0, 400).forEach((c) => {
      const d = (c.chatId && details[c.chatId]) || {};
      const prev = d.preview;
      const row = h('div', { class: 'zf-cl-row', onclick: ui.safe(() => openChatFrom(c)) },
        avatar(c),
        h('div', { class: 'zf-cl-mid' },
          h('div', { class: 'zf-cl-top' }, h('span', { class: 'zf-cl-name' }, c.name || ZF.fmtPhone(c.phone) || 'Conversa'), h('span', { class: 'zf-cl-time' + (c.unread ? ' unread' : '') }, timeLabel(c.t))),
          h('div', { class: 'zf-cl-bottom' },
            h('span', { class: 'zf-cl-prev' }, prev ? (prev.fromMe ? '✓ ' : '') + prev.text : c.phone ? ZF.fmtPhone(c.phone) : c.isGroup ? 'Grupo' : ''),
            c.unread ? h('span', { class: 'zf-cl-badge' }, c.unread) : null,
            h('button', { class: 'zf-iconbtn zf-cl-more', title: 'Opções', onclick: (e) => { e.stopPropagation(); rowMenu(c, e.currentTarget); } }, icon('chevronDown', 16)))));
      list.appendChild(row);
    });
    if (!shown.length) {
      list.appendChild(h('div', { class: 'zf-empty' }, members.length ? 'Nada encontrado.'
        : sel.kind === 'tab' ? 'Nenhuma conversa nesta aba. Abra uma conversa e use o botão "Contato" (ou o quadro) para colocá-la aqui.' : 'Nenhuma conversa.'));
    }
    if (shown.length > 400) list.appendChild(h('div', { class: 'zf-hint', style: { padding: '8px 16px' } }, `Mostrando 400 de ${shown.length}. Use a busca.`));

    overlayEl.replaceChildren(
      h('div', { class: 'zf-cl-head', style: { '--c': selColor(sel) } },
        h('span', { class: 'zf-tabchip-dot' }),
        h('div', { class: 'zf-grow zf-ellipsis', style: { fontWeight: 700 } }, selName(sel)),
        h('span', { class: 'zf-tbchip-n' }, members.length),
        tab ? h('button', { class: 'zf-iconbtn', title: 'Opções da aba', onclick: (e) => tabMenu(tab, e.currentTarget) }, icon('more', 18)) : null,
        h('button', { class: 'zf-iconbtn', title: 'Fechar filtro (voltar para todas as conversas)', onclick: () => select(null) }, icon('x', 18))),
      h('label', { class: 'zf-searchbox zf-cl-search' }, icon('search', 16), search),
      list);
    list.scrollTop = scroll;
    positionOverlay();
  }

  /* ---------------- quadro de atendimento (Kanban) ---------------- */
  function openKanban() {
    if (!ZF.crm) return;
    tb.kanbanOpen = true;
    if (!kanbanEl) {
      kanbanEl = h('div', { class: 'zf-kanban zf-keep', tabindex: '-1' });
      kanbanEl.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeKanban(); });
    }
    ui.wrap.appendChild(kanbanEl);
    renderKanban();
    refresh();
    setTimeout(() => kanbanEl.focus(), 30);
  }
  function closeKanban() {
    tb.kanbanOpen = false;
    if (kanbanEl) kanbanEl.remove();
  }

  function renderKanban() {
    if (!kanbanEl || !tb.kanbanOpen) return;
    const scrollers = [...kanbanEl.querySelectorAll('.zf-kb-cards')].map((el) => el.scrollTop);
    const boardScroll = (kanbanEl.querySelector('.zf-kb-board') || {}).scrollLeft || 0;
    const q = ZF.normKey(kanbanQuery);
    const match = (c) => !q || ZF.normKey(`${c.name} ${c.phone || ''}`).includes(q);
    const inAnyTab = new Set();
    const tabs = ZF.crm.tabs();
    const cols = tabs.map((t) => {
      const members = membersOf({ kind: 'tab', id: t.id });
      members.forEach((m) => { if (m.chatId) inAnyTab.add(m.chatId); if (m.phone) inAnyTab.add(ZF.onlyDigits(m.phone)); });
      return { id: t.id, tab: t, name: t.name, color: t.color, items: members.sort((a, b) => (b.t || 0) - (a.t || 0)) };
    });
    const recent = tb.chats.filter((c) => !c.archived && !inAnyTab.has(c.chatId) && !(c.phone && inAnyTab.has(c.phone))).slice(0, 40);
    cols.unshift({ id: null, name: 'Conversas recentes', color: '#8696a0', items: recent, hint: 'Arraste para uma aba' });

    const card = (c, fromId) => {
      const info = { name: c.name, phone: c.phone, chatId: c.chatId, isGroup: c.isGroup };
      const lastNote = c.notes && c.notes.length ? c.notes[c.notes.length - 1].text : '';
      const el = h('div', {
        class: 'zf-kb-card', draggable: 'true',
        ondragstart: (e) => { e.dataTransfer.setData('text/plain', JSON.stringify({ info, from: fromId })); e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); },
        ondragend: () => el.classList.remove('dragging'),
        onclick: ui.safe(async () => { await openChatFrom(c); closeKanban(); }),
      },
      avatar(c, 34),
      h('div', { class: 'zf-grow', style: { minWidth: 0 } },
        h('div', { class: 'zf-kb-name' }, c.name || ZF.fmtPhone(c.phone) || 'Conversa'),
        h('div', { class: 'zf-kb-sub' }, lastNote ? '📝 ' + lastNote : c.isGroup ? 'Grupo' : ZF.fmtPhone(c.phone))),
      c.unread ? h('span', { class: 'zf-cl-badge' }, c.unread) : null,
      fromId ? h('button', { class: 'zf-iconbtn zf-kb-x', title: 'Tirar desta aba', onclick: ui.safe(async (e) => { e.stopPropagation(); await ZF.crm.toggleTab(info, fromId, false); }) }, icon('x', 14)) : null);
      return el;
    };

    const board = h('div', { class: 'zf-kb-board' }, cols.map((col) => {
      const items = col.items.filter(match);
      const cardsEl = h('div', { class: 'zf-kb-cards' }, items.slice(0, 200).map((c) => card(c, col.id)),
        items.length ? null : h('div', { class: 'zf-kb-empty' }, col.hint || 'Arraste conversas para cá'));
      const colEl = h('div', {
        class: 'zf-kb-col', style: { '--c': col.color },
        ondragover: (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; colEl.classList.add('over'); },
        ondragleave: (e) => { if (!colEl.contains(e.relatedTarget)) colEl.classList.remove('over'); },
        ondrop: ui.safe(async (e) => {
          e.preventDefault();
          colEl.classList.remove('over');
          let d;
          try { d = JSON.parse(e.dataTransfer.getData('text/plain')); } catch (err) { return; }
          if (!d || !d.info || d.from === col.id) return;
          if (d.from) await ZF.crm.moveTab(d.info, d.from, col.id);
          else if (col.id) await ZF.crm.toggleTab(d.info, col.id, true);
        }),
      },
      h('div', { class: 'zf-kb-colh' },
        h('span', { class: 'zf-tabchip-dot' }),
        h('span', { class: 'zf-grow zf-ellipsis' }, col.name),
        h('span', { class: 'zf-tbchip-n' }, col.items.length),
        col.tab ? h('button', { class: 'zf-iconbtn', title: 'Opções', onclick: (e) => tabMenu(col.tab, e.currentTarget) }, icon('more', 16)) : null),
      cardsEl);
      return colEl;
    }),
    h('button', { class: 'zf-kb-add', onclick: ui.safe(() => ZF.crm.openTabEditor()) }, icon('folderPlus', 18), 'Nova aba'));

    const search = h('input', { placeholder: 'Pesquisar conversa…', value: kanbanQuery });
    search.addEventListener('input', () => {
      kanbanQuery = search.value;
      renderKanban();
      const s = kanbanEl.querySelector('.zf-kb-head input');
      if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
    });
    kanbanEl.replaceChildren(h('div', { class: 'zf-kb-inner' },
      h('div', { class: 'zf-kb-head' },
        icon('kanban', 20), h('div', { class: 'zf-kb-title' }, 'Quadro de atendimento'),
        h('span', { class: 'zf-muted zf-small' }, 'Arraste as conversas entre as abas. Clique para abrir.'),
        h('div', { class: 'zf-grow' }),
        h('label', { class: 'zf-searchbox', style: { maxWidth: '260px' } }, icon('search', 16), search),
        h('button', { class: 'zf-iconbtn', title: 'Atualizar', onclick: () => refresh() }, icon('refresh', 18)),
        h('button', { class: 'zf-iconbtn', title: 'Fechar (Esc)', onclick: closeKanban }, icon('x', 20))),
      board));
    const newBoard = kanbanEl.querySelector('.zf-kb-board');
    if (newBoard) newBoard.scrollLeft = boardScroll;
    [...kanbanEl.querySelectorAll('.zf-kb-cards')].forEach((el, i) => { el.scrollTop = scrollers[i] || 0; });
  }

  /* ---------------- ciclo de vida ---------------- */
  function mount() {
    if (barEl || !ui.wrap) return;
    buildBar();
    applyVisibility();
    renderChips();
    ZF.on('settings', () => { applyVisibility(); renderChips(); });
    ZF.on('crm', () => {
      renderChips();
      if (tb.selected) renderOverlay(true);
      if (tb.kanbanOpen) renderKanban();
    });
    setInterval(() => {
      applyVisibility();
      // só consulta o WhatsApp quando algo visível depende das contagens
      const visible = settings().topBar !== false || tb.selected || tb.kanbanOpen;
      if (!document.hidden && visible) refresh();
    }, 8000);
    const boot = setInterval(() => {
      applyVisibility();
      if (!ZF.wa.isReady()) return;
      clearInterval(boot);
      applyVisibility();
      refresh();
    }, 1000);
  }

  ZF.topbar = {
    mount,
    refresh,
    select: (sel) => select(sel),
    openKanban,
    closeKanban,
    get kanbanOpen() { return tb.kanbanOpen; },
    state: tb,
  };
})();
