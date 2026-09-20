/* ZapFlow — aba "IA": assistente com Claude (sugestão de resposta, resumo, reescrita, tradução) */
(() => {
  'use strict';
  const ZF = window.ZF;
  const { h, icon, store, ui } = ZF;

  const MODELS = [
    { value: 'claude-opus-5', label: 'Claude Opus 5 — melhor qualidade (padrão)' },
    { value: 'claude-sonnet-5', label: 'Claude Sonnet 5 — mais rápido e econômico' },
    { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 — o mais econômico' },
  ];
  const EFFORTS = [
    { value: 'low', label: 'Rápido (recomendado para mensagens)' },
    { value: 'medium', label: 'Equilibrado' },
    { value: 'high', label: 'Caprichado (mais lento)' },
  ];

  let keyInfo = null; // { hasKey, hint }
  let busy = false;
  const results = []; // respostas desta sessão (mais recente primeiro)
  let promptDraft = '';
  let useChatContext = true;

  const bg = (msg) => chrome.runtime.sendMessage(msg);
  async function refreshKey() {
    try { keyInfo = await bg({ type: 'ZF_AI_HAS_KEY' }); } catch (e) { keyInfo = { hasKey: false }; }
  }

  /* ---------------- contexto da conversa ---------------- */
  /** Últimas mensagens da conversa aberta: pela ponte ou lendo a tela */
  async function readConversation(limit = 30) {
    const r = await ZF.wa.bridge('getMessages', { limit }, 4000);
    let msgs = r && r.ok ? r.messages : null;
    if (!msgs || !msgs.length) {
      msgs = [...document.querySelectorAll('#main .message-in, #main .message-out')].slice(-limit).map((el) => {
        const t = el.querySelector('span.selectable-text, .copyable-text span[dir]');
        return { fromMe: el.classList.contains('message-out'), text: t ? t.innerText : '' };
      }).filter((m) => m.text);
    }
    return msgs;
  }
  const transcript = (msgs, name) => msgs.map((m) => `${m.fromMe ? 'Atendente' : (name || 'Cliente')}: ${m.text}`).join('\n');

  const composeText = () => { const box = ZF.wa.getCompose(); return box ? box.innerText.trim() : ''; };

  async function systemPrompt() {
    const s = await store.settings();
    return [
      'Você é um assistente de atendimento pelo WhatsApp, integrado a uma extensão usada por um profissional para falar com clientes e pacientes.',
      'Escreva em português do Brasil, a menos que o pedido indique outro idioma.',
      'Mensagens para enviar no WhatsApp devem soar naturais, cordiais e objetivas, com frases curtas e sem títulos ou listas longas; use a formatação do WhatsApp (*negrito*, _itálico_) só quando ajudar.',
      'Não invente fatos, valores, datas, horários ou políticas que não estejam no contexto; quando faltar uma informação, deixe um marcador entre colchetes, como [horário], para o atendente preencher.',
      'Quando o pedido for um texto para enviar, responda apenas com o texto da mensagem, sem comentários antes ou depois.',
      s.aiInstructions ? `Informações do negócio e preferências do atendente:\n${s.aiInstructions}` : '',
    ].filter(Boolean).join('\n\n');
  }

  /* ---------------- chamada à IA ---------------- */
  async function ask({ kind, label, prompt, source }) {
    if (busy) return;
    busy = true;
    ui.rerender('ai');
    const keepalive = setInterval(() => bg({ type: 'ZF_KEEPALIVE' }).catch(() => {}), 20000);
    try {
      const r = await bg({ type: 'ZF_AI', system: await systemPrompt(), messages: [{ role: 'user', content: prompt }], maxTokens: 8000 });
      if (!r || !r.ok) {
        if (r && (r.code === 'no_key' || r.code === 'auth')) await refreshKey();
        throw new Error((r && r.error) || 'Falha ao falar com a IA');
      }
      results.unshift({ id: ZF.uid(), kind, label, text: r.text, source, truncated: r.truncated, at: Date.now() });
      if (results.length > 20) results.pop();
    } finally {
      clearInterval(keepalive);
      busy = false;
      ui.rerender('ai');
    }
  }

  const actions = {
    async suggest() {
      const info = await ZF.wa.requireChat();
      const msgs = await readConversation(30);
      if (!msgs.length) throw ZF.userError('Não encontrei mensagens nesta conversa.');
      await ask({
        kind: 'message', label: `Sugestão de resposta — ${info.name || 'conversa'}`,
        prompt: `Conversa recente no WhatsApp com ${info.name || 'o cliente'}:\n<conversa>\n${transcript(msgs, ZF.firstName(info.name))}\n</conversa>\n\nEscreva a próxima mensagem que o atendente deve enviar, respondendo ao que ficou pendente.`,
      });
    },
    async summarize() {
      const info = await ZF.wa.requireChat();
      const msgs = await readConversation(60);
      if (!msgs.length) throw ZF.userError('Não encontrei mensagens nesta conversa.');
      await ask({
        kind: 'note', label: `Resumo — ${info.name || 'conversa'}`,
        prompt: `Conversa no WhatsApp com ${info.name || 'o cliente'}:\n<conversa>\n${transcript(msgs, ZF.firstName(info.name))}\n</conversa>\n\nResuma em tópicos curtos: o que a pessoa quer, o que já foi combinado, o que está pendente e o próximo passo recomendado. Este resumo é para o atendente, não para enviar.`,
      });
    },
    async rewrite(mode) {
      const text = composeText();
      if (!text) throw ZF.userError('Escreva algo no campo de mensagem do WhatsApp primeiro.');
      const s = await store.settings();
      const orders = {
        improve: 'Reescreva a mensagem abaixo deixando-a mais clara, cordial e profissional, mantendo o sentido e um tamanho parecido.',
        fix: 'Corrija ortografia, acentuação e gramática da mensagem abaixo, sem mudar o estilo nem o sentido.',
        shorter: 'Deixe a mensagem abaixo mais curta e direta, mantendo o essencial.',
        translate: `Traduza a mensagem abaixo para ${s.aiLanguage || 'inglês'}. Responda só com a tradução.`,
      };
      const labels = { improve: 'Texto melhorado', fix: 'Texto corrigido', shorter: 'Texto mais curto', translate: `Tradução (${s.aiLanguage || 'inglês'})` };
      await ask({ kind: 'message', label: labels[mode], source: 'compose', prompt: `${orders[mode]}\n\n<mensagem>\n${text}\n</mensagem>` });
    },
    async free(text, withChat) {
      if (!text.trim()) throw ZF.userError('Escreva o que você quer pedir à IA.');
      let prompt = text.trim();
      if (withChat) {
        const info = await ZF.wa.activeChatInfo();
        const msgs = info ? await readConversation(30) : [];
        if (msgs.length) prompt = `Contexto — conversa recente com ${info.name || 'o cliente'}:\n<conversa>\n${transcript(msgs, ZF.firstName(info.name))}\n</conversa>\n\nPedido: ${prompt}`;
      }
      await ask({ kind: 'free', label: text.trim().slice(0, 60), prompt });
      promptDraft = '';
    },
  };

  /* ---------------- usar o resultado ---------------- */
  async function useResult(r, how) {
    if (how === 'copy') {
      await navigator.clipboard.writeText(r.text);
      ui.toast('Copiado', 'ok');
      return;
    }
    if (how === 'save') {
      ZF.openReplyEditor(null, { title: r.label.slice(0, 40), blocks: [{ type: 'text', text: r.text }] });
      return;
    }
    if (how === 'note') {
      const info = await ZF.wa.activeChatInfo();
      if (!info) throw ZF.userError('Abra a conversa para salvar a nota.');
      await ZF.crm.upsert(info, (c) => { c.notes = [...(c.notes || []), { id: ZF.uid(), text: r.text, createdAt: Date.now() }]; });
      ui.toast('Salvo nas notas do contato', 'ok');
      return;
    }
    const box = ZF.wa.requireCompose();
    if (how === 'replace') {
      const ok = await ZF.wa.bridge('composeInsert', { text: r.text, replace: true }, 3000);
      if (!(ok && ok.ok && (await ZF.wa.waitFor(() => box.innerText.trim() === r.text.trim(), 1500, 100)))) {
        await ZF.wa.insertText(box, r.text, { replace: true });
      }
      return;
    }
    if (how === 'insert') {
      await ZF.wa.insertBlocks([{ type: 'text', text: r.text }]);
      return;
    }
    if (how === 'send') {
      const info = await ZF.wa.activeChatInfo();
      await ZF.runner.exclusive(async () => {
        const target = { chatId: info && info.chatId, phone: info && info.phone };
        if (!target.chatId && !target.phone) return ZF.wa.sendBlocks([{ type: 'text', text: r.text }]);
        const res = await ZF.wa.deliver(target, [{ type: 'text', text: r.text }], ui.settings, { isOpen: true });
        if (!res.ok) throw new Error(res.error || 'Falha no envio');
      });
      ui.toast('Mensagem enviada', 'ok');
    }
  }

  /* ---------------- renderização ---------------- */
  function renderSetup(body) {
    const key = h('input', { class: 'zf-input', type: 'password', placeholder: 'sk-ant-…', autocomplete: 'off' });
    ZF.append(body,
      h('div', { class: 'zf-h2' }, icon('sparkles', 18), 'Assistente de IA'),
      h('div', { class: 'zf-section' },
        h('div', { style: { fontSize: '13.5px', marginBottom: '8px' } },
          'O assistente usa o Claude, da Anthropic. Para ativar, cole sua chave da API — ela fica guardada só neste navegador e não vai para backups.'),
        h('ol', { class: 'zf-small', style: { margin: '0 0 10px', paddingLeft: '18px' } },
          h('li', {}, 'Acesse console.anthropic.com e crie uma conta.'),
          h('li', {}, 'Em "API Keys", crie uma chave e copie.'),
          h('li', {}, 'Cole abaixo. O uso é cobrado pela Anthropic na sua conta.')),
        ui.field('Chave da API', key),
        h('div', { class: 'zf-row', style: { gap: '6px' } },
          h('button', { class: 'zf-btn', onclick: () => window.open('https://console.anthropic.com/settings/keys', '_blank', 'noopener') }, icon('externalLink', 14), 'Abrir console'),
          h('button', {
            class: 'zf-btn primary', onclick: ui.safe(async () => {
              const v = key.value.trim();
              if (!/^sk-ant-/.test(v)) { ui.toast('A chave deve começar com "sk-ant-"', 'error'); return; }
              await bg({ type: 'ZF_AI_KEY', key: v });
              await refreshKey();
              ui.toast('Chave salva', 'ok');
              ui.rerender('ai');
            }),
          }, icon('check', 14), 'Salvar chave'))));
  }

  function resultCard(r) {
    const btn = (label, ic, how, cls = '') => h('button', { class: 'zf-btn sm ' + cls, onclick: ui.safe(() => useResult(r, how)) }, icon(ic, 13), label);
    return h('div', { class: 'zf-card' },
      h('div', { class: 'zf-row' }, icon(r.kind === 'note' ? 'note' : 'sparkles', 15),
        h('div', { class: 'zf-name zf-grow zf-small' }, r.label),
        h('span', { class: 'zf-muted zf-small' }, ZF.fmtTime(r.at))),
      h('div', { style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '13.5px', marginTop: '6px' } }, r.text),
      r.truncated ? h('div', { class: 'zf-err' }, 'A resposta foi cortada por ser longa demais.') : null,
      h('div', { class: 'zf-actions' },
        r.kind === 'note'
          ? [btn('Salvar nas notas', 'note', 'note', 'primary'), btn('Copiar', 'copy', 'copy')]
          : [
            r.source === 'compose' ? btn('Substituir no campo', 'corner', 'replace', 'primary') : btn('Colocar no campo', 'corner', 'insert', 'primary'),
            btn('Enviar', 'send', 'send'),
            btn('Copiar', 'copy', 'copy'),
            btn('Salvar como resposta', 'zap', 'save'),
          ]));
  }

  function renderSettings(body, s) {
    const instr = h('textarea', {
      class: 'zf-textarea', rows: 4, value: s.aiInstructions || '',
      placeholder: 'Ex.: Sou nutricionista. Consultas online e presenciais (Barra e Tijuca). Valor da consulta: R$ 300. Tom acolhedor, trato por "você".',
      onchange: (e) => store.saveSettings({ aiInstructions: e.target.value.trim() }).then(() => ui.toast('Instruções salvas', 'ok', 1400)),
    });
    ZF.append(body, h('details', { class: 'zf-section', style: { padding: '8px 12px', marginTop: '12px' } },
      h('summary', { style: { cursor: 'pointer', fontWeight: 700, fontSize: '13px' } }, 'Configurar assistente'),
      h('div', { style: { marginTop: '10px' } },
        ui.field('Sobre o seu negócio (a IA usa em todas as respostas)', instr),
        ui.field('Modelo', ui.select(MODELS, s.aiModel, { onchange: (e) => store.saveSettings({ aiModel: e.target.value }) })),
        ui.field('Qualidade x velocidade', ui.select(EFFORTS, s.aiEffort, { onchange: (e) => store.saveSettings({ aiEffort: e.target.value }) })),
        ui.field('Idioma para "Traduzir"', ui.input({ value: s.aiLanguage || 'inglês', onchange: (e) => store.saveSettings({ aiLanguage: e.target.value.trim() || 'inglês' }) })),
        h('div', { class: 'zf-row', style: { gap: '6px', alignItems: 'center' } },
          h('span', { class: 'zf-muted zf-small zf-grow' }, `Chave: ${keyInfo.hint || '—'}`),
          h('button', {
            class: 'zf-btn sm danger', onclick: ui.safe(async () => {
              if (!(await ui.confirm('Remover a chave da API deste navegador?', { okLabel: 'Remover', danger: true }))) return;
              await bg({ type: 'ZF_AI_KEY', key: '' });
              await refreshKey();
              ui.rerender('ai');
            }),
          }, 'Remover chave')))));
  }

  function render(body) {
    if (!keyInfo) {
      ZF.append(body, h('div', { class: 'zf-empty' }, 'Carregando…'));
      refreshKey().then(() => ui.rerender('ai'));
      return;
    }
    if (!keyInfo.hasKey) return renderSetup(body);
    const s = ui.settings;
    const quick = (label, ic, fn, title) => h('button', { class: 'zf-btn sm', title, disabled: busy, onclick: ui.safe(fn) }, icon(ic, 13), label);
    const prompt = h('textarea', {
      class: 'zf-textarea', rows: 3, value: promptDraft, placeholder: 'Peça algo à IA… (ex.: "escreva uma mensagem de boas-vindas para paciente novo")',
      oninput: (e) => { promptDraft = e.target.value; },
      onkeydown: ui.safe(async (e) => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); await actions.free(prompt.value, useChatContext); } }),
    });
    const ctx = h('input', { type: 'checkbox', checked: useChatContext, onchange: (e) => { useChatContext = e.target.checked; } });

    ZF.append(body,
      h('div', { class: 'zf-h2' }, icon('sparkles', 18), 'Assistente de IA'),
      h('div', { class: 'zf-h3', style: { marginTop: 0 } }, 'Conversa aberta'),
      h('div', { class: 'zf-row', style: { flexWrap: 'wrap', gap: '6px' } },
        quick('Sugerir resposta', 'message', actions.suggest, 'Lê a conversa e sugere a próxima mensagem'),
        quick('Resumir conversa', 'note', actions.summarize)),
      h('div', { class: 'zf-h3' }, 'Texto do campo de mensagem'),
      h('div', { class: 'zf-row', style: { flexWrap: 'wrap', gap: '6px' } },
        quick('Melhorar', 'sparkles', () => actions.rewrite('improve')),
        quick('Corrigir', 'check', () => actions.rewrite('fix')),
        quick('Encurtar', 'corner', () => actions.rewrite('shorter')),
        quick(`Traduzir (${s.aiLanguage || 'inglês'})`, 'globe', () => actions.rewrite('translate'))),
      h('div', { class: 'zf-h3' }, 'Pedido livre'),
      prompt,
      h('div', { class: 'zf-row', style: { justifyContent: 'space-between', margin: '6px 0' } },
        h('label', { class: 'zf-check', style: { margin: 0 } }, ctx, h('span', { class: 'zf-small' }, 'Usar a conversa aberta como contexto')),
        h('button', { class: 'zf-btn sm primary', disabled: busy, onclick: ui.safe(() => actions.free(prompt.value, useChatContext)) }, icon('send', 13), 'Pedir')),
      busy ? h('div', { class: 'zf-note info' }, icon('loader', 15, 'zf-spin'), 'Pensando…') : null,
      results.map(resultCard),
      !results.length && !busy ? h('div', { class: 'zf-hint', style: { marginTop: '8px' } }, 'As respostas aparecem aqui. Você revisa antes de enviar.') : null);
    renderSettings(body, s);
  }

  ui.registerTab('ai', { icon: 'sparkles', title: 'Assistente de IA', render, noHeader: true });
})();
