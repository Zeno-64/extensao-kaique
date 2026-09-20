/* ZapFlow — aba "Lembretes": compromissos com alerta na tela e notificação do sistema */
(() => {
  'use strict';
  const ZF = window.ZF;
  const { h, icon, store, ui } = ZF;

  const REPEAT = { none: 'Não repetir', daily: 'Todo dia', weekdays: 'Dias úteis', weekly: 'Toda semana', monthly: 'Todo mês' };

  let reminders = [];
  store.onChange(['reminders'], async () => {
    reminders = await store.get('reminders');
    ui.rerender('reminders');
    pruneAlerts();
    checkDue();
  });

  const at = (hh, mm = 0, addDays = 0) => { const d = new Date(); d.setDate(d.getDate() + addDays); d.setHours(hh, mm, 0, 0); return d.getTime(); };
  const nextMonday9 = () => { const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); d.setHours(9, 0, 0, 0); return d.getTime(); };

  /* ---------------- ações ---------------- */
  const update = (id, fn) => store.updateItem('reminders', id, fn);
  const complete = (r) => update(r.id, (x) => {
    if (x.repeat && x.repeat !== 'none') {
      x.dueAt = ZF.runner.nextOccurrence(x.dueAt, x.repeat, x.anchorDay);
      x.notifiedAt = null;
      x.lastDoneAt = Date.now();
    } else {
      x.status = 'done';
      x.doneAt = Date.now();
    }
  });
  const snooze = (r, ms) => update(r.id, (x) => { x.status = 'pending'; x.dueAt = typeof ms === 'function' ? ms() : Date.now() + ms; x.notifiedAt = null; });
  const remove = async (r) => {
    if (!(await ui.confirm(`Excluir o lembrete "${r.title}"?`, { okLabel: 'Excluir', danger: true }))) return;
    await store.update('reminders', (list) => list.filter((x) => x.id !== r.id));
  };
  const openChat = async (r) => {
    if (!r.chat) return;
    const res = await ZF.wa.openChatUI({ phone: r.chat.phone, chatId: r.chat.chatId });
    if (!res.ok) throw new Error('Não consegui abrir a conversa deste lembrete');
  };
  const toGcal = (r) => ui.openEventEditor({
    title: r.title,
    start: r.dueAt,
    details: [r.notes, r.chat ? `${r.chat.name || ''} ${r.chat.phone ? ZF.fmtPhone(r.chat.phone) : ''}`.trim() : ''].filter(Boolean).join('\n\n'),
  });
  const snoozeMenu = (r, anchor) => ui.menu(anchor, [
    { label: '10 minutos', icon: 'clock', onClick: () => snooze(r, 10 * 60000) },
    { label: '1 hora', icon: 'clock', onClick: () => snooze(r, 3600000) },
    { label: '3 horas', icon: 'clock', onClick: () => snooze(r, 3 * 3600000) },
    { label: 'Amanhã às 09:00', icon: 'calendar', onClick: () => snooze(r, () => at(9, 0, 1)) },
  ]);

  /* ---------------- editor ---------------- */
  async function openReminderEditor(rem = null, defaults = {}) {
    let chat = rem ? rem.chat : defaults.chat ? { key: ZF.chatKey(defaults.chat), name: defaults.chat.name, phone: defaults.chat.phone, chatId: defaults.chat.chatId, isGroup: defaults.chat.isGroup } : null;
    const title = ui.input({ value: rem ? rem.title : defaults.title || '', placeholder: 'Ex.: Ligar para confirmar exame' });
    const notes = h('textarea', { class: 'zf-textarea', rows: 3, value: rem ? rem.notes || '' : defaults.notes || '', placeholder: 'Detalhes (opcional)' });
    const when = ui.input({ type: 'datetime-local', value: ZF.toLocalInput(rem ? rem.dueAt : defaults.dueAt || Date.now() + 3600000) });
    const quick = (label, fn) => h('button', { class: 'zf-varchip', onclick: (e) => { e.preventDefault(); when.value = ZF.toLocalInput(fn()); } }, label);
    const repeat = ui.select(Object.entries(REPEAT).map(([value, label]) => ({ value, label })), rem ? rem.repeat || 'none' : 'none');
    const gcal = h('input', { type: 'checkbox' });
    const chatBox = h('div');
    const renderChat = () => {
      chatBox.replaceChildren(chat
        ? h('div', { class: 'zf-note info' }, icon(chat.isGroup ? 'users' : 'user', 15), h('span', { class: 'zf-grow' }, chat.name || ZF.fmtPhone(chat.phone)),
          h('button', { class: 'zf-iconbtn', title: 'Desvincular', onclick: (e) => { e.preventDefault(); chat = null; renderChat(); } }, icon('x', 14)))
        : h('button', {
          class: 'zf-btn sm', onclick: ui.safe(async (e) => {
            e.preventDefault();
            const info = await ZF.wa.activeChatInfo();
            if (!info) { ui.toast('Abra uma conversa no WhatsApp primeiro', 'error'); return; }
            chat = { key: ZF.chatKey(info), name: info.name, phone: info.phone, chatId: info.chatId, isGroup: info.isGroup };
            renderChat();
          }),
        }, icon('user', 13), 'Vincular à conversa aberta'));
    };
    renderChat();

    ui.modal({
      title: rem ? 'Editar lembrete' : 'Novo lembrete',
      body: h('div', {},
        ui.field('O que lembrar', title),
        ui.field('Quando', h('div', {}, when, h('div', { class: 'zf-varchips' },
          quick('+30 min', () => Date.now() + 30 * 60000), quick('+1 hora', () => Date.now() + 3600000),
          quick('Hoje 18:00', () => at(18)), quick('Amanhã 09:00', () => at(9, 0, 1)), quick('Segunda 09:00', nextMonday9)))),
        ui.field('Repetir', repeat),
        ui.field('Conversa', chatBox),
        ui.field('Detalhes', notes),
        h('label', { class: 'zf-check' }, gcal, h('span', {}, 'Criar também no Google Agenda'))),
      actions: [
        { label: 'Cancelar' },
        {
          label: 'Salvar', class: 'primary', icon: 'check', onClick: async () => {
            const t = title.value.trim();
            const dueAt = ZF.fromLocalInput(when.value);
            if (!t) { ui.toast('Diga o que lembrar', 'error'); title.focus(); return false; }
            if (!dueAt) { ui.toast('Informe a data e hora', 'error'); return false; }
            const rec = { title: t, notes: notes.value.trim(), dueAt, repeat: repeat.value, anchorDay: new Date(dueAt).getDate(), chat, status: 'pending', notifiedAt: null, updatedAt: Date.now() };
            if (rem) await update(rem.id, (x) => ({ ...x, ...rec }));
            else await store.update('reminders', (list) => { list.push({ id: ZF.uid(), createdAt: Date.now(), ...rec }); return list; });
            ui.toast(`Lembrete para ${ZF.fmtDateTime(dueAt)}`, 'ok');
            if (gcal.checked) toGcal({ ...rec });
            if (ui.current !== 'reminders') ui.setTab('reminders');
          },
        },
      ],
    });
  }
  ZF.openReminderEditor = openReminderEditor;

  /* ---------------- alerta na tela ---------------- */
  const shown = new Set();
  let alertBox = null;
  function showAlert(r) {
    if (!ui.wrap) return;
    if (!alertBox) {
      alertBox = h('div', { class: 'zf-alerts zf-keep' });
      ui.wrap.appendChild(alertBox);
    }
    if (!alertBox.isConnected) ui.wrap.appendChild(alertBox);
    const card = h('div', { class: 'zf-alert', dataset: { key: r.id + ':' + r.dueAt } });
    const close = () => { card.remove(); };
    const act = (label, ic, fn, cls = '') => h('button', { class: 'zf-btn sm ' + cls, onclick: ui.safe(async () => { await fn(); close(); }) }, icon(ic, 13), label);
    card.append(
      h('div', { class: 'zf-row' }, icon('bell', 18), h('div', { class: 'zf-name zf-grow' }, r.title),
        h('button', { class: 'zf-iconbtn', title: 'Fechar', onclick: close }, icon('x', 16))),
      h('div', { class: 'zf-muted zf-small' }, `${ZF.fmtDateTime(r.dueAt)}${r.chat ? ' • ' + (r.chat.name || ZF.fmtPhone(r.chat.phone)) : ''}`),
      r.notes ? h('div', { class: 'zf-small', style: { marginTop: '4px', whiteSpace: 'pre-wrap' } }, r.notes) : '',
      h('div', { class: 'zf-actions' },
        act('Concluir', 'check', () => complete(r), 'primary'),
        act('+10 min', 'clock', () => snooze(r, 10 * 60000)),
        act('+1 h', 'clock', () => snooze(r, 3600000)),
        r.chat ? act('Abrir conversa', 'message', () => openChat(r)) : null));
    alertBox.appendChild(card);
  }

  /** Remove alertas de lembretes que foram concluídos, adiados, editados ou excluídos */
  function pruneAlerts() {
    if (!alertBox) return;
    const live = new Set(reminders.filter((r) => r.status === 'pending' && r.dueAt <= Date.now()).map((r) => r.id + ':' + r.dueAt));
    [...alertBox.children].forEach((c) => { if (!live.has(c.dataset.key)) c.remove(); });
  }

  function checkDue() {
    const now = Date.now();
    reminders.filter((r) => r.status === 'pending' && r.dueAt <= now).forEach((r) => {
      const k = r.id + ':' + r.dueAt;
      if (shown.has(k)) return;
      shown.add(k);
      showAlert(r);
    });
  }
  ZF.every(15000, checkDue);
  store.get('reminders').then((list) => { reminders = list; setTimeout(checkDue, 3000); });

  /** Pedido do service worker (clique na notificação) */
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== 'ZF_OPEN_REMINDER') return;
    const r = reminders.find((x) => x.id === msg.id);
    ui.openView('reminders');
    if (r && r.chat) openChat(r).catch(() => {});
  });

  /* ---------------- renderização ---------------- */
  function card(r) {
    const late = r.status === 'pending' && r.dueAt <= Date.now();
    const repeats = r.repeat && r.repeat !== 'none';
    return h('div', { class: 'zf-card', style: late ? { borderColor: 'var(--warn)' } : null },
      h('div', { class: 'zf-row' }, icon(r.status === 'done' ? 'checkSquare' : 'bell', 16),
        h('div', { class: 'zf-name zf-grow' }, r.title),
        late ? ui.badge('missed', 'Agora') : r.status === 'done' ? ui.badge('done', 'Feito') : null),
      h('div', { class: 'zf-meta' },
        h('span', {}, icon('calendar', 13), ZF.fmtDateTime(r.status === 'done' ? r.doneAt : r.dueAt), r.status === 'pending' ? ` (${ZF.relTime(r.dueAt)})` : ''),
        repeats ? h('span', {}, icon('repeat', 13), REPEAT[r.repeat]) : null,
        r.chat ? h('span', {}, icon(r.chat.isGroup ? 'users' : 'user', 13), r.chat.name || ZF.fmtPhone(r.chat.phone)) : null),
      r.notes ? h('div', { class: 'zf-msg', style: { whiteSpace: 'pre-wrap' } }, r.notes) : null,
      h('div', { class: 'zf-actions' },
        r.status === 'pending' ? h('button', { class: 'zf-btn sm' + (late ? ' primary' : ''), onclick: ui.safe(() => complete(r)) }, icon('check', 13), 'Concluir') : null,
        r.status === 'pending' ? h('button', { class: 'zf-btn sm', onclick: (e) => snoozeMenu(r, e.currentTarget) }, icon('clock', 13), 'Adiar') : null,
        r.chat ? h('button', { class: 'zf-btn sm', onclick: ui.safe(() => openChat(r)) }, icon('message', 13), 'Conversa') : null,
        h('button', { class: 'zf-btn sm', title: 'Google Agenda', onclick: () => toGcal(r) }, icon('calendar', 13)),
        h('button', { class: 'zf-btn sm', title: 'Editar', onclick: ui.safe(() => openReminderEditor(r)) }, icon('edit', 13)),
        h('button', { class: 'zf-btn sm danger', title: 'Excluir', onclick: ui.safe(() => remove(r)) }, icon('trash', 13))));
  }

  function render(body) {
    store.get('reminders').then((list) => {
      if (JSON.stringify(list) !== JSON.stringify(reminders)) { reminders = list; ui.rerender('reminders'); }
    });
    const now = Date.now();
    const pending = reminders.filter((r) => r.status === 'pending').sort((a, b) => a.dueAt - b.dueAt);
    const late = pending.filter((r) => r.dueAt <= now);
    const next = pending.filter((r) => r.dueAt > now);
    const done = reminders.filter((r) => r.status === 'done').sort((a, b) => b.doneAt - a.doneAt).slice(0, 30);

    ZF.append(body,
      h('div', { class: 'zf-row', style: { gap: '6px', marginBottom: '6px' } },
        h('button', { class: 'zf-btn primary', style: { flex: 1 }, onclick: ui.safe(() => openReminderEditor()) }, icon('plus', 16), 'Novo lembrete'),
        h('button', { class: 'zf-btn', title: 'Criar evento no Google Agenda', onclick: () => ui.openEventEditor({}) }, icon('calendarDays', 16), 'Agenda')),
      late.length ? [h('div', { class: 'zf-h3', style: { color: 'var(--warn)' } }, `Agora (${late.length})`), late.map(card)] : null,
      h('div', { class: 'zf-h3' }, `Próximos (${next.length})`),
      next.length ? next.map(card) : h('div', { class: 'zf-empty' }, 'Nenhum lembrete agendado.'),
      done.length ? h('details', { class: 'zf-section', style: { padding: '8px 12px', marginTop: '12px' } },
        h('summary', { style: { cursor: 'pointer', fontWeight: 700, fontSize: '13px' } }, `Concluídos (${done.length})`),
        h('div', { style: { marginTop: '8px' } }, done.map(card),
          h('button', {
            class: 'zf-btn sm', onclick: ui.safe(async () => {
              if (await ui.confirm('Apagar todos os lembretes concluídos?', { okLabel: 'Apagar', danger: true })) await store.update('reminders', (list) => list.filter((x) => x.status !== 'done'));
            }),
          }, 'Limpar concluídos'))) : null,
      h('div', { class: 'zf-note info', style: { marginTop: '12px' } }, icon('bell', 15),
        h('span', {}, 'Na hora marcada aparece um alerta aqui no WhatsApp e uma notificação do Windows (com o Chrome aberto).')));
  }

  ui.registerTab('reminders', { icon: 'alarm', title: 'Lembretes', render });
})();
