/* ZapFlow — aba "Contato": notas por conversa, etiquetas próprias (organizar chats) e exportação */
(() => {
  'use strict';
  const ZF = window.ZF;
  const { h, icon, store, ui } = ZF;

  const TAG_COLORS = ['#2455e6', '#0a8f5a', '#d97706', '#d93025', '#7c3aed', '#0891b2', '#db2777', '#4b5563'];

  let data = { crmChats: {}, crmTags: [] };
  let loaded = false;
  let current = null; // conversa aberta no WhatsApp
  let currentKey = null;
  let openTag = null; // etiqueta expandida em "Organizar"
  let notesQuery = '';
  const drafts = {}; // rascunho de nota por conversa

  const load = async () => {
    data = await store.getMany(['crmChats', 'crmTags']);
    loaded = true;
  };
  store.onChange(['crmChats', 'crmTags'], async () => {
    await load();
    rerenderIfIdle();
  });
  load(); // outras abas (disparos) usam as etiquetas mesmo sem abrir esta aba

  const rerenderIfIdle = () => {
    if (ui.current !== 'crm' || !ui.open) return;
    const active = ui.root && ui.root.activeElement;
    if (active && active.tagName === 'TEXTAREA' && active.value.trim()) return; // não atrapalha quem está escrevendo
    ui.rerender('crm');
  };

  /* ---------------- API usada por outras abas ---------------- */
  const crm = {
    key: ZF.chatKey,
    tags: () => data.crmTags,
    tagById: (id) => data.crmTags.find((t) => t.id === id) || null,
    chatsWithTag: (tagId) => Object.entries(data.crmChats).filter(([, c]) => (c.tags || []).includes(tagId)).map(([k, c]) => ({ key: k, ...c })),
    /** Cria/atualiza o registro da conversa e aplica fn(registro) */
    upsert(info, fn) {
      const k = ZF.chatKey(info);
      if (!k) throw new Error('Não consegui identificar esta conversa');
      return store.update('crmChats', (map) => {
        const cur = map[k] || { tags: [], notes: [] };
        cur.name = info.name || cur.name || '';
        cur.phone = info.phone || cur.phone || null;
        cur.chatId = info.chatId || cur.chatId || null;
        cur.isGroup = !!(info.isGroup || cur.isGroup);
        fn(cur);
        cur.updatedAt = Date.now();
        map[k] = cur;
        return map;
      });
    },
    async openChat(c) {
      const r = await ZF.wa.openChatUI({ phone: c.phone, chatId: c.chatId });
      if (!r.ok) throw new Error(r.invalid ? 'Este número não tem WhatsApp' : 'Não consegui abrir a conversa');
    },
  };
  ZF.crm = crm;

  /* ---------------- etiquetas ---------------- */
  function openTagEditor(tag = null) {
    return new Promise((resolve) => {
      let color = tag ? tag.color : TAG_COLORS[data.crmTags.length % TAG_COLORS.length];
      let savedId = null;
      const name = ui.input({ value: tag ? tag.name : '', placeholder: 'Ex.: Paciente novo, Retorno, Orçamento…' });
      const sw = h('div', { class: 'zf-swatches' });
      const renderSw = () => {
        sw.replaceChildren();
        TAG_COLORS.forEach((c) => sw.appendChild(h('button', {
          class: 'zf-swatch' + (c === color ? ' active' : ''), style: { background: c },
          onclick: (e) => { e.preventDefault(); color = c; renderSw(); },
        })));
      };
      renderSw();
      ui.modal({
        title: tag ? 'Editar etiqueta' : 'Nova etiqueta',
        body: h('div', {}, ui.field('Nome', name), ui.field('Cor', sw)),
        onClose: () => resolve(savedId),
        actions: [
          tag ? {
            label: 'Excluir', class: 'danger', left: true, onClick: async () => {
              if (!(await ui.confirm(`Excluir a etiqueta "${tag.name}"? Ela sai de todas as conversas.`, { okLabel: 'Excluir', danger: true }))) return false;
              await store.update('crmTags', (list) => list.filter((t) => t.id !== tag.id));
              await store.update('crmChats', (map) => { Object.values(map).forEach((c) => { c.tags = (c.tags || []).filter((t) => t !== tag.id); }); return map; });
            },
          } : null,
          { label: 'Cancelar' },
          {
            label: 'Salvar', class: 'primary', onClick: async () => {
              const n = name.value.trim();
              if (!n) { ui.toast('Informe o nome', 'error'); return false; }
              savedId = tag ? tag.id : ZF.uid();
              await store.update('crmTags', (list) => {
                if (tag) return list.map((t) => (t.id === tag.id ? { ...t, name: n, color } : t));
                list.push({ id: savedId, name: n, color });
                return list;
              });
            },
          },
        ].filter(Boolean),
      });
    });
  }

  const tagChip = (t, { active = true, onclick, count } = {}) => h('button', {
    class: 'zf-chip', onclick,
    style: { background: active ? t.color : 'transparent', color: active ? '#fff' : t.color, border: `1px solid ${t.color}` },
  }, icon('tag', 12), t.name, count != null ? ` (${count})` : '');

  async function toggleTag(tagId) {
    const has = ((data.crmChats[currentKey] || {}).tags || []).includes(tagId);
    await crm.upsert(current, (c) => { c.tags = has ? c.tags.filter((t) => t !== tagId) : [...(c.tags || []), tagId]; });
  }

  /* ---------------- notas ---------------- */
  async function addNote(text) {
    const t = text.trim();
    if (!t) return;
    await crm.upsert(current, (c) => { c.notes = [...(c.notes || []), { id: ZF.uid(), text: t, createdAt: Date.now() }]; });
    drafts[currentKey] = '';
    ui.toast('Nota salva', 'ok');
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
  const noteCard = (key, n, showChat) => h('div', { class: 'zf-card', style: { padding: '8px 10px' } },
    showChat ? h('div', { class: 'zf-name zf-small', style: { marginBottom: '4px' } }, (data.crmChats[key] || {}).name || key) : null,
    h('div', { style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '13.5px' } }, n.text),
    h('div', { class: 'zf-row', style: { marginTop: '4px' } },
      h('span', { class: 'zf-muted zf-small zf-grow' }, ZF.fmtDateTime(n.updatedAt || n.createdAt) + (n.updatedAt ? ' (editada)' : '')),
      h('button', { class: 'zf-iconbtn', title: 'Editar', onclick: () => editNote(key, n) }, icon('edit', 14)),
      h('button', { class: 'zf-iconbtn', title: 'Excluir', onclick: ui.safe(() => deleteNote(key, n)) }, icon('trash', 14))));

  /* ---------------- exportação ---------------- */
  const stamp = () => new Date().toISOString().slice(0, 10);
  const exporters = {
    async contacts() {
      const r = await ZF.wa.call('listContacts', {}, 30000);
      const onlySaved = await ui.confirm(`Encontrei ${r.contacts.length} contatos.\n\nExportar só os salvos na sua agenda?\n(Cancelar = cancelar a exportação)`, { okLabel: 'Só os salvos', title: 'Exportar contatos' });
      if (!onlySaved) return;
      const list = r.contacts.filter((c) => c.saved && c.phone);
      ZF.downloadXlsx(`contatos-whatsapp-${stamp()}`, [
        ['Nome', 'Telefone', 'Nome no WhatsApp', 'Empresa'],
        ...list.map((c) => [c.name, c.phone, c.pushname, c.business ? 'Sim' : '']),
      ], 'Contatos');
      ui.toast(`${list.length} contatos exportados`, 'ok');
    },
    async allContacts() {
      const r = await ZF.wa.call('listContacts', {}, 30000);
      const list = r.contacts.filter((c) => c.phone);
      ZF.downloadXlsx(`todos-contatos-whatsapp-${stamp()}`, [
        ['Nome', 'Telefone', 'Nome no WhatsApp', 'Salvo na agenda', 'Empresa'],
        ...list.map((c) => [c.name, c.phone, c.pushname, c.saved ? 'Sim' : 'Não', c.business ? 'Sim' : '']),
      ], 'Contatos');
      ui.toast(`${list.length} contatos exportados`, 'ok');
    },
    async groups(groupsList) {
      const groups = groupsList || (await ui.pickChats({ title: 'Grupos para exportar', filter: 'groups', okLabel: 'Exportar' }));
      if (!groups || !groups.length) return;
      const rows = [['Grupo', 'Nome', 'Telefone', 'Administrador']];
      for (const g of groups.filter((x) => x.isGroup)) {
        const r = await ZF.wa.call('groupParticipants', { chatId: g.chatId }, 30000);
        r.participants.forEach((p) => rows.push([r.group || g.name, p.name, p.phone || '', p.isAdmin ? 'Sim' : '']));
      }
      ZF.downloadXlsx(`participantes-grupos-${stamp()}`, rows, 'Participantes');
      ui.toast(`${rows.length - 1} participantes exportados`, 'ok');
    },
    async waLabel() {
      const r = await ui.pickWaLabel();
      if (!r) return;
      ZF.downloadXlsx(`etiqueta-${ZF.normKey(r.label.name)}-${stamp()}`, [
        ['Nome', 'Telefone', 'Grupo'],
        ...r.chats.map((c) => [c.name, c.phone || '', c.isGroup ? 'Sim' : '']),
      ], r.label.name);
      ui.toast(`${r.chats.length} conversas exportadas`, 'ok');
    },
    myTag(tag) {
      const list = crm.chatsWithTag(tag.id);
      ZF.downloadXlsx(`etiqueta-${ZF.normKey(tag.name)}-${stamp()}`, [
        ['Nome', 'Telefone', 'Grupo', 'Última nota'],
        ...list.map((c) => [c.name, c.phone || '', c.isGroup ? 'Sim' : '', ((c.notes || []).slice(-1)[0] || {}).text || '']),
      ], tag.name);
    },
  };
  ZF.exportContacts = exporters;

  /* ---------------- renderização ---------------- */
  function renderCurrent(body) {
    if (!current) {
      ZF.append(body, h('div', { class: 'zf-card' },
        h('div', { class: 'zf-row' }, icon('user', 18), h('div', { class: 'zf-name' }, 'Nenhuma conversa aberta')),
        h('div', { class: 'zf-hint' }, 'Abra uma conversa no WhatsApp para ver e escrever notas, etiquetar e agendar.')));
      return;
    }
    const rec = data.crmChats[currentKey] || { tags: [], notes: [] };
    const myTags = data.crmTags;
    const sub = current.isGroup ? 'Grupo' : current.phone ? ZF.fmtPhone(current.phone) : '';

    const tagRow = h('div', { class: 'zf-chips', style: { margin: '8px 0 0' } },
      (rec.tags || []).map((id) => crm.tagById(id)).filter(Boolean).map((t) => tagChip(t, { onclick: ui.safe(() => toggleTag(t.id)) })),
      h('button', {
        class: 'zf-chip', style: { background: 'var(--surface-2)', color: 'var(--text)' },
        onclick: (e) => ui.menu(e.currentTarget, [
          { title: 'Etiquetas desta conversa' },
          ...myTags.map((t) => ({ label: t.name, icon: (rec.tags || []).includes(t.id) ? 'checkSquare' : 'square', onClick: () => toggleTag(t.id) })),
          myTags.length ? '-' : null,
          { label: 'Nova etiqueta…', icon: 'plus', onClick: async () => { const id = await openTagEditor(); if (id) await toggleTag(id); } },
        ]),
      }, icon('plus', 12), 'Etiqueta'));

    const firstName = ZF.firstName(current.name);
    const actions = h('div', { class: 'zf-actions' },
      h('button', { class: 'zf-btn sm', onclick: ui.safe(() => ZF.openScheduleEditor(null, { useActiveChat: true })) }, icon('clock', 13), 'Agendar'),
      h('button', { class: 'zf-btn sm', onclick: ui.safe(() => ZF.openReminderEditor(null, { chat: current })) }, icon('bell', 13), 'Lembrete'),
      h('button', {
        class: 'zf-btn sm', onclick: () => ui.openEventEditor({
          title: current.isGroup ? `Reunião — ${current.name}` : `Consulta — ${firstName || current.name}`,
          details: [current.name, current.phone ? ZF.fmtPhone(current.phone) : '', ((rec.notes || []).slice(-1)[0] || {}).text || ''].filter(Boolean).join('\n'),
        }),
      }, icon('calendar', 13), 'Google Agenda'),
      current.isGroup ? h('button', { class: 'zf-btn sm', onclick: ui.safe(() => exporters.groups([current])) }, icon('grid', 13), 'Participantes (Excel)') : null);

    const draft = h('textarea', {
      class: 'zf-textarea', rows: 3, value: drafts[currentKey] || '', placeholder: 'Escreva uma nota sobre esta conversa…',
      oninput: (e) => { drafts[currentKey] = e.target.value; },
      onkeydown: ui.safe(async (e) => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); await addNote(draft.value); } }),
    });
    const notes = (rec.notes || []).slice().reverse();

    ZF.append(body,
      h('div', { class: 'zf-card' },
        h('div', { class: 'zf-row' }, icon(current.isGroup ? 'users' : 'user', 18),
          h('div', { class: 'zf-grow', style: { minWidth: 0 } },
            h('div', { class: 'zf-name' }, current.name || sub || 'Conversa'),
            sub && current.name ? h('div', { class: 'zf-muted zf-small' }, sub) : null)),
        tagRow, actions),
      h('div', { class: 'zf-h3' }, `Notas (${notes.length})`),
      draft,
      h('div', { class: 'zf-row', style: { justifyContent: 'space-between', margin: '6px 0 10px' } },
        h('span', { class: 'zf-hint', style: { margin: 0 } }, 'Ctrl+Enter para salvar'),
        h('button', { class: 'zf-btn sm primary', onclick: ui.safe(() => addNote(draft.value)) }, icon('note', 13), 'Salvar nota')),
      notes.map((n) => noteCard(currentKey, n, false)));
  }

  function renderOrganize(body) {
    const counts = {};
    Object.values(data.crmChats).forEach((c) => (c.tags || []).forEach((t) => { counts[t] = (counts[t] || 0) + 1; }));
    ZF.append(body,
      h('div', { class: 'zf-row', style: { justifyContent: 'space-between' } },
        h('div', { class: 'zf-h3' }, 'Organizar conversas'),
        h('button', { class: 'zf-btn sm', onclick: () => openTagEditor() }, icon('plus', 13), 'Etiqueta')),
      data.crmTags.length
        ? h('div', { class: 'zf-chips', style: { marginTop: 0 } }, data.crmTags.map((t) => tagChip(t, {
          active: openTag === t.id, count: counts[t.id] || 0,
          onclick: () => { openTag = openTag === t.id ? null : t.id; ui.rerender('crm'); },
        })))
        : h('div', { class: 'zf-hint' }, 'Crie etiquetas (ex.: "Paciente novo", "Retorno", "Orçamento") para organizar suas conversas e usar nos disparos em massa.'));

    if (!openTag) return;
    const tag = crm.tagById(openTag);
    if (!tag) { openTag = null; return; }
    const chats = crm.chatsWithTag(tag.id);
    ZF.append(body, h('div', { class: 'zf-section', style: { padding: '8px' } },
      h('div', { class: 'zf-row', style: { marginBottom: '6px' } },
        h('span', { class: 'zf-grow', style: { fontWeight: 700 } }, `${tag.name} — ${chats.length} conversa(s)`),
        h('button', { class: 'zf-iconbtn', title: 'Editar etiqueta', onclick: () => openTagEditor(tag) }, icon('edit', 14)),
        h('button', { class: 'zf-iconbtn', title: 'Exportar (Excel)', onclick: () => exporters.myTag(tag) }, icon('grid', 14)),
        h('button', { class: 'zf-iconbtn', title: 'Disparo em massa para esta etiqueta', onclick: () => ZF.openCampaignEditor(null, { name: tag.name, recipients: chats }) }, icon('megaphone', 14))),
      chats.length ? h('div', { class: 'zf-contacts' }, chats.map((c) => h('div', { class: 'zf-contact' },
        icon(c.isGroup ? 'users' : 'user', 14),
        h('span', { class: 'zf-grow', title: ((c.notes || []).slice(-1)[0] || {}).text || '' }, c.name || ZF.fmtPhone(c.phone)),
        h('span', { class: 'zf-muted zf-small' }, (c.notes || []).length ? `${c.notes.length} nota(s)` : ''),
        h('button', { class: 'zf-btn sm', onclick: ui.safe(() => crm.openChat(c)) }, 'Abrir'))))
        : h('div', { class: 'zf-hint' }, 'Nenhuma conversa com esta etiqueta ainda.')));
  }

  function renderExport(body) {
    ZF.append(body,
      h('div', { class: 'zf-h3' }, 'Exportar para Excel'),
      h('div', { class: 'zf-row', style: { flexWrap: 'wrap', gap: '6px' } },
        h('button', { class: 'zf-btn sm', onclick: ui.safe(exporters.contacts) }, icon('grid', 13), 'Contatos salvos'),
        h('button', { class: 'zf-btn sm', onclick: ui.safe(exporters.allContacts) }, icon('grid', 13), 'Todos os contatos'),
        h('button', { class: 'zf-btn sm', onclick: ui.safe(() => exporters.groups()) }, icon('users', 13), 'Participantes de grupos'),
        h('button', { class: 'zf-btn sm', onclick: ui.safe(exporters.waLabel) }, icon('tag', 13), 'Etiqueta/lista do WhatsApp')));
  }

  function renderAllNotes(body) {
    const all = [];
    Object.entries(data.crmChats).forEach(([k, c]) => (c.notes || []).forEach((n) => all.push({ k, c, n })));
    if (!all.length) return;
    const q = ZF.normKey(notesQuery);
    const items = all.filter(({ c, n }) => !q || ZF.normKey(`${c.name} ${c.phone} ${n.text}`).includes(q))
      .sort((a, b) => (b.n.updatedAt || b.n.createdAt) - (a.n.updatedAt || a.n.createdAt)).slice(0, 50);
    const list = h('div');
    const search = h('input', {
      class: 'zf-input', placeholder: 'Pesquisar em todas as notas…', value: notesQuery,
      oninput: (e) => {
        notesQuery = e.target.value;
        const qq = ZF.normKey(notesQuery);
        list.replaceChildren(...all.filter(({ c, n }) => !qq || ZF.normKey(`${c.name} ${c.phone} ${n.text}`).includes(qq)).slice(0, 50).map(({ k, n }) => noteCard(k, n, true)));
      },
    });
    list.replaceChildren(...items.map(({ k, n }) => noteCard(k, n, true)));
    ZF.append(body,
      h('details', { class: 'zf-section', style: { padding: '8px 12px', marginTop: '12px' }, open: !!notesQuery },
        h('summary', { style: { cursor: 'pointer', fontWeight: 700, fontSize: '13px' } }, `Todas as notas (${all.length})`),
        h('div', { style: { marginTop: '8px' } }, h('div', { class: 'zf-field' }, search), list)));
  }

  function render(body) {
    if (!loaded) {
      ZF.append(body, h('div', { class: 'zf-empty' }, 'Carregando…'));
      load().then(() => ui.rerender('crm'));
      return;
    }
    if (!checkedOnce) setTimeout(checkChat, 0);
    renderCurrent(body);
    renderOrganize(body);
    renderExport(body);
    renderAllNotes(body);
  }

  /* Acompanha a troca de conversa enquanto a aba está visível */
  let checking = false;
  let checkedOnce = false;
  async function checkChat() {
    if (!ui.open || ui.current !== 'crm' || checking || !ZF.wa.isReady()) return;
    checking = true;
    try {
      const info = ZF.wa.qs(ZF.wa.SEL.main) ? await ZF.wa.activeChatInfo() : null;
      const key = info ? ZF.chatKey(info) : null;
      if (key !== currentKey || !checkedOnce) {
        checkedOnce = true;
        current = info;
        currentKey = key;
        ui.rerender('crm'); // rascunhos ficam guardados por conversa em "drafts"
      }
    } catch (e) { /* ignora */ } finally { checking = false; }
  }
  setInterval(checkChat, 1200);
  ZF.on('crm:check', checkChat);

  ui.registerTab('crm', { icon: 'user', title: 'Contato: notas, etiquetas e exportação', render });
})();
