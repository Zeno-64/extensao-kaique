/* ZapFlow — aba "Contato": conversa aberta, abas do CRM, etiquetas do WhatsApp e exportação */
(() => {
  'use strict';
  const ZF = window.ZF;
  const { h, icon, store, ui } = ZF;

  const TAB_COLORS = ['#2455e6', '#7c3aed', '#e0a800', '#0a8f5a', '#e8590c', '#0891b2', '#db2777', '#d93025', '#4b5563', '#65a30d'];

  // As abas do CRM ficam em "crmTags" (nome antigo mantido para não perder dados da v1.1)
  let data = { crmChats: {}, crmTags: [] };
  let loaded = false;
  let labels = null; // etiquetas do WhatsApp (cache)

  const load = async () => {
    data = await store.getMany(['crmChats', 'crmTags']);
    data.crmTags.sort((a, b) => (a.order || 0) - (b.order || 0));
    loaded = true;
  };
  store.onChange(['crmChats', 'crmTags'], async () => {
    await load();
    ZF.emit('crm', data);
    rerenderIfIdle();
  });
  load().then(() => ZF.emit('crm', data));

  const rerenderIfIdle = () => {
    if (ui.current !== 'crm' || !ui.open) return;
    const active = ui.root && ui.root.activeElement;
    if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT') && active.value) return;
    ui.rerender('crm');
  };

  /* ---------------- conversa aberta (compartilhada com a aba Notas) ---------------- */
  const active = { info: null, key: null, checked: false };
  let checking = false;
  async function checkChat(force = false) {
    if (checking || !ZF.wa.isReady()) return;
    if (!force && (!ui.open || !['crm', 'notes', 'schedules'].includes(ui.current))) return;
    checking = true;
    try {
      const info = ZF.wa.qs(ZF.wa.SEL.main) ? await ZF.wa.activeChatInfo() : null;
      const key = info ? ZF.chatKey(info) : null;
      const labelsChanged = info && active.info && (info.labels || []).join() !== (active.info.labels || []).join();
      if (key !== active.key || !active.checked || labelsChanged) {
        active.checked = true;
        active.info = info;
        active.key = key;
        ZF.emit('activechat', active);
        if (ui.current === 'crm') ui.rerender('crm');
      }
    } catch (e) { /* ignora */ } finally { checking = false; }
  }
  ZF.every(1200, checkChat);
  ZF.activeChat = active;
  ZF.checkActiveChat = checkChat;

  /* ---------------- API usada pelas outras partes ---------------- */
  const crm = {
    key: ZF.chatKey,
    tabs: () => data.crmTags,
    tabById: (id) => data.crmTags.find((t) => t.id === id) || null,
    chats: () => data.crmChats,
    /** Conversas de uma aba: [{key, name, phone, chatId, isGroup, tags, notes}] */
    chatsInTab: (tabId) => Object.entries(data.crmChats).filter(([, c]) => (c.tags || []).includes(tabId)).map(([k, c]) => ({ key: k, ...c })),
    countInTab: (tabId) => Object.values(data.crmChats).filter((c) => (c.tags || []).includes(tabId)).length,
    record: (info) => data.crmChats[ZF.chatKey(info)] || null,
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
        cur.tags = cur.tags || [];
        cur.notes = cur.notes || [];
        fn(cur);
        cur.updatedAt = Date.now();
        map[k] = cur;
        return map;
      });
    },
    toggleTab(info, tabId, on) {
      return crm.upsert(info, (c) => {
        const has = c.tags.includes(tabId);
        const want = on === undefined ? !has : on;
        c.tags = want ? [...new Set([...c.tags, tabId])] : c.tags.filter((t) => t !== tabId);
      });
    },
    /** Move entre abas (quadro Kanban) */
    moveTab(info, fromId, toId) {
      return crm.upsert(info, (c) => {
        c.tags = c.tags.filter((t) => t !== fromId);
        if (toId && !c.tags.includes(toId)) c.tags.push(toId);
      });
    },
    async openChat(c) {
      const r = await ZF.wa.openChatUI({ phone: c.phone, chatId: c.chatId });
      if (!r.ok) throw new Error(r.invalid ? 'Este número não tem WhatsApp' : 'Não consegui abrir a conversa');
    },
    openTabEditor: (tab) => openTabEditor(tab),
    deleteTab: (tab) => deleteTab(tab),
    COLORS: TAB_COLORS,
  };
  // nomes antigos (v1.1)
  crm.tags = crm.tabs;
  crm.tagById = crm.tabById;
  crm.chatsWithTag = crm.chatsInTab;
  ZF.crm = crm;

  /* ---------------- abas do CRM ---------------- */
  async function deleteTab(tab) {
    const n = crm.countInTab(tab.id);
    if (!(await ui.confirm(`Excluir a aba "${tab.name}"?${n ? `\n\n${n} conversa(s) saem dela (as conversas não são apagadas).` : ''}`, { okLabel: 'Excluir', danger: true, global: !ui.open }))) return false;
    await store.update('crmTags', (list) => list.filter((t) => t.id !== tab.id));
    await store.update('crmChats', (map) => { Object.values(map).forEach((c) => { c.tags = (c.tags || []).filter((t) => t !== tab.id); }); return map; });
    return true;
  }

  function openTabEditor(tab = null) {
    return new Promise((resolve) => {
      let color = tab ? tab.color : TAB_COLORS[data.crmTags.length % TAB_COLORS.length];
      let savedId = null;
      const name = ui.input({ value: tab ? tab.name : '', placeholder: 'Ex.: Lead Orgânico, Retomar Contato, Pacientes Antigos…' });
      const emoji = h('button', { class: 'zf-iconbtn', title: 'Emojis', onclick: (e) => { e.preventDefault(); ui.emojiPicker(e.currentTarget, (em) => ui.insertAtCursor(name, em)); } }, icon('smile', 18));
      const sw = h('div', { class: 'zf-swatches' });
      const renderSw = () => {
        sw.replaceChildren();
        TAB_COLORS.forEach((c) => sw.appendChild(h('button', {
          class: 'zf-swatch' + (c === color ? ' active' : ''), style: { background: c },
          onclick: (e) => { e.preventDefault(); color = c; renderSw(); },
        })));
      };
      renderSw();
      ui.modal({
        title: tab ? 'Editar aba do CRM' : 'Nova aba do CRM',
        global: !ui.open || !!(ZF.topbar && ZF.topbar.kanbanOpen),
        body: h('div', {},
          ui.field('Nome', h('div', { class: 'zf-inputwrap' }, name, emoji)),
          ui.field('Cor', sw),
          h('div', { class: 'zf-hint' }, 'As abas aparecem na barra do topo do WhatsApp e no quadro de atendimento.')),
        onClose: () => resolve(savedId),
        actions: [
          tab ? { label: 'Excluir', class: 'danger', left: true, onClick: async () => { if (!(await deleteTab(tab))) return false; } } : null,
          { label: 'Cancelar' },
          {
            label: 'Salvar', class: 'primary', onClick: async () => {
              const n = name.value.trim();
              if (!n) { ui.toast('Informe o nome', 'error'); return false; }
              savedId = tab ? tab.id : ZF.uid();
              await store.update('crmTags', (list) => {
                if (tab) return list.map((t) => (t.id === tab.id ? { ...t, name: n, color } : t));
                const order = list.reduce((m, t) => Math.max(m, t.order || 0), 0) + 1;
                list.push({ id: savedId, name: n, color, order });
                return list;
              });
            },
          },
        ].filter(Boolean),
      });
    });
  }

  async function moveTabOrder(tab, dir) {
    await store.update('crmTags', (list) => {
      list.sort((a, b) => (a.order || 0) - (b.order || 0)).forEach((t, i) => { t.order = i; });
      const i = list.findIndex((t) => t.id === tab.id);
      const j = i + dir;
      if (j < 0 || j >= list.length) return list;
      [list[i].order, list[j].order] = [list[j].order, list[i].order];
      return list;
    });
  }

  const tabChip = (t, { active = true, onclick, count, title } = {}) => h('button', {
    class: 'zf-tabchip' + (active ? ' on' : ''), onclick, title,
    style: { '--c': t.color || '#2455e6' },
  }, h('span', { class: 'zf-tabchip-dot' }), h('span', { class: 'zf-ellipsis' }, t.name), count != null ? h('span', { class: 'zf-tabchip-n' }, count) : null);

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
    tab(tab) {
      const list = crm.chatsInTab(tab.id);
      ZF.downloadXlsx(`aba-${ZF.normKey(tab.name)}-${stamp()}`, [
        ['Nome', 'Telefone', 'Grupo', 'Última nota'],
        ...list.map((c) => [c.name, c.phone || '', c.isGroup ? 'Sim' : '', ((c.notes || []).slice(-1)[0] || {}).text || '']),
      ], tab.name);
      ui.toast(`${list.length} conversas exportadas`, 'ok');
    },
  };
  exporters.myTag = exporters.tab;
  ZF.exportContacts = exporters;

  /* ---------------- renderização ---------------- */
  function renderCurrent(body) {
    const cur = active.info;
    if (!cur) {
      ZF.append(body, h('div', { class: 'zf-card' },
        h('div', { class: 'zf-row' }, icon('contactCard', 18), h('div', { class: 'zf-name' }, 'Nenhuma conversa aberta')),
        h('div', { class: 'zf-hint' }, 'Abra uma conversa no WhatsApp para colocar em abas do CRM, etiquetar, agendar e anotar.')));
      return;
    }
    const rec = crm.record(cur) || { tags: [], notes: [] };
    const sub = cur.isGroup ? 'Grupo' : cur.phone ? ZF.fmtPhone(cur.phone) : '';
    const initials = (cur.name || '?').replace(/[^\p{L}\p{N} ]/gu, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '#';

    const tabsRow = h('div', { class: 'zf-chips', style: { margin: '6px 0 0' } },
      data.crmTags.map((t) => tabChip(t, { active: (rec.tags || []).includes(t.id), onclick: ui.safe(() => crm.toggleTab(cur, t.id)), title: (rec.tags || []).includes(t.id) ? 'Clique para tirar desta aba' : 'Clique para colocar nesta aba' })),
      h('button', { class: 'zf-tabchip add', onclick: ui.safe(async () => { const id = await openTabEditor(); if (id) await crm.toggleTab(cur, id, true); }) }, icon('folderPlus', 14), 'Nova aba'));

    const labelsRow = h('div', { class: 'zf-chips', style: { margin: '6px 0 0' } });
    const renderLabels = () => {
      labelsRow.replaceChildren();
      if (!labels || !labels.ok) { labelsRow.appendChild(h('span', { class: 'zf-hint', style: { margin: 0 } }, labels ? 'Etiquetas do WhatsApp indisponíveis nesta conta.' : 'Carregando…')); return; }
      if (!labels.labels.length) { labelsRow.appendChild(h('span', { class: 'zf-hint', style: { margin: 0 } }, 'Nenhuma etiqueta/lista no seu WhatsApp.')); return; }
      ZF.sortLabels(labels.labels, (ui.settings || {}).labelOrder).forEach((l) => {
        const on = (cur.labels || []).includes(l.id);
        labelsRow.appendChild(tabChip({ name: l.name, color: l.color || '#8696a0' }, {
          active: on,
          onclick: ui.safe(async () => {
            await ZF.wa.call('editLabels', { chatId: cur.chatId, phone: cur.phone, [on ? 'remove' : 'add']: [l.id] });
            cur.labels = on ? (cur.labels || []).filter((x) => x !== l.id) : [...(cur.labels || []), l.id];
            renderLabels();
          }),
        }));
      });
    };
    renderLabels();
    if (!labels) ZF.wa.bridge('listLabels', {}, 15000).then((r) => { labels = r || { ok: false }; renderLabels(); });

    const firstName = ZF.firstName(cur.name);
    ZF.append(body,
      h('div', { class: 'zf-card zf-contactcard' },
        h('div', { class: 'zf-row' },
          h('div', { class: 'zf-avatar' }, initials),
          h('div', { class: 'zf-grow', style: { minWidth: 0 } },
            h('div', { class: 'zf-name' }, cur.name || sub || 'Conversa'),
            sub && cur.name ? h('div', { class: 'zf-muted zf-small' }, sub) : null),
          h('button', { class: 'zf-iconbtn', title: 'Atualizar', onclick: () => { labels = null; active.checked = false; checkChat(true); } }, icon('refresh', 16))),
        h('div', { class: 'zf-label', style: { marginTop: '10px' } }, 'Abas do CRM'),
        tabsRow,
        h('div', { class: 'zf-label', style: { marginTop: '10px' } }, 'Etiquetas do WhatsApp'),
        labelsRow,
        h('div', { class: 'zf-actions' },
          h('button', { class: 'zf-btn sm', onclick: ui.safe(() => ZF.openScheduleEditor(null, { useActiveChat: true })) }, icon('calendarClock', 13), 'Agendar'),
          h('button', { class: 'zf-btn sm', onclick: ui.safe(() => ZF.openReminderEditor(null, { chat: cur })) }, icon('alarm', 13), 'Lembrete'),
          h('button', {
            class: 'zf-btn sm', onclick: () => ui.openEventEditor({
              title: cur.isGroup ? `Reunião — ${cur.name}` : `Consulta — ${firstName || cur.name}`,
              details: [cur.name, cur.phone ? ZF.fmtPhone(cur.phone) : '', ((rec.notes || []).slice(-1)[0] || {}).text || ''].filter(Boolean).join('\n'),
            }),
          }, icon('calendarDays', 13), 'Google Agenda'),
          h('button', { class: 'zf-btn sm', onclick: () => ui.setTab('notes') }, icon('clipboardEdit', 13), `Notas (${(rec.notes || []).length})`),
          cur.isGroup ? h('button', { class: 'zf-btn sm', onclick: ui.safe(() => exporters.groups([cur])) }, icon('grid', 13), 'Participantes (Excel)') : null)));
  }

  function renderTabs(body) {
    ZF.append(body,
      h('div', { class: 'zf-row', style: { justifyContent: 'space-between', marginTop: '6px' } },
        h('div', { class: 'zf-h3' }, `Abas do CRM (${data.crmTags.length})`),
        h('div', { class: 'zf-row', style: { gap: '6px' } },
          h('button', { class: 'zf-btn sm', onclick: () => ZF.topbar && ZF.topbar.openKanban() }, icon('kanban', 13), 'Quadro'),
          h('button', { class: 'zf-btn sm', onclick: () => openTabEditor() }, icon('folderPlus', 13), 'Nova aba'))));
    if (!data.crmTags.length) {
      body.appendChild(h('div', { class: 'zf-hint' }, 'Crie abas (ex.: "Lead Orgânico", "Retomar Contato", "Pacientes Antigos") para organizar as conversas. Elas aparecem na barra do topo do WhatsApp.'));
      return;
    }
    body.appendChild(h('div', { class: 'zf-tablist' }, data.crmTags.map((t, i) => h('div', { class: 'zf-tabrow', style: { '--c': t.color } },
      h('span', { class: 'zf-tabchip-dot' }),
      h('button', { class: 'zf-tabrow-name', title: 'Ver as conversas desta aba', onclick: () => ZF.topbar && ZF.topbar.select({ kind: 'tab', id: t.id }) }, t.name),
      h('span', { class: 'zf-tabchip-n' }, crm.countInTab(t.id)),
      h('button', { class: 'zf-iconbtn', title: 'Mais opções', onclick: (e) => ui.menu(e.currentTarget, [
        { label: 'Ver conversas', icon: 'filter', onClick: () => ZF.topbar && ZF.topbar.select({ kind: 'tab', id: t.id }) },
        { label: 'Editar', icon: 'edit', onClick: () => openTabEditor(t) },
        { label: 'Disparo em massa para esta aba', icon: 'inbox', onClick: () => ZF.openCampaignEditor(null, { name: t.name, recipients: crm.chatsInTab(t.id) }) },
        { label: 'Exportar (Excel)', icon: 'grid', onClick: () => exporters.tab(t) },
        { label: 'Mover para cima', icon: 'arrowUp', onClick: () => moveTabOrder(t, -1) },
        { label: 'Mover para baixo', icon: 'arrowDown', onClick: () => moveTabOrder(t, 1) },
        '-',
        { label: 'Excluir aba', icon: 'trash', danger: true, onClick: () => deleteTab(t) },
      ]) }, icon('more', 16)),
    ))));
  }

  function renderExport(body) {
    ZF.append(body,
      h('div', { class: 'zf-h3' }, 'Exportar para Excel'),
      h('div', { class: 'zf-row', style: { flexWrap: 'wrap', gap: '6px' } },
        h('button', { class: 'zf-btn sm', onclick: ui.safe(exporters.contacts) }, icon('grid', 13), 'Contatos salvos'),
        h('button', { class: 'zf-btn sm', onclick: ui.safe(exporters.allContacts) }, icon('grid', 13), 'Todos os contatos'),
        h('button', { class: 'zf-btn sm', onclick: ui.safe(() => exporters.groups()) }, icon('users', 13), 'Participantes de grupos'),
        h('button', { class: 'zf-btn sm', onclick: ui.safe(exporters.waLabel) }, icon('label', 13), 'Etiqueta/lista do WhatsApp')));
  }

  function render(body) {
    if (!loaded) {
      ZF.append(body, h('div', { class: 'zf-empty' }, 'Carregando…'));
      load().then(() => ui.rerender('crm'));
      return;
    }
    if (!active.checked) setTimeout(() => checkChat(true), 0);
    renderCurrent(body);
    renderTabs(body);
    renderExport(body);
  }

  ui.registerTab('crm', { icon: 'contactCard', title: 'Contato: abas do CRM, etiquetas e exportação', render });
})();
