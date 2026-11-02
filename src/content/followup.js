/*
 * ZapFlow — Follow-up: sequência de mensagens com datas fixas (X dias/semanas/meses depois da etapa anterior).
 * Cada etapa vira um agendamento comum (runner.js envia); o runner pausa a sequência se o contato responder (opcional).
 * Pré-definições ficam numa área própria ("followupPresets"), com categorias como as das respostas rápidas.
 */
(() => {
  'use strict';
  const ZF = window.ZF;
  const { h, icon, store, ui } = ZF;

  const UNITS = [['days', 'dias'], ['weeks', 'semanas'], ['months', 'meses']];
  const CHIPS = [7, 10, 14, 30];
  const COLORS = ['gray', 'peach', 'blue', 'green', 'yellow', 'pink', 'purple', 'teal'];
  const STATUS = { active: 'Ativo', paused: 'Pausado', done: 'Concluído', canceled: 'Cancelado' };
  const { pad2: pad, dateValue, targetOf } = ZF;
  const dateLabel = (ts) => new Date(ts).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
  const unitLabel = (u, n) => ({ days: n === 1 ? 'dia' : 'dias', weeks: n === 1 ? 'semana' : 'semanas', months: n === 1 ? 'mês' : 'meses' }[u] || 'dias');
  const targetKey = (t) => t.phone || t.chatId;
  const targetLabel = (t) => t.name || ZF.fmtPhone(t.phone) || 'Conversa';
  const newStep = (over = {}) => ({ id: ZF.uid(), amount: 7, unit: 'days', time: '', actions: [], ...over });
  /** Resumo "7, 10 e 14 dias" dos intervalos de uma sequência */
  const gaps = (steps) => steps.slice(1).map((s) => `${s.amount} ${unitLabel(s.unit, s.amount)}`).join(', ') || 'uma etapa';
  /** Ações de uma etapa (pré-definições antigas guardavam só texto/blocos) */
  const stepActions = (s) => s.actions || (s.blocks && s.blocks.length ? ZF.blocksToActions(s.blocks) : s.text ? [{ id: ZF.uid(), type: 'text', text: s.text }] : []);
  const DEFAULT_BUTTON = { id: 'pause', label: 'Pausar Lista VIP', keyword: 'PAUSAR' };
  /** O WhatsApp pessoal não envia botões de verdade: eles vão como linhas no fim da mensagem ("Responda PAUSAR…") */
  const buttonsText = (btns) => `Responda com uma opção:\n${btns.map((b) => `▫️ *${b.keyword}* → ${b.label}`).join('\n')}`;
  /** Acrescenta o texto dos botões no fim da etapa: junto do último texto ou como mensagem própria */
  const withNotice = (actions, notice) => {
    const list = ZF.clone(actions);
    const last = list[list.length - 1];
    if (last && last.type === 'text') last.text = `${last.text || ''}\n\n${notice}`;
    else list.push({ id: ZF.uid(), type: 'text', text: notice });
    return list;
  };
  const isMsg = (a) => !!(ZF.ACTION_TYPES[a.type] && ZF.ACTION_TYPES[a.type].msg);

  let opening = false;
  ZF.openFollowup = async (opts = {}) => {
    if (opening || ui.wrap.querySelector('.zf-fu-win')) return; // o 2º clique chega antes da janela existir
    opening = true;
    setTimeout(() => { opening = false; }, 1500);
    const tomorrow = new Date(Date.now() + 86400000);
    const form = {
      targets: opts.targets || [],
      start: dateValue(tomorrow), time: '09:00', buttonsOn: false, buttons: [],
      steps: [newStep({ amount: 0 }), newStep({ amount: 10 })],
    };
    if (!form.targets.length) {
      const t = targetOf((ZF.activeChat && ZF.activeChat.info) || await ZF.wa.activeChatInfo().catch(() => null));
      if (t) form.targets.push(t);
    }
    let view = opts.view || 'new';
    const body = h('div', { class: 'zf-fu-win zf-actcard' });

    /* editores de ações: um por etapa, guardados pelo id para não se perderem ao redesenhar/trocar de aba */
    const editors = {};
    const ed = (s) => editors[s.id] || (editors[s.id] = ui.actionsEditor(stepActions(s), { title: 'Mensagem e ações desta etapa' }));
    const sync = () => form.steps.forEach((s) => { s.actions = ed(s).get(); });

    /* ---------- cálculo das datas ---------- */
    const dates = () => ZF.followupDates(new Date(form.start + 'T00:00').getTime(), form.steps, form.time);

    /* ---------- aba: programar ---------- */
    const renderNew = () => {
      const stepsEl = h('div');
      const labels = [];
      // só a 1ª etapa pode ter intervalo 0; ao mover/duplicar, as outras voltam a ter pelo menos 1
      const fixGaps = () => form.steps.forEach((s, i) => { if (i > 0 && !(Number(s.amount) >= 1)) { s.amount = 7; s.unit = 'days'; } });
      const refreshDates = () => {
        const ds = dates();
        labels.forEach((el, i) => { el.textContent = Number.isFinite(ds[i]) ? `${dateLabel(ds[i])} às ${pad(new Date(ds[i]).getHours())}:${pad(new Date(ds[i]).getMinutes())}` : ''; });
      };
      const move = (i, d) => { const j = i + d; if (j < 0 || j >= form.steps.length) return; [form.steps[i], form.steps[j]] = [form.steps[j], form.steps[i]]; paintSteps(); };

      const paintSteps = () => {
        fixGaps();
        labels.length = 0;
        stepsEl.replaceChildren(...form.steps.map((s, i) => {
          const lab = h('span', { class: 'zf-muted zf-small zf-fu-when' });
          labels.push(lab);
          const amount = h('input', { class: 'zf-input zf-pace-n', type: 'number', min: 1, max: 999, value: s.amount });
          const unit = ui.select(UNITS.map(([value, label]) => ({ value, label })), s.unit);
          amount.addEventListener('input', () => { s.amount = Math.max(1, Math.min(999, Number(amount.value) || 1)); refreshDates(); });
          unit.addEventListener('change', () => { s.unit = unit.value; refreshDates(); });
          const chips = CHIPS.map((n) => h('button', {
            class: 'zf-chip', onclick: (e) => { e.preventDefault(); s.amount = n; s.unit = 'days'; amount.value = n; unit.value = 'days'; refreshDates(); },
          }, `${n} dias`));
          const time = h('input', { class: 'zf-input zf-fu-time', type: 'time', value: s.time || '' });
          time.addEventListener('input', () => { s.time = time.value; refreshDates(); });
          const quick = h('button', {
            class: 'zf-btn sm', onclick: ui.safe(async (e) => {
              e.preventDefault();
              const r = await ui.pickReply({ title: 'Inserir resposta rápida nesta etapa', global: true });
              if (r) ed(s).append(r.actions);
            }),
          }, icon('zap', 14), 'Inserir resposta rápida');
          return h('div', { class: 'zf-act open' },
            h('div', { class: 'zf-act-h' },
              icon('calendarClock', 17, 'zf-act-icon'),
              h('div', { class: 'zf-grow', style: { minWidth: 0 } }, h('div', { class: 'zf-act-label' }, `Etapa ${i + 1}`), lab),
              h('button', { class: 'zf-iconbtn', title: 'Subir', disabled: i === 0, onclick: (e) => { e.stopPropagation(); move(i, -1); } }, icon('arrowUp', 14)),
              h('button', { class: 'zf-iconbtn', title: 'Descer', disabled: i === form.steps.length - 1, onclick: (e) => { e.stopPropagation(); move(i, 1); } }, icon('arrowDown', 14)),
              h('button', { class: 'zf-iconbtn', title: 'Duplicar', onclick: (e) => { e.stopPropagation(); s.actions = ed(s).get(); form.steps.splice(i + 1, 0, { ...ZF.clone(s), id: ZF.uid() }); paintSteps(); } }, icon('copy', 14)),
              h('button', { class: 'zf-iconbtn danger', title: 'Remover esta etapa', disabled: form.steps.length < 2, onclick: (e) => { e.stopPropagation(); form.steps.splice(i, 1); paintSteps(); } }, icon('trash', 14))),
            h('div', { class: 'zf-act-b' },
              i > 0 ? h('div', { class: 'zf-fu-gap' },
                h('div', { class: 'zf-pace' }, h('span', {}, 'Enviar'), amount, unit, h('span', {}, 'depois da etapa anterior')),
                h('div', { class: 'zf-fu-chips' }, ...chips)) : h('div', { class: 'zf-hint' }, 'Primeira mensagem: sai na data de início, no horário padrão.'),
              h('div', { class: 'zf-pace' }, h('span', {}, 'Horário desta etapa'), time, h('span', { class: 'zf-muted' }, time.value ? '' : `(padrão ${form.time})`)),
              h('div', { class: 'zf-fu-quick' }, quick), ed(s).el));
        }));
        refreshDates();
      };

      const start = h('input', { class: 'zf-input', type: 'date', value: form.start });
      const defTime = h('input', { class: 'zf-input zf-fu-time', type: 'time', value: form.time });
      start.addEventListener('input', () => { form.start = start.value; refreshDates(); });
      defTime.addEventListener('input', () => { form.time = defTime.value || '09:00'; refreshDates(); });

      const toEl = h('div', { class: 'zf-fu-to' });
      const paintTo = () => toEl.replaceChildren(
        icon('user', 15),
        ...(form.targets.length
          ? form.targets.map((t, i) => h('span', { class: 'zf-badge' }, targetLabel(t), h('button', { class: 'zf-iconbtn', title: 'Remover', onclick: (e) => { e.preventDefault(); form.targets.splice(i, 1); paintTo(); } }, icon('x', 11))))
          : [h('span', { class: 'zf-muted' }, 'Escolha para quem enviar')]),
        h('button', {
          class: 'zf-btn sm', onclick: ui.safe(async (e) => {
            e.preventDefault();
            const r = await ui.pickChats({ title: 'Escolher contatos do follow-up', global: true });
            (r || []).map(targetOf).filter(Boolean).forEach((t) => { if (!form.targets.some((x) => targetKey(x) === targetKey(t))) form.targets.push(t); });
            paintTo();
          }),
        }, icon('plus', 13), form.targets.length ? 'Adicionar contatos' : 'Escolher contatos'));
      paintTo();

      /* botões de resposta no fim da mensagem (marcar/desmarcar) */
      const btnArea = h('div', { class: 'zf-fu-btnarea', style: { display: form.buttonsOn ? '' : 'none' } });
      const paintButtons = () => {
        btnArea.style.display = form.buttonsOn ? '' : 'none';
        btnArea.replaceChildren(
          h('div', { class: 'zf-fu-chips' },
            ...form.buttons.map((b, i) => h('span', { class: 'zf-badge' }, `${b.label} (${b.keyword})`, h('button', { class: 'zf-iconbtn', title: 'Tirar este botão', onclick: (e) => { e.preventDefault(); form.buttons.splice(i, 1); paintButtons(); } }, icon('x', 11)))),
            h('button', { class: 'zf-btn sm', onclick: ui.safe(addButtonMenu) }, icon('plus', 13), 'Adicionar botão')),
          form.buttons.length ? h('pre', { class: 'zf-fu-prev' }, buttonsText(form.buttons)) : h('div', { class: 'zf-hint' }, 'Escolha pelo menos um botão.'));
      };
      const addButtonMenu = async (e) => {
        const anchor = e.currentTarget;
        const saved = await store.get('followupButtons');
        const list = saved.length ? saved : [DEFAULT_BUTTON];
        const items = list.filter((b) => !form.buttons.some((x) => x.keyword === b.keyword)).map((b) => ({ label: `${b.label} (${b.keyword})`, icon: 'plus', onClick: () => { form.buttons.push({ label: b.label, keyword: b.keyword }); paintButtons(); } }));
        ui.menu(anchor, [
          ...(items.length ? [{ title: 'Botões salvos' }, ...items, '-'] : []),
          { label: 'Novo botão…', icon: 'plus', onClick: () => setTimeout(newButton, 0) },
          { label: 'Gerenciar botões salvos…', icon: 'edit', onClick: () => setTimeout(manageButtons, 0) },
        ], { align: 'left' });
      };
      const newButton = () => {
        const label = ui.input({ placeholder: 'Texto do botão (ex.: Agendar Consulta)' });
        const keyword = ui.input({ placeholder: 'Palavra que o contato responde (ex.: AGENDAR)' });
        ui.modal({
          title: 'Novo botão', global: true,
          body: h('div', {}, ui.field('Texto do botão', label), ui.field('Palavra de resposta', keyword, 'Uma palavra só. Quando o contato escrever ela, o follow-up pausa e você é avisado.')),
          actions: [{ label: 'Cancelar' }, {
            label: 'Salvar e usar', class: 'primary', onClick: async () => {
              const l = label.value.trim();
              const k = ZF.normKey(keyword.value).replace(/[^a-z0-9]/g, '').toUpperCase();
              if (!l || !k) { ui.toast('Preencha o texto e uma palavra (só letras e números)', 'error'); return false; }
              await store.update('followupButtons', (list) => (list.some((b) => b.keyword === k) ? list : [...list, { id: ZF.uid(), label: l, keyword: k }]));
              if (!form.buttons.some((b) => b.keyword === k)) form.buttons.push({ label: l, keyword: k });
              paintButtons();
            },
          }],
        });
      };
      const manageButtons = async () => {
        const saved = await store.get('followupButtons');
        const list = h('div', { class: 'zf-fu-list' });
        const paint = (items) => list.replaceChildren(...items.map((b) => h('div', { class: 'zf-item zf-fu-row' },
          h('div', { class: 'zf-grow' }, h('div', { class: 'zf-title' }, b.label), h('div', { class: 'zf-muted zf-small' }, `Palavra: ${b.keyword}`)),
          b.id === DEFAULT_BUTTON.id ? h('span', { class: 'zf-muted zf-small' }, 'padrão') : h('button', { class: 'zf-iconbtn danger', title: 'Excluir', onclick: ui.safe(async () => { const next = await store.update('followupButtons', (l) => l.filter((x) => x.id !== b.id)); paint(next); }) }, icon('trash', 14)))));
        paint(saved.length ? saved : [DEFAULT_BUTTON]);
        ui.modal({ title: 'Botões salvos', global: true, body: list });
      };
      const buttonsCb = ui.checkbox('Incluir botões de resposta no fim da mensagem', form.buttonsOn, ui.safe(async (v) => {
        form.buttonsOn = v;
        if (v && !form.buttons.length) {
          const saved = await store.get('followupButtons');
          const d = saved.find((b) => b.id === DEFAULT_BUTTON.id) || DEFAULT_BUTTON;
          form.buttons = [{ label: d.label, keyword: d.keyword }];
        }
        paintButtons();
        if (!v) return;
        const r = await ZF.wa.bridge('getMessages', { limit: 1 }, 8000).catch(() => null);
        if (!r || !r.ok) ui.toast('Não consigo ler as respostas neste WhatsApp: os botões vão na mensagem, mas o follow-up NÃO vai pausar sozinho. Pare manualmente em "Em andamento".', 'error', 8000);
      }));
      paintButtons();
      const applyBtn = h('button', {
        class: 'zf-btn', onclick: ui.safe(async (e) => {
          const { followupPresets: ps, followupCats: cs } = await store.getMany(['followupPresets', 'followupCats']);
          if (!ps.length) { ui.toast('Nenhuma pré-definição salva ainda', 'info'); return; }
          const items = [];
          [...cs, { id: null, name: 'Sem categoria' }].forEach((c) => {
            const list = ps.filter((p) => (p.categoryId || null) === c.id || (c.id === null && !cs.some((x) => x.id === p.categoryId)));
            if (!list.length) return;
            items.push({ title: c.name });
            list.forEach((p) => items.push({ label: `${p.name} — ${p.steps.length} etapas (${gaps(p.steps)})`, icon: 'repeat', onClick: () => setTimeout(() => applyPreset(p), 0) }));
          });
          ui.menu(e.currentTarget, items, { align: 'left' });
        }),
      }, icon('repeat', 14), 'Aplicar pré-definição');
      const saveBtn = h('button', { class: 'zf-btn', onclick: ui.safe(() => { sync(); return savePreset(form.steps, { buttons: form.buttonsOn ? form.buttons : [] }); }) }, icon('check', 14), 'Salvar como pré-definição');

      const fab = h('button', { class: 'zf-fu-send', title: 'Programar follow-up', onclick: ui.safe(create) }, icon('send', 18), 'Programar follow-up');

      body.replaceChildren(
        h('div', { class: 'zf-fu-top' }, toEl),
        h('div', { class: 'zf-fu-grid' },
          ui.field('Data da 1ª mensagem', start), ui.field('Horário padrão', defTime)),
        h('div', { class: 'zf-fu-bar' }, applyBtn, saveBtn),
        stepsEl,
        h('button', { class: 'zf-fu-addstep', onclick: (e) => { e.preventDefault(); form.steps.push(newStep({ amount: 7 })); paintSteps(); } }, icon('plus', 16), 'Adicionar nova etapa do follow-up'),
        h('div', { class: 'zf-fu-pause' }, buttonsCb,
          h('div', { class: 'zf-hint' }, 'Os botões entram no fim de cada mensagem do follow-up. Se o contato responder a palavra de um botão, o follow-up pausa e você é avisado. (O WhatsApp pessoal não envia botões de verdade: eles vão como texto.)'), btnArea),
        h('div', { class: 'zf-fu-foot' }, fab));
      paintSteps();
    };

    function applyPreset(p) {
      form.steps = p.steps.map((s) => ({ amount: s.amount, unit: s.unit, time: s.time || '', id: ZF.uid(), actions: ZF.clone(stepActions(s)) }));
      form.buttons = ZF.clone(p.buttons || []);
      form.buttonsOn = form.buttons.length > 0;
      view = 'new';
      render();
      ui.toast(`Pré-definição "${p.name}" aplicada`, 'ok', 2200);
    }

    async function askPreset(initial = {}) {
      return new Promise(async (resolve) => {
        const cats = await store.get('followupCats');
        const name = ui.input({ value: initial.name || '', placeholder: 'Nome da pré-definição (ex.: Lead novo — 4 etapas)' });
        const sel = ui.select([{ value: '', label: 'Sem categoria' }, ...cats.map((c) => ({ value: c.id, label: c.name })), { value: '__new', label: '+ Nova categoria…' }], initial.categoryId || '');
        const newCat = ui.input({ placeholder: 'Nome da nova categoria', style: { display: 'none', marginTop: '6px' } });
        sel.addEventListener('change', () => { newCat.style.display = sel.value === '__new' ? '' : 'none'; });
        let answered = false;
        ui.modal({
          title: initial.title || 'Salvar pré-definição', global: true,
          body: h('div', {}, ui.field('Nome', name), ui.field('Categoria', h('div', {}, sel, newCat))),
          onClose: () => { if (!answered) resolve(null); },
          actions: [{ label: 'Cancelar' }, {
            label: 'Salvar', class: 'primary', onClick: async () => {
              const n = name.value.trim();
              if (!n) { ui.toast('Dê um nome', 'error'); return false; }
              let categoryId = sel.value || null;
              if (categoryId === '__new') {
                const cn = newCat.value.trim();
                if (!cn) { ui.toast('Dê um nome à categoria', 'error'); return false; }
                categoryId = ZF.uid();
                await store.update('followupCats', (l) => { l.push({ id: categoryId, name: cn, color: COLORS[l.length % COLORS.length], order: l.length + 1, collapsed: false }); return l; });
              }
              answered = true;
              resolve({ name: n, categoryId });
            },
          }],
        });
      });
    }

    async function savePreset(steps, opts) {
      if (!steps.some((s) => (s.actions || []).length)) throw ZF.userError('Monte pelo menos uma ação antes de salvar.');
      const info = await askPreset();
      if (!info) return;
      await store.update('followupPresets', (l) => {
        l.push({ id: ZF.uid(), ...info, steps: ZF.clone(steps).map((s) => ({ amount: s.amount, unit: s.unit, time: s.time || '', actions: s.actions })), buttons: ZF.clone(opts.buttons || []), order: l.length + 1, createdAt: Date.now() });
        return l;
      });
      ui.toast(`Pré-definição "${info.name}" salva`, 'ok');
    }

    /* ---------- criar os agendamentos ---------- */
    async function create() {
      if (!form.targets.length) throw ZF.userError('Escolha para quem enviar o follow-up.');
      const start = new Date(form.start + 'T00:00').getTime();
      if (!Number.isFinite(start)) throw ZF.userError('Escolha a data da 1ª mensagem.');
      const ds = dates();
      if (ds[0] <= Date.now()) throw ZF.userError('A 1ª mensagem precisa estar no futuro: escolha outro dia ou horário.');
      sync();
      for (let i = 0; i < form.steps.length; i++) {
        if (!form.steps[i].actions.length) throw ZF.userError(`A etapa ${i + 1} está sem ações.`);
        const err = ed(form.steps[i]).validate();
        if (err) throw ZF.userError(`Etapa ${i + 1}: ${err}`);
      }
      if (form.buttonsOn && !form.buttons.length) throw ZF.userError('Escolha pelo menos um botão ou desmarque a opção.');
      const notice = form.buttonsOn ? buttonsText(form.buttons) : '';
      const steps = form.steps.map((s, i) => {
        const actions = notice ? withNotice(s.actions, notice) : s.actions;
        return { ...ZF.clone(s), actions, amount: i > 0 ? Math.max(1, Number(s.amount) || 1) : 0, blocks: ZF.actionsToBlocks(actions.filter(isMsg)) };
      });
      let vars = {};
      const missing = [...new Set(steps.flatMap((s) => ZF.findVarsInActions(s.actions)))].filter((v) => !ZF.BUILTIN_VARS.includes(v));
      if (missing.length) {
        const extra = await ui.askVars(missing, 'Campos das mensagens', { global: true });
        if (!extra) return;
        vars = extra;
      }
      const now = Date.now();
      const fus = [];
      const scheds = [];
      form.targets.forEach((t) => {
        const id = ZF.uid();
        fus.push({
          id, createdAt: now, target: { ...t }, status: 'active', buttons: form.buttonsOn ? ZF.clone(form.buttons) : [], defaultTime: form.time,
          startAt: ds[0], dates: ds, sentSteps: 0, lastSentAt: null, steps: steps.map((s) => ({ amount: s.amount, unit: s.unit, time: s.time, actions: s.actions })),
        });
        steps.forEach((s, i) => scheds.push({
          id: ZF.uid(), createdAt: now, history: [], title: `Follow-up · etapa ${i + 1}/${steps.length}`, kind: null,
          followupId: id, step: i, stepCount: steps.length,
          target: { ...t }, blocks: s.blocks, actions: s.actions, vars: { ...vars }, sendAt: ds[i], repeat: 'none', everyDays: null,
          anchorDay: new Date(ds[i]).getDate(), status: 'pending', lastError: null, updatedAt: now,
        }));
      });
      await store.update('followups', (l) => [...fus, ...l]);
      await store.update('schedules', (l) => { l.push(...scheds); return l; });
      ZF.runner.tick();
      ui.toast(`Follow-up programado: ${steps.length} etapas para ${form.targets.length} contato(s)`, 'ok', 4000);
      view = 'running';
      render();
    }

    /* ---------- aba: em andamento ---------- */
    async function renderRunning() {
      const list = await store.get('followups');
      const setSched = (id, from, to) => store.update('schedules', (l) => l.map((x) => (x.followupId === id && x.status === from ? { ...x, status: to } : x)));
      const rows = list.map((f) => {
        const total = f.steps.length;
        const nextI = Math.min(f.processed || 0, total - 1);
        const next = f.status === 'active' || f.status === 'paused' ? f.dates[nextI] : null;
        return h('div', { class: 'zf-item zf-fu-row' },
          icon('user', 15),
          h('div', { class: 'zf-grow', style: { minWidth: 0 } },
            h('div', { class: 'zf-title' }, targetLabel(f.target)),
            h('div', { class: 'zf-muted zf-small' }, `${f.sentSteps || 0}/${total} enviadas`, f.failedSteps ? ` (${f.failedSteps} com falha)` : '', next ? ` • próxima: ${dateLabel(next)} ${pad(new Date(next).getHours())}:${pad(new Date(next).getMinutes())}` : '', f.pauseReason && f.status === 'paused' ? ` • ${f.pauseReason}` : '')),
          h('span', { class: 'zf-badge ' + (f.status === 'active' ? 'pending' : f.status === 'done' ? 'ok' : '') }, STATUS[f.status] || f.status),
          f.status === 'active' ? h('button', { class: 'zf-btn sm', onclick: ui.safe(async () => { await store.updateItem('followups', f.id, (x) => ({ ...x, status: 'paused', pauseReason: 'Pausado por você' })); await setSched(f.id, 'pending', 'paused'); render(); }) }, 'Pausar') : null,
          f.status === 'paused' ? h('button', { class: 'zf-btn sm primary', onclick: ui.safe(async () => { await store.updateItem('followups', f.id, (x) => ({ ...x, status: 'active', pauseReason: null, lastSentAt: Date.now() })); await setSched(f.id, 'paused', 'pending'); ZF.runner.tick(); render(); }) }, 'Retomar') : null,
          f.status === 'active' || f.status === 'paused'
            ? h('button', { class: 'zf-btn sm', onclick: ui.safe(async () => {
              if (!(await ui.confirm(`Cancelar o follow-up de ${targetLabel(f.target)}? As etapas pendentes não serão enviadas.`, { okLabel: 'Cancelar follow-up', danger: true, global: true }))) return;
              await store.updateItem('followups', f.id, (x) => ({ ...x, status: 'canceled' }));
              await store.update('schedules', (l) => l.filter((x) => x.followupId !== f.id || x.status === 'sent'));
              render();
            }) }, 'Cancelar')
            : h('button', { class: 'zf-iconbtn danger', title: 'Remover da lista', onclick: ui.safe(async () => { await store.update('followups', (l) => l.filter((x) => x.id !== f.id)); store.gcFiles(); render(); }) }, icon('trash', 14)));
      });
      body.replaceChildren(rows.length ? h('div', { class: 'zf-fu-list' }, ...rows) : h('div', { class: 'zf-empty' }, 'Nenhum follow-up programado ainda.'));
    }

    /* ---------- aba: pré-definições ---------- */
    async function renderPresets() {
      const { followupPresets: ps, followupCats: cs } = await store.getMany(['followupPresets', 'followupCats']);
      if (!ps.length) { body.replaceChildren(h('div', { class: 'zf-empty' }, 'Nenhuma pré-definição ainda. Monte uma sequência em "Programar" e use "Salvar como pré-definição".')); return; }
      const block = (cat, list) => (list.length ? h('div', { class: 'zf-cat', 'data-color': cat ? cat.color || 'gray' : 'none' },
        h('div', { class: 'zf-cat-h' }, icon('shapes', 16, 'zf-cat-ico'), h('span', { class: 'zf-cat-name' }, cat ? cat.name : 'Sem categoria'),
          cat ? h('button', {
            class: 'zf-iconbtn', title: 'Categoria', onclick: (e) => ui.menu(e.currentTarget, [
              { label: 'Renomear categoria', icon: 'edit', onClick: async () => {
                const r = await askName('Renomear categoria', cat.name);
                if (r) { await store.updateItem('followupCats', cat.id, (c) => ({ ...c, name: r })); render(); }
              } },
              { label: 'Excluir categoria', icon: 'trash', danger: true, onClick: async () => {
                if (!(await ui.confirm(`Excluir a categoria "${cat.name}"? As pré-definições ficam em "Sem categoria".`, { okLabel: 'Excluir', danger: true, global: true }))) return;
                await store.update('followupCats', (l) => l.filter((c) => c.id !== cat.id)); render();
              } },
            ]),
          }, icon('more', 16)) : null),
        h('div', { class: 'zf-cat-b' }, list.map((p) => h('div', { class: 'zf-item zf-fu-row' },
          icon('repeat', 15),
          h('div', { class: 'zf-grow', style: { minWidth: 0 } }, h('div', { class: 'zf-title' }, p.name), h('div', { class: 'zf-muted zf-small' }, `${p.steps.length} etapas • ${gaps(p.steps)}`)),
          h('button', { class: 'zf-btn sm primary', onclick: () => applyPreset(p) }, 'Aplicar'),
          h('button', { class: 'zf-iconbtn', title: 'Renomear', onclick: ui.safe(async () => {
            const r = await askName('Renomear pré-definição', p.name);
            if (r) { await store.updateItem('followupPresets', p.id, (x) => ({ ...x, name: r })); render(); }
          }) }, icon('edit', 14)),
          h('button', { class: 'zf-iconbtn danger', title: 'Excluir', onclick: ui.safe(async () => {
            if (!(await ui.confirm(`Excluir a pré-definição "${p.name}"?`, { okLabel: 'Excluir', danger: true, global: true }))) return;
            await store.update('followupPresets', (l) => l.filter((x) => x.id !== p.id)); store.gcFiles(); render();
          }) }, icon('trash', 14)))))) : null);
      body.replaceChildren(...[
        ...[...cs].sort((a, b) => (a.order || 0) - (b.order || 0)).map((c) => block(c, ps.filter((p) => p.categoryId === c.id))),
        block(null, ps.filter((p) => !cs.some((c) => c.id === p.categoryId))),
      ].filter(Boolean));
    }
    const askName = (title, value) => new Promise((resolve) => {
      const input = ui.input({ value });
      let answered = false;
      ui.modal({ title, global: true, body: input, onClose: () => { if (!answered) resolve(null); }, actions: [{ label: 'Cancelar' }, { label: 'Salvar', class: 'primary', onClick: () => { const v = input.value.trim(); if (!v) return false; answered = true; resolve(v); } }] });
    });

    /* ---------- janela ---------- */
    const tabs = h('div', { class: 'zf-fu-tabs' });
    function render() {
      tabs.replaceChildren(...[['new', 'Programar'], ['running', 'Em andamento'], ['presets', 'Pré-definições']].map(([k, label]) => h('button', {
        class: 'zf-chip' + (view === k ? ' active' : ''), onclick: () => { view = k; render(); },
      }, label)));
      if (view === 'new') renderNew();
      else ui.safe(view === 'running' ? renderRunning : renderPresets)();
    }
    ui.modal({
      title: h('span', { class: 'zf-row' }, icon('repeat', 18), 'Follow-up'),
      global: true, wide: true,
      body: h('div', {}, tabs, body),
    });
    render();
  };
})();
