/* ZapFlow — aba "Envio em massa" (campanhas) */
(() => {
  'use strict';
  const ZF = window.ZF;
  const { h, icon, store, ui } = ZF;

  const STATUS = { draft: 'Rascunho', scheduled: 'Agendada', running: 'Enviando', paused: 'Pausada', done: 'Concluída', canceled: 'Cancelada' };
  const CSTATUS = { pending: 'Pendente', sent: 'Enviada', failed: 'Falhou', invalid: 'Sem WhatsApp' };

  let campaigns = [];
  // list | edit | detail — a tela de detalhes sobrevive ao recarregamento (modo seguro recarrega a aba)
  let view = (() => {
    try {
      const v = JSON.parse(sessionStorage.getItem('zapflow-bulk-view'));
      return v && v.name === 'detail' ? v : { name: 'list' };
    } catch (e) { return { name: 'list' }; }
  })();
  let detailFilter = 'all';

  store.onChange(['campaigns'], async () => {
    campaigns = await store.get('campaigns');
    if (view.name !== 'edit') ui.rerender('bulk');
  });

  const counts = (c) => {
    const r = { total: c.contacts.length, sent: 0, failed: 0, invalid: 0, pending: 0 };
    c.contacts.forEach((x) => { r[x.status] = (r[x.status] || 0) + 1; });
    return r;
  };
  const estimate = (n, c) => {
    const avg = ((Number(c.minDelay) || 0) + (Number(c.maxDelay) || 0)) / 2 + 6; // +6s para abrir conversa/enviar
    const pauses = c.pauseEvery > 0 ? Math.floor(Math.max(0, n - 1) / c.pauseEvery) : 0;
    return (n * avg + pauses * (Number(c.pauseMinutes) || 0) * 60) * 1000;
  };

  const go = (v) => {
    view = v;
    try { sessionStorage.setItem('zapflow-bulk-view', JSON.stringify(v.name === 'detail' ? v : { name: 'list' })); } catch (e) { /* ignora */ }
    ui.rerender('bulk');
    ui.body.scrollTop = 0;
  };

  ZF.openCampaignEditor = (camp = null, defaults = {}) => {
    view = { name: 'edit', camp, defaults };
    if (ui.current !== 'bulk') ui.setTab('bulk');
    else ui.rerender('bulk');
  };

  /* ---------------- editor ---------------- */
  function renderEditor(body, camp, defaults = {}) {
    const s = ui.settings;
    const cfg = camp || {
      name: defaults.name || '',
      rawContacts: '',
      blocks: defaults.blocks || [],
      minDelay: s.bulkMinDelay, maxDelay: s.bulkMaxDelay,
      pauseEvery: s.bulkPauseEvery, pauseMinutes: s.bulkPauseMinutes,
    };
    let parsed = ZF.parseContacts(cfg.rawContacts || '', s.countryCode);
    // destinatários escolhidos do próprio WhatsApp (conversas, grupos, etiquetas)
    let picked = (cfg.picked || []).slice();
    (defaults.recipients || []).forEach((c) => addPickedItem(c));

    function addPickedItem(c) {
      const phone = c.isGroup ? null : c.phone ? ZF.normalizePhone(c.phone, s.countryCode) : null;
      if (!phone && !c.chatId) return false;
      if (picked.some((x) => (phone && x.phone === phone) || (!phone && x.chatId === c.chatId))) return false;
      picked.push({ phone, chatId: phone ? c.chatId || null : c.chatId, name: c.name || '', isGroup: !!c.isGroup });
      return true;
    }
    /** Lista final: linhas digitadas/planilha + escolhidos no WhatsApp (sem duplicar telefones) */
    const allRecipients = () => {
      const phones = new Set(parsed.contacts.map((c) => c.phone));
      const extra = picked.filter((p) => !p.phone || !phones.has(p.phone)).map((p) => ({ phone: p.phone, chatId: p.chatId, name: p.name, vars: {}, isGroup: p.isGroup }));
      return [...parsed.contacts, ...extra];
    };

    const name = ui.input({ value: cfg.name, placeholder: 'Ex.: Confirmações de segunda-feira' });
    const raw = h('textarea', {
      class: 'zf-textarea', rows: 6, value: cfg.rawContacts || '',
      placeholder: 'Um contato por linha:\n11987654321;Maria Silva\nJoão, 21 99876-5432\n\nOu importe uma planilha (.xlsx/.csv) com cabeçalho (telefone;nome;outras colunas).',
    });
    const summary = h('div', { class: 'zf-hint' });
    const pickedEl = h('div');
    let editor;
    const editorWrap = h('div');

    const renderPicked = () => {
      pickedEl.replaceChildren();
      if (!picked.length) return;
      const groups = picked.filter((p) => p.isGroup).length;
      ZF.append(pickedEl, h('details', { style: { margin: '8px 0 0' } },
        h('summary', { style: { cursor: 'pointer', fontSize: '12.5px', fontWeight: 700 } },
          `Escolhidos do WhatsApp: ${picked.length}${groups ? ` (${groups} grupo(s))` : ''}`),
        h('div', { class: 'zf-contacts', style: { marginTop: '6px', maxHeight: '200px' } }, picked.map((p, i) => h('div', { class: 'zf-contact' },
          icon(p.isGroup ? 'users' : 'user', 13),
          h('span', { class: 'zf-grow' }, p.name || ZF.fmtPhone(p.phone) || p.chatId),
          h('span', { class: 'zf-muted zf-small' }, p.isGroup ? 'Grupo' : ZF.fmtPhone(p.phone)),
          h('button', { class: 'zf-iconbtn', title: 'Remover', onclick: (e) => { e.preventDefault(); picked.splice(i, 1); renderPicked(); renderSummary(); } }, icon('x', 13))))),
        h('button', { class: 'zf-btn sm', style: { marginTop: '6px' }, onclick: (e) => { e.preventDefault(); picked = []; renderPicked(); renderSummary(); } }, 'Remover todos')));
    };
    const addPicked = (items, source) => {
      const n = (items || []).filter(addPickedItem).length;
      renderPicked();
      renderSummary();
      ui.toast(`${n} destinatário(s) adicionados${source ? ' de ' + source : ''}`, n ? 'ok' : 'info');
    };

    const renderSummary = () => {
      summary.replaceChildren();
      const p = parsed;
      const total = allRecipients().length;
      if (!raw.value.trim() && !picked.length) { ZF.append(summary, 'Nenhum destinatário ainda.'); return; }
      ZF.append(summary,
        h('span', { style: { color: 'var(--ok)', fontWeight: 700 } }, `✓ ${total} destinatário(s)`),
        p.invalid.length ? h('span', { style: { color: 'var(--danger)' } }, ` • ${p.invalid.length} linha(s) inválida(s)`) : '',
        p.duplicates ? ` • ${p.duplicates} duplicado(s) ignorado(s)` : '',
        total ? ` • tempo estimado ~${ZF.fmtDuration(estimate(total, readDelays()))}` : '');
      if (p.columns.length) ZF.append(summary, h('div', {}, 'Colunas viram variáveis: ', p.columns.map((c) => `{${c}} `)));
      if (p.invalid.length) {
        ZF.append(summary, h('details', {}, h('summary', { style: { cursor: 'pointer' } }, 'Ver linhas inválidas'),
          h('div', { style: { whiteSpace: 'pre-wrap', fontFamily: 'Consolas, monospace', fontSize: '11.5px' } }, p.invalid.slice(0, 50).join('\n'))));
      }
    };

    const rebuildEditor = () => {
      const blocks = editor ? editor.get() : cfg.blocks;
      editor = ui.blocksEditor(blocks, { extraVars: parsed.columns, spintaxHint: true });
      editorWrap.replaceChildren();
      editorWrap.appendChild(editor.el);
    };

    let timer;
    let lastCols = parsed.columns.join('|');
    raw.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        parsed = ZF.parseContacts(raw.value, s.countryCode);
        renderSummary();
        if (parsed.columns.join('|') !== lastCols) { lastCols = parsed.columns.join('|'); rebuildEditor(); }
      }, 300);
    });

    const importBtn = h('button', {
      class: 'zf-btn sm', onclick: ui.safe(async (e) => {
        e.preventDefault();
        const f = await ZF.pickFile('.xlsx,.csv,.txt,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        if (!f) return;
        const rows = await ZF.readSpreadsheet(f);
        const text = ZF.toCSV(rows).replace(/^\uFEFF/, '');
        raw.value = raw.value.trim() ? raw.value.trim() + '\n' + text : text;
        raw.dispatchEvent(new Event('input'));
        ui.toast(`Planilha "${f.name}" importada (${rows.length} linhas)`, 'ok');
      }),
    }, icon('grid', 14), 'Planilha');

    const fromWhatsApp = h('button', {
      class: 'zf-btn sm', onclick: (e) => {
        e.preventDefault();
        ui.menu(e.currentTarget, [
          { title: 'Adicionar destinatários' },
          { label: 'Conversas…', icon: 'message', onClick: async () => addPicked(await ui.pickChats({ title: 'Escolher conversas', filter: 'contacts' }), 'conversas') },
          { label: 'Grupos (envia no grupo)…', icon: 'users', onClick: async () => addPicked(await ui.pickChats({ title: 'Enviar para grupos', filter: 'groups' }), 'grupos') },
          { label: 'Participantes de grupos…', icon: 'user', onClick: async () => {
            const groups = await ui.pickChats({ title: 'Participantes de quais grupos?', filter: 'groups', okLabel: 'Buscar participantes' });
            if (!groups || !groups.length) return;
            const all = [];
            for (const g of groups) {
              const r = await ZF.wa.call('groupParticipants', { chatId: g.chatId }, 30000);
              r.participants.filter((p) => p.phone).forEach((p) => all.push({ phone: p.phone, name: p.name }));
            }
            addPicked(all, 'participantes');
          } },
          { label: 'Etiqueta ou lista do WhatsApp…', icon: 'tag', onClick: async () => { const r = await ui.pickWaLabel(); if (r) addPicked(r.chats, r.label.name); } },
          '-',
          { title: 'Minhas etiquetas (ZapFlow)' },
          ...myTagItems(),
        ]);
      },
    }, icon('plus', 14), 'Do WhatsApp');
    function myTagItems() {
      const list = ZF.crm ? ZF.crm.tags() : [];
      if (!list.length) return [{ label: 'Nenhuma etiqueta criada (aba Contato)', icon: 'tag', onClick: () => ui.setTab('crm') }];
      return list.map((t) => ({ label: t.name, icon: 'tag', onClick: () => addPicked(ZF.crm.chatsWithTag(t.id), t.name) }));
    }

    const minD = ui.input({ type: 'number', min: 3, value: cfg.minDelay });
    const maxD = ui.input({ type: 'number', min: 3, value: cfg.maxDelay });
    const pEvery = ui.input({ type: 'number', min: 0, value: cfg.pauseEvery });
    const pMin = ui.input({ type: 'number', min: 0, value: cfg.pauseMinutes });
    [minD, maxD, pEvery, pMin].forEach((i) => i.addEventListener('input', renderSummary));
    function readDelays() {
      const a = Math.max(3, Number(minD.value) || 3);
      const b = Math.max(a, Number(maxD.value) || a);
      return { minDelay: a, maxDelay: b, pauseEvery: Math.max(0, Number(pEvery.value) || 0), pauseMinutes: Math.max(0, Number(pMin.value) || 0) };
    }

    const startMode = ui.select([{ value: 'now', label: 'Começar agora' }, { value: 'later', label: 'Agendar início' }], 'now');
    const startAt = ui.input({ type: 'datetime-local', value: ZF.toLocalInput(Date.now() + 3600000), style: { display: 'none', marginTop: '6px' } });
    startMode.addEventListener('change', () => { startAt.style.display = startMode.value === 'later' ? '' : 'none'; });

    rebuildEditor();
    renderSummary();
    renderPicked();

    const collect = () => ({
      name: name.value.trim() || `Campanha ${ZF.fmtDateTime(Date.now())}`,
      rawContacts: raw.value,
      picked: picked.slice(),
      contacts: allRecipients().map((c) => ({ ...c, status: 'pending', error: null, at: null })),
      columns: parsed.columns,
      blocks: editor.get(),
      ...readDelays(),
    });

    const save = async (start) => {
      const data = collect();
      if (start) {
        if (!data.contacts.length) { ui.toast('Adicione pelo menos um destinatário válido', 'error'); return; }
        if (!data.blocks.length) { ui.toast('A mensagem está vazia', 'error'); return; }
        const missing = ZF.missingVars(data.blocks, Object.fromEntries(data.columns.map((c) => [c, 1])));
        const later = startMode.value === 'later';
        const at = ZF.fromLocalInput(startAt.value);
        if (later && !(at > Date.now())) { ui.toast('Escolha uma data/hora futura para o início', 'error'); return; }
        const msg = `Enviar para ${data.contacts.length} contato(s)?\n\nTempo estimado: ~${ZF.fmtDuration(estimate(data.contacts.length, data))}` +
          (later ? `\nInício: ${ZF.fmtDateTime(at)}` : '') +
          (missing.length ? `\n\n⚠️ Sem coluna na lista (ficarão vazias): ${missing.map((m) => `{${m}}`).join(' ')}` : '') +
          '\n\nMantenha o WhatsApp Web aberto (de preferência visível) até o fim.';
        if (!(await ui.confirm(msg, { okLabel: later ? 'Agendar' : 'Iniciar envio', title: 'Iniciar campanha' }))) return;
        Object.assign(data, later
          ? { status: 'scheduled', startAt: at }
          : { status: 'running', startedAt: Date.now(), nextAt: Date.now() });
      } else {
        data.status = 'draft';
      }
      let id = camp && camp.id;
      if (id) await store.updateItem('campaigns', id, (c) => ({ ...c, ...data, updatedAt: Date.now() }));
      else {
        id = ZF.uid();
        await store.update('campaigns', (list) => { list.unshift({ id, createdAt: Date.now(), ...data }); return list; });
      }
      store.gcFiles();
      campaigns = await store.get('campaigns');
      ui.toast(start ? (data.status === 'running' ? 'Envio iniciado' : 'Campanha agendada') : 'Rascunho salvo', 'ok');
      go({ name: 'detail', id });
      if (start) ZF.runner.tick();
    };

    ZF.append(body, 
      h('button', { class: 'zf-back', onclick: () => go(camp ? { name: 'detail', id: camp.id } : { name: 'list' }) }, icon('chevronLeft', 16), 'Voltar'),
      h('div', { class: 'zf-h2' }, icon('megaphone', 18), camp ? 'Editar disparo' : 'Novo disparo em massa'),
      ui.field('Nome da campanha', name),
      h('div', { class: 'zf-section' },
        h('div', { class: 'zf-row', style: { justifyContent: 'space-between', marginBottom: '8px', gap: '6px' } },
          h('div', { class: 'zf-h3', style: { margin: 0 } }, 'Destinatários'),
          h('div', { class: 'zf-row', style: { gap: '6px' } }, importBtn, fromWhatsApp)),
        raw, summary, pickedEl,
        h('div', { class: 'zf-hint' }, `Números com até 11 dígitos recebem o DDI +${s.countryCode}. "Do WhatsApp" adiciona conversas, grupos, participantes e etiquetas.`)),
      h('div', { class: 'zf-section' },
        h('div', { class: 'zf-row', style: { justifyContent: 'space-between', marginBottom: '8px' } },
          h('div', { class: 'zf-h3', style: { margin: 0 } }, 'Mensagem'),
          h('button', {
            class: 'zf-btn sm', onclick: ui.safe(async (e) => {
              e.preventDefault();
              const r = await ui.pickReply();
              if (r) editor.set(r.blocks);
            }),
          }, icon('zap', 14), 'Usar resposta rápida')),
        editorWrap),
      h('div', { class: 'zf-section' },
        h('div', { class: 'zf-h3' }, 'Ritmo de envio'),
        h('div', { class: 'zf-grid2' }, ui.field('Intervalo mínimo (s)', minD), ui.field('Intervalo máximo (s)', maxD)),
        h('div', { class: 'zf-grid2' }, ui.field('Pausa longa a cada (msgs)', pEvery), ui.field('Duração da pausa (min)', pMin)),
        ui.field('Início', h('div', {}, startMode, startAt))),
      h('div', { class: 'zf-note' }, icon('alert', 16), h('span', {},
        'Envio em massa pode fazer o WhatsApp restringir ou banir o número. Envie só para quem conhece você (ex.: pacientes/clientes), use intervalos longos, varie o texto com {a|b} e evite links em excesso.')),
      h('div', { class: 'zf-row', style: { justifyContent: 'flex-end', gap: '8px', marginBottom: '8px' } },
        h('button', { class: 'zf-btn', onclick: ui.safe(() => save(false)) }, 'Salvar rascunho'),
        h('button', { class: 'zf-btn primary', onclick: ui.safe(() => save(true)) }, icon('send', 15), 'Iniciar envio')),
    );
  }

  /* ---------------- ações ---------------- */
  const setStatus = (c, patch) => store.updateItem('campaigns', c.id, (x) => ({ ...x, ...patch }));
  const pause = (c) => setStatus(c, { status: 'paused', pauseReason: null });
  const resume = (c) => { setStatus(c, { status: 'running', nextAt: Date.now(), consecutiveFails: 0, pauseReason: null, startedAt: c.startedAt || Date.now() }); setTimeout(() => ZF.runner.tick(), 500); };
  const cancel = async (c) => {
    if (!(await ui.confirm(`Cancelar a campanha "${c.name}"? Os contatos pendentes não receberão a mensagem.`, { okLabel: 'Cancelar campanha', danger: true }))) return;
    await setStatus(c, { status: 'canceled', finishedAt: Date.now() });
  };
  const remove = async (c) => {
    if (!(await ui.confirm(`Excluir a campanha "${c.name}" e o relatório dela?`, { okLabel: 'Excluir', danger: true }))) return;
    await store.update('campaigns', (list) => list.filter((x) => x.id !== c.id));
    store.gcFiles();
    go({ name: 'list' });
  };
  const duplicate = async (c, onlyFailed = false) => {
    const contacts = c.contacts.filter((x) => !onlyFailed || x.status === 'failed');
    if (!contacts.length) { ui.toast('Nenhum contato com falha para reenviar'); return; }
    const cols = (c.columns || []).filter((k) => k !== 'telefone');
    const withPhone = contacts.filter((x) => x.phone);
    const rawContacts = cols.length
      ? ZF.toCSV([['telefone', ...cols], ...withPhone.map((x) => [x.phone, ...cols.map((k) => (x.vars || {})[k] || '')])]).replace(/^\uFEFF/, '')
      : withPhone.map((x) => [x.phone, x.name].filter(Boolean).join(';')).join('\n');
    const copy = {
      ...ZF.clone(c), id: ZF.uid(), createdAt: Date.now(), status: 'draft',
      name: c.name + (onlyFailed ? ' (reenvio)' : ' (cópia)'),
      contacts: contacts.map((x) => ({ ...x, status: 'pending', error: null, at: null })),
      rawContacts,
      picked: contacts.filter((x) => !x.phone && x.chatId).map((x) => ({ phone: null, chatId: x.chatId, name: x.name, isGroup: !!x.isGroup })),
      startedAt: null, finishedAt: null, nextAt: null, startAt: null, batchCount: 0, consecutiveFails: 0, pauseReason: null,
    };
    await store.update('campaigns', (list) => { list.unshift(copy); return list; });
    campaigns = await store.get('campaigns');
    ui.toast('Cópia criada como rascunho', 'ok');
    go({ name: 'detail', id: copy.id });
  };
  const exportReport = (c) => {
    const rows = [['telefone', 'nome', 'status', 'erro', 'horario']];
    c.contacts.forEach((x) => rows.push([x.phone, x.name, CSTATUS[x.status] || x.status, x.error || '', x.at ? ZF.fmtDateTime(x.at) : '']));
    ZF.downloadText(`relatorio-${ZF.normKey(c.name) || 'campanha'}.csv`, ZF.toCSV(rows), 'text/csv');
  };
  const startDraft = async (c) => {
    if (!c.contacts.length || !c.blocks.length) { ZF.openCampaignEditor(c); ui.toast('Complete contatos e mensagem', 'error'); return; }
    if (!(await ui.confirm(`Enviar para ${c.contacts.length} contato(s)?\nTempo estimado: ~${ZF.fmtDuration(estimate(c.contacts.length, c))}`, { okLabel: 'Iniciar envio' }))) return;
    await setStatus(c, { status: 'running', startedAt: Date.now(), nextAt: Date.now() });
    ZF.runner.tick();
  };

  /* ---------------- detalhes ---------------- */
  function progressBar(c) {
    const n = counts(c);
    const pct = (v) => (n.total ? (v / n.total) * 100 : 0) + '%';
    return h('div', { class: 'zf-progress' },
      h('span', { class: 'ok', style: { width: pct(n.sent) } }),
      h('span', { class: 'bad', style: { width: pct(n.failed + n.invalid) } }));
  }

  function renderDetail(body, c) {
    const n = counts(c);
    const actions = [];
    const btn = (label, ic, fn, cls = '') => h('button', { class: 'zf-btn sm ' + cls, onclick: ui.safe(fn) }, icon(ic, 13), label);
    if (c.status === 'draft') actions.push(btn('Iniciar envio', 'send', () => startDraft(c), 'primary'), btn('Editar', 'edit', () => ZF.openCampaignEditor(c)));
    if (c.status === 'running') actions.push(btn('Pausar', 'pause', () => pause(c)), btn('Cancelar', 'stop', () => cancel(c), 'danger'));
    if (c.status === 'paused') actions.push(btn('Retomar', 'play', () => resume(c), 'primary'), btn('Cancelar', 'stop', () => cancel(c), 'danger'));
    if (c.status === 'scheduled') actions.push(btn('Começar agora', 'play', () => resume(c), 'primary'), btn('Cancelar', 'stop', () => cancel(c), 'danger'));
    if (['done', 'canceled'].includes(c.status) && n.failed) actions.push(btn('Reenviar falhas', 'repeat', () => duplicate(c, true), 'primary'));

    const filterChip = (key, label) => h('button', { class: 'zf-chip' + (detailFilter === key ? ' active' : ''), onclick: () => { detailFilter = key; ui.rerender('bulk'); } }, label);
    const shown = c.contacts.filter((x) => detailFilter === 'all' || (detailFilter === 'bad' ? ['failed', 'invalid'].includes(x.status) : x.status === detailFilter));
    const stIcon = { pending: ['clock', 'var(--muted)'], sent: ['check', 'var(--ok)'], failed: ['alert', 'var(--danger)'], invalid: ['x', 'var(--danger)'] };

    let info = null;
    if (c.status === 'running' && c.nextAt > Date.now()) info = h('div', { class: 'zf-note info' }, icon('clock', 15), `Próximo envio às ${new Date(c.nextAt).toLocaleTimeString('pt-BR')} (contagem na barra abaixo)`);
    else if (c.status === 'running') info = h('div', { class: 'zf-note info' }, icon('loader', 15, 'zf-spin'), 'Enviando… mantenha o WhatsApp Web aberto.');
    else if (c.status === 'scheduled') info = h('div', { class: 'zf-note info' }, icon('calendar', 15), `Início agendado para ${ZF.fmtDateTime(c.startAt)} (${ZF.relTime(c.startAt)})`);
    else if (c.status === 'paused' && c.pauseReason) info = h('div', { class: 'zf-note' }, icon('alert', 15), c.pauseReason);

    ZF.append(body, 
      h('button', { class: 'zf-back', onclick: () => go({ name: 'list' }) }, icon('chevronLeft', 16), 'Campanhas'),
      h('div', { class: 'zf-row' }, h('div', { class: 'zf-h2 zf-grow', style: { margin: 0 } }, c.name), ui.badge(c.status, STATUS[c.status])),
      progressBar(c),
      h('div', { class: 'zf-stats' },
        h('div', { class: 'zf-stat' }, h('b', {}, n.total), h('span', {}, 'Total')),
        h('div', { class: 'zf-stat' }, h('b', { style: { color: 'var(--ok)' } }, n.sent), h('span', {}, 'Enviadas')),
        h('div', { class: 'zf-stat' }, h('b', { style: { color: 'var(--danger)' } }, n.failed + n.invalid), h('span', {}, 'Falhas')),
        h('div', { class: 'zf-stat' }, h('b', {}, n.pending), h('span', {}, 'Restantes'))),
      info,
      actions.length ? h('div', { class: 'zf-actions', style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' } }, actions) : null,
      h('details', { class: 'zf-section', style: { padding: '8px 12px' } },
        h('summary', { style: { cursor: 'pointer', fontWeight: 700, fontSize: '13px' } }, 'Mensagem'),
        h('div', { class: 'zf-preview', style: { marginTop: '8px' } }, c.blocks.map((b) => (b.type === 'text' ? h('div', {}, b.text) : h('div', { class: 'zf-file' }, icon('paperclip', 13), b.name, b.caption ? ` — ${b.caption}` : ''))))),
      h('div', { class: 'zf-chips', style: { marginTop: 0 } },
        filterChip('all', `Todos (${n.total})`), filterChip('pending', `Pendentes (${n.pending})`),
        filterChip('sent', `Enviadas (${n.sent})`), filterChip('bad', `Falhas (${n.failed + n.invalid})`)),
      h('div', { class: 'zf-contacts' },
        shown.length ? shown.slice(0, 500).map((x) => h('div', { class: 'zf-contact', title: x.error || '' },
          h('span', { style: { color: stIcon[x.status][1], display: 'inline-flex' } }, icon(stIcon[x.status][0], 14)),
          h('span', { class: 'zf-grow' }, x.name || (x.phone ? '' : 'Grupo/conversa')),
          h('span', { class: 'zf-muted zf-small' }, ZF.fmtPhone(x.phone))))
          : h('div', { class: 'zf-empty' }, 'Nenhum contato aqui.')),
      h('div', { class: 'zf-row', style: { gap: '6px', flexWrap: 'wrap', marginTop: '10px' } },
        btn('Relatório CSV', 'download', () => exportReport(c)),
        btn('Duplicar', 'copy', () => duplicate(c)),
        !['running'].includes(c.status) ? btn('Excluir', 'trash', () => remove(c), 'danger') : null),
    );
  }

  /* ---------------- lista ---------------- */
  function renderList(body) {
    ZF.append(body, h('button', { class: 'zf-btn primary block', style: { marginBottom: '12px' }, onclick: () => ZF.openCampaignEditor(null) }, icon('plus', 16), 'Nova campanha'));
    if (!campaigns.length) {
      ZF.append(body, h('div', { class: 'zf-empty' }, 'Nenhuma campanha ainda.', h('div', { class: 'zf-small', style: { marginTop: '6px' } },
        'Cole uma lista de números ou importe um CSV, escreva a mensagem (com {nome}, {saudacao}…) e a extensão envia uma por uma, com intervalos aleatórios.')));
      return;
    }
    campaigns.forEach((c) => {
      const n = counts(c);
      ZF.append(body, h('div', { class: 'zf-card clickable', onclick: () => go({ name: 'detail', id: c.id }) },
        h('div', { class: 'zf-row' }, h('div', { class: 'zf-name zf-grow' }, c.name), ui.badge(c.status, STATUS[c.status])),
        progressBar(c),
        h('div', { class: 'zf-meta' },
          h('span', {}, `${n.sent}/${n.total} enviadas`),
          n.failed + n.invalid ? h('span', { style: { color: 'var(--danger)' } }, `${n.failed + n.invalid} falha(s)`) : null,
          h('span', {}, icon('calendar', 12), ZF.fmtDate(c.createdAt)))));
    });
  }

  let loaded = false;
  function render(body) {
    store.get('campaigns').then((list) => {
      const first = !loaded;
      loaded = true;
      if (first || JSON.stringify(list) !== JSON.stringify(campaigns)) { campaigns = list; if (view.name !== 'edit') ui.rerender('bulk'); }
    });
    if (view.name === 'edit') return renderEditor(body, view.camp, view.defaults);
    if (!loaded) return ZF.append(body, h('div', { class: 'zf-empty' }, 'Carregando…'));
    if (view.name === 'detail') {
      const c = campaigns.find((x) => x.id === view.id);
      if (c) return renderDetail(body, c);
      view = { name: 'list' };
    }
    renderList(body);
  }

  ui.registerTab('bulk', { icon: 'megaphone', title: 'Disparos em massa', render });
})();
