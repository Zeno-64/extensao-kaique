/* ZapFlow — aba "Envio em massa" (campanhas) */
(() => {
  'use strict';
  const ZF = window.ZF;
  const { h, icon, store, ui } = ZF;

  const STATUS = { draft: 'Rascunho', scheduled: 'Agendada', running: 'Enviando', paused: 'Pausada', done: 'Concluída', canceled: 'Cancelada' };
  const CSTATUS = { pending: 'Pendente', sent: 'Enviada', failed: 'Falhou', invalid: 'Sem WhatsApp' };

  let campaigns = [];
  // list | detail — a tela de detalhes sobrevive ao recarregamento (modo seguro recarrega a aba)
  let view = (() => {
    try {
      const v = JSON.parse(sessionStorage.getItem('zapflow-bulk-view'));
      return v && v.name === 'detail' ? v : { name: 'list' };
    } catch (e) { return { name: 'list' }; }
  })();
  let detailFilter = 'all';

  store.onChange(['campaigns'], async () => {
    campaigns = await store.get('campaigns');
    ui.rerender('bulk');
  });

  const counts = (c) => {
    const r = { total: c.contacts.length, sent: 0, failed: 0, invalid: 0, pending: 0 };
    c.contacts.forEach((x) => { r[x.status] = (r[x.status] || 0) + 1; });
    return r;
  };
  const estimate = (n, c) => {
    const avg = ZF.campaignDelay(c) + 6; // +6s para abrir conversa/enviar
    const pauses = c.pauseEvery > 0 ? Math.floor(Math.max(0, n - 1) / c.pauseEvery) : 0;
    return (n * avg + pauses * ZF.campaignPause(c)) * 1000;
  };

  const go = (v) => {
    view = v;
    try { sessionStorage.setItem('zapflow-bulk-view', JSON.stringify(v.name === 'detail' ? v : { name: 'list' })); } catch (e) { /* ignora */ }
    ui.rerender('bulk');
    ui.body.scrollTop = 0;
  };

  /** Toda campanha nova nasce no Envio Rápido (tela cheia); (camp) fica só para os chamadores antigos */
  ZF.openCampaignEditor = (camp = null, defaults = {}) => ZF.openQuickSend(defaults);

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
    if (!c.contacts.length || !c.blocks.length) throw ZF.userError('Rascunho incompleto: crie a campanha de novo pelo Envio Rápido.');
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
    if (c.status === 'draft') actions.push(btn('Iniciar envio', 'send', () => startDraft(c), 'primary'));
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
        'Escolha os contatos (salvos, etiquetas, grupos, CRM ou planilha), monte o script da mensagem e a extensão envia um por um, com o intervalo e a pausa que você definir.')));
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
      if (first || JSON.stringify(list) !== JSON.stringify(campaigns)) { campaigns = list; ui.rerender('bulk'); }
    });
    if (!loaded) return ZF.append(body, h('div', { class: 'zf-empty' }, 'Carregando…'));
    if (view.name === 'detail') {
      const c = campaigns.find((x) => x.id === view.id);
      if (c) return renderDetail(body, c);
      view = { name: 'list' };
    }
    renderList(body);
  }

  ui.registerTab('bulk', { icon: 'inbox', title: 'Disparos em massa', render });
})();
