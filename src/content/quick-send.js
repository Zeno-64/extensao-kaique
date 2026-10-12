/*
 * ZapFlow — Envio Rápido (disparo em massa em 3 passos, como no WaSpeed):
 *   1. Selecione os contatos  2. Crie o script de envio  3. Acompanhe o envio.
 * Tela cheia sobre o WhatsApp; usa o mesmo motor de campanhas do "Envio em massa" (runner.js).
 */
(() => {
  'use strict';
  const ZF = window.ZF;
  const { h, icon, store, ui } = ZF;

  const SOURCES = [
    ['saved', 'Contatos Salvos'], ['inbox', 'Inbox'], ['labels', 'Etiquetas'], ['groups', 'Grupos'],
    ['members', 'Contatos de grupos'], ['crm', 'CRM'], ['sheet', 'Importar planilha'],
  ];
  const PILLS = [200, -200, 100, -100, 10, -10];
  const SHOW_MAX = 300; // linhas desenhadas por vez (o resto aparece ao filtrar)
  const SENT_LABEL = { sent: 'Enviado ✓', failed: 'Falhou', invalid: 'Sem WhatsApp' };

  ZF.openQuickSend = (defaults = {}) => {
    if (document.querySelector('.zf-qk')) return;
    const s = ui.settings || store.DEFAULT_SETTINGS;
    const selected = new Map(); // chave (telefone ou chatId) → contato
    let actionsEditor = null;
    let alive = true;
    let step = 1;

    /* ---------------- contatos escolhidos ---------------- */
    const add = (c) => {
      const phone = c.isGroup ? null : c.phone ? ZF.normalizePhone(c.phone, s.countryCode) : null;
      if (!phone && !c.chatId) return false;
      const k = phone || c.chatId;
      if (selected.has(k)) return false;
      selected.set(k, { phone, chatId: phone ? c.chatId || null : c.chatId, name: c.name || '', isGroup: !!c.isGroup, vars: c.vars || {} });
      return true;
    };
    const keyOf = (c) => (c.isGroup ? null : c.phone ? ZF.normalizePhone(c.phone, s.countryCode) : null) || c.chatId;
    (defaults.recipients || []).forEach(add);

    /* ---------------- estrutura da tela ---------------- */
    const root = h('div', { class: 'zf-qk zf-keep' });
    const close = () => { alive = false; root.remove(); };
    const header = (title, sub) => h('div', { class: 'zf-qk-head' },
      h('div', {}, ...[h('div', { class: 'zf-qk-title' }, title), sub ? h('div', { class: 'zf-qk-sub' }, sub) : null].filter(Boolean)),
      h('button', { class: 'zf-qk-close', onclick: close }, 'Fechar'));
    const screen = h('div', { class: 'zf-qk-screen' });
    root.appendChild(screen);
    ui.wrap.appendChild(root);

    /* ================= passo 1: contatos ================= */
    let source = 'saved';
    let items = [];
    let subKey = '';
    let q = '';
    const cache = {};
    const listBridge = async (name) => {
      if (!cache[name]) {
        const r = await ZF.wa.bridge(name, {}, 25000);
        if (!r || !r.ok) throw ZF.userError('Não consegui ler isso do WhatsApp (recurso indisponível nesta versão).');
        cache[name] = r;
      }
      return cache[name];
    };

    const loadItems = async () => {
      items = [];
      note.textContent = '';
      if (source === 'saved') {
        const r = await listBridge('listContacts');
        items = r.contacts.filter((c) => c.saved && c.phone).map((c) => ({ phone: c.phone, chatId: c.id, name: c.name || c.pushname }));
      } else if (source === 'inbox') {
        const r = await listBridge('listChats');
        items = r.chats.filter((c) => !c.isGroup).map((c) => ({ phone: c.phone, chatId: c.chatId, name: c.name }));
      } else if (source === 'groups') {
        const r = await listBridge('listChats');
        items = r.chats.filter((c) => c.isGroup).map((c) => ({ chatId: c.chatId, name: c.name, isGroup: true }));
      } else if (source === 'labels' && subKey) {
        const r = await listBridge('listChats');
        items = r.chats.filter((c) => (c.labels || []).includes(subKey)).map((c) => ({ phone: c.phone, chatId: c.chatId, name: c.name, isGroup: c.isGroup }));
      } else if (source === 'members' && subKey) {
        const r = await ZF.wa.call('groupParticipants', { chatId: subKey }, 30000);
        items = r.participants.filter((p) => p.phone).map((p) => ({ phone: p.phone, name: p.name }));
      } else if (source === 'crm' && subKey) {
        items = ZF.crm.chatsInTab(subKey).map((c) => ({ phone: c.phone, chatId: c.chatId, name: c.name, isGroup: c.isGroup }));
      }
    };
    const filtered = () => {
      const t = ZF.normKey(q);
      const d = ZF.onlyDigits(q);
      return items.filter((c) => !t || ZF.normKey(c.name || '').includes(t) || (d && (c.phone || '').includes(d)));
    };

    const segCol = h('div', { class: 'zf-qk-seg' });
    const subWrap = h('div');
    const search = h('input', { class: 'zf-qk-search', placeholder: 'Pesquisar por numero ou nome do contato' });
    const allBtn = h('button', { class: 'zf-qk-blue' });
    const pillsEl = h('div', { class: 'zf-qk-pills' });
    const listEl = h('div', { class: 'zf-qk-list' });
    const note = h('div', { class: 'zf-qk-note' });
    const selTitle = h('div', { class: 'zf-qk-seltitle' });
    const selList = h('div', { class: 'zf-qk-selist' });
    const removeSel = h('button', { class: 'zf-qk-ghost', onclick: () => { selected.clear(); refreshAll(); } }, 'Remover Seleção');
    const nextBtn = h('button', { class: 'zf-qk-next', title: 'Próximo: criar o script', onclick: () => {
      if (!selected.size) { ui.toast('Selecione pelo menos um contato', 'error'); return; }
      goStep2();
    } }, icon('chevronRight', 26), icon('chevronRight', 26));

    const renderSeg = () => {
      segCol.replaceChildren(...SOURCES.map(([k, label]) => h('button', {
        class: 'zf-qk-blue seg' + (k === source ? ' on' : ''),
        onclick: ui.safe(async () => {
          if (k === 'sheet') { openSheet(); return; }
          source = k; subKey = ''; q = ''; search.value = '';
          await switchSource();
        }),
      }, label)),
      h('button', { class: 'zf-qk-blue export', onclick: exportXlsx }, icon('download', 15), 'Exporta Em .XLSX'));
    };
    const switchSource = async () => {
      renderSeg();
      subWrap.replaceChildren();
      listEl.replaceChildren(h('div', { class: 'zf-qk-empty' }, 'Carregando…'));
      if (source === 'labels') {
        const r = await listBridge('listLabels');
        subWrap.appendChild(subSelect([['', 'Escolha uma etiqueta ou lista'], ...r.labels.map((l) => [l.id, l.name])]));
      } else if (source === 'members') {
        const r = await listBridge('listChats');
        subWrap.appendChild(subSelect([['', 'Escolha um grupo'], ...r.chats.filter((c) => c.isGroup).map((c) => [c.chatId, c.name])]));
      } else if (source === 'crm') {
        const tags = ZF.crm ? ZF.crm.tags() : [];
        subWrap.appendChild(subSelect([['', tags.length ? 'Escolha uma aba do CRM' : 'Nenhuma aba criada'], ...tags.map((t) => [t.id, t.name])]));
      }
      await loadItems();
      refreshAll();
    };
    const subSelect = (opts) => {
      const sel = ui.select(opts.map(([value, label]) => ({ value, label })), subKey);
      sel.classList.add('zf-qk-select');
      sel.addEventListener('change', ui.safe(async () => { subKey = sel.value; await loadItems(); refreshAll(); }));
      return sel;
    };

    const renderTop = () => {
      const f = filtered();
      const allIn = f.length && f.every((c) => selected.has(keyOf(c)));
      allBtn.textContent = allIn ? 'Remover todos' : `Selecionar Todos (${f.length})`;
      allBtn.onclick = () => {
        f.forEach((c) => (allIn ? selected.delete(keyOf(c)) : add(c)));
        refreshAll();
      };
      pillsEl.replaceChildren(...PILLS.map((n) => h('button', {
        class: 'zf-qk-pill ' + (n > 0 ? 'plus' : 'minus'),
        onclick: () => {
          if (n > 0) f.filter((c) => !selected.has(keyOf(c))).slice(0, n).forEach(add);
          else f.filter((c) => selected.has(keyOf(c))).slice(n).forEach((c) => selected.delete(keyOf(c)));
          refreshAll();
        },
      }, `${n > 0 ? '+' : ''}${n}`)));
    };
    const renderList = () => {
      const f = filtered();
      listEl.replaceChildren(...f.slice(0, SHOW_MAX).map((c) => {
        const on = selected.has(keyOf(c));
        return h('div', {
          class: 'zf-qk-row', onclick: () => { if (on) selected.delete(keyOf(c)); else add(c); refreshAll(); },
        }, h('span', { class: 'zf-qk-radio' + (on ? ' on' : '') }, on ? icon('check', 11) : null),
        h('b', {}, c.name || ZF.fmtPhone(c.phone) || 'Sem nome'),
        h('span', { class: 'zf-qk-num' }, c.isGroup ? 'Grupo' : c.phone || ''));
      }));
      if (!f.length) listEl.appendChild(h('div', { class: 'zf-qk-empty' }, source === 'sheet' ? 'Use "Importar planilha"' : ['labels', 'members', 'crm'].includes(source) && !subKey ? 'Escolha uma opção acima' : 'Nenhum contato encontrado'));
      if (f.length > SHOW_MAX) listEl.appendChild(h('div', { class: 'zf-qk-empty' }, `Mostrando ${SHOW_MAX} de ${f.length}. Use a busca para refinar.`));
    };
    const renderSelected = () => {
      selTitle.replaceChildren(...['Contatos Selecionados', selected.size ? h('span', { class: 'zf-qk-badge' }, `+${selected.size}`) : null].filter(Boolean));
      removeSel.style.display = selected.size ? '' : 'none';
      selList.replaceChildren(...(selected.size
        ? [...selected.values()].slice(0, 500).map((c) => h('div', { class: 'zf-qk-sel' }, icon(c.isGroup ? 'users' : 'user', 13), h('b', {}, c.name || ''), h('span', { class: 'zf-qk-num' }, c.isGroup ? 'Grupo' : c.phone || '')))
        : [h('div', { class: 'zf-qk-warn' }, icon('alert', 16), 'Nenhum contato selecionado')]));
    };
    const refreshAll = () => { renderTop(); renderList(); renderSelected(); };
    search.addEventListener('input', () => { q = search.value; renderTop(); renderList(); });

    const exportXlsx = ui.safe(async () => {
      const rows = [['Nome', 'Telefone'], ...(selected.size ? [...selected.values()] : filtered()).map((c) => [c.name || '', c.phone || ''])];
      if (rows.length < 2) throw ZF.userError('Não há contatos para exportar.');
      ZF.downloadXlsx('contatos-envio-rapido.xlsx', rows, 'Contatos');
    });

    /* importar planilha (.xlsx/.csv): modal como no WaSpeed */
    function openSheet() {
      const drop = h('div', { class: 'zf-qk-drop' }, 'Arraste o arquivo aqui.');
      const importFile = ui.safe(async (f) => {
        if (!f) return;
        const rows = await ZF.readSpreadsheet(f);
        const parsed = ZF.parseContacts(ZF.toCSV(rows).replace(/^﻿/, ''), s.countryCode);
        const n = parsed.contacts.filter(add).length;
        ui.toast(`${n} contato(s) importados de "${f.name}"${parsed.invalid.length ? ` • ${parsed.invalid.length} linha(s) inválida(s)` : ''}`, n ? 'ok' : 'info', 4500);
        refreshAll();
        ref.close();
      });
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('over'));
      drop.addEventListener('drop', (e) => { e.preventDefault(); importFile(e.dataTransfer.files[0]); });
      const pick = ui.safe(async () => importFile(await ZF.pickFile('.xlsx,.csv,.txt,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')));
      const ref = ui.modal({
        title: 'Importar Planilhas', global: true,
        body: h('div', {},
          h('div', { class: 'zf-muted' }, 'Importe ou arraste uma planilha (.xlsx/.csv) com o cabeçalho telefone;nome;outras colunas. As colunas viram variáveis na mensagem.'),
          h('div', { class: 'zf-qk-importrow' }, h('button', { class: 'zf-qk-import', onclick: pick }, icon('upload', 18), 'Importar'), drop),
          h('div', { class: 'zf-qk-opt' }, h('span', {}, `Números com até 11 dígitos recebem o DDI +${s.countryCode}.`))),
      });
    }

    /* ================= passo 2: script ================= */
    function buildStep1() {
      renderSeg();
      screen.replaceChildren(
        header('Envio Rápido', null),
        h('div', { class: 'zf-qk-h2' }, 'Selecione os contatos'),
        h('div', { class: 'zf-qk-grid1' },
          h('div', {}, h('div', { class: 'zf-qk-label' }, 'Contatos por segmento'), segCol),
          h('div', { class: 'zf-qk-mid' },
            h('div', { class: 'zf-qk-bar' }, search, allBtn), subWrap, pillsEl, listEl),
          h('div', { class: 'zf-qk-right' },
            h('div', { class: 'zf-qk-rhead' }, selTitle, removeSel), selList),
          nextBtn));
      refreshAll();
    }

    function goStep2() {
      step = 2;
      if (!actionsEditor) {
        actionsEditor = ui.actionsEditor(defaults.actions || (defaults.blocks ? ZF.blocksToActions(defaults.blocks) : []), { title: 'Crie um script de envio' });
      }
      const replies = h('div', { class: 'zf-qk-replies' });
      const rsearch = h('input', { class: 'zf-qk-search', placeholder: 'Pesquisar resposta rápida' });
      const renderReplies = async () => {
        const d = await store.getMany(['replies', 'categories']);
        const t = ZF.normKey(rsearch.value);
        const cats = [...d.categories].sort((a, b) => (a.order || 0) - (b.order || 0));
        const list = d.replies.filter((r) => r.kind !== 'script').map(ZF.migrateReply).filter((r) => !t || ZF.normKey(r.title).includes(t));
        const block = (cat, rs) => (rs.length ? h('div', { class: 'zf-cat', 'data-color': cat ? cat.color || 'gray' : 'none' },
          h('div', { class: 'zf-cat-h' }, icon('shapes', 16, 'zf-cat-ico'), h('span', { class: 'zf-cat-name' }, cat ? cat.name : 'Sem categoria')),
          h('div', { class: 'zf-cat-b' }, rs.map((r) => h('div', {
            class: 'zf-item', title: 'Inserir no script',
            onclick: () => { actionsEditor.append(r.actions); ui.toast(`"${r.title}" inserida no script`, 'ok', 1800); },
          }, h('span', { class: 'zf-title' }, r.title), h('div', { class: 'zf-item-acts' }, icon('send', 16)))))) : null);
        replies.replaceChildren(...cats.map((c) => block(c, list.filter((r) => r.categoryId === c.id))), block(null, list.filter((r) => !cats.some((c) => c.id === r.categoryId))));
      };
      rsearch.addEventListener('input', renderReplies);
      renderReplies();
      const fab = h('button', { class: 'zf-send-fab zf-qk-fab', title: 'Enviar campanha', onclick: ui.safe(openSettings) }, icon('send', 22));
      screen.replaceChildren(
        header('Envio Rápido', 'Crie um script para realizar o envio rápido'),
        h('div', { class: 'zf-qk-grid2' },
          h('button', { class: 'zf-qk-back', title: 'Voltar aos contatos', onclick: () => { step = 1; buildStep1(); } }, icon('chevronLeft', 26), icon('chevronLeft', 26)),
          h('div', { class: 'zf-qk-script' }, actionsEditor.el, fab),
          h('div', { class: 'zf-qk-rcol' }, h('div', { class: 'zf-qk-rtitle' }, 'Selecione uma Resposta Rápida para inserir no envio da campanha'), rsearch, replies)));
    }

    /* configurações de envio + termo de uso */
    function openSettings() {
      const actions = actionsEditor.get();
      if (!actions.length) throw ZF.userError('Adicione pelo menos uma ação ao script');
      const err = actionsEditor.validate();
      if (err) throw ZF.userError(err);
      const msgActions = actions.filter((a) => ZF.ACTION_TYPES[a.type] && ZF.ACTION_TYPES[a.type].msg);
      const ignored = actions.length - msgActions.length;
      const blocks = ZF.actionsToBlocks(msgActions).filter(ZF.blockHasContent);
      if (!blocks.length) throw ZF.userError('O script precisa ter pelo menos uma mensagem (texto, imagem, documento…).');

      const dSlider = ui.slider({ min: 3, max: 180, value: s.bulkDelay || 10, unit: 'Segundos' });
      const pEvery = ui.slider({ min: 0, max: 200, value: s.bulkPauseEvery == null ? 10 : s.bulkPauseEvery, unit: 'Contatos', zero: 'Sem pausa' });
      const pSec = ui.slider({ min: 0, max: 600, step: 5, value: s.bulkPauseSeconds == null ? 60 : s.bulkPauseSeconds, unit: 'Segundos', zero: 'Sem pausa' });
      let noSig = false;
      let customSig = false;
      const sigName = h('input', { class: 'zf-input', placeholder: 'Nome na assinatura', value: s.signatureName || '', style: { display: 'none' } });
      const sigOff = ui.switch(false, (v) => { noSig = v; });
      const sigCustom = ui.switch(false, (v) => { customSig = v; sigName.style.display = v ? '' : 'none'; });
      const terms = h('input', { type: 'checkbox' });
      const send = h('button', { class: 'zf-btn primary', disabled: true }, 'Enviar Campanha');
      terms.addEventListener('change', () => { send.disabled = !terms.checked; });
      const ref = ui.modal({
        title: 'Configurações de envio', global: true,
        body: h('div', {},
          ui.field('Intervalo (s)', dSlider), ui.field('Pausa (a cada X envios)', pEvery), ui.field('Tempo de pausa em (s)', pSec),
          h('div', { class: 'zf-qk-opt' }, h('span', {}, 'Desativar a assinatura'), sigOff),
          h('div', { class: 'zf-qk-opt' }, h('span', {}, 'Personalizar o nome da assinatura'), sigCustom), sigName,
          ignored ? h('div', { class: 'zf-hint' }, `${ignored} ação(ões) que não são mensagem (ex.: etiquetas) não entram no envio em massa.`) : null,
          h('div', { class: 'zf-qk-terms' }, h('b', {}, 'Termo de uso'),
            h('p', {}, 'A prática de envios em massa ou spam pode ocasionar o banimento do seu número por parte do WhatsApp. Envie mensagens apenas para pessoas que gostariam de receber sua mensagem.'),
            h('label', { class: 'zf-check' }, terms, h('span', {}, 'Eu entendo e aceito os termos de uso.'))),
          h('div', { class: 'zf-center' }, send)),
      });
      send.addEventListener('click', ui.safe(async () => {
        const delay = Math.max(3, dSlider.get());
        const pauseSeconds = Math.max(0, pSec.get());
        const contacts = [...selected.values()].map((c) => ({ ...c, status: 'pending', error: null, at: null }));
        const columns = [...new Set(contacts.flatMap((c) => Object.keys(c.vars || {})))];
        const id = ZF.uid();
        const camp = {
          id, createdAt: Date.now(), quick: true,
          name: defaults.name || `Envio rápido ${ZF.fmtDateTime(Date.now())}`,
          rawContacts: '', picked: [], contacts, columns, blocks,
          delay, minDelay: delay, maxDelay: delay, pauseEvery: Math.max(0, pEvery.get()), pauseSeconds, pauseMinutes: pauseSeconds / 60,
          noSignature: noSig, signatureName: customSig ? sigName.value.trim() : '',
          status: 'running', startedAt: Date.now(), nextAt: Date.now(),
        };
        await store.update('campaigns', (list) => { list.unshift(camp); return list; });
        ref.close();
        ZF.runner.tick();
        showProgress(id);
      }));
    }

    /* ================= passo 3: andamento ================= */
    function showProgress(id) {
      step = 3;
      const totals = h('div', { class: 'zf-qk-totals' });
      const state = h('button', { class: 'zf-qk-wait', disabled: true });
      const info = h('div', { class: 'zf-qk-info' });
      const tbody = h('div', { class: 'zf-qk-table' });
      const cancelBtn = h('button', { class: 'zf-qk-cancel' }, 'Cancelar Envio');
      let camp = null;
      const draw = () => {
        if (!camp) return;
        const n = { total: camp.contacts.length, sent: 0, bad: 0 };
        camp.contacts.forEach((c) => { if (c.status === 'sent') n.sent++; else if (c.status === 'failed' || c.status === 'invalid') n.bad++; });
        const pct = n.total ? Math.round(((n.sent + n.bad) / n.total) * 100) : 0;
        const running = camp.status === 'running' || camp.status === 'scheduled';
        totals.replaceChildren(...[['Total de contatos', n.total], ['Enviados', n.sent], ['Erro ao enviar', n.bad]].map(([l, v]) => h('div', {}, h('div', { class: 'zf-qk-tl' }, l), h('div', { class: 'zf-qk-tv' }, String(v)))));
        state.replaceChildren(running ? icon('refresh', 16, 'zf-spin') : icon('check', 16), running ? 'Aguarde' : ({ done: 'Concluída', paused: 'Pausada', canceled: 'Cancelada' }[camp.status] || camp.status));
        const rs = ZF.runner.state || {};
        info.replaceChildren(icon('clock', 16), h('span', { class: 'zf-grow' }, running ? (rs.text || 'Em andamento…') : `Campanha ${state.textContent.toLowerCase()}`), h('b', {}, `${pct}%`));
        cancelBtn.style.display = running || camp.status === 'paused' ? '' : 'none';
        tbody.replaceChildren(
          h('div', { class: 'zf-qk-tr head' }, h('span', {}, 'ID'), h('span', {}, 'Nome'), h('span', {}, 'Número'), h('span', {}, 'Status')),
          ...camp.contacts.map((c, i) => [c, i]).filter(([c]) => c.status !== 'pending').slice(-300).map(([c, i]) => h('div', { class: 'zf-qk-tr' },
            h('span', {}, String(i)), h('span', {}, c.name || ''), h('span', {}, c.isGroup ? 'Grupo' : c.phone || ''),
            h('span', { class: 'zf-qk-status ' + c.status, title: c.error || '' }, SENT_LABEL[c.status] || c.status))));
      };
      const refresh = async () => { if (!alive) return; camp = (await store.get('campaigns')).find((c) => c.id === id) || camp; draw(); };
      store.onChange(['campaigns'], refresh);
      const off = ZF.on('runner', () => { if (alive) draw(); else off(); });
      cancelBtn.onclick = ui.safe(async () => {
        if (!(await ui.confirm('Cancelar este envio? Os contatos pendentes não receberão a mensagem.', { okLabel: 'Cancelar envio', danger: true, global: true }))) return;
        await store.updateItem('campaigns', id, (x) => ({ ...x, status: 'canceled', finishedAt: Date.now() }));
      });
      screen.replaceChildren(
        header('Envio Rápido', null),
        h('div', { class: 'zf-qk-grid3' },
          h('button', { class: 'zf-qk-back', title: 'Voltar ao script', onclick: () => goStep2() }, icon('chevronLeft', 26), icon('chevronLeft', 26)),
          h('div', { class: 'zf-qk-prog' },
            h('div', { class: 'zf-qk-progtitle' }, h('span', {}, 'Enviando Campanha'), cancelBtn),
            totals, h('div', { class: 'zf-center' }, state), info, tbody)));
      refresh();
      ui.toast('Fechar esta janela durante o envio não interrompe-o. Para acompanhar de novo, abra o Envio em massa.', 'info', 7000);
    }

    buildStep1();
    ui.safe(switchSource)();
  };
})();
