/* ZapFlow — aba "Notas": anotações por conversa e busca em todas as notas */
(() => {
  'use strict';
  const ZF = window.ZF;
  const { h, icon, store, ui } = ZF;

  let notesQuery = '';
  const drafts = {}; // rascunho de nota por conversa

  const chats = () => (ZF.crm ? ZF.crm.chats() : {});
  const current = () => (ZF.activeChat ? ZF.activeChat.info : null);
  const currentKey = () => (ZF.activeChat ? ZF.activeChat.key : null);

  const rerenderIfIdle = () => {
    if (ui.current !== 'notes' || !ui.open) return;
    const a = ui.root && ui.root.activeElement;
    if (a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT') && a.value) return;
    ui.rerender('notes');
  };
  ZF.on('crm', rerenderIfIdle);
  ZF.on('activechat', () => { if (ui.current === 'notes') ui.rerender('notes'); });

  async function addNote(text) {
    const t = text.trim();
    if (!t) return;
    await ZF.crm.upsert(current(), (c) => { c.notes = [...(c.notes || []), { id: ZF.uid(), text: t, createdAt: Date.now() }]; });
    drafts[currentKey()] = '';
    ui.toast('Nota salva', 'ok');
    ui.rerender('notes');
  }
  function editNote(key, note) {
    const ta = h('textarea', { class: 'zf-textarea', rows: 5, value: note.text });
    ui.modal({
      title: 'Editar nota',
      body: ta,
      actions: [
        { label: 'Cancelar' },
        {
          label: 'Salvar', class: 'primary', onClick: () => store.update('crmChats', (map) => {
            const c = map[key];
            if (c) c.notes = c.notes.map((n) => (n.id === note.id ? { ...n, text: ta.value.trim(), updatedAt: Date.now() } : n));
            return map;
          }),
        },
      ],
    });
  }
  async function deleteNote(key, note) {
    if (!(await ui.confirm('Excluir esta nota?', { okLabel: 'Excluir', danger: true }))) return;
    await store.update('crmChats', (map) => {
      const c = map[key];
      if (c) c.notes = c.notes.filter((n) => n.id !== note.id);
      return map;
    });
  }
  const noteCard = (key, n, showChat) => {
    const c = chats()[key] || {};
    return h('div', { class: 'zf-card zf-note-card' },
      showChat ? h('button', {
        class: 'zf-linkbtn', title: 'Abrir a conversa', onclick: ui.safe(() => ZF.crm.openChat(c)),
      }, icon(c.isGroup ? 'users' : 'user', 13), c.name || ZF.fmtPhone(c.phone) || key) : null,
      h('div', { class: 'zf-note-text' }, n.text),
      h('div', { class: 'zf-row', style: { marginTop: '4px' } },
        h('span', { class: 'zf-muted zf-small zf-grow' }, ZF.fmtDateTime(n.updatedAt || n.createdAt) + (n.updatedAt ? ' (editada)' : '')),
        h('button', { class: 'zf-iconbtn', title: 'Editar', onclick: () => editNote(key, n) }, icon('edit', 14)),
        h('button', { class: 'zf-iconbtn', title: 'Excluir', onclick: ui.safe(() => deleteNote(key, n)) }, icon('trash', 14))));
  };

  function renderCurrent(body) {
    const cur = current();
    if (!cur) {
      ZF.append(body, h('div', { class: 'zf-card' },
        h('div', { class: 'zf-row' }, icon('clipboardEdit', 18), h('div', { class: 'zf-name' }, 'Nenhuma conversa aberta')),
        h('div', { class: 'zf-hint' }, 'Abra uma conversa para ver e escrever notas sobre ela. As notas ficam só no seu computador.')));
      return;
    }
    const key = currentKey();
    const rec = chats()[key] || { notes: [] };
    const draft = h('textarea', {
      class: 'zf-textarea', rows: 4, value: drafts[key] || '', placeholder: `Escreva uma nota sobre ${cur.name || 'esta conversa'}…`,
      oninput: (e) => { drafts[key] = e.target.value; },
      onkeydown: ui.safe(async (e) => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); await addNote(draft.value); } }),
    });
    const notes = (rec.notes || []).slice().reverse();
    ZF.append(body,
      h('div', { class: 'zf-row', style: { marginBottom: '8px' } }, icon(cur.isGroup ? 'users' : 'user', 16),
        h('div', { class: 'zf-name zf-grow zf-ellipsis' }, cur.name || ZF.fmtPhone(cur.phone) || 'Conversa'),
        cur.phone ? h('span', { class: 'zf-muted zf-small' }, ZF.fmtPhone(cur.phone)) : null),
      draft,
      h('div', { class: 'zf-row', style: { justifyContent: 'space-between', margin: '6px 0 10px' } },
        h('span', { class: 'zf-hint', style: { margin: 0 } }, 'Ctrl+Enter para salvar'),
        h('button', { class: 'zf-btn sm primary', onclick: ui.safe(() => addNote(draft.value)) }, icon('check', 13), 'Salvar nota')),
      h('div', { class: 'zf-h3' }, `Notas desta conversa (${notes.length})`),
      notes.length ? notes.map((n) => noteCard(key, n, false)) : h('div', { class: 'zf-hint' }, 'Nenhuma nota ainda.'));
  }

  function renderAll(body) {
    const all = [];
    Object.entries(chats()).forEach(([k, c]) => (c.notes || []).forEach((n) => all.push({ k, c, n })));
    if (!all.length) return;
    const list = h('div');
    const fill = () => {
      const q = ZF.normKey(notesQuery);
      const items = all.filter(({ c, n }) => !q || ZF.normKey(`${c.name} ${c.phone} ${n.text}`).includes(q))
        .sort((a, b) => (b.n.updatedAt || b.n.createdAt) - (a.n.updatedAt || a.n.createdAt)).slice(0, 60);
      list.replaceChildren(...(items.length ? items.map(({ k, n }) => noteCard(k, n, true)) : [h('div', { class: 'zf-hint' }, 'Nada encontrado.')]));
    };
    const search = h('label', { class: 'zf-searchbox', style: { marginBottom: '8px' } }, icon('search', 16),
      h('input', { placeholder: 'Pesquisar em todas as notas…', value: notesQuery, oninput: (e) => { notesQuery = e.target.value; fill(); } }));
    fill();
    ZF.append(body, h('div', { class: 'zf-h3', style: { marginTop: '18px' } }, `Todas as notas (${all.length})`), search, list);
  }

  function render(body) {
    if (ZF.activeChat && !ZF.activeChat.checked && ZF.checkActiveChat) setTimeout(() => ZF.checkActiveChat(true), 0);
    ZF.append(body, h('div', { class: 'zf-h2' }, icon('clipboardEdit', 18), 'Notas'));
    renderCurrent(body);
    renderAll(body);
  }

  ui.registerTab('notes', { icon: 'clipboardEdit', title: 'Notas', render });
})();
