/* ZapFlow — aba "Agendamentos" */
(() => {
  'use strict';
  const ZF = window.ZF;
  const { h, icon, store, ui } = ZF;

  const REPEAT = {
    none: 'Não repetir',
    daily: 'Todo dia',
    weekdays: 'Dias úteis (seg–sex)',
    weekly: 'Toda semana',
    days: 'A cada X dias',
    monthly: 'Todo mês',
    yearly: 'Todo ano',
  };
  const STATUS = { pending: 'Agendado', paused: 'Pausado', sent: 'Enviado', failed: 'Falhou', missed: 'Perdido' };

  let schedules = [];
  store.onChange(['schedules'], async () => {
    schedules = await store.get('schedules');
    ui.rerender('schedules');
  });

  const targetLabel = (t) => t.name || ZF.fmtPhone(t.phone) || 'Conversa';

  /* ---------------- editor ---------------- */
  async function openScheduleEditor(sched = null, defaults = {}) {
    const settings = await store.settings();
    let target = sched ? { ...sched.target } : { type: 'phone', phone: '', name: '', chatId: null };

    const phone = ui.input({ placeholder: 'Ex.: 11 98765-4321', value: target.phone ? ZF.fmtPhone(target.phone) : '' });
    const name = ui.input({ placeholder: 'Opcional — usado em {nome}', value: target.name || '' });
    const groupInfo = h('div');
    const phoneFields = h('div', { class: 'zf-grid2' }, ui.field('Telefone (com DDD)', phone), ui.field('Nome', name));

    const renderTarget = () => {
      groupInfo.replaceChildren();
      const isChatOnly = target.chatId && !target.phone;
      phoneFields.style.display = isChatOnly ? 'none' : '';
      if (target.chatId) {
        groupInfo.appendChild(h('div', { class: 'zf-note info' }, icon(isChatOnly ? 'users' : 'user', 15),
          h('span', { class: 'zf-grow' }, `${isChatOnly ? 'Grupo/conversa' : 'Conversa'}: ${target.name || target.chatId}`),
          h('button', {
            class: 'zf-iconbtn', title: 'Remover', onclick: (e) => {
              e.preventDefault();
              target = { type: 'phone', phone: ZF.onlyDigits(phone.value), name: name.value, chatId: null };
              renderTarget();
            },
          }, icon('x', 14))));
      }
    };

    const useActive = ui.safe(async () => {
      const info = await ZF.wa.activeChatInfo();
      if (!info) { ui.toast('Abra uma conversa no WhatsApp primeiro', 'error'); return; }
      if (!info.phone && !info.chatId) {
        ui.toast('Não consegui identificar o número desta conversa. Digite o telefone.', 'error', 4500);
        name.value = info.name || '';
        return;
      }
      target = { type: info.phone ? 'phone' : 'chat', phone: info.phone || '', chatId: info.chatId || null, name: info.name || '' };
      phone.value = info.phone ? ZF.fmtPhone(info.phone) : '';
      name.value = info.name || '';
      renderTarget();
    });

    const pickOther = ui.safe(async () => {
      const r = await ui.pickChats({ title: 'Escolher contato ou grupo', multi: false });
      const info = r && r[0];
      if (!info) return;
      target = { type: info.phone ? 'phone' : 'chat', phone: info.phone || '', chatId: info.chatId || null, name: info.name || '' };
      phone.value = info.phone ? ZF.fmtPhone(info.phone) : '';
      name.value = info.name || '';
      renderTarget();
    });

    const editor = ui.blocksEditor(sched ? sched.blocks : defaults.blocks || []);
    const loadReply = h('button', {
      class: 'zf-btn sm', onclick: ui.safe(async (e) => {
        e.preventDefault();
        const r = await ui.pickReply();
        if (r) editor.set(r.blocks);
      }),
    }, icon('zap', 14), 'Usar resposta rápida');

    const defaultTime = (() => { const d = new Date(Date.now() + 3600000); d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0); return d.getTime(); })();
    const when = ui.input({ type: 'datetime-local', value: ZF.toLocalInput(sched ? sched.sendAt : defaultTime) });
    const quick = (label, fn) => h('button', { class: 'zf-varchip', onclick: (e) => { e.preventDefault(); when.value = ZF.toLocalInput(fn()); } }, label);
    const tomorrowAt = (hh) => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(hh, 0, 0, 0); return d.getTime(); };
    const repeat = ui.select(Object.entries(REPEAT).map(([value, label]) => ({ value, label })), sched ? sched.repeat || 'none' : 'none');
    const everyDays = ui.input({ type: 'number', min: 1, max: 365, value: (sched && sched.everyDays) || 14, style: { width: '80px' } });
    const everyBox = h('div', { class: 'zf-row', style: { gap: '6px', marginTop: '6px' } }, 'A cada', everyDays, 'dias');
    const syncEvery = () => { everyBox.style.display = repeat.value === 'days' ? '' : 'none'; };
    repeat.addEventListener('change', syncEvery);
    syncEvery();

    const body = h('div', {},
      h('div', { class: 'zf-field' },
        h('div', { class: 'zf-row', style: { justifyContent: 'space-between', marginBottom: '6px' } },
          h('span', { class: 'zf-label', style: { margin: 0 } }, 'Destinatário'),
          h('div', { class: 'zf-row', style: { gap: '6px' } },
            h('button', { class: 'zf-btn sm', onclick: (e) => { e.preventDefault(); useActive(); } }, icon('user', 14), 'Conversa aberta'),
            h('button', { class: 'zf-btn sm', onclick: (e) => { e.preventDefault(); pickOther(); } }, icon('users', 14), 'Escolher…'))),
        groupInfo, phoneFields),
      h('div', { class: 'zf-field' },
        h('div', { class: 'zf-row', style: { justifyContent: 'space-between', marginBottom: '6px' } },
          h('span', { class: 'zf-label', style: { margin: 0 } }, 'Mensagem'), loadReply),
        editor.el),
      ui.field('Data e hora', h('div', {}, when, h('div', { class: 'zf-varchips' },
        quick('+1 hora', () => Date.now() + 3600000),
        quick('Amanhã 08:00', () => tomorrowAt(8)),
        quick('Amanhã 09:00', () => tomorrowAt(9)),
        quick('Amanhã 14:00', () => tomorrowAt(14))))),
      ui.field('Repetir', h('div', {}, repeat, everyBox)));

    renderTarget();
    if (!sched && defaults.useActiveChat) useActive();

    ui.modal({
      title: sched ? 'Editar agendamento' : 'Novo agendamento',
      body,
      actions: [
        { label: 'Cancelar' },
        {
          label: 'Salvar', class: 'primary', icon: 'check', onClick: async () => {
            // destinatário
            let t;
            if (target.chatId && !target.phone) t = { ...target };
            else {
              const p = ZF.normalizePhone(phone.value, settings.countryCode);
              if (!p) { ui.toast('Telefone inválido. Use DDD + número.', 'error'); phone.focus(); return false; }
              const sameChat = target.chatId && ZF.onlyDigits(target.phone) === p;
              t = { type: 'phone', phone: p, name: name.value.trim(), chatId: sameChat ? target.chatId : null };
            }
            const blocks = editor.get();
            if (!blocks.length) { ui.toast('A mensagem está vazia', 'error'); return false; }
            let sendAt = ZF.fromLocalInput(when.value);
            if (!sendAt) { ui.toast('Informe a data e hora', 'error'); return false; }
            if (sendAt < Date.now() - 60000) {
              const ok = await ui.confirm('Essa data/hora já passou. Deseja enviar agora?', { okLabel: 'Enviar agora' });
              if (!ok) return false;
              sendAt = Date.now();
            }
            // campos personalizados ({horario}, {valor}…)
            let vars = { ...((sched && sched.vars) || {}) };
            const missing = ZF.missingVars(blocks, vars);
            if (missing.length) {
              const extra = await ui.askVars(missing, 'Campos da mensagem');
              if (!extra) return false;
              vars = { ...vars, ...extra };
            }
            const rep = repeat.value;
            const rec = {
              target: t, blocks, vars, sendAt, repeat: rep,
              everyDays: rep === 'days' ? Math.max(1, Math.min(365, Number(everyDays.value) || 1)) : null,
              anchorDay: new Date(sendAt).getDate(),
              status: 'pending', lastError: null, updatedAt: Date.now(),
            };
            if (sched) await store.updateItem('schedules', sched.id, (s) => ({ ...s, ...rec }));
            else await store.update('schedules', (list) => { list.push({ id: ZF.uid(), createdAt: Date.now(), history: [], ...rec }); return list; });
            store.gcFiles();
            ui.toast(`Agendado para ${ZF.fmtDateTime(sendAt)}`, 'ok');
            if (ui.current !== 'schedules') ui.setTab('schedules');
          },
        },
      ],
    });
  }
  ZF.openScheduleEditor = openScheduleEditor;

  /* ---------------- ações ---------------- */
  const sendNow = async (s) => {
    await store.updateItem('schedules', s.id, (x) => { x.status = 'pending'; x.sendAt = Date.now(); x.lastError = null; });
    ui.toast('Envio iniciado…');
    ZF.runner.tick();
  };
  const togglePause = async (s) => {
    await store.updateItem('schedules', s.id, (x) => {
      if (x.status === 'paused') {
        x.status = 'pending';
        if (x.sendAt < Date.now() && x.repeat && x.repeat !== 'none') x.sendAt = ZF.runner.nextOccurrence(x.sendAt, x.repeat, x.anchorDay, x.everyDays);
      } else x.status = 'paused';
    });
  };
  const remove = async (s) => {
    if (!(await ui.confirm(`Excluir o agendamento para ${targetLabel(s.target)}?`, { okLabel: 'Excluir', danger: true }))) return;
    await store.update('schedules', (list) => list.filter((x) => x.id !== s.id));
    store.gcFiles();
  };
  const clearHistory = async () => {
    if (!(await ui.confirm('Remover todos os agendamentos já enviados, perdidos ou com falha?', { okLabel: 'Limpar', danger: true }))) return;
    await store.update('schedules', (list) => list.filter((x) => ['pending', 'paused'].includes(x.status)));
    store.gcFiles();
  };

  /* ---------------- renderização ---------------- */
  function card(s) {
    const repeats = s.repeat && s.repeat !== 'none';
    const upcoming = ['pending', 'paused'].includes(s.status);
    const ts = upcoming ? s.sendAt : s.sentAt || s.lastRunAt || s.sendAt;
    return h('div', { class: 'zf-card' },
      h('div', { class: 'zf-row' },
        icon(s.target.chatId && !s.target.phone ? 'users' : 'user', 16),
        h('div', { class: 'zf-name zf-grow' }, targetLabel(s.target)),
        ui.badge(s.status, STATUS[s.status] || s.status)),
      h('div', { class: 'zf-meta' },
        h('span', {}, icon('calendar', 13), ZF.fmtDateTime(ts), upcoming ? ` (${ZF.relTime(ts)})` : ''),
        repeats ? h('span', {}, icon('repeat', 13), ZF.repeatLabel(s)) : null,
        s.target.phone && s.target.name ? h('span', {}, ZF.fmtPhone(s.target.phone)) : null),
      h('div', { class: 'zf-msg' }, ZF.blocksPreview(s.blocks, 140)),
      s.lastError && s.status !== 'sent' ? h('div', { class: 'zf-err' }, s.lastError) : null,
      h('div', { class: 'zf-actions' },
        h('button', { class: 'zf-btn sm', onclick: ui.safe(() => sendNow(s)) }, icon('send', 13), s.status === 'failed' || s.status === 'missed' ? 'Tentar de novo' : 'Enviar agora'),
        h('button', { class: 'zf-btn sm', onclick: ui.safe(() => openScheduleEditor(s)) }, icon('edit', 13), 'Editar'),
        upcoming ? h('button', { class: 'zf-btn sm', onclick: ui.safe(() => togglePause(s)) }, icon(s.status === 'paused' ? 'play' : 'pause', 13), s.status === 'paused' ? 'Retomar' : 'Pausar') : null,
        h('button', { class: 'zf-btn sm danger', onclick: ui.safe(() => remove(s)) }, icon('trash', 13))));
  }

  function render(body) {
    store.get('schedules').then((list) => {
      if (JSON.stringify(list) !== JSON.stringify(schedules)) { schedules = list; ui.rerender('schedules'); }
    });
    const upcoming = schedules.filter((s) => ['pending', 'paused'].includes(s.status)).sort((a, b) => a.sendAt - b.sendAt);
    const history = schedules.filter((s) => !['pending', 'paused'].includes(s.status))
      .sort((a, b) => (b.lastRunAt || b.sendAt) - (a.lastRunAt || a.sendAt)).slice(0, 60);

    ZF.append(body, 
      h('button', { class: 'zf-btn primary block', style: { marginBottom: '6px' }, onclick: ui.safe(() => openScheduleEditor(null, { useActiveChat: !!ZF.wa.getCompose() })) }, icon('plus', 16), 'Novo agendamento'),
      h('div', { class: 'zf-h3' }, `Próximos (${upcoming.length})`),
      upcoming.length ? upcoming.map(card) : h('div', { class: 'zf-empty' }, 'Nenhuma mensagem agendada.'),
    );
    if (history.length) {
      ZF.append(body, 
        h('div', { class: 'zf-row', style: { justifyContent: 'space-between' } },
          h('div', { class: 'zf-h3' }, 'Histórico'),
          h('button', { class: 'zf-btn sm', onclick: ui.safe(clearHistory) }, 'Limpar')),
        history.map(card));
    }
    ZF.append(body, h('div', { class: 'zf-note info', style: { marginTop: '12px' } }, icon('alert', 15),
      h('span', {}, 'Os envios acontecem com o Chrome aberto. Se o WhatsApp Web estiver fechado, a extensão abre uma aba automaticamente na hora marcada.')));
  }

  ui.registerTab('schedules', { icon: 'calendarClock', title: 'Mensagens agendadas', render });
})();
