/* ZapFlow — aba "Respostas rápidas": respostas com ações, scripts (sequências) e categorias */
(() => {
  'use strict';
  const ZF = window.ZF;
  const { h, icon, store, ui } = ZF;

  const COLORS = [
    { key: 'gray', hex: '#d9dce0' }, { key: 'peach', hex: '#f6d3bd' }, { key: 'blue', hex: '#c4d4fa' },
    { key: 'green', hex: '#bfe6cd' }, { key: 'yellow', hex: '#f5e39c' }, { key: 'pink', hex: '#f6c4d8' },
    { key: 'purple', hex: '#d9c8f7' }, { key: 'teal', hex: '#b5e3df' }, { key: 'none', hex: 'transparent' },
  ];

  const state = { q: '', filter: 'all', type: null, catId: null, expanded: new Set(), view: { name: 'list' } };
  let data = { replies: [], categories: [] };
  let loaded = false;
  let listEl = null, chipsEl = null;

  const load = async () => {
    const d = await store.getMany(['replies', 'categories']);
    data = { replies: d.replies.map(ZF.migrateReply), categories: d.categories.sort((a, b) => (a.order || 0) - (b.order || 0)) };
    loaded = true;
  };
  store.onChange(['replies', 'categories'], async () => {
    await load();
    if (ui.current === 'replies' && state.view.name === 'list' && listEl && listEl.isConnected) {
      renderChips();
      renderList();
    }
  });

  const catById = (id) => data.categories.find((c) => c.id === id) || null;
  const replyById = (id) => data.replies.find((r) => r.id === id) || null;
  const sortReplies = (arr) => arr.slice().sort((a, b) => (a.order || 0) - (b.order || 0) || a.title.localeCompare(b.title));
  const typeIcon = (r) => ZF.TYPE_ICONS[ZF.replyType(r)] || 'fileText';
  const scriptSteps = (s) => (s.steps || []).map((st) => replyById(st.replyId)).filter(Boolean);

  /* ---------------- usar uma resposta ---------------- */
  /** Conversa aberta + variáveis (pergunta os campos personalizados). null = cancelado */
  async function prepare(actionsList) {
    if (!ZF.wa.getCompose()) throw new Error('Abra uma conversa no WhatsApp primeiro.');
    const info = await ZF.wa.activeChatInfo();
    const vars = ZF.builtinVars({ name: info && info.name, phone: info && info.phone });
    const used = ZF.findVarsInActions(actionsList);
    const ask = used.filter((v) => (!ZF.BUILTIN_VARS.includes(v) && !(v in vars)) || (v === 'nome' && !vars.nome) || (v === 'primeiro_nome' && !vars.primeiro_nome && !used.includes('nome')));
    if (ask.length) {
      const extra = await ui.askVars(ask);
      if (!extra) return null;
      Object.assign(vars, extra);
      if (extra.nome && !extra.primeiro_nome) vars.primeiro_nome = ZF.firstName(extra.nome);
      if (extra.primeiro_nome && !extra.nome) vars.nome = extra.primeiro_nome;
    }
    return { info, vars };
  }

  const flash = (rowEl) => { if (rowEl) { rowEl.classList.remove('flash'); void rowEl.offsetWidth; rowEl.classList.add('flash'); } };
  const countUse = (r) => store.updateItem('replies', r.id, (x) => { x.uses = (x.uses || 0) + 1; x.lastUsed = Date.now(); });

  /** Executa as ações de uma ou mais respostas na conversa aberta */
  async function runOnActiveChat(items, ctx, label) {
    const { info, vars } = ctx;
    const target = { chatId: info && info.chatId, phone: info && info.phone, name: info && info.name, isGroup: info && info.isGroup };
    await ZF.runner.exclusive(async () => {
      for (let k = 0; k < items.length; k++) {
        const r = items[k];
        if (k > 0) await ZF.sleep(Math.max(1, Number(items.delay) || 3) * 1000);
        const prefix = items.length > 1 ? `${label} — etapa ${k + 1}/${items.length}: ` : `"${r.title}" — `;
        if (!target.chatId && !target.phone) {
          // sem identificar a conversa: só dá para mandar mensagens pela interface
          if (!(r.actions || []).every((a) => ZF.ACTION_TYPES[a.type] && ZF.ACTION_TYPES[a.type].msg)) throw new Error('Não consegui identificar esta conversa para executar as ações.');
          const blocks = ZF.renderBlocks(ZF.actionsToBlocks(r.actions), vars, false);
          ui.setBusy(prefix + 'enviando…');
          await ZF.wa.sendBlocks(blocks);
        } else {
          await ZF.runActions(r.actions, {
            target, vars, isOpen: true,
            onStep: (i, total, a) => ui.setBusy(`${prefix}${ZF.ACTION_TYPES[a.type].label} (${i + 1}/${total})`),
          });
        }
        countUse(r);
      }
    });
  }

  async function useReply(reply, mode, rowEl) {
    if (reply.kind === 'script') {
      if (mode === 'send') return runScript(reply, rowEl);
      const first = scriptSteps(reply)[0];
      if (!first) throw new Error('Este script não tem etapas.');
      return useReply(first, 'insert', rowEl);
    }
    const ctx = await prepare(reply.actions);
    if (!ctx) return;
    if (mode === 'send') {
      try {
        await runOnActiveChat([reply], ctx, reply.title);
      } finally { ui.setBusy(null); }
      ui.toast('Resposta enviada', 'ok');
    } else {
      const blocks = ZF.renderBlocks(ZF.actionsToBlocks(reply.actions), ctx.vars, false);
      if (!blocks.length) throw new Error('Esta resposta só tem automações. Use o botão ➤ para executar.');
      const r = await ZF.wa.insertBlocks(blocks);
      const extras = (reply.actions || []).length - blocks.length;
      if (r.skippedFiles || extras > 0) ui.toast('Texto inserido. Para enviar tudo (arquivos e ações), use o botão ➤', 'info', 4000);
      countUse(reply);
    }
    flash(rowEl);
  }

  async function runScript(script, rowEl, from = 0) {
    const steps = scriptSteps(script).slice(from);
    if (!steps.length) throw new Error('Este script não tem etapas.');
    const ctx = await prepare(steps.flatMap((s) => s.actions || []));
    if (!ctx) return;
    steps.delay = script.delay || 3;
    try {
      await runOnActiveChat(steps, ctx, `Script "${script.title}"`);
    } finally { ui.setBusy(null); }
    countUse(script);
    ui.toast('Script concluído', 'ok');
    flash(rowEl);
  }

  /* ---------------- categorias ---------------- */
  function openCategoryEditor(cat = null) {
    return new Promise((resolve) => {
      let color = cat ? cat.color : 'gray';
      let savedId = null;
      const name = ui.input({ value: cat ? cat.name : '', placeholder: 'Ex.: ☎️ Confirmações de consulta' });
      const emojiBtn = h('button', { class: 'zf-iconbtn', title: 'Emojis', onclick: (e) => { e.preventDefault(); ui.emojiPicker(e.currentTarget, (em) => ui.insertAtCursor(name, em)); } }, icon('smile', 18));
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
          ui.field('Nome', h('div', { class: 'zf-inputwrap' }, name, emojiBtn)),
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

  /* ---------------- telas de criação (resposta / script) ---------------- */
  const go = (view) => {
    state.view = view;
    ui.rerender('replies');
    if (ui.body) ui.body.scrollTop = 0;
  };

  function tutorial(kind) {
    const steps = kind === 'script' ? [
      'Um script é uma sequência de respostas rápidas enviadas em etapas (ex.: boas-vindas → valores → agendamento).',
      'Clique em "Adicionar Etapa" e escolha as respostas na ordem certa.',
      'Na lista, abra o script (👁) para enviar etapa por etapa, ou use ➤ para enviar todas com o intervalo escolhido.',
    ] : [
      'Dê um título curto (é o que você procura na busca).',
      'Clique em "Adicionar Ação" e escolha o que a resposta faz: mensagens (texto, imagem, áudio, Pix, contato…), mover para uma aba do CRM, etiquetas, "digitando…", agendar retorno, transferir atendimento etc.',
      'As ações rodam em ordem. Use ↑ ↓ para reorganizar e "#Tags" para inserir variáveis como {primeiro_nome}.',
      'Na lista: clicar no título coloca o texto no campo (para revisar); o botão ➤ executa todas as ações na conversa aberta.',
    ];
    ui.modal({
      title: kind === 'script' ? 'Como funcionam os scripts' : 'Como criar uma resposta rápida',
      body: h('ol', { class: 'zf-steps' }, steps.map((s) => h('li', {}, s))),
      actions: [{ label: 'Entendi', class: 'primary' }],
    });
  }

  function categorySelect(value) {
    let sel = null;
    const wrap = h('div');
    const build = (v) => {
      sel = ui.select([{ value: '', label: 'Nenhuma selecionada' }, ...data.categories.map((c) => ({ value: c.id, label: c.name })), { value: '__new', label: '+ Nova categoria…' }], v || '');
      sel.addEventListener('change', ui.safe(async () => {
        if (sel.value !== '__new') return;
        const id = await openCategoryEditor();
        await load();
        build(id || '');
      }));
      wrap.replaceChildren(sel);
    };
    build(value);
    return { el: wrap, get: () => (sel.value && sel.value !== '__new' ? sel.value : null) };
  }

  function titleInput(value, placeholder) {
    const input = h('input', { class: 'zf-input', value: value || '', placeholder });
    const emoji = h('button', { class: 'zf-iconbtn', title: 'Emojis', onclick: (e) => { e.preventDefault(); ui.emojiPicker(e.currentTarget, (em) => ui.insertAtCursor(input, em)); } }, icon('smile', 20));
    return { el: h('div', { class: 'zf-inputwrap' }, input, emoji), input };
  }

  function editorHeader(title, kind) {
    return h('div', { class: 'zf-edhead' },
      h('div', { class: 'zf-row', style: { justifyContent: 'space-between' } },
        h('button', { class: 'zf-iconbtn accent big', title: 'Voltar', onclick: () => go({ name: 'list' }) }, icon('back', 24)),
        h('button', { class: 'zf-btn', onclick: () => tutorial(kind) }, icon('youtube', 18), 'Tutorial')),
      h('div', { class: 'zf-edtitle' }, title));
  }

  function buildReplyEditor(reply, defaults = {}) {
    const t = titleInput(reply ? reply.title : defaults.title, 'Digite o título da resposta rápida');
    const initial = reply ? reply.actions : defaults.actions || (defaults.blocks ? ZF.blocksToActions(defaults.blocks) : []);
    const editor = ui.actionsEditor(initial);
    const cat = categorySelect(reply ? reply.categoryId : defaults.categoryId);
    const save = h('button', {
      class: 'zf-btn primary lg', onclick: ui.safe(async () => {
        const title = t.input.value.trim();
        const actions = editor.get();
        if (!title) { ui.toast('Informe um título', 'error'); t.input.focus(); return; }
        if (!actions.length) { ui.toast('Adicione pelo menos uma ação', 'error'); return; }
        const err = editor.validate();
        if (err) { ui.toast(err, 'error', 5000); return; }
        const categoryId = cat.get();
        if (reply) {
          await store.updateItem('replies', reply.id, (r) => ({ ...ZF.migrateReply(r), title, categoryId, actions, updatedAt: Date.now() }));
        } else {
          await store.update('replies', (list) => {
            const order = list.reduce((m, r) => Math.max(m, r.order || 0), 0) + 1;
            list.push({ id: ZF.uid(), kind: 'reply', title, categoryId, actions, uses: 0, order, createdAt: Date.now() });
            return list;
          });
        }
        store.gcFiles();
        ui.toast(reply ? 'Resposta salva' : 'Resposta criada', 'ok');
        go({ name: 'list' });
      }),
    }, reply ? 'Salvar' : 'Criar');
    return h('div', { class: 'zf-editor' },
      editorHeader(reply ? 'Editar Resposta Rápida' : 'Criar Respostas Rápidas', 'reply'),
      ui.field('Título', t.el),
      editor.el,
      ui.field('Selecione uma categoria', cat.el),
      h('div', { class: 'zf-center' }, save));
  }

  function buildScriptEditor(script, defaults = {}) {
    const t = titleInput(script ? script.title : '', 'Digite o título do script');
    let steps = ZF.clone(script ? script.steps || [] : []);
    const delay = h('input', { class: 'zf-input', type: 'number', min: 1, max: 600, value: script ? script.delay || 3 : 3, style: { width: '100px' } });
    const cat = categorySelect(script ? script.categoryId : defaults.categoryId);
    const list = h('div', { class: 'zf-actlist' });
    const render = () => {
      list.replaceChildren();
      if (!steps.length) {
        list.appendChild(h('div', { class: 'zf-actempty' }, icon('filter', 28),
          h('div', { class: 'zf-actempty-t' }, 'Nenhuma etapa adicionada'),
          h('div', { class: 'zf-muted' }, 'Escolha as respostas rápidas na ordem em que devem ser enviadas')));
        return;
      }
      steps.forEach((st, i) => {
        const r = replyById(st.replyId);
        list.appendChild(h('div', { class: 'zf-act' },
          h('div', { class: 'zf-act-h' },
            h('span', { class: 'zf-act-num' }, i + 1),
            icon(r ? typeIcon(r) : 'alert', 17, 'zf-act-icon'),
            h('div', { class: 'zf-grow', style: { minWidth: 0 } }, h('div', { class: 'zf-act-label' }, r ? r.title : 'Resposta excluída'),
              r ? h('span', { class: 'zf-act-sum' }, (r.actions || []).map((a) => ZF.ACTION_TYPES[a.type] ? ZF.ACTION_TYPES[a.type].label : a.type).join(' • ')) : null),
            h('button', { class: 'zf-iconbtn', title: 'Subir', disabled: i === 0, onclick: () => { [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]]; render(); } }, icon('arrowUp', 14)),
            h('button', { class: 'zf-iconbtn', title: 'Descer', disabled: i === steps.length - 1, onclick: () => { [steps[i + 1], steps[i]] = [steps[i], steps[i + 1]]; render(); } }, icon('arrowDown', 14)),
            h('button', { class: 'zf-iconbtn', title: 'Remover etapa', onclick: () => { steps.splice(i, 1); render(); } }, icon('trash', 14)))));
      });
    };
    render();
    const addStep = h('button', {
      class: 'zf-btn primary lg', onclick: ui.safe(async () => {
        const r = await ui.pickReply({ title: 'Escolher resposta para a etapa' });
        if (!r) return;
        steps.push({ id: ZF.uid(), replyId: r.id });
        render();
      }),
    }, 'Adicionar Etapa');
    const save = h('button', {
      class: 'zf-btn primary lg', onclick: ui.safe(async () => {
        const title = t.input.value.trim();
        if (!title) { ui.toast('Informe um título', 'error'); t.input.focus(); return; }
        if (!steps.length) { ui.toast('Adicione pelo menos uma etapa', 'error'); return; }
        const rec = { title, steps, delay: Math.max(1, Math.min(600, Number(delay.value) || 3)), categoryId: cat.get(), updatedAt: Date.now() };
        if (script) await store.updateItem('replies', script.id, (r) => ({ ...r, ...rec }));
        else {
          await store.update('replies', (arr) => {
            const order = arr.reduce((m, r) => Math.max(m, r.order || 0), 0) + 1;
            arr.push({ id: ZF.uid(), kind: 'script', actions: [], uses: 0, order, createdAt: Date.now(), ...rec });
            return arr;
          });
        }
        ui.toast(script ? 'Script salvo' : 'Script criado', 'ok');
        go({ name: 'list' });
      }),
    }, script ? 'Salvar' : 'Criar');
    return h('div', { class: 'zf-editor' },
      editorHeader(script ? 'Editar Script' : 'Criar Script', 'script'),
      ui.field('Título', t.el),
      h('div', { class: 'zf-actcard' },
        h('div', { class: 'zf-actcard-h' }, h('span', { class: 'zf-actcard-title' }, 'Etapas do Script')),
        list,
        h('div', { class: 'zf-center' }, addStep)),
      ui.field('Intervalo entre as etapas ao enviar tudo (segundos)', delay),
      ui.field('Selecione uma categoria', cat.el),
      h('div', { class: 'zf-center' }, save));
  }

  /** Abre a tela de criação/edição (usado por outras abas, ex.: IA) */
  function openReplyEditor(reply = null, defaults = {}) {
    state.view = { name: 'edit', reply, defaults };
    if (ui.current !== 'replies' || !ui.open) ui.openView('replies');
    else go(state.view);
  }
  ZF.openReplyEditor = openReplyEditor;
  const openScriptEditor = (script = null, defaults = {}) => go({ name: 'script', script, defaults });

  /* ---------------- ações da lista ---------------- */
  async function duplicateReply(r) {
    await store.update('replies', (list) => {
      list.push({ ...ZF.clone(r), id: ZF.uid(), title: r.title + ' (cópia)', uses: 0, order: (r.order || 0) + 0.5, createdAt: Date.now() });
      return list;
    });
    ui.toast('Duplicado', 'ok');
  }

  async function deleteReply(r) {
    const usedIn = data.replies.filter((s) => s.kind === 'script' && (s.steps || []).some((st) => st.replyId === r.id));
    const extra = usedIn.length ? `\n\nEla é etapa de ${usedIn.length} script(s): ${usedIn.map((s) => s.title).join(', ')}.` : '';
    if (!(await ui.confirm(`Excluir "${r.title}"?${extra}`, { okLabel: 'Excluir', danger: true }))) return;
    await store.update('replies', (list) => list.filter((x) => x.id !== r.id));
    store.gcFiles();
    ui.toast('Excluído');
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
    const ok = await ui.confirm(`Excluir a categoria "${cat.name}"?${n ? `\n\nOs ${n} item(ns) dela vão para "Sem categoria".` : ''}`, { okLabel: 'Excluir', danger: true });
    if (!ok) return;
    await store.update('replies', (list) => list.map((r) => (r.categoryId === cat.id ? { ...r, categoryId: null } : r)));
    await store.update('categories', (list) => list.filter((c) => c.id !== cat.id));
  }

  const onlyMessages = (r) => {
    const blocks = ZF.actionsToBlocks(r.actions || []);
    if (!blocks.length) throw new Error('Esta resposta não tem mensagens para enviar.');
    if (blocks.length < (r.actions || []).length) ui.toast('Só as mensagens entram (automações como abas e etiquetas ficam de fora).', 'info', 4500);
    return blocks;
  };

  function replyMenu(r, anchor) {
    const common = [
      { label: 'Editar', icon: 'edit', onClick: () => (r.kind === 'script' ? openScriptEditor(r) : openReplyEditor(r)) },
      { label: 'Duplicar', icon: 'copy', onClick: () => duplicateReply(r) },
      { label: 'Mover para cima', icon: 'arrowUp', onClick: () => moveReply(r, -1) },
      { label: 'Mover para baixo', icon: 'arrowDown', onClick: () => moveReply(r, 1) },
      { label: 'Mudar categoria…', icon: 'shapes', onClick: () => ui.menu(anchor, [
        { title: 'Mover para' },
        { label: '— Sem categoria —', active: !r.categoryId, onClick: () => store.updateItem('replies', r.id, (x) => { x.categoryId = null; }) },
        ...data.categories.map((c) => ({ label: c.name, active: r.categoryId === c.id, onClick: () => store.updateItem('replies', r.id, (x) => { x.categoryId = c.id; }) })),
      ]) },
      '-',
      { label: 'Excluir', icon: 'trash', danger: true, onClick: () => deleteReply(r) },
    ];
    if (r.kind === 'script') {
      ui.menu(anchor, [{ label: 'Enviar todas as etapas', icon: 'send', onClick: () => runScript(r) }, '-', ...common]);
      return;
    }
    ui.menu(anchor, [
      { label: 'Inserir no campo (sem enviar)', icon: 'corner', onClick: () => useReply(r, 'insert') },
      { label: 'Executar/enviar agora', icon: 'send', onClick: () => useReply(r, 'send') },
      { label: 'Agendar para esta conversa…', icon: 'calendarClock', onClick: () => ZF.openScheduleEditor(null, { blocks: onlyMessages(r), useActiveChat: true }) },
      { label: 'Usar em envio em massa…', icon: 'inbox', onClick: () => ZF.openCampaignEditor(null, { blocks: onlyMessages(r), name: r.title }) },
      '-',
      ...common,
    ]);
  }

  function categoryMenu(cat, anchor) {
    ui.menu(anchor, [
      { label: 'Nova resposta nesta categoria', icon: 'zap', onClick: () => openReplyEditor(null, { categoryId: cat.id }) },
      { label: 'Novo script nesta categoria', icon: 'filter', onClick: () => openScriptEditor(null, { categoryId: cat.id }) },
      { label: 'Editar categoria', icon: 'edit', onClick: () => openCategoryEditor(cat) },
      { label: 'Mover para cima', icon: 'arrowUp', onClick: () => moveCategory(cat, -1) },
      { label: 'Mover para baixo', icon: 'arrowDown', onClick: () => moveCategory(cat, 1) },
      '-',
      { label: 'Excluir categoria', icon: 'trash', danger: true, onClick: () => deleteCategory(cat) },
    ]);
  }

  /* ---------------- renderização da lista ---------------- */
  function previewOf(r) {
    const prev = h('div', { class: 'zf-preview' });
    if (r.kind === 'script') {
      const steps = scriptSteps(r);
      if (!steps.length) prev.appendChild(h('div', { class: 'zf-muted' }, 'Sem etapas.'));
      steps.forEach((st, i) => prev.appendChild(h('div', { class: 'zf-step' },
        h('span', { class: 'zf-act-num' }, i + 1),
        icon(typeIcon(st), 14),
        h('span', { class: 'zf-grow zf-ellipsis' }, st.title),
        h('button', { class: 'zf-iconbtn accent', title: 'Enviar só esta etapa', onclick: ui.safe(async (e) => { e.stopPropagation(); await useReply(st, 'send'); }) }, icon('send', 15)),
        h('button', { class: 'zf-btn sm', title: 'Enviar desta etapa até o fim', onclick: ui.safe(async (e) => { e.stopPropagation(); await runScript(r, null, i); }) }, 'daqui em diante'))));
      return prev;
    }
    (r.actions || []).forEach((a, i) => {
      const def = ZF.ACTION_TYPES[a.type];
      if (!def) return;
      if (i) prev.appendChild(h('div', { class: 'zf-sep' }));
      if (a.type === 'text') prev.appendChild(h('div', {}, a.text));
      else {
        prev.appendChild(h('div', { class: 'zf-file' }, icon(def.icon, 14), h('b', {}, def.label), ' — ', ZF.actionSummary(a, { tab: (id) => (ZF.crm && ZF.crm.tabById(id) ? ZF.crm.tabById(id).name : ''), reply: (id) => (replyById(id) || {}).title })));
        if (a.caption) prev.appendChild(h('div', {}, a.caption));
      }
    });
    return prev;
  }

  function replyRow(r, { showCat = false, showUses = false } = {}) {
    const stop = (fn) => ui.safe(async (e) => { e.stopPropagation(); await fn(e); });
    const isScript = r.kind === 'script';
    const row = h('div', {
      class: 'zf-item' + (isScript ? ' script' : ''), title: isScript ? `Script com ${(r.steps || []).length} etapa(s)` : ZF.blocksPreview(ZF.actionsToBlocks(r.actions || []), 300),
      onclick: ui.safe(async () => {
        if (isScript) { state.expanded.has(r.id) ? state.expanded.delete(r.id) : state.expanded.add(r.id); renderList(); return; }
        await useReply(r, ui.settings.clickAction === 'send' ? 'send' : 'insert', row);
      }),
    },
    // texto simples não ganha ícone: numa lista grande, um ícone igual em toda linha vira poluição
    h('span', { class: 'zf-type' }, ZF.replyType(r) === 'texto' ? null : icon(typeIcon(r), 15)),
    h('span', { class: 'zf-title' }, r.title),
    showCat && r.categoryId && catById(r.categoryId)
      ? h('span', { class: 'zf-catlabel', 'data-color': catById(r.categoryId).color || 'gray' }, h('span', { class: 'zf-ellipsis' }, catById(r.categoryId).name))
      : null,
    showUses ? h('span', { class: 'zf-uses' }, `${r.uses || 0}×`) : null,
    h('div', { class: 'zf-item-acts' },
      h('button', { class: 'zf-iconbtn', title: 'Mais opções', onclick: stop((e) => replyMenu(r, e.currentTarget)) }, icon('more', 18)),
      h('button', {
        class: 'zf-iconbtn', title: isScript ? 'Ver etapas' : 'Pré-visualizar',
        onclick: stop(() => { state.expanded.has(r.id) ? state.expanded.delete(r.id) : state.expanded.add(r.id); renderList(); }),
      }, icon('eye', 17)),
      h('button', { class: 'zf-iconbtn accent', title: isScript ? 'Enviar todas as etapas' : 'Executar na conversa aberta', onclick: stop(() => useReply(r, 'send', row)) }, icon('send', 17))));

    if (!state.expanded.has(r.id)) return row;
    return h('div', {}, row, previewOf(r));
  }

  function categoryBlock(cat, replies, forceOpen = false) {
    const collapsed = !forceOpen && cat && cat.collapsed;
    const toggle = () => cat && store.updateItem('categories', cat.id, (c) => { c.collapsed = !c.collapsed; });
    return h('div', { class: 'zf-cat' + (collapsed ? ' collapsed' : ''), 'data-color': cat ? cat.color || 'gray' : 'none' },
      h('div', { class: 'zf-cat-h', onclick: toggle },
        h('span', { class: 'zf-cat-dot' }),
        h('span', { class: 'zf-cat-name' }, cat ? cat.name : 'Sem categoria'),
        h('span', { class: 'zf-count' }, replies.length),
        cat ? h('button', {
          class: 'zf-iconbtn zf-cat-more', title: 'Opções da categoria',
          onclick: (e) => { e.stopPropagation(); categoryMenu(cat, e.currentTarget); },
        }, icon('more', 16)) : null,
        cat ? icon('chevronUp', 16, 'zf-cat-caret') : null),
      h('div', { class: 'zf-cat-body' },
        replies.length ? sortReplies(replies).map((r) => replyRow(r)) : h('div', { class: 'zf-muted zf-small', style: { padding: '4px 2px' } }, 'Nada nesta categoria ainda.')));
  }

  function filteredReplies() {
    let items = data.replies;
    const q = ZF.normKey(state.q);
    if (q) items = items.filter((r) => ZF.normKey(ZF.replySearchText(r)).includes(q));
    if (state.filter === 'type') items = items.filter((r) => ZF.replyType(r) === state.type);
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
      listEl.appendChild(h('div', { style: { display: 'flex', flexDirection: 'column', gap: '1px', paddingTop: '4px' } },
        items.map((r) => replyRow(r, { showCat: true, showUses: state.filter === 'top' }))));
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
    const typeLabel = state.filter === 'type' ? ZF.TYPE_LABELS[state.type] : 'Por tipo';
    const cat = state.filter === 'cat' ? catById(state.catId) : null;
    const presentTypes = [...new Set(data.replies.map(ZF.replyType))];
    // só mostra o filtro que tem serventia agora: com poucas respostas a barra fica com 1 ou 2 chips
    const hasUncat = data.replies.some((r) => !r.categoryId || !catById(r.categoryId));
    const hasUses = data.replies.some((r) => r.uses > 0);
    ZF.append(chipsEl,
      chip('Tudo', state.filter === 'all', () => set({ filter: 'all' })),
      presentTypes.length > 1 || state.filter === 'type' ? chip(typeLabel, state.filter === 'type', (e) => ui.menu(e.currentTarget, Object.keys(ZF.TYPE_LABELS).filter((t) => presentTypes.includes(t)).map((t) => ({
        label: ZF.TYPE_LABELS[t], icon: ZF.TYPE_ICONS[t], active: state.filter === 'type' && state.type === t,
        count: data.replies.filter((r) => ZF.replyType(r) === t).length,
        onClick: () => set({ filter: 'type', type: t }),
      })), { align: 'left' }), true) : null,
      data.categories.length || state.filter === 'cat' ? chip(cat ? cat.name : 'Por categoria', state.filter === 'cat', (e) => ui.menu(e.currentTarget, data.categories.length
        ? data.categories.map((c) => ({ label: c.name, icon: 'shapes', active: state.catId === c.id, count: data.replies.filter((r) => r.categoryId === c.id).length, onClick: () => set({ filter: 'cat', catId: c.id }) }))
        : [{ label: 'Nenhuma categoria criada', icon: 'plus', onClick: () => openCategoryEditor() }], { align: 'left' }), true) : null,
      hasUncat || state.filter === 'uncat' ? chip('Sem categoria', state.filter === 'uncat', () => set({ filter: 'uncat' })) : null,
      hasUses || state.filter === 'top' ? chip('Mais usadas', state.filter === 'top', () => set({ filter: 'top' })) : null,
    );
  }

  function renderListView(body) {
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
      class: 'zf-iconbtn big', title: 'Criar',
      onclick: (e) => ui.menu(e.currentTarget, [
        { label: 'Respostas Rápidas', icon: 'zap', onClick: () => openReplyEditor(null, state.filter === 'cat' ? { categoryId: state.catId } : {}) },
        { label: 'Script', icon: 'filter', onClick: () => openScriptEditor(null, state.filter === 'cat' ? { categoryId: state.catId } : {}) },
        '-',
        { label: 'Categoria', icon: 'shapes', onClick: () => openCategoryEditor() },
      ]),
    }, icon('gridPlus', 24));

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

  function render(body) {
    if (!loaded) {
      body.appendChild(h('div', { class: 'zf-empty' }, 'Carregando…'));
      load().then(() => ui.rerender('replies'));
      return;
    }
    const v = state.view;
    if (v.name === 'edit' || v.name === 'script') {
      // mantém o que já foi digitado ao trocar de aba e voltar
      if (!v.el) v.el = v.name === 'edit' ? buildReplyEditor(v.reply, v.defaults) : buildScriptEditor(v.script, v.defaults);
      body.appendChild(v.el);
      return;
    }
    renderListView(body);
  }

  ui.registerTab('replies', { icon: 'zap', title: 'Respostas rápidas', render });
})();
