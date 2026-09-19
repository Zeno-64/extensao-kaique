/* ZapFlow — editor de ações das respostas rápidas ("Ação do Resposta Rápida") */
(() => {
  'use strict';
  const ZF = window.ZF;
  const { h, icon, store, ui } = ZF;
  const T = () => ZF.ACTION_TYPES;

  /** Grava áudio pelo microfone. Devolve { button } — onDone(file) é chamado ao parar. */
  ui.recorderButton = (onDone, label = 'Gravar áudio') => {
    let recorder = null;
    const btn = h('button', { class: 'zf-btn sm' }, icon('mic', 14), label);
    const setLabel = (txt, rec) => { btn.replaceChildren(icon(rec ? 'stop' : 'mic', 14), txt); btn.classList.toggle('danger', !!rec); };
    btn.addEventListener('click', ui.safe(async (e) => {
      e.preventDefault();
      if (recorder) { recorder.stop(); return; }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm'].find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
      recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const chunks = [];
      const started = Date.now();
      const timer = setInterval(() => setLabel(`Parar (${ZF.fmtDuration(Date.now() - started)})`, true), 500);
      recorder.ondataavailable = (ev) => ev.data.size && chunks.push(ev.data);
      recorder.onstop = ui.safe(async () => {
        clearInterval(timer);
        stream.getTracks().forEach((t) => t.stop());
        recorder = null;
        setLabel(label);
        const mime = (type || 'audio/webm').split(';')[0];
        const blob = new Blob(chunks, { type: mime });
        if (blob.size < 500) return;
        await onDone(new File([blob], `audio-${ZF.fmtDate(Date.now()).replace(/\//g, '-')}.${mime.includes('ogg') ? 'ogg' : 'webm'}`, { type: mime }));
      });
      recorder.start(250);
      setLabel('Parar (0s)', true);
    }));
    return btn;
  };

  /**
   * Editor da lista de ações. Retorna { el, get(), validate() }.
   * validate() devolve a mensagem de erro da primeira ação incompleta (ou null).
   */
  ui.actionsEditor = (initial = [], { title = 'Ação do Resposta Rápida' } = {}) => {
    let actions = ZF.clone(initial || []).map((a) => ({ id: a.id || ZF.uid(), ...a }));
    const open = new Set(actions.length <= 3 ? actions.map((a) => a.id) : []);
    let lastField = null;
    let labelsCache = null;

    const list = h('div', { class: 'zf-actlist' });
    const card = h('div', { class: 'zf-actcard' });
    card.addEventListener('focusin', (e) => {
      const t = e.target;
      if (t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && (t.type === 'text' || t.type === '')))) lastField = t;
    });

    /* ----- campos ----- */
    const bind = (el, a, key, ev = 'input') => { el.addEventListener(ev, () => { a[key] = el.type === 'checkbox' ? el.checked : el.value; refreshSummary(a); }); return el; };
    const ta = (a, key, placeholder, rows = 3) => bind(h('textarea', { class: 'zf-textarea', rows, value: a[key] || '', placeholder, style: { minHeight: rows * 22 + 16 + 'px' } }), a, key);
    const inp = (a, key, placeholder, props = {}) => bind(h('input', { class: 'zf-input', value: a[key] == null ? '' : a[key], placeholder, ...props }), a, key);
    const sel = (a, key, options) => bind(ui.select(options, a[key]), a, key, 'change');
    const chk = (a, key, label) => {
      const box = h('input', { type: 'checkbox', checked: !!a[key] });
      bind(box, a, key, 'change');
      return h('label', { class: 'zf-check' }, box, h('span', {}, label));
    };
    const num = (a, key, min, max) => {
      const el = h('input', { class: 'zf-input', type: 'number', min, max, value: a[key], style: { width: '110px' } });
      el.addEventListener('input', () => { a[key] = Math.max(min, Math.min(max, Number(el.value) || min)); refreshSummary(a); });
      return el;
    };
    const hint = (text) => h('div', { class: 'zf-hint' }, text);
    const field = (label, control, help) => ui.field(label, control, help);

    const filePick = (a, accept, label = 'Escolher arquivo') => {
      const box = h('div');
      const render = () => {
        box.replaceChildren();
        if (a.fileId) {
          const thumb = h('div', { class: 'zf-thumb' }, icon(T()[a.type] ? T()[a.type].icon : 'file', 20));
          if ((a.mime || '').startsWith('image/')) store.getFile(a.fileId).then((f) => { if (f) thumb.replaceChildren(h('img', { src: f.data, alt: '' })); });
          box.appendChild(h('div', { class: 'zf-filebox' }, thumb,
            h('div', { class: 'zf-grow', style: { minWidth: 0 } },
              h('div', { class: 'zf-ellipsis', style: { fontWeight: 600 } }, a.name),
              h('div', { class: 'zf-muted zf-small' }, ZF.fmtSize(a.size || 0))),
            h('button', { class: 'zf-btn sm', onclick: pick }, 'Trocar'),
            h('button', { class: 'zf-iconbtn', title: 'Remover arquivo', onclick: (e) => { e.preventDefault(); a.fileId = null; a.name = ''; render(); refreshSummary(a); } }, icon('x', 14))));
        } else {
          box.appendChild(h('button', { class: 'zf-btn sm', onclick: pick }, icon('paperclip', 14), label));
        }
      };
      const setFile = async (file) => {
        ui.toast('Salvando arquivo…');
        const meta = await store.saveFile(file);
        Object.assign(a, meta);
        render();
        refreshSummary(a);
      };
      const pick = ui.safe(async (e) => {
        if (e) e.preventDefault();
        const f = await ZF.pickFile(accept);
        if (f) await setFile(f);
      });
      box.setFile = setFile;
      render();
      return box;
    };

    const delayFields = (a) => {
      const time = inp(a, 'time', '09:00', { type: 'time', style: { width: '120px' } });
      const unit = sel(a, 'unit', [{ value: 'minutes', label: 'minuto(s)' }, { value: 'hours', label: 'hora(s)' }, { value: 'days', label: 'dia(s)' }]);
      const sync = () => { time.style.display = a.unit === 'days' ? '' : 'none'; };
      unit.addEventListener('change', sync);
      sync();
      return field('Quando', h('div', { class: 'zf-row', style: { flexWrap: 'wrap' } }, h('span', { class: 'zf-small' }, 'Daqui a'), num(a, 'amount', 0, 3650), unit, time),
        'Com "dia(s)", vale o horário escolhido (0 dia = hoje).');
    };

    const tabSelect = (a, key = 'tabId', optional = false) => {
      const wrap = h('div');
      const render = () => {
        const tabs = ZF.crm ? ZF.crm.tabs() : [];
        const s = ui.select([
          { value: '', label: optional ? '— Não mover —' : '— Escolha a aba —' },
          ...tabs.map((t) => ({ value: t.id, label: t.name })),
          { value: '__new', label: '+ Nova aba…' },
        ], a[key] || '');
        s.addEventListener('change', ui.safe(async () => {
          if (s.value === '__new') {
            const id = ZF.crm ? await ZF.crm.openTabEditor() : null;
            a[key] = id || null;
            render();
          } else a[key] = s.value || null;
          refreshSummary(a);
        }));
        wrap.replaceChildren(s);
      };
      render();
      return wrap;
    };

    const labelSelect = (a) => {
      const wrap = h('div', {}, h('div', { class: 'zf-hint' }, 'Carregando etiquetas do WhatsApp…'));
      const load = labelsCache || (labelsCache = ZF.wa.bridge('listLabels', {}, 15000));
      load.then((r) => {
        if (!r || !r.ok) {
          wrap.replaceChildren(hint('Não consegui ler as etiquetas do WhatsApp agora (disponíveis no WhatsApp Business ou nas listas). A ação será tentada mesmo assim.'),
            inp(a, 'labelName', 'Nome da etiqueta'));
          return;
        }
        const s = ui.select([{ value: '', label: '— Escolha a etiqueta —' }, ...r.labels.map((l) => ({ value: l.id, label: l.name }))], a.labelId || '');
        s.addEventListener('change', () => {
          a.labelId = s.value || null;
          a.labelName = (r.labels.find((l) => l.id === s.value) || {}).name || '';
          refreshSummary(a);
        });
        wrap.replaceChildren(r.labels.length ? s : hint('Nenhuma etiqueta encontrada no seu WhatsApp.'));
      });
      return wrap;
    };

    const replySelect = (a, textEl) => {
      const wrap = h('div');
      store.get('replies').then((replies) => {
        const opts = replies.map(ZF.migrateReply).filter((r) => r.kind !== 'script' && ZF.actionsToBlocks(r.actions || []).length);
        const s = ui.select([{ value: '', label: '— Escrever a mensagem abaixo —' }, ...opts.map((r) => ({ value: r.id, label: r.title }))], a.replyId || '');
        const sync = () => { textEl.style.display = a.replyId ? 'none' : ''; };
        s.addEventListener('change', () => { a.replyId = s.value || null; sync(); refreshSummary(a); });
        sync();
        wrap.replaceChildren(s);
      });
      return wrap;
    };

    const pixPreview = (a) => {
      const out = h('div', { class: 'zf-preview', style: { marginTop: '6px' } });
      const upd = () => {
        try {
          const blocks = ZF.actionToBlocks(a);
          out.textContent = blocks.length ? blocks.map((b) => b.text).join('\n\n— mensagem separada —\n') : 'Preencha a chave para ver a prévia.';
        } catch (e) { out.textContent = e.message; }
      };
      upd();
      out.update = upd;
      return out;
    };

    /* ----- editores por tipo ----- */
    const EDITORS = {
      text: (a) => [ta(a, 'text', 'Digite a mensagem… (*negrito*, _itálico_, {nome}, {Oi|Olá})', 5)],
      image: (a) => [filePick(a, 'image/*', 'Escolher imagem'), field('Legenda', ta(a, 'caption', 'Legenda (opcional)', 2))],
      video: (a) => [filePick(a, 'video/*', 'Escolher vídeo'), field('Legenda', ta(a, 'caption', 'Legenda (opcional)', 2))],
      document: (a) => [filePick(a, '*/*', 'Escolher documento'), field('Legenda', ta(a, 'caption', 'Legenda (opcional)', 2))],
      audio: (a) => {
        const fp = filePick(a, 'audio/*', 'Escolher áudio');
        return [h('div', { class: 'zf-row', style: { flexWrap: 'wrap', gap: '6px' } }, fp, ui.recorderButton((file) => fp.setFile(file))),
          chk(a, 'asVoice', 'Enviar como mensagem de voz (como se fosse gravado na hora)')];
      },
      sticker: (a) => [filePick(a, 'image/*', 'Escolher imagem'), hint('A imagem vira figurinha (WebP 512×512). Se o WhatsApp não aceitar, ela vai como foto.')],
      pix: (a) => {
        const prev = pixPreview(a);
        const card2 = h('div', {},
          h('div', { class: 'zf-grid2' }, field('Tipo de chave', sel(a, 'keyType', Object.entries(ZF.PIX_KEY_TYPES).map(([value, label]) => ({ value, label })))), field('Chave', inp(a, 'key', 'Sua chave Pix'))),
          h('div', { class: 'zf-grid2' }, field('Favorecido', inp(a, 'name', 'Nome do recebedor')), field('Cidade', inp(a, 'city', 'Ex.: Rio de Janeiro'))),
          h('div', { class: 'zf-grid2' }, field('Valor (opcional)', inp(a, 'amount', 'Ex.: 150,00')), h('div')),
          field('Mensagem', ta(a, 'message', 'Texto antes da chave', 2)),
          chk(a, 'copyPaste', 'Enviar também o código Pix "copia e cola" (numa mensagem separada, fácil de copiar)'),
          h('div', { class: 'zf-label' }, 'Prévia'), prev);
        card2.addEventListener('input', () => prev.update());
        card2.addEventListener('change', () => prev.update());
        return [card2];
      },
      group_invite: (a) => {
        const name = h('div', { class: 'zf-small', style: { fontWeight: 600 } }, a.groupName || 'Nenhum grupo escolhido');
        const link = inp(a, 'link', 'https://chat.whatsapp.com/…');
        const choose = h('button', {
          class: 'zf-btn sm', onclick: ui.safe(async (e) => {
            e.preventDefault();
            const r = await ui.pickChats({ title: 'Escolher grupo', filter: 'groups', multi: false });
            const g = r && r[0];
            if (!g) return;
            a.chatId = g.chatId;
            a.groupName = g.name;
            name.textContent = g.name;
            const inv = await ZF.wa.bridge('groupInvite', { chatId: g.chatId }, 8000);
            if (inv && inv.ok && inv.link) { a.link = inv.link; link.value = inv.link; ui.toast('Link do grupo encontrado', 'ok'); } else if (!a.link) ui.toast('Cole o link de convite do grupo (Dados do grupo → Convidar via link).', 'info', 5000);
            refreshSummary(a);
          }),
        }, icon('users', 14), 'Escolher grupo…');
        return [h('div', { class: 'zf-row', style: { marginBottom: '8px' } }, choose, name), field('Link de convite', link), field('Mensagem', ta(a, 'text', 'Texto antes do link', 2))];
      },
      contact: (a) => {
        const name = inp(a, 'name', 'Nome do contato');
        const phone = inp(a, 'phone', 'Ex.: 11 98765-4321');
        const fromWa = h('button', {
          class: 'zf-btn sm', onclick: ui.safe(async (e) => {
            e.preventDefault();
            const r = await ui.pickChats({ title: 'Escolher contato', filter: 'contacts', multi: false });
            const c = r && r[0];
            if (!c || !c.phone) return;
            a.name = c.name; a.phone = c.phone;
            name.value = c.name; phone.value = ZF.fmtPhone(c.phone);
            refreshSummary(a);
          }),
        }, icon('contactCard', 14), 'Do WhatsApp…');
        return [h('div', { class: 'zf-grid2' }, field('Nome', name), field('Telefone', phone)), fromWa,
          hint('Vai como cartão de contato (igual a Anexar → Contato). Se não der, vai como texto com o link wa.me.')];
      },
      link: (a) => [field('Link', inp(a, 'url', 'https://…')), field('Título do banner', inp(a, 'title', 'Ex.: Agende sua consulta')),
        field('Descrição', inp(a, 'description', 'Texto menor do banner')), field('Imagem do banner (opcional)', filePick(a, 'image/*', 'Escolher imagem')),
        field('Mensagem', ta(a, 'text', 'Texto antes do link (opcional)', 2))],
      list: (a) => [field('Título', inp(a, 'title', 'Ex.: Escolha uma opção')), field('Opções (uma por linha)', ta(a, 'items', 'Agendar consulta\nRemarcar\nFalar com a nutricionista', 4)),
        h('div', { class: 'zf-grid2' }, field('Rodapé', inp(a, 'footer', '')), field('Numeração', sel(a, 'style', [{ value: 'numbers', label: '1. 2. 3.' }, { value: 'emoji', label: 'Emojis 1️⃣ 2️⃣' }, { value: 'bullets', label: 'Marcadores •' }])))],
      location: (a) => [field('Nome do local', inp(a, 'name', 'Ex.: Consultório')), field('Endereço', inp(a, 'address', 'Rua, número, bairro, cidade')), hint('Vai com o link do Google Maps.')],

      crm_add: (a) => [field('Aba do CRM', tabSelect(a))],
      crm_remove: (a) => [field('Aba do CRM', tabSelect(a))],
      crm_clear: () => [hint('Tira a conversa de todas as abas do CRM.')],
      label_add: (a) => [field('Etiqueta do WhatsApp', labelSelect(a))],
      label_remove: (a) => [field('Etiqueta do WhatsApp', labelSelect(a))],
      label_clear: () => [hint('Remove todas as etiquetas do WhatsApp desta conversa.')],

      wait: (a) => [field('Segundos', num(a, 'seconds', 1, 3600)), hint('Pausa antes da próxima ação.')],
      typing: (a) => [field('Segundos', num(a, 'seconds', 1, 120)), hint('O contato vê "digitando…" durante esse tempo.')],
      recording: (a) => [field('Segundos', num(a, 'seconds', 1, 120)), hint('O contato vê "gravando áudio…" durante esse tempo.')],

      schedule: (a) => {
        const text = ta(a, 'text', 'Mensagem de acompanhamento… ({nome}, {saudacao})', 3);
        return [field('Mensagem', h('div', {}, replySelect(a, text), h('div', { style: { marginTop: '6px' } }, text))), delayFields(a)];
      },
      reminder: (a) => [field('Lembrete', inp(a, 'title', 'Ex.: Retornar para {nome}')), delayFields(a)],
      note: (a) => [ta(a, 'text', 'Nota salva na conversa (ex.: Enviou orçamento em {data})', 3)],
      gcal: (a) => [field('Título do evento', inp(a, 'title', 'Consulta — {nome}')), delayFields(a),
        field('Duração', sel(a, 'minutes', [15, 30, 45, 60, 90, 120].map((m) => ({ value: m, label: `${m} min` })))),
        hint('Abre o Google Agenda numa nova aba com o evento preenchido.')],
      mark_unread: () => [hint('Deixa a conversa marcada como não lida (bom para lembrar de voltar nela).')],
      archive: () => [hint('Move a conversa para Arquivadas.')],
      pin: () => [hint('Fixa a conversa no topo da lista.')],

      transfer: (a) => [h('div', { class: 'zf-grid2' }, field('Atendente', inp(a, 'name', 'Ex.: Dra. Ana')), field('WhatsApp do atendente', inp(a, 'phone', 'Ex.: 11 98765-4321'))),
        field('Mensagem para o cliente (opcional)', ta(a, 'toClient', '', 2)),
        field('Mensagem para o atendente', ta(a, 'toAgent', '', 3), 'Use {atendente} para o nome do atendente e {nome}/{telefone}/{numero} do cliente.'),
        field('Mover para a aba (opcional)', tabSelect(a, 'tabId', true))],
      finish: (a) => [field('Mensagem de despedida (opcional)', ta(a, 'text', 'Ex.: Obrigado pelo contato, {primeiro_nome}! 😊', 2)),
        chk(a, 'clearTabs', 'Tirar a conversa das abas do CRM'), chk(a, 'markRead', 'Marcar como lida'), chk(a, 'archive', 'Arquivar a conversa')],
    };

    /* ----- lista ----- */
    const names = () => ({
      tab: (id) => (ZF.crm && ZF.crm.tabById(id) ? ZF.crm.tabById(id).name : ''),
      reply: () => 'resposta rápida',
    });
    const summaries = {};
    function refreshSummary(a) {
      const el = summaries[a.id];
      if (el) el.textContent = ZF.actionSummary(a, names());
    }
    const move = (i, d) => {
      const j = i + d;
      if (j < 0 || j >= actions.length) return;
      [actions[i], actions[j]] = [actions[j], actions[i]];
      render();
    };

    function render() {
      list.replaceChildren();
      if (!actions.length) {
        list.appendChild(h('div', { class: 'zf-actempty' },
          icon('box', 30),
          h('div', { class: 'zf-actempty-t' }, 'Nenhuma ação foi atribuída'),
          h('div', { class: 'zf-muted' }, 'Adicione ações para criar e configurar modelos de envio personalizados para seus clientes')));
        return;
      }
      actions.forEach((a, i) => {
        const def = T()[a.type] || { label: a.type, icon: 'alert' };
        const isOpen = open.has(a.id);
        const sum = h('span', { class: 'zf-act-sum' }, ZF.actionSummary(a, names()));
        summaries[a.id] = sum;
        const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
        const head = h('div', { class: 'zf-act-h', onclick: () => { isOpen ? open.delete(a.id) : open.add(a.id); render(); } },
          h('span', { class: 'zf-act-num' }, i + 1),
          icon(def.icon, 17, 'zf-act-icon'),
          h('div', { class: 'zf-grow', style: { minWidth: 0 } }, h('div', { class: 'zf-act-label' }, def.label), isOpen ? null : sum),
          h('button', { class: 'zf-iconbtn', title: 'Subir', disabled: i === 0, onclick: stop(() => move(i, -1)) }, icon('arrowUp', 14)),
          h('button', { class: 'zf-iconbtn', title: 'Descer', disabled: i === actions.length - 1, onclick: stop(() => move(i, 1)) }, icon('arrowDown', 14)),
          h('button', { class: 'zf-iconbtn', title: 'Duplicar', onclick: stop(() => { const c = { ...ZF.clone(a), id: ZF.uid() }; actions.splice(i + 1, 0, c); open.add(c.id); render(); }) }, icon('copy', 14)),
          h('button', { class: 'zf-iconbtn', title: 'Remover ação', onclick: stop(() => { actions.splice(i, 1); render(); }) }, icon('trash', 14)),
          icon(isOpen ? 'chevronUp' : 'chevronDown', 16, 'zf-muted'));
        const item = h('div', { class: 'zf-act' + (def.danger ? ' danger' : '') + (isOpen ? ' open' : ''), dataset: { id: a.id } }, head);
        if (isOpen) item.appendChild(h('div', { class: 'zf-act-b' }, (EDITORS[a.type] || (() => [hint('Tipo de ação desconhecido.')]))(a)));
        list.appendChild(item);
      });
    }

    const add = (type) => {
      const a = ZF.newAction(type);
      actions.push(a);
      open.clear(); // mantém só a nova ação aberta (as outras mostram o resumo)
      open.add(a.id);
      render();
      setTimeout(() => {
        const el = list.querySelector(`[data-id="${a.id}"]`);
        if (el) {
          el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          const f = el.querySelector('textarea, input:not([type=checkbox])');
          if (f) f.focus();
        }
      }, 30);
    };
    const addBtn = h('button', {
      class: 'zf-btn primary lg', onclick: (e) => {
        e.preventDefault();
        ui.accordionMenu(e.currentTarget, ZF.ACTION_GROUPS.map((g) => ({
          key: g.key, label: g.label, icon: g.icon,
          items: g.types.map((t) => ({ label: T()[t].label, icon: T()[t].icon, danger: T()[t].danger, onClick: () => add(t) })),
        })));
      },
    }, 'Adicionar Ação');

    const tagsBtn = h('button', {
      class: 'zf-tagpill', title: 'Inserir variável no campo selecionado',
      onclick: (e) => {
        e.preventDefault();
        const target = lastField && lastField.isConnected ? lastField : null;
        const insert = (v) => {
          if (!target) { ui.toast('Clique primeiro no campo de texto onde quer inserir', 'info', 3500); return; }
          ui.insertAtCursor(target, v);
        };
        ui.menu(e.currentTarget, [
          { title: 'Variáveis' },
          ...ZF.BUILTIN_VARS.map((v) => ({ label: `{${v}} — ${ZF.VAR_HELP[v] || ''}`, onClick: () => insert(`{${v}}`) })),
          { label: '{atendente} — nome do atendente (transferência)', onClick: () => insert('{atendente}') },
          '-',
          { label: 'Campo perguntado na hora…', icon: 'plus', onClick: async () => {
            const r = await ui.askVars(['nome_do_campo'], 'Novo campo personalizado');
            const key = r && ZF.normKey(r.nome_do_campo);
            if (key) insert(`{${key}}`);
          } },
          { label: 'Variação aleatória {Oi|Olá}', icon: 'repeat', onClick: () => insert('{Oi|Olá|E aí}') },
        ]);
      },
    }, icon('hash', 13), 'Tags', icon('tag', 12));

    ZF.append(card,
      h('div', { class: 'zf-actcard-h' }, h('span', { class: 'zf-actcard-title' }, title), tagsBtn),
      list,
      h('div', { class: 'zf-center' }, addBtn));
    render();

    const validate = () => {
      for (let i = 0; i < actions.length; i++) {
        const a = actions[i];
        const def = T()[a.type];
        if (!def) continue;
        let err = null;
        if (def.msg && !ZF.actionToBlocks(a).length) err = def.file ? 'escolha o arquivo' : 'preencha a mensagem';
        if (['crm_add', 'crm_remove'].includes(a.type) && !a.tabId) err = 'escolha a aba';
        if (['label_add', 'label_remove'].includes(a.type) && !a.labelId && !(a.labelName || '').trim()) err = 'escolha a etiqueta';
        if (a.type === 'transfer' && !ZF.normalizePhone(a.phone)) err = 'informe o WhatsApp do atendente';
        if (a.type === 'schedule' && !a.replyId && !(a.text || '').trim()) err = 'escreva a mensagem';
        if (a.type === 'pix') { try { ZF.pixPayload(a); } catch (e) { err = e.message; } }
        if (err) {
          open.add(a.id);
          render();
          return `Ação ${i + 1} (${def.label}): ${err}`;
        }
      }
      return null;
    };

    return {
      el: card,
      get: () => ZF.clone(actions),
      validate,
      add,
    };
  };
})();
