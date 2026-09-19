/* ZapFlow — aba "Respostas rápidas" */
(() => {
  'use strict';
  const ZF = window.ZF;
  const { h, icon, store, ui } = ZF;

  const COLORS = [
    { key: 'gray', hex: '#d9dce0' }, { key: 'peach', hex: '#f6d3bd' }, { key: 'blue', hex: '#c4d4fa' },
    { key: 'green', hex: '#bfe6cd' }, { key: 'yellow', hex: '#f5e39c' }, { key: 'pink', hex: '#f6c4d8' },
    { key: 'purple', hex: '#d9c8f7' }, { key: 'teal', hex: '#b5e3df' }, { key: 'none', hex: 'transparent' },
  ];

  const state = { q: '', filter: 'all', type: null, catId: null, expanded: new Set() };
  let data = { replies: [], categories: [] };
  let loaded = false;
  let listEl = null, chipsEl = null;

  const load = async () => {
    data = await store.getMany(['replies', 'categories']);
    data.categories.sort((a, b) => (a.order || 0) - (b.order || 0));
    loaded = true;
  };
  store.onChange(['replies', 'categories'], async () => {
    await load();
    if (ui.current === 'replies' && listEl && listEl.isConnected) {
      renderChips();
      renderList();
    }
  });

  const catById = (id) => data.categories.find((c) => c.id === id) || null;
  const sortReplies = (arr) => arr.slice().sort((a, b) => (a.order || 0) - (b.order || 0) || a.title.localeCompare(b.title));

  /* ---------------- usar uma resposta ---------------- */
  async function useReply(reply, mode, rowEl) {
    if (!ZF.wa.getCompose()) throw new Error('Abra uma conversa no WhatsApp primeiro.');
    const info = await ZF.wa.activeChatInfo();
    const vars = ZF.builtinVars({ name: info && info.name, phone: info && info.phone });
    const used = ZF.findVarsInBlocks(reply.blocks);
    const ask = used.filter((v) => (!ZF.BUILTIN_VARS.includes(v) && !(v in vars)) || (v === 'nome' && !vars.nome) || (v === 'primeiro_nome' && !vars.primeiro_nome && !used.includes('nome')));
    if (ask.length) {
      const extra = await ui.askVars(ask);
      if (!extra) return;
      Object.assign(vars, extra);
      if (extra.nome && !extra.primeiro_nome) vars.primeiro_nome = ZF.firstName(extra.nome);
      if (extra.primeiro_nome && !extra.nome) vars.nome = extra.primeiro_nome;
    }
    const rendered = ZF.renderBlocks(reply.blocks, vars, false);
    if (mode === 'send') {
      ui.toast('Enviando…');
      const target = { chatId: info && info.chatId, phone: info && info.phone };
      await ZF.runner.exclusive(async () => {
        if (!target.chatId && !target.phone) return ZF.wa.sendBlocks(rendered);
        const r = await ZF.wa.deliver(target, rendered, ui.settings, { isOpen: true });
        if (!r.ok) throw new Error(r.error || 'Falha no envio');
      });
      ui.toast('Mensagem enviada', 'ok');
    } else {
      const r = await ZF.wa.insertBlocks(rendered);
      if (r.skippedFiles) ui.toast('Texto inserido. Para enviar os arquivos junto, use o botão ➤', 'info', 4000);
    }
    if (rowEl) { rowEl.classList.remove('flash'); void rowEl.offsetWidth; rowEl.classList.add('flash'); }
    store.updateItem('replies', reply.id, (r) => { r.uses = (r.uses || 0) + 1; r.lastUsed = Date.now(); });
  }

  /* ---------------- editores ---------------- */
  function openCategoryEditor(cat = null) {
    return new Promise((resolve) => {
      let color = cat ? cat.color : 'gray';
      let savedId = null;
      const name = ui.input({ value: cat ? cat.name : '', placeholder: 'Ex.: 📞 Confirmações de consulta' });
      const sw = h('div', { class: 'zf-swatches' });
      const renderSw = () => {
        sw.replaceChildren();
        COLORS.forEach((c) => sw.appendChild(h('button', {
          class: 'zf-swatch' + (c.key === color ? ' active' : ''), title: c.key === 'none' ? 'Sem cor' : c.key,
          style: { background: c.key === 'none' ? 'repeating-linear-gradient(45deg,#fff,#fff 4px,#ddd 4px,#ddd 8px)' : c.hex },
          onclick: (e) => { e.preventDefault(); color = c.key; renderSw(); },
        })));
      };
      renderSw();
      ui.modal({
        title: cat ? 'Editar categoria' : 'Nova categoria',
        body: h('div', {},
          ui.field('Nome', name, 'Dica: use Win + . para inserir emojis no nome.'),
          ui.field('Cor', sw)),
        onClose: () => resolve(savedId),
        actions: [
          { label: 'Cancelar' },
          {
            label: 'Salvar', class: 'primary', onClick: async () => {
              const n = name.value.trim();
              if (!n) { ui.toast('Informe o nome da categoria', 'error'); name.focus(); return false; }
              if (cat) {
                await store.updateItem('categories', cat.id, (c) => { c.name = n; c.color = color; });
                savedId = cat.id;
              } else {
                savedId = ZF.uid();
                await store.update('categories', (list) => {
                  const order = list.reduce((m, c) => Math.max(m, c.order || 0), 0) + 1;
                  list.push({ id: savedId, name: n, color, order, collapsed: false });
                  return list;
                });
              }
            },
          },
        ],
      });
    });
  }

  function openReplyEditor(reply = null, defaults = {}) {
    const title = ui.input({ value: reply ? reply.title : defaults.title || '', placeholder: 'Ex.: CC - Amanhã' });
    const catSelect = () => ui.select(
      [{ value: '', label: '— Sem categoria —' }, ...data.categories.map((c) => ({ value: c.id, label: c.name })), { value: '__new', label: '+ Nova categoria…' }],
      reply ? reply.categoryId || '' : defaults.categoryId || '');
    let cat = catSelect();
    const catWrap = h('div', {}, cat);
    const bindCat = () => cat.addEventListener('change', async () => {
      if (cat.value !== '__new') return;
      const id = await openCategoryEditor();
      await load();
      const next = catSelect();
      next.value = id || '';
      cat.replaceWith(next);
      cat = next;
      bindCat();
    });
    bindCat();
    const editor = ui.blocksEditor(reply ? reply.blocks : defaults.blocks || []);

    ui.modal({
      title: reply ? 'Editar resposta' : 'Nova resposta rápida',
      body: h('div', {},
        ui.field('Título', title),
        ui.field('Categoria', catWrap),
        h('div', { class: 'zf-field' }, h('label', {}, 'Mensagem'), editor.el,
          h('div', { class: 'zf-hint' }, 'Blocos são enviados em sequência. Campos como {horario} são perguntados na hora do envio.'))),
      actions: [
        { label: 'Cancelar' },
        {
          label: 'Salvar', class: 'primary', onClick: async () => {
            const t = title.value.trim();
            const blocks = editor.get();
            if (!t) { ui.toast('Informe um título', 'error'); title.focus(); return false; }
            if (!blocks.length) { ui.toast('A mensagem está vazia', 'error'); return false; }
            const categoryId = cat.value && cat.value !== '__new' ? cat.value : null;
            if (reply) {
              await store.updateItem('replies', reply.id, (r) => ({ ...r, title: t, categoryId, blocks, updatedAt: Date.now() }));
            } else {
              await store.update('replies', (list) => {
                const order = list.reduce((m, r) => Math.max(m, r.order || 0), 0) + 1;
                list.push({ id: ZF.uid(), title: t, categoryId, blocks, uses: 0, order, createdAt: Date.now() });
                return list;
              });
            }
            store.gcFiles();
            ui.toast('Resposta salva', 'ok');
          },
        },
      ],
    });
  }
  ZF.openReplyEditor = openReplyEditor;

  /* ---------------- ações ---------------- */
  async function duplicateReply(r) {
    await store.update('replies', (list) => {
      list.push({ ...ZF.clone(r), id: ZF.uid(), title: r.title + ' (cópia)', uses: 0, order: (r.order || 0) + 0.5, createdAt: Date.now() });
      return list;
    });
    ui.toast('Resposta duplicada', 'ok');
  }

  async function deleteReply(r) {
    if (!(await ui.confirm(`Excluir a resposta "${r.title}"?`, { okLabel: 'Excluir', danger: true }))) return;
    await store.update('replies', (list) => list.filter((x) => x.id !== r.id));
    store.gcFiles();
    ui.toast('Resposta excluída');
  }

  async function moveReply(r, dir) {
    await store.update('replies', (list) => {
      const siblings = sortReplies(list.filter((x) => (x.categoryId || null) === (r.categoryId || null)));
      siblings.forEach((x, i) => { x.order = i; });
      const i = siblings.findIndex((x) => x.id === r.id);
      const j = i + dir;
      if (j < 0 || j >= siblings.length) return list;
      [siblings[i].order, siblings[j].order] = [siblings[j].order, siblings[i].order];
      return list;
    });
  }

  async function moveCategory(cat, dir) {
    await store.update('categories', (list) => {
      list.sort((a, b) => (a.order || 0) - (b.order || 0)).forEach((c, i) => { c.order = i; });
      const i = list.findIndex((c) => c.id === cat.id);
      const j = i + dir;
      if (j < 0 || j >= list.length) return list;
      [list[i].order, list[j].order] = [list[j].order, list[i].order];
      return list;
    });
  }

  async function deleteCategory(cat) {
    const n = data.replies.filter((r) => r.categoryId === cat.id).length;
    const ok = await ui.confirm(`Excluir a categoria "${cat.name}"?${n ? `\n\nAs ${n} resposta(s) dela vão para "Sem categoria".` : ''}`, { okLabel: 'Excluir', danger: true });
    if (!ok) return;
    await store.update('replies', (list) => list.map((r) => (r.categoryId === cat.id ? { ...r, categoryId: null } : r)));
    await store.update('categories', (list) => list.filter((c) => c.id !== cat.id));
  }

  const setAllCollapsed = (collapsed) => store.update('categories', (list) => list.map((c) => ({ ...c, collapsed })));

  function replyMenu(r, anchor) {
    ui.menu(anchor, [
      { label: 'Inserir no campo (sem enviar)', icon: 'corner', onClick: () => useReply(r, 'insert') },
      { label: 'Enviar agora', icon: 'send', onClick: () => useReply(r, 'send') },
      { label: 'Agendar para esta conversa…', icon: 'clock', onClick: () => ZF.openScheduleEditor(null, { blocks: r.blocks, useActiveChat: true }) },
      { label: 'Usar em envio em massa…', icon: 'users', onClick: () => ZF.openCampaignEditor(null, { blocks: r.blocks, name: r.title }) },
      '-',
      { label: 'Editar', icon: 'edit', onClick: () => openReplyEditor(r) },
      { label: 'Duplicar', icon: 'copy', onClick: () => duplicateReply(r) },
      { label: 'Mover para cima', icon: 'arrowUp', onClick: () => moveReply(r, -1) },
      { label: 'Mover para baixo', icon: 'arrowDown', onClick: () => moveReply(r, 1) },
      { label: 'Mudar categoria…', icon: 'folder', onClick: () => ui.menu(anchor, [
        { title: 'Mover para' },
        { label: '— Sem categoria —', active: !r.categoryId, onClick: () => store.updateItem('replies', r.id, (x) => { x.categoryId = null; }) },
        ...data.categories.map((c) => ({ label: c.name, active: r.categoryId === c.id, onClick: () => store.updateItem('replies', r.id, (x) => { x.categoryId = c.id; }) })),
      ]) },
      '-',
      { label: 'Excluir', icon: 'trash', danger: true, onClick: () => deleteReply(r) },
    ]);
  }

  function categoryMenu(cat, anchor) {
    ui.menu(anchor, [
      { label: 'Nova resposta nesta categoria', icon: 'plus', onClick: () => openReplyEditor(null, { categoryId: cat.id }) },
      { label: 'Editar categoria', icon: 'edit', onClick: () => openCategoryEditor(cat) },
      { label: 'Mover para cima', icon: 'arrowUp', onClick: () => moveCategory(cat, -1) },
      { label: 'Mover para baixo', icon: 'arrowDown', onClick: () => moveCategory(cat, 1) },
      '-',
      { label: 'Excluir categoria', icon: 'trash', danger: true, onClick: () => deleteCategory(cat) },
    ]);
  }

  /* ---------------- renderização ---------------- */
  function replyRow(r, { showCat = false, showUses = false } = {}) {
    const type = ZF.messageType(r.blocks);
    const stop = (fn) => ui.safe(async (e) => { e.stopPropagation(); await fn(e); });
    const row = h('div', {
      class: 'zf-item', title: ZF.blocksPreview(r.blocks, 300),
      onclick: ui.safe(async () => useReply(r, ui.settings.clickAction === 'send' ? 'send' : 'insert', row)),
    },
    icon(ZF.TYPE_ICONS[type], 16, 'zf-type'),
    h('span', { class: 'zf-title' }, r.title),
    showCat && r.categoryId && catById(r.categoryId) ? h('span', { class: 'zf-catlabel' }, catById(r.categoryId).name) : null,
    showUses ? h('span', { class: 'zf-uses' }, `${r.uses || 0}×`) : null,
    h('button', { class: 'zf-iconbtn', title: 'Mais opções', onclick: stop((e) => replyMenu(r, e.currentTarget)) }, icon('more', 18)),
    h('button', {
      class: 'zf-iconbtn', title: 'Pré-visualizar',
      onclick: stop(() => { state.expanded.has(r.id) ? state.expanded.delete(r.id) : state.expanded.add(r.id); renderList(); }),
    }, icon('eye', 17)),
    h('button', { class: 'zf-iconbtn accent', title: 'Enviar agora na conversa aberta', onclick: stop(() => useReply(r, 'send', row)) }, icon('send', 17)));

    if (!state.expanded.has(r.id)) return row;
    const prev = h('div', { class: 'zf-preview' });
    r.blocks.forEach((b, i) => {
      if (i) prev.appendChild(h('div', { class: 'zf-sep' }));
      if (b.type === 'text') prev.appendChild(h('div', {}, b.text));
      else {
        prev.appendChild(h('div', { class: 'zf-file' }, icon(ZF.TYPE_ICONS[ZF.messageType([b])], 14), `${b.name} (${ZF.fmtSize(b.size || 0)})`));
        if (b.caption) prev.appendChild(h('div', {}, b.caption));
      }
    });
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } }, row, prev);
  }

  function categoryBlock(cat, replies, forceOpen = false) {
    const collapsed = !forceOpen && cat && cat.collapsed;
    const toggle = () => cat && store.updateItem('categories', cat.id, (c) => { c.collapsed = !c.collapsed; });
    const el = h('div', { class: 'zf-cat' + (collapsed ? ' collapsed' : ''), 'data-color': cat ? cat.color || 'gray' : 'none' },
      h('div', { class: 'zf-cat-h', onclick: toggle },
        icon('shapes', 16, 'zf-cat-icon'),
        h('span', { class: 'zf-cat-name' }, cat ? cat.name : 'Sem categoria'),
        h('span', { class: 'zf-count' }, replies.length),
        cat ? h('button', {
          class: 'zf-iconbtn zf-cat-more', title: 'Opções da categoria',
          onclick: (e) => { e.stopPropagation(); categoryMenu(cat, e.currentTarget); },
        }, icon('more', 16)) : null,
        cat ? icon(collapsed ? 'chevronDown' : 'chevronUp', 18) : null),
      h('div', { class: 'zf-cat-body' },
        replies.length ? sortReplies(replies).map((r) => replyRow(r)) : h('div', { class: 'zf-muted zf-small', style: { padding: '4px 2px' } }, 'Nenhuma resposta nesta categoria.')));
    return el;
  }

  function filteredReplies() {
    let items = data.replies;
    const q = ZF.normKey(state.q);
    if (q) items = items.filter((r) => ZF.normKey(`${r.title} ${ZF.blocksPreview(r.blocks, 2000)}`).includes(q));
    if (state.filter === 'type') items = items.filter((r) => ZF.messageType(r.blocks) === state.type);
    if (state.filter === 'uncat') items = items.filter((r) => !r.categoryId || !catById(r.categoryId));
    if (state.filter === 'cat') items = items.filter((r) => r.categoryId === state.catId);
    if (state.filter === 'top') items = items.filter((r) => r.uses > 0).sort((a, b) => (b.uses || 0) - (a.uses || 0)).slice(0, 20);
    return items;
  }

  function renderList() {
    if (!listEl) return;
    listEl.replaceChildren();
    if (!data.replies.length) {
      listEl.appendChild(h('div', { class: 'zf-empty' },
        h('div', {}, 'Você ainda não tem respostas rápidas.'),
        h('button', { class: 'zf-btn primary', onclick: () => openReplyEditor() }, icon('plus', 16), 'Criar resposta')));
      return;
    }
    const items = filteredReplies();
    if (!items.length) {
      listEl.appendChild(h('div', { class: 'zf-empty' }, state.filter === 'top' ? 'Nenhuma resposta usada ainda.' : 'Nada encontrado.'));
      return;
    }
    const flat = state.q || ['type', 'uncat', 'top'].includes(state.filter);
    if (flat) {
      const wrap = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
      items.forEach((r) => wrap.appendChild(replyRow(r, { showCat: true, showUses: state.filter === 'top' })));
      listEl.appendChild(wrap);
      return;
    }
    if (state.filter === 'cat') {
      const cat = catById(state.catId);
      if (cat) listEl.appendChild(categoryBlock(cat, items, true));
      return;
    }
    data.categories.forEach((cat) => listEl.appendChild(categoryBlock(cat, items.filter((r) => r.categoryId === cat.id))));
    const orphans = items.filter((r) => !r.categoryId || !catById(r.categoryId));
    if (orphans.length) listEl.appendChild(categoryBlock(null, orphans));
  }

  function renderChips() {
    if (!chipsEl) return;
    chipsEl.replaceChildren();
    const chip = (label, active, onclick, dropdown = false) => h('button', { class: 'zf-chip' + (active ? ' active' : ''), onclick },
      label, dropdown ? icon('chevronDown', 14) : null);
    const set = (patch) => { Object.assign(state, patch); renderChips(); renderList(); };
    const typeLabel = state.filter === 'type' ? ZF.TYPE_LABELS[state.type] : 'Por Tipo';
    const cat = state.filter === 'cat' ? catById(state.catId) : null;
    ZF.append(chipsEl, 
      chip('Tudo', state.filter === 'all', () => set({ filter: 'all' })),
      chip(typeLabel, state.filter === 'type', (e) => ui.menu(e.currentTarget, Object.keys(ZF.TYPE_LABELS).map((t) => ({
        label: ZF.TYPE_LABELS[t], icon: ZF.TYPE_ICONS[t], active: state.filter === 'type' && state.type === t,
        onClick: () => set({ filter: 'type', type: t }),
      }))), true),
      chip('Sem Categoria', state.filter === 'uncat', () => set({ filter: 'uncat' })),
      chip(cat ? cat.name : 'Por Categoria', state.filter === 'cat', (e) => ui.menu(e.currentTarget, data.categories.length
        ? data.categories.map((c) => ({ label: c.name, active: state.catId === c.id, onClick: () => set({ filter: 'cat', catId: c.id }) }))
        : [{ label: 'Nenhuma categoria criada', onClick: () => openCategoryEditor() }]), true),
      chip('Mais Usadas', state.filter === 'top', () => set({ filter: 'top' })),
    );
  }

  function render(body) {
    if (!loaded) {
      body.appendChild(h('div', { class: 'zf-empty' }, 'Carregando…'));
      load().then(() => ui.rerender('replies'));
      return;
    }
    const search = h('input', {
      placeholder: 'Pesquisar resposta rápida', value: state.q,
      oninput: (e) => { state.q = e.target.value; renderList(); },
      onkeydown: ui.safe(async (e) => {
        if (e.key === 'Enter') {
          const first = filteredReplies()[0];
          if (first) await useReply(first, e.ctrlKey ? 'send' : 'insert');
        }
        if (e.key === 'Escape') { state.q = ''; e.target.value = ''; renderList(); }
      }),
    });
    const add = h('button', {
      class: 'zf-iconbtn big', title: 'Adicionar',
      onclick: (e) => ui.menu(e.currentTarget, [
        { label: 'Nova resposta', icon: 'message', onClick: () => openReplyEditor(null, state.filter === 'cat' ? { categoryId: state.catId } : {}) },
        { label: 'Nova categoria', icon: 'folder', onClick: () => openCategoryEditor() },
        '-',
        { label: 'Expandir todas', icon: 'chevronDown', onClick: () => setAllCollapsed(false) },
        { label: 'Recolher todas', icon: 'chevronUp', onClick: () => setAllCollapsed(true) },
      ]),
    }, icon('layers', 22));

    chipsEl = h('div', { class: 'zf-chips' });
    listEl = h('div');
    ZF.append(body, 
      h('div', { class: 'zf-row' }, h('label', { class: 'zf-searchbox' }, icon('search', 17), search), add),
      chipsEl,
      listEl,
    );
    renderChips();
    renderList();
  }

  ui.registerTab('replies', { icon: 'zap', title: 'Respostas rápidas', render });
})();
