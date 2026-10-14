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
  let showAll = false; // por padrao mostra so os da conversa aberta
  store.onChange(['schedules'], async () => {
    schedules = await store.get('schedules');
    ui.rerender('schedules');
    renderWindow();
  });
  ZF.on('activechat', () => {
    if (ui.current === 'schedules') ui.rerender('schedules');
    renderWindow();
  });

  const targetLabel = (t) => t.name || ZF.fmtPhone(t.phone) || 'Conversa';
  const activeInfo = () => (ZF.activeChat && ZF.activeChat.info) || null;
  /** O agendamento e para a conversa aberta? (compara pelo id da conversa ou pelo telefone) */
  const sameTarget = (t, info) => {
    if (!t || !info) return false;
    if (t.chatId && info.chatId && t.chatId === info.chatId) return true;
    return !!(t.phone && info.phone && ZF.onlyDigits(t.phone) === ZF.onlyDigits(info.phone));
  };

  /* ---------------- editor ---------------- */
  async function openScheduleEditor(sched = null, defaults = {}, opts = {}) {
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
      global: !!opts.global,
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
            if (opts.noJump) return;
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
    if (!(await ui.confirm('Remover todos os agendamentos perdidos ou com falha?', { okLabel: 'Limpar', danger: true }))) return;
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
    if (ZF.activeChat && !ZF.activeChat.checked && ZF.checkActiveChat) setTimeout(() => ZF.checkActiveChat(true), 0);
    const info = activeInfo();
    const scoped = !!info && !showAll;
    const list = scoped ? schedules.filter((s) => sameTarget(s.target, info)) : schedules;
    const upcoming = list.filter((s) => ['pending', 'paused'].includes(s.status)).sort((a, b) => a.sendAt - b.sendAt);
    const history = list.filter((s) => !['pending', 'paused'].includes(s.status))
      .sort((a, b) => (b.lastRunAt || b.sendAt) - (a.lastRunAt || a.sendAt)).slice(0, 60);
    const others = schedules.length - list.length;

    ZF.append(body, 
      h('button', { class: 'zf-btn primary block', style: { marginBottom: '8px' }, onclick: ui.safe(() => openScheduleEditor(null, { useActiveChat: ZF.wa.chatOpen() })) }, icon('plus', 16), 'Novo agendamento'),
      // a tela abre mostrando so o que esta agendado para a conversa aberta
      info ? h('div', { class: 'zf-scope' },
        icon(info.isGroup ? 'users' : 'user', 15),
        h('span', { class: 'zf-grow zf-ellipsis' }, scoped ? targetLabel(info) : 'Todas as conversas'),
        h('button', {
          class: 'zf-btn sm', title: scoped ? 'Mostrar os agendamentos de todas as conversas' : 'Mostrar só os desta conversa',
          onclick: () => { showAll = !showAll; ui.rerender('schedules'); },
        }, icon('eye', 13), scoped ? `Exibir todos${others ? ` (${others})` : ''}` : 'Só desta conversa')) : null,
      h('button', { class: 'zf-btn sm', style: { marginBottom: '8px' }, onclick: () => openSchedulesWindow('report') }, icon('clipboardEdit', 13), 'Relatório de envios'),
      h('div', { class: 'zf-h3' }, `Próximos (${upcoming.length})`),
      upcoming.length ? upcoming.map(card) : h('div', { class: 'zf-empty' }, scoped ? 'Nada agendado para esta conversa.' : 'Nenhuma mensagem agendada.'),
    );
    if (history.length) {
      ZF.append(body, 
        h('div', { class: 'zf-row', style: { justifyContent: 'space-between' } },
          h('div', { class: 'zf-h3' }, 'Não enviados'),
          h('button', { class: 'zf-btn sm', onclick: ui.safe(clearHistory) }, 'Limpar')),
        history.map(card));
    }
    ZF.append(body, h('div', { class: 'zf-note info', style: { marginTop: '12px' } }, icon('alert', 15),
      h('span', {}, 'Os envios acontecem com o Chrome aberto. Se o WhatsApp Web estiver fechado, a extensão abre uma aba automaticamente na hora marcada.')));
  }


  /* ---------------- "Criar agendamento" (layout do WaSpeed) ---------------- */
  /*
   * Abre pelo "Adicionar" da janela de agendamentos. Tipos: texto, mídia (com legenda),
   * áudio (com texto opcional) ou uma resposta rápida salva. Data e hora separadas,
   * recorrência numa lista e "recorrência personalizada" = a cada X dias.
   */
  const KINDS = [['texto', 'Criar texto'], ['midia', 'Mídia'], ['audio', 'Áudio'], ['resposta', 'Selecionar mensagem rápida']];
  const KIND_LABEL = { texto: 'Texto', midia: 'Mídia', audio: 'Áudio', resposta: 'Resposta rápida' };
  const RECUR = [['none', 'Nenhuma selecionada'], ['daily', 'Todo dia'], ['weekdays', 'Dias úteis (seg–sex)'], ['weekly', 'Toda semana'], ['monthly', 'Todo mês'], ['yearly', 'Todo ano']];

  /** Em qual tipo do editor novo um agendamento abre (null = só cabe no editor completo) */
  const kindOf = (s) => {
    if (!s) return 'texto';
    if (s.kind) return s.kind;
    const b = s.blocks || [];
    const texts = b.filter((x) => x.type === 'text');
    const files = b.filter((x) => x.type === 'file');
    if (b.some((x) => x.type === 'vcard') || files.length > 1 || texts.length > 1) return null;
    if (!files.length) return 'texto';
    if ((files[0].mime || '').startsWith('audio/')) return 'audio';
    return texts.length ? null : 'midia';
  };
  const typeLabel = (s) => KIND_LABEL[s.kind] || ZF.TYPE_LABELS[ZF.messageType(s.blocks)] || 'Texto';
  const replyIcon = (r) => (r.kind === 'script' ? 'bot' : ZF.TYPE_ICONS[ZF.replyType(r)] || 'fileText');
  const pad = (n) => String(n).padStart(2, '0');
  const dateValue = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const timeValue = (ts) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const targetOf = (info) => (info && (info.phone || info.chatId)
    ? { type: info.phone ? 'phone' : 'chat', phone: info.phone || '', chatId: info.chatId || null, name: info.name || '' }
    : null);

  /**
   * sched: agendamento a editar. copy: usa sched só como modelo (cria um novo — ex.: "editar" no relatório).
   * target: destinatário já escolhido (senão, a conversa aberta).
   */
  async function openCreateSchedule(sched = null, { copy = false, target: presetTarget = null } = {}) {
    const editing = !!(sched && sched.id && !copy);
    const kind0 = kindOf(sched);
    if (sched && !kind0) {
      return editing
        ? openScheduleEditor(sched, {}, { global: true, noJump: true })
        : openScheduleEditor(null, { blocks: sched.blocks, useActiveChat: true }, { global: true, noJump: true });
    }

    const { replies: rawReplies } = await store.getMany(['replies']);
    const replies = rawReplies.map(ZF.migrateReply);
    let kind = kind0 || 'texto';
    let target = sched ? { ...sched.target } : presetTarget || targetOf(activeInfo()) || targetOf(await ZF.wa.activeChatInfo().catch(() => null));
    const blocks0 = (sched && sched.blocks) || [];
    const file0 = blocks0.find((b) => b.type === 'file') || null;
    let mediaFile = kind === 'midia' ? file0 : null;
    let audioFile = kind === 'audio' ? file0 : null;
    let reply = (sched && sched.replyId && replies.find((r) => r.id === sched.replyId)) || null;
    const text0 = kind === 'midia' ? (file0 && file0.caption) || '' : (blocks0.find((b) => b.type === 'text') || {}).text || '';

    /* destinatário */
    const toEl = h('div', { class: 'zf-sed-to' });
    const pickTarget = ui.safe(async () => {
      const r = await ui.pickChats({ title: 'Escolher contato ou grupo', multi: false, global: true });
      const t = targetOf(r && r[0]);
      if (t) { target = t; renderTo(); }
    });
    const renderTo = () => toEl.replaceChildren(
      icon(target && target.chatId && !target.phone ? 'users' : 'user', 15),
      target ? h('span', { class: 'zf-grow zf-ellipsis' }, 'Para: ', h('b', {}, targetLabel(target))) : h('span', { class: 'zf-grow zf-muted' }, 'Escolha para quem enviar'),
      h('button', { class: 'zf-btn sm', onclick: (e) => { e.preventDefault(); pickTarget(); } }, target ? 'Trocar' : 'Escolher contato'));
    renderTo();

    /* título */
    const title = ui.input({ placeholder: 'Insira aqui o título', value: (sched && sched.title) || '' });

    /* mensagem (o mesmo campo passa de um tipo para o outro) */
    const ta = h('textarea', { class: 'zf-textarea', rows: 5, placeholder: 'Insira sua mensagem', value: text0 });
    const wand = h('button', { class: 'zf-iconbtn', title: 'Melhorar o texto com a IA' }, icon('sparkles', 18));
    wand.addEventListener('click', ui.safe(async (e) => {
      e.preventDefault();
      if (wand.disabled) return;
      wand.disabled = true;
      wand.replaceChildren(icon('loader', 18, 'zf-spin'));
      try {
        if (!ZF.aiImprove) throw ZF.userError('Assistente de IA indisponível.');
        ta.value = await ZF.aiImprove(ta.value);
      } finally { wand.disabled = false; wand.replaceChildren(icon('sparkles', 18)); }
    }));
    const msgBox = h('div', { class: 'zf-sed-msg' }, ta,
      h('div', { class: 'zf-sed-msgtools' },
        h('button', { class: 'zf-iconbtn', title: 'Emojis', onclick: (e) => { e.preventDefault(); ui.emojiPicker(e.currentTarget, (em) => ui.insertAtCursor(ta, em)); } }, icon('smile', 18)),
        wand));
    const varsBtn = h('button', {
      class: 'zf-iconbtn zf-sed-vars', title: 'Inserir variável ({nome}, {saudacao}…)',
      onclick: (e) => {
        e.preventDefault();
        ui.menu(e.currentTarget, ZF.BUILTIN_VARS.map((v) => ({ label: `{${v}} — ${ZF.VAR_HELP[v] || ''}`, onClick: () => ui.insertAtCursor(ta, `{${v}}`) })), { align: 'left' });
      },
    }, icon('hash', 14));
    const msgLabel = h('div', { class: 'zf-sed-label' }, 'Mensagem', varsBtn);

    /* arquivos */
    const saveFile = async (file, extra = {}) => {
      ui.toast('Salvando arquivo…');
      const meta = await store.saveFile(file);
      return { type: 'file', ...meta, caption: '', ...extra };
    };
    const fileChip = (b, onRemove) => h('div', { class: 'zf-filebox' },
      icon(ZF.TYPE_ICONS[ZF.messageType([b])] || 'file', 20),
      h('div', { class: 'zf-grow', style: { minWidth: 0 } },
        h('div', { class: 'zf-ellipsis', style: { fontWeight: 600 } }, b.name || 'arquivo'),
        h('div', { class: 'zf-muted zf-small' }, ZF.fmtSize(b.size || 0))),
      h('button', { class: 'zf-iconbtn', title: 'Remover', onclick: (e) => { e.preventDefault(); onRemove(); } }, icon('x', 14)));

    const mediaTile = h('button', { class: 'zf-sed-import' });
    const renderTile = () => {
      mediaTile.replaceChildren();
      mediaTile.classList.toggle('has', !!mediaFile);
      if (!mediaFile) { mediaTile.append(icon('download', 22), h('span', {}, 'Importar')); return; }
      const thumb = h('span', { class: 'zf-sed-thumb' }, icon(ZF.TYPE_ICONS[ZF.messageType([mediaFile])] || 'file', 26));
      if ((mediaFile.mime || '').startsWith('image/')) {
        store.getFile(mediaFile.fileId).then((f) => { if (f) thumb.replaceChildren(h('img', { src: f.data, alt: '' })); });
      }
      mediaTile.append(thumb, h('span', { class: 'zf-sed-fname', title: mediaFile.name }, mediaFile.name || 'arquivo'), h('span', { class: 'zf-sed-swap' }, 'Trocar'));
    };
    mediaTile.addEventListener('click', ui.safe(async (e) => {
      e.preventDefault();
      const file = await ZF.pickFile('image/*,video/*,application/pdf,application/*,text/*');
      if (!file) return;
      mediaFile = await saveFile(file);
      renderTile();
    }));
    renderTile();

    const audioBox = h('div', { class: 'zf-sed-audio' });
    const importAudio = h('button', {
      class: 'zf-btn sm primary', onclick: ui.safe(async (e) => {
        e.preventDefault();
        const file = await ZF.pickFile('audio/*');
        if (!file) return;
        audioFile = await saveFile(file, { asVoice: true });
        renderAudio();
      }),
    }, icon('download', 14), 'Importar Áudio');
    const recBtn = ui.recorderButton(async (file) => { audioFile = await saveFile(file, { asVoice: true }); renderAudio(); }, 'Gravar Áudio');
    recBtn.classList.add('primary');
    const renderAudio = () => {
      audioBox.replaceChildren(importAudio, recBtn);
      if (audioFile) audioBox.append(fileChip(audioFile, () => { audioFile = null; renderAudio(); }));
    };
    renderAudio();

    /* resposta rápida */
    const replyBtn = h('button', { class: 'zf-sed-select' });
    const renderReplyBtn = () => replyBtn.replaceChildren(
      reply ? icon(replyIcon(reply), 16) : null,
      h('span', { class: 'zf-grow zf-ellipsis' }, reply ? reply.title : replies.length ? 'Escolha uma resposta' : 'Nenhuma resposta rápida salva'),
      icon('chevronDown', 16));
    replyBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const search = h('input', { class: 'zf-input', placeholder: 'Pesquisar resposta rápida' });
      const list = h('div', { class: 'zf-sed-replies' });
      const fill = () => {
        const q = ZF.normKey(search.value);
        const items = replies.filter((r) => !q || ZF.normKey(ZF.replySearchText(r)).includes(q));
        list.replaceChildren(...(items.length ? items.map((r) => h('button', {
          class: r === reply ? 'active' : '',
          onclick: (ev) => { ev.stopPropagation(); reply = r; renderReplyBtn(); ui.closeMenu(); },
        }, icon(replyIcon(r), 16), h('span', { class: 'zf-ellipsis' }, r.title))) : [h('div', { class: 'zf-empty' }, 'Nenhuma resposta encontrada.')]));
      };
      search.addEventListener('input', fill);
      fill();
      ui.popover(replyBtn, h('div', {}, h('div', { class: 'zf-sed-search' }, icon('search', 15), search), list), { width: Math.max(300, replyBtn.offsetWidth) });
      setTimeout(() => search.focus(), 30);
    });
    renderReplyBtn();

    /* tipos */
    const kindsEl = h('div', { class: 'zf-sed-kinds' });
    const content = h('div');
    const renderKind = () => {
      kindsEl.replaceChildren(...KINDS.map(([k, label]) => h('button', {
        class: 'zf-sed-kind' + (k === kind ? ' active' : ''),
        onclick: (e) => { e.preventDefault(); kind = k; if (k === 'resposta' && !reply) reply = replies[0] || null; renderReplyBtn(); renderKind(); },
      }, label)));
      content.replaceChildren();
      if (kind === 'texto') content.append(msgLabel, msgBox);
      else if (kind === 'midia') content.append(h('div', { class: 'zf-sed-split media' }, mediaTile, h('div', { class: 'zf-grow' }, msgLabel, msgBox)));
      else if (kind === 'audio') {
        content.append(h('div', { class: 'zf-sed-split' },
          h('div', {}, h('div', { class: 'zf-sed-label' }, 'Gravar Áudio'), audioBox),
          h('div', { class: 'zf-grow' }, msgLabel, msgBox)));
      } else {
        content.append(h('div', { class: 'zf-sed-replycard' },
          h('div', { class: 'zf-sed-label' }, icon('zap', 14), 'Selecione uma resposta rápida'), replyBtn));
      }
    };
    renderKind();

    /* data, hora e recorrência */
    const startTs = editing ? sched.sendAt : (() => { const d = new Date(Date.now() + 3600000); d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0); return d.getTime(); })();
    const date = ui.input({ type: 'date', value: dateValue(startTs) });
    const time = ui.input({ type: 'time', value: timeValue(startTs) });
    const rep0 = (sched && sched.repeat) || 'none';
    let custom = rep0 === 'days';
    const recur = ui.select(RECUR.map(([value, label]) => ({ value, label })), custom ? 'none' : rep0);
    const everyDays = ui.input({ type: 'number', min: 1, max: 365, value: (sched && sched.everyDays) || 15, style: { width: '80px' } });
    const customBox = h('div', { class: 'zf-row zf-sed-every' }, 'Repetir a cada', everyDays, 'dias');
    const customToggle = h('button', { class: 'zf-sed-radio' });
    const renderCustom = () => {
      customToggle.replaceChildren(h('span', { class: 'zf-sed-dot' + (custom ? ' on' : '') }), 'Adicionar recorrência personalizada');
      customBox.style.display = custom ? '' : 'none';
      recur.disabled = custom;
    };
    customToggle.addEventListener('click', (e) => { e.preventDefault(); custom = !custom; renderCustom(); });
    renderCustom();

    const body = h('div', { class: 'zf-sed-body' },
      toEl,
      ui.field('Título (Opcional)', title),
      h('div', { class: 'zf-field' }, h('div', { class: 'zf-sed-label' }, 'Escolha um tipo'), kindsEl),
      h('div', { class: 'zf-field' }, content),
      h('div', { class: 'zf-grid2' }, ui.field('Data', date), ui.field('Hora', time)),
      ui.field('Recorrência', recur),
      customToggle, customBox);

    ui.modal({
      title: editing ? 'Editar Agendamento' : 'Criar Agendamento',
      body,
      global: true,
      className: 'zf-sed',
      actions: [
        { label: 'Cancelar' },
        {
          label: editing ? 'Salvar' : 'Criar', class: 'primary', onClick: async () => {
            if (!target) { ui.toast('Escolha para quem enviar', 'error'); pickTarget(); return false; }
            const txt = ta.value;
            let blocks;
            if (kind === 'texto') {
              if (!txt.trim()) { ui.toast('Escreva a mensagem', 'error'); ta.focus(); return false; }
              blocks = [{ type: 'text', text: txt }];
            } else if (kind === 'midia') {
              if (!mediaFile) { ui.toast('Importe a mídia', 'error'); return false; }
              blocks = [{ ...mediaFile, caption: txt }];
            } else if (kind === 'audio') {
              if (!audioFile) { ui.toast('Importe ou grave o áudio', 'error'); return false; }
              blocks = txt.trim() ? [{ type: 'text', text: txt }, { ...audioFile }] : [{ ...audioFile }];
            } else {
              if (!reply) { ui.toast('Escolha a resposta rápida', 'error'); return false; }
              blocks = ZF.actionsToBlocks(reply.actions || []);
              if (!blocks.length) { ui.toast('Essa resposta rápida não tem mensagem para enviar', 'error'); return false; }
            }
            let sendAt = date.value && time.value ? new Date(`${date.value}T${time.value}`).getTime() : NaN;
            if (!sendAt) { ui.toast('Informe a data e a hora', 'error'); return false; }
            if (sendAt < Date.now() - 60000) {
              const ok = await ui.confirm('Essa data/hora já passou. Deseja enviar agora?', { okLabel: 'Enviar agora', global: true });
              if (!ok) return false;
              sendAt = Date.now();
            }
            let vars = { ...((sched && sched.vars) || {}) };
            const missing = ZF.missingVars(blocks, vars);
            if (missing.length) {
              const extra = await ui.askVars(missing, 'Campos da mensagem', { global: true });
              if (!extra) return false;
              vars = { ...vars, ...extra };
            }
            const rep = custom ? 'days' : recur.value;
            const rec = {
              title: title.value.trim(), kind, replyId: kind === 'resposta' ? reply.id : null,
              target: { ...target }, blocks, vars, sendAt, repeat: rep,
              everyDays: rep === 'days' ? Math.max(1, Math.min(365, Number(everyDays.value) || 1)) : null,
              anchorDay: new Date(sendAt).getDate(),
              status: 'pending', lastError: null, updatedAt: Date.now(),
            };
            if (editing) await store.updateItem('schedules', sched.id, (s) => ({ ...s, ...rec }));
            else await store.update('schedules', (list) => { list.push({ id: ZF.uid(), createdAt: Date.now(), history: [], ...rec }); return list; });
            store.gcFiles();
            ui.toast(`Agendado para ${ZF.fmtDateTime(sendAt)}`, 'ok');
          },
        },
      ],
    });
  }
  ZF.openCreateSchedule = openCreateSchedule;

  /* ---------------- janela própria (botão "Mensagens agendadas" do menu) ---------------- */
  /*
   * Abre fora do painel, mostrando primeiro só o que está agendado para a conversa aberta
   * no WhatsApp; o botão "Exibir todos" passa a listar os agendamentos de todos os contatos.
   * Mensagem enviada (sem repetição) sai da lista e fica no "Relatório".
   */
  let winApi = null, winBody = null, winTitle = null;
  let winAll = false;
  let winView = 'list'; // 'list' | 'report'
  let log = [];
  const REPORT_SHOW = 30;
  store.onChange(['scheduleLog'], async () => {
    log = await store.get('scheduleLog');
    renderWindow();
  });

  const blockIcon = (blocks = []) => {
    const b = blocks.find((x) => x.type !== 'text') || blocks[0];
    if (!b || b.type === 'text') return 'fileText';
    if (b.type === 'vcard') return 'contactCard';
    const m = String(b.mime || '');
    if (m.startsWith('image/')) return 'image';
    if (m.startsWith('video/')) return 'film';
    if (m.startsWith('audio/')) return 'music';
    return 'file';
  };

  /** Próximos primeiro (do mais perto para o mais longe); depois falhas/perdidos, do mais recente */
  const sortForWindow = (list) => {
    const upcoming = (s) => ['pending', 'paused'].includes(s.status);
    return list.slice().sort((a, b) => {
      if (upcoming(a) !== upcoming(b)) return upcoming(a) ? -1 : 1;
      return upcoming(a) ? a.sendAt - b.sendAt : (b.lastRunAt || b.sendAt) - (a.lastRunAt || a.sendAt);
    });
  };

  /** Editar pela janela: editor novo quando o agendamento cabe nele */
  const editFromWindow = (s) => (kindOf(s) ? openCreateSchedule(s) : openScheduleEditor(s, {}, { global: true, noJump: true }));
  const act = (title, ic, fn, cls = '') => h('button', { class: 'zf-iconbtn ' + cls, title, onclick: ui.safe(() => fn()) }, icon(ic, 15));

  function windowRow(s) {
    const upcoming = ['pending', 'paused'].includes(s.status);
    const ts = upcoming ? s.sendAt : s.sentAt || s.lastRunAt || s.sendAt;
    return h('tr', { class: upcoming ? '' : 'past' },
      h('td', {},
        h('div', { class: 'zf-tcell' },
          icon(blockIcon(s.blocks), 14, 'zf-tico'),
          h('span', { class: 'zf-ellipsis', title: ZF.blocksPreview(s.blocks, 400) }, s.title || ZF.blocksPreview(s.blocks, 60) || '—'))),
      h('td', {}, h('div', { class: 'zf-tcell' },
        icon(s.target.chatId && !s.target.phone ? 'users' : 'user', 14, 'zf-tico'),
        h('span', { class: 'zf-ellipsis' }, targetLabel(s.target)))),
      h('td', { class: 'nowrap' }, ZF.fmtDate(ts)),
      h('td', { class: 'nowrap' }, ZF.fmtTime(ts)),
      h('td', { class: 'nowrap' }, ZF.repeatLabel(s) || 'Não repetir'),
      h('td', { title: s.lastError || '' }, ui.badge(s.status, STATUS[s.status] || s.status)),
      h('td', { class: 'acts' }, h('div', { class: 'zf-tacts' },
        act(s.status === 'failed' || s.status === 'missed' ? 'Tentar de novo' : 'Enviar agora', 'send', () => sendNow(s), 'accent'),
        upcoming ? act(s.status === 'paused' ? 'Retomar' : 'Pausar', s.status === 'paused' ? 'play' : 'pause', () => togglePause(s)) : null,
        act('Editar', 'edit', () => editFromWindow(s)),
        act('Excluir', 'trash', () => remove(s), 'danger'))));
  }

  /* relatório */
  const resend = async (e) => {
    if (!(await ui.confirm(`Enviar de novo para ${targetLabel(e.target)} agora?`, { okLabel: 'Enviar', global: true }))) return;
    await store.update('schedules', (list) => {
      list.push({
        id: ZF.uid(), createdAt: Date.now(), history: [], title: e.title || '', kind: e.kind || null,
        target: { ...e.target }, blocks: ZF.clone(e.blocks || []), vars: { ...(e.vars || {}) },
        sendAt: Date.now(), repeat: 'none', everyDays: null, anchorDay: new Date().getDate(),
        status: 'pending', lastError: null, updatedAt: Date.now(),
      });
      return list;
    });
    ui.toast('Envio iniciado…');
    ZF.runner.tick();
  };
  const removeLog = async (e) => {
    if (!(await ui.confirm('Apagar este envio do relatório?', { okLabel: 'Apagar', danger: true, global: true }))) return;
    await store.update('scheduleLog', (list) => list.filter((x) => x.id !== e.id));
    store.gcFiles();
  };
  function reportRow(e) {
    return h('tr', {},
      h('td', {}, h('div', { class: 'zf-tcell' },
        icon(blockIcon(e.blocks), 14, 'zf-tico'),
        h('span', { class: 'zf-ellipsis', title: ZF.blocksPreview(e.blocks, 400) }, e.title || 'Não definido'))),
      h('td', {}, h('div', { class: 'zf-tcell' },
        icon(e.target.chatId && !e.target.phone ? 'users' : 'user', 14, 'zf-tico'),
        h('span', { class: 'zf-ellipsis' }, targetLabel(e.target)))),
      h('td', { class: 'nowrap' }, typeLabel(e)),
      h('td', { class: 'nowrap' }, ZF.fmtDate(e.at)),
      h('td', { class: 'nowrap' }, ZF.fmtTime(e.at)),
      h('td', { class: 'nowrap' }, ZF.repeatLabel(e) || 'Não repetir'),
      h('td', { title: e.error || '' }, ui.badge(e.status, e.status === 'sent' ? 'Enviado' : 'Falhou')),
      h('td', { class: 'acts' }, h('div', { class: 'zf-tacts' },
        act('Editar e agendar de novo', 'edit', () => openCreateSchedule({ ...e, id: undefined }, { copy: true })),
        act('Apagar do relatório', 'trash', () => removeLog(e), 'danger'),
        act('Enviar de novo agora', 'send', () => resend(e), 'accent'))));
  }

  function renderWindow() {
    if (!winBody) return;
    const info = activeInfo();
    const scoped = !!info && !winAll;
    const inScope = (x) => !scoped || sameTarget(x.target, info);
    const list = sortForWindow(schedules.filter(inScope));
    const logList = log.filter(inScope);
    const others = winView === 'report' ? log.length - logList.length : schedules.length - list.length;
    const head = winView === 'report'
      ? ['Título', 'Cliente', 'Tipo', 'Data', 'Hora', 'Recorrência', 'Status', 'Ações']
      : ['Mensagem', 'Cliente', 'Data', 'Hora', 'Recorrência', 'Status', 'Ações'];
    if (winTitle) winTitle.textContent = winView === 'report' ? 'Relatório' : 'Mensagens agendadas';

    const scopeBtn = info ? h('button', {
      class: 'zf-btn sm', title: scoped ? 'Mostrar de todos os contatos' : 'Mostrar só os da conversa aberta',
      onclick: () => { winAll = !winAll; renderWindow(); },
    }, icon('eye', 13), scoped ? `Exibir todos${others ? ` (${others})` : ''}` : 'Só desta conversa') : null;
    const who = scoped ? targetLabel(info) : 'todos os contatos';

    winBody.replaceChildren();
    if (winView === 'report') {
      const shown = logList.slice(0, REPORT_SHOW);
      ZF.append(winBody,
        h('div', { class: 'zf-scope' },
          h('button', { class: 'zf-iconbtn', title: 'Voltar', onclick: () => { winView = 'list'; renderWindow(); } }, icon('back', 16)),
          h('span', { class: 'zf-grow zf-ellipsis' }, `Últimos ${REPORT_SHOW} envios — ${who}`),
          scopeBtn),
        shown.length
          ? h('div', { class: 'zf-tablewrap' }, h('table', { class: 'zf-table' },
            h('thead', {}, h('tr', {}, head.map((t) => h('th', { class: t === 'Ações' ? 'acts' : '' }, t)))),
            h('tbody', {}, shown.map(reportRow))))
          : h('div', { class: 'zf-empty' }, scoped ? 'Nenhum envio para esta conversa ainda.' : 'Nenhum envio registrado ainda.'),
        h('div', { style: { textAlign: 'center', marginTop: '10px' } },
          h('button', { class: 'zf-btn primary', onclick: () => { winView = 'list'; renderWindow(); } }, 'Voltar')));
      return;
    }
    ZF.append(winBody,
      h('div', { class: 'zf-scope' },
        icon(scoped ? (info.isGroup ? 'users' : 'user') : 'inbox', 15),
        h('span', { class: 'zf-grow zf-ellipsis' }, `Agendamentos de ${who}`),
        h('button', {
          class: 'zf-btn sm zf-reportbtn', title: 'Histórico das mensagens enviadas',
          onclick: () => { winView = 'report'; renderWindow(); },
        }, icon('clipboardEdit', 13), 'Relatório', h('span', { class: 'zf-count' }, String(logList.length))),
        scopeBtn),
      list.length
        ? h('div', { class: 'zf-tablewrap' }, h('table', { class: 'zf-table' },
          h('thead', {}, h('tr', {}, head.map((t) => h('th', { class: t === 'Ações' ? 'acts' : '' }, t)))),
          h('tbody', {}, list.slice(0, 200).map(windowRow))))
        : h('div', { class: 'zf-empty zf-sched-empty' },
          icon('calendarClock', 30),
          h('b', {}, 'Nenhum agendamento encontrado'),
          h('span', {}, 'Não há agendamentos programados no momento. Para adicionar um novo agendamento, clique no botão de criação.'),
          h('button', { class: 'zf-btn primary', onclick: ui.safe(() => addFromWindow()) }, icon('plus', 15), 'Adicionar')),
      list.length > 200 ? h('div', { class: 'zf-hint' }, `Mostrando 200 de ${list.length}.`) : null);
  }

  const addFromWindow = () => openCreateSchedule(null, { target: !winAll ? targetOf(activeInfo()) : null });

  /** Janela de agendamentos, fora do painel (botão do menu flutuante). view: 'list' | 'report' */
  function openSchedulesWindow(view = 'list') {
    winView = view === 'report' ? 'report' : 'list';
    if (winApi) { renderWindow(); return; }
    winAll = false;
    winBody = h('div');
    winTitle = h('span', {}, 'Mensagens agendadas');
    renderWindow();
    winApi = ui.modal({
      title: winTitle,
      body: winBody,
      global: true,
      wide: true,
      onClose: () => { winApi = null; winBody = null; winTitle = null; ZF.activeChatWatchers.delete('schedwin'); },
      actions: [
        { label: 'Fechar' },
        { label: 'Adicionar', class: 'primary', icon: 'plus', close: false, onClick: () => addFromWindow() },
      ],
    });
    // com o painel fechado ninguém acompanha a conversa aberta: enquanto a janela existir, acompanha
    ZF.activeChatWatchers.add('schedwin');
    if (ZF.checkActiveChat) Promise.resolve(ZF.checkActiveChat(true)).then(renderWindow).catch(() => {});
    store.getMany(['schedules', 'scheduleLog']).then((d) => { schedules = d.schedules; log = d.scheduleLog; renderWindow(); });
  }
  ZF.openSchedulesWindow = openSchedulesWindow;

  ui.registerTab('schedules', { icon: 'calendarClock', title: 'Mensagens agendadas', render });
})();
