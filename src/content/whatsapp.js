/*
 * ZapFlow — automação do WhatsApp Web via DOM.
 * Os seletores ficam todos em SEL para facilitar ajustes quando o WhatsApp mudar o layout.
 */
(() => {
  'use strict';
  const ZF = window.ZF;
  const { sleep } = ZF;

  const SEL = {
    appReady: ['#pane-side', '#side', '[data-testid="chat-list"]', 'div[aria-label="Lista de conversas"]', 'div[aria-label="Chat list"]'],
    main: ['#main', '[data-testid="conversation-panel-wrapper"]', '[data-testid="conversation-panel-messages"]'],
    compose: [
      '#main footer div[contenteditable="true"][role="textbox"]',
      '#main footer div[contenteditable="true"]',
      '#main div[contenteditable="true"][data-tab="10"]',
      'footer div[contenteditable="true"][role="textbox"]',
      'footer div[contenteditable="true"]',
      '[data-testid="conversation-compose-box-input"]',
      'div[contenteditable="true"][data-tab="10"]',
      'div[contenteditable="true"][aria-placeholder*="mensagem" i]',
      'div[contenteditable="true"][aria-placeholder*="message" i]',
      'div[contenteditable="true"][aria-label*="Digite uma mensagem" i]',
      'div[contenteditable="true"][aria-label*="Type a message" i]',
    ],
    sendIcon: [
      'span[data-icon="send"]',
      'span[data-icon="wds-ic-send-filled"]',
      'span[data-icon="send-light"]',
      '[data-testid="send"]',
      'button[aria-label="Enviar"]',
      'div[role="button"][aria-label="Enviar"]',
      'button[aria-label="Send"]',
      'div[role="button"][aria-label="Send"]',
    ],
    header: ['#main header', '[data-testid="conversation-header"]', '[data-testid="conversation-info-header"]'],
    pending: ['[data-icon="msg-time"]', '[data-icon="status-time"]'],
    popup: ['[data-animate-modal-popup="true"]', 'div[role="dialog"]'],
    attachBtn: [
      '[data-icon="plus-rounded"]',
      '[data-icon="plus"]',
      '[data-icon="attach-menu-plus"]',
      '[data-icon="clip"]',
      'button[title="Anexar"]',
      '[aria-label="Anexar"]',
      '[aria-label="Attach"]',
    ],
    captionBox: [
      'div[contenteditable="true"][aria-label*="legenda" i]',
      'div[contenteditable="true"][aria-label*="caption" i]',
      'div[contenteditable="true"][aria-placeholder*="legenda" i]',
      'div[contenteditable="true"][aria-placeholder*="caption" i]',
    ],
  };

  const qs = (sels, root = document) => {
    for (const s of [].concat(sels)) {
      try { const el = root.querySelector(s); if (el) return el; } catch (e) { /* seletor inválido */ }
    }
    return null;
  };
  const qsa = (sels, root = document) => {
    const out = new Set();
    for (const s of [].concat(sels)) {
      try { root.querySelectorAll(s).forEach((e) => out.add(e)); } catch (e) { /* ignora */ }
    }
    return [...out];
  };
  const visible = (el) => {
    if (!el || !el.isConnected || !el.getClientRects().length) return false;
    return typeof el.checkVisibility === 'function' ? el.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true }) : true;
  };
  const clickable = (el) => (el && (el.closest('button, [role="button"]') || el)) || null;

  async function waitFor(fn, timeout = 10000, interval = 200) {
    const end = Date.now() + timeout;
    for (;;) {
      let v = null;
      try { v = fn(); } catch (e) { v = null; }
      if (v) return v;
      if (Date.now() > end) return null;
      await sleep(interval);
    }
  }

  function realClick(el) {
    el = clickable(el);
    if (!el) return false;
    const opts = { bubbles: true, cancelable: true, view: window, button: 0 };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.click();
    return true;
  }

  /* ---------------- ponte com o contexto da página ---------------- */
  const pending = new Map();
  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.__zapflow !== 'res' || !pending.has(d.id)) return;
    const { resolve, timer } = pending.get(d.id);
    clearTimeout(timer);
    pending.delete(d.id);
    resolve(d.result);
  });
  const bridge = (action, args = {}, timeout = 15000) => new Promise((resolve) => {
    const id = ZF.uid();
    const timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, reason: 'timeout' }); }, timeout);
    pending.set(id, { resolve, timer });
    window.postMessage({ __zapflow: 'req', id, action, args }, location.origin);
  });

  /* ---------------- estado da interface ---------------- */
  const isReady = () => !!qs(SEL.appReady);
  const matchesAny = (el, sels) => [].concat(sels).some((s) => { try { return el.matches(s); } catch (e) { return false; } });
  /** É um campo da conversa aberta? (não da lista, de uma janela flutuante ou da legenda de um arquivo) */
  const inChat = (el) => !!el && !el.closest('#side, #pane-side, #zapflow-root, [data-animate-modal-popup="true"], div[role="dialog"]') && !matchesAny(el, SEL.captionBox);
  const getCompose = () => qsa(SEL.compose).find((el) => visible(el) && inChat(el)) || null;
  /** Tem conversa aberta na tela? Vários sinais, porque o WhatsApp troca de layout sem avisar */
  const chatOpen = () => !!(qsa(SEL.main).some(visible) || qsa(SEL.header).some(visible) || getCompose());
  /** Rodapé da conversa: partindo do campo de mensagem, sobrevive a mudanças no #main */
  const chatFooter = () => {
    const box = getCompose();
    return (box && box.closest('footer, [data-testid="compose-box"]')) || qs('#main footer') || null;
  };
  /** Painel da conversa aberta (lista de mensagens + rodapé) */
  const chatPanel = () => {
    const footer = chatFooter();
    return qs(SEL.main) || (footer && footer.parentElement) || null;
  };
  /** Campo de mensagem da conversa aberta; o erro diz o que está faltando */
  function requireCompose() {
    const box = getCompose();
    if (box) return box;
    if (!chatOpen()) throw ZF.userError('Abra uma conversa no WhatsApp primeiro.');
    throw ZF.userError('Não achei o campo de mensagem desta conversa. Clique no campo de texto do WhatsApp e tente de novo (em conversas só de leitura não dá para escrever).');
  }

  function headerTitle() {
    const header = qs(SEL.header);
    if (!header) return '';
    const t = header.querySelector('span[dir="auto"][title]') || header.querySelector('span[dir="auto"]');
    return t ? (t.getAttribute('title') || t.textContent || '').trim() : '';
  }

  /** Informações da conversa aberta (nome/telefone), com o melhor dado disponível */
  async function activeChatInfo() {
    if (!chatOpen()) return null;
    const title = headerTitle();
    const r = await bridge('getActiveChat', {}, 3000);
    if (r && r.ok) return { ...r, name: r.name || r.pushname || title };
    const digits = ZF.onlyDigits(title);
    return { ok: true, chatId: null, isGroup: false, phone: /^\+?[\d\s()-]+$/.test(title) && digits.length >= 10 ? digits : null, name: title };
  }

  /* ---------------- edição do campo de mensagem ---------------- */
  function placeCaretAtEnd(el) {
    el.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  const contentSnapshot = (el) => el.innerHTML.length + '|' + el.textContent;
  const isEmpty = (el) => !el.textContent.trim() && !el.querySelector('img, [data-plain-text]');

  async function clearBox(el) {
    placeCaretAtEnd(el);
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    await sleep(60);
    if (!isEmpty(el)) {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', keyCode: 65, ctrlKey: true, bubbles: true, cancelable: true }));
      document.execCommand('delete', false, null);
      await sleep(60);
    }
  }

  const pressEnter = (el, shift = false) => {
    const o = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, shiftKey: shift, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent('keydown', o));
    el.dispatchEvent(new KeyboardEvent('keypress', o));
    el.dispatchEvent(new KeyboardEvent('keyup', o));
  };

  /** Insere texto (com quebras de linha e emojis) no editor do WhatsApp */
  async function insertText(el, text, { replace = false } = {}) {
    if (replace) await clearBox(el);
    placeCaretAtEnd(el);
    await sleep(30);
    const before = contentSnapshot(el);

    // 1) colar via evento de paste (preserva quebras de linha)
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    } catch (e) { /* segue para o fallback */ }
    await sleep(150);
    if (contentSnapshot(el) !== before) return true;

    // 2) fallback: digita linha por linha com Shift+Enter
    placeCaretAtEnd(el);
    const lines = String(text).split('\n');
    lines.forEach((line, i) => {
      if (i > 0) pressEnter(el, true);
      if (line) document.execCommand('insertText', false, line);
    });
    await sleep(120);
    return contentSnapshot(el) !== before;
  }

  /** Botão de enviar dentro do rodapé da conversa */
  const footerSendButton = () => {
    const footer = chatFooter();
    if (!footer) return null;
    const icon = qsa(SEL.sendIcon, footer).find(visible);
    return icon ? clickable(icon) : null;
  };

  /** Botão de enviar da tela de pré-visualização de mídia (fora do rodapé) */
  const mediaSendButton = () => {
    const footer = chatFooter();
    const icons = qsa(SEL.sendIcon).filter((e) => visible(e) && !(footer && footer.contains(e)) && !e.closest('#side, #pane-side'));
    return icons.length ? clickable(icons[icons.length - 1]) : null;
  };

  /** Botão de anexo do rodapé da conversa aberta */
  const attachButton = () => {
    const footer = chatFooter();
    const el = footer ? qs(SEL.attachBtn, footer) : null;
    return el && visible(el) ? clickable(el) : null;
  };

  const captionBox = () => {
    const compose = getCompose();
    const footer = chatFooter();
    const outside = (e) => visible(e) && e !== compose && !e.closest('#side, #pane-side, #zapflow-root') && !(footer && footer.contains(e));
    const direct = qsa(SEL.captionBox).filter(outside);
    if (direct.length) return direct[direct.length - 1];
    const all = qsa('div[contenteditable="true"]').filter(outside);
    return all.length ? all[all.length - 1] : null;
  };

  /** Relógios de "enviando…" da conversa aberta (não os da lista de conversas) */
  const pendingIcons = () => qsa(SEL.pending, chatPanel() || document).filter((e) => visible(e) && !e.closest('#side, #pane-side'));

  async function waitPendingClear(timeout = 30000) {
    await sleep(400);
    await waitFor(() => !pendingIcons().length, timeout, 400);
  }

  /* ---------------- envio ---------------- */
  async function sendText(text) {
    let box = await waitFor(getCompose, 8000);
    if (!box) box = requireCompose();
    const ok = await insertText(box, text, { replace: true });
    if (!ok) throw new Error('Não foi possível escrever a mensagem');
    await sleep(ZF.rand(250, 500));
    const btn = await waitFor(footerSendButton, 3000, 150);
    if (btn) realClick(btn);
    else pressEnter(box);
    const cleared = await waitFor(() => isEmpty(box) || !box.isConnected, 8000, 150);
    if (!cleared) throw new Error('A mensagem não saiu do campo de texto');
    await waitPendingClear(20000);
  }

  async function attachViaInput(file) {
    const btn = attachButton();
    if (!btn) return false;
    realClick(btn);
    const isMedia = /^(image|video)\//.test(file.type);
    const input = await waitFor(() => {
      const inputs = [...document.querySelectorAll('input[type="file"]')];
      if (!inputs.length) return null;
      const media = inputs.find((i) => /image|video/.test(i.accept || ''));
      const doc = inputs.find((i) => !i.accept || i.accept === '*' || !/image|video/.test(i.accept));
      return isMedia ? media || doc : doc || inputs[0];
    }, 4000, 150);
    if (!input) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return false;
    }
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  async function sendFile(fileRec, caption = '') {
    let box = await waitFor(getCompose, 8000);
    if (!box) box = requireCompose();
    await clearBox(box);
    const file = fileRec.file || ZF.dataURLtoFile(fileRec.data, fileRec.name, fileRec.mime);

    // 1) cola o arquivo no campo de mensagem
    placeCaretAtEnd(box);
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    } catch (e) { /* fallback abaixo */ }
    let sendBtn = await waitFor(mediaSendButton, 5000, 200);

    // 2) fallback: menu de anexar + input de arquivo
    if (!sendBtn) {
      const ok = await attachViaInput(file);
      if (ok) sendBtn = await waitFor(mediaSendButton, 10000, 200);
    }
    if (!sendBtn) throw new Error('Não foi possível anexar o arquivo');

    if (caption && caption.trim()) {
      const cap = await waitFor(captionBox, 3000, 150);
      if (cap) await insertText(cap, caption, { replace: true });
    }
    await sleep(ZF.rand(400, 800));
    realClick(mediaSendButton() || sendBtn);
    const closed = await waitFor(() => !mediaSendButton(), 60000, 300);
    if (!closed) throw new Error('A pré-visualização do arquivo não fechou');
    await waitPendingClear(90000);
  }

  /** Nome da assinatura (Configurações): o personalizado ou o nome do perfil do WhatsApp; '' = sem assinatura */
  let profileName = null;
  async function signatureName(settings) {
    if (!settings || !settings.signature) return '';
    const custom = String(settings.signatureName || '').trim();
    if (settings.signatureCustom && custom) return custom;
    if (!profileName) {
      const r = await bridge('me', {}, 3000);
      profileName = (r && r.ok && r.name) || '';
    }
    return profileName;
  }

  /** Envia uma sequência de blocos (já renderizados) na conversa aberta */
  async function sendBlocks(blocks) {
    const list = blocks.filter(ZF.blockHasContent);
    if (!list.length) throw ZF.userError('Mensagem vazia');
    for (let i = 0; i < list.length; i++) {
      await sendBlockUI(list[i]);
      if (i < list.length - 1) await sleep(ZF.rand(900, 1800));
    }
  }

  /** Coloca o texto no campo (sem enviar). Arquivos são apenas anexados na pré-visualização. */
  async function insertBlocks(blocks) {
    const box = requireCompose();
    blocks = ZF.signBlocks(blocks, await signatureName((ZF.ui && ZF.ui.settings) || (await ZF.store.settings())));
    const texts = blocks.filter((b) => (b.type === 'text' && b.text.trim()) || b.type === 'vcard').map((b) => (b.type === 'vcard' ? ZF.vcardText(b) : b.text));
    const files = blocks.filter((b) => b.type === 'file');
    if (texts.length) {
      const text = texts.join('\n\n');
      const before = contentSnapshot(box);
      // 1) pela ação interna do WhatsApp; 2) simulando colar/digitar
      const r = await bridge('composeInsert', { text }, 3000);
      const ok = r && r.ok && (await waitFor(() => contentSnapshot(box) !== before, 1500, 100));
      if (!ok) await insertText(box, text);
    }
    if (files.length && !texts.length) {
      const rec = await ZF.store.getFile(files[0].fileId);
      if (rec) {
        const file = ZF.dataURLtoFile(rec.data, rec.name, rec.mime);
        const r = await bridge('composeFiles', { files: [file] }, 3000);
        const ok = r && r.ok && (await waitFor(mediaSendButton, 2500, 150));
        if (!ok) {
          placeCaretAtEnd(box);
          const dt = new DataTransfer();
          dt.items.add(file);
          box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
        }
      }
    }
    return { skippedFiles: texts.length ? files.length : Math.max(0, files.length - 1) };
  }

  /* ---------------- abrir conversas (sem recarregar) ---------------- */
  /**
   * Tenta abrir a conversa pelo link interno wa.me. Se o WhatsApp não tratar o
   * clique, a navegação é cancelada — a página nunca recarrega aqui.
   */
  async function openChatViaLink(phone) {
    const before = headerTitle();
    const a = document.createElement('a');
    a.href = `https://wa.me/${phone}`;
    a.style.display = 'none';
    let handled = false;
    const guard = (e) => {
      if (!e.composedPath().includes(a)) return;
      if (e.defaultPrevented) handled = true;
      else e.preventDefault();
    };
    window.addEventListener('click', guard);
    (document.querySelector('#app') || document.body).appendChild(a);
    try { a.click(); } finally { window.removeEventListener('click', guard); a.remove(); }
    if (!handled) return { ok: false };
    const res = await waitFor(() => {
      const pop = qsa(SEL.popup).find((p) => visible(p) && /inv[aá]lid|invalid|n[aã]o est[aá] no whatsapp|isn.t on whatsapp/i.test(p.textContent || ''));
      if (pop) return 'invalid';
      return getCompose() && headerTitle() !== before ? 'ok' : null;
    }, 15000, 250);
    if (res === 'invalid') {
      const pop = qsa(SEL.popup).find(visible);
      const btn = pop && [...pop.querySelectorAll('button, [role="button"]')].pop();
      if (btn) realClick(btn);
      return { ok: false, invalid: true };
    }
    return { ok: res === 'ok' };
  }

  /** Abre a conversa na interface. Retorna {ok} | {ok:false, invalid} | {ok:false, reason} */
  async function openChatUI({ phone, chatId }) {
    const r = await bridge('openChat', { phone, chatId }, 25000);
    if (r && r.ok && (await waitFor(getCompose, 8000))) return { ok: true };
    if (r && r.reason === 'not_found') return { ok: false, invalid: true };
    if (phone) {
      const l = await openChatViaLink(phone);
      if (l.ok || l.invalid) return l;
    }
    return { ok: false, reason: (r && r.reason) || 'open_failed' };
  }

  /* ---------------- envio a qualquer destino ---------------- */
  // Motivos em que ainda é seguro tentar pela interface (nada foi enviado)
  const RETRYABLE = ['unavailable', 'no_chat', 'find_failed', 'error', 'media_error', 'no_target'];

  async function sendDirect(target, b) {
    const args = { phone: target.phone || undefined, chatId: target.chatId || undefined };
    if (b.type === 'text') {
      let linkPreview;
      if (b.linkPreview && b.linkPreview.url) {
        linkPreview = { url: b.linkPreview.url, title: b.linkPreview.title, description: b.linkPreview.description };
        const img = b.linkPreview.thumbFileId ? await ZF.store.getFile(b.linkPreview.thumbFileId) : null;
        if (img) { try { linkPreview.thumbnail = await ZF.thumbBase64(img.data); } catch (e) { /* segue sem imagem */ } }
      }
      return (await bridge('sendText', { ...args, text: b.text, linkPreview }, 60000)) || { ok: false };
    }
    if (b.type === 'vcard') {
      return (await bridge('sendVcard', { ...args, name: b.name || ZF.fmtPhone(b.phone), vcard: ZF.vcard(b) }, 60000)) || { ok: false };
    }
    const rec = await fileRecOf(b);
    const file = rec.file || ZF.dataURLtoFile(rec.data, rec.name, rec.mime);
    const mime = rec.mime || '';
    if (b.asSticker && mime.startsWith('image/')) {
      let sticker = null;
      try { sticker = await ZF.toStickerFile(rec); } catch (e) { /* manda como imagem */ }
      const r = sticker ? await bridge('sendMedia', { ...args, file: sticker, mode: 'sticker' }, 180000) : null;
      if (r && (r.ok || !RETRYABLE.includes(r.reason))) return r;
      return (await bridge('sendMedia', { ...args, file, mode: 'auto' }, 180000)) || { ok: false };
    }
    const mode = mime.startsWith('audio/') ? (b.asVoice ? 'ptt' : 'audio') : b.asDocument ? 'document' : /^(image|video)\//.test(mime) ? 'auto' : 'document';
    let r = await bridge('sendMedia', { ...args, file, caption: b.caption, mode }, 180000);
    if (r && !r.ok && mode === 'ptt' && RETRYABLE.includes(r.reason)) {
      r = await bridge('sendMedia', { ...args, file, caption: b.caption, mode: 'audio' }, 180000);
    }
    return r || { ok: false };
  }

  /** Envio pela interface (conversa aberta). Contato vira texto e figurinha vira imagem. */
  async function sendBlockUI(b) {
    if (b.type === 'text') return sendText(b.text);
    if (b.type === 'vcard') return sendText(ZF.vcardText(b));
    return sendFile(await fileRecOf(b), b.caption);
  }

  /** Arquivo do bloco: salvo no storage (fileId) ou gerado na hora (inline: {name, mime, file}), ex.: backup */
  async function fileRecOf(b) {
    const rec = b.inline || (await ZF.store.getFile(b.fileId));
    if (!rec) throw new Error(`Arquivo "${b.name}" não encontrado`);
    return rec;
  }

  /**
   * Envia blocos (já renderizados) para um destino {phone, chatId}, sem recarregar a página:
   * 1) direto pelas funções internas do WhatsApp — não troca a conversa aberta;
   * 2) se não der, abre a conversa na interface e envia como um humano.
   * Retorna {ok, usedUi, prevChat} | {ok:false, invalid} | {ok:false, needReload, remaining}.
   */
  async function deliver(target, blocks, settings = {}, { isOpen = false } = {}) {
    const list = ZF.signBlocks(blocks.filter(ZF.blockHasContent), await signatureName(settings));
    if (!list.length) throw ZF.userError('Mensagem vazia');
    // isOpen: o destino já é a conversa aberta — o caminho pela interface não precisa abrir nada
    let ui = isOpen ? { prevChat: null } : null;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      let sent = false;
      if (settings.directSend !== false) {
        const r = await sendDirect(target, b);
        if (r.ok) sent = true;
        else if (r.reason === 'not_found') return { ok: false, invalid: true, error: 'Número não tem WhatsApp' };
        else if (!RETRYABLE.includes(r.reason)) throw new Error(r.error || `Falha no envio (${r.reason || 'desconhecida'})`);
      }
      if (!sent) {
        if (!ui) {
          const prevChat = await bridge('getActiveChat', {}, 2000);
          const o = await openChatUI(target);
          if (!o.ok) {
            if (o.invalid) return { ok: false, invalid: true, error: 'Número não tem WhatsApp' };
            return { ok: false, needReload: true, remaining: list.slice(i), error: 'Não foi possível abrir a conversa sem recarregar a página' };
          }
          ui = { prevChat };
          await sleep(ZF.rand(500, 900));
        }
        await sendBlockUI(b);
      }
      if (i < list.length - 1) await sleep(ZF.rand(900, 1800));
    }
    return { ok: true, usedUi: !!(ui && ui.prevChat), prevChat: ui ? ui.prevChat : null };
  }

  /** Após abrir via link /send?phone=, espera a conversa ou o aviso de número inválido */
  async function waitChatAfterNavigation(timeout = 60000) {
    const res = await waitFor(() => {
      const pop = qsa(SEL.popup).find((p) => visible(p) && /inv[aá]lid|invalid|n[aã]o est[aá] no whatsapp|isn.t on whatsapp/i.test(p.textContent || ''));
      if (pop) return 'invalid';
      return getCompose() ? 'ok' : null;
    }, timeout, 300);
    if (res === 'invalid') {
      const pop = qsa(SEL.popup).find(visible);
      const btn = pop && [...pop.querySelectorAll('button, [role="button"]')].pop();
      if (btn) realClick(btn);
      return { ok: false, invalid: true };
    }
    return res === 'ok' ? { ok: true } : { ok: false, reason: 'timeout' };
  }

  async function diagnostics() {
    const ping = await bridge('ping', {}, 3000);
    return {
      appReady: isReady(),
      chatOpen: chatOpen(),
      compose: !!getCompose(),
      attach: !!attachButton(),
      bridge: ping && ping.ok ? ping.modules : null,
    };
  }

  /** Último recurso (só se permitido nas Configurações): abre pelo link oficial e recarrega o WhatsApp Web */
  const openChatByLink = (phone) => {
    location.href = `https://web.whatsapp.com/send?phone=${encodeURIComponent(phone)}`;
  };

  /** Chamada à ponte que exige resposta ok; lança erro amigável se o recurso não existir */
  async function call(action, args, timeout) {
    const r = await bridge(action, args, timeout);
    if (!r || !r.ok) {
      const why = r && r.reason;
      if (why === 'unavailable' || why === 'timeout') throw new Error('Recurso indisponível nesta versão do WhatsApp Web (veja Configurações → Diagnóstico).');
      throw new Error(r && r.error ? r.error : `Não foi possível concluir (${why || 'erro'})`);
    }
    return r;
  }

  ZF.wa = {
    SEL, qs, qsa, waitFor, visible, bridge, call,
    isReady, getCompose, chatOpen, requireCompose, headerTitle, activeChatInfo,
    insertText, sendText, sendFile, sendBlocks, insertBlocks,
    openChatUI, openChatViaLink, openChatByLink, deliver, signatureName,
    waitChatAfterNavigation, waitPendingClear, diagnostics,
  };
})();
