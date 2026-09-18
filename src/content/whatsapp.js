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
    main: ['#main'],
    compose: [
      '#main footer div[contenteditable="true"][role="textbox"]',
      '#main footer div[contenteditable="true"]',
      '#main div[contenteditable="true"][data-tab="10"]',
      'footer div[contenteditable="true"]',
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
    header: ['#main header'],
    pending: ['#main [data-icon="msg-time"]', '#main [data-icon="status-time"]'],
    popup: ['[data-animate-modal-popup="true"]', 'div[role="dialog"]'],
    attachBtn: [
      '#main footer [data-icon="plus-rounded"]',
      '#main footer [data-icon="plus"]',
      '#main footer [data-icon="attach-menu-plus"]',
      '#main footer [data-icon="clip"]',
      '#main footer button[title="Anexar"]',
      '#main footer [aria-label="Anexar"]',
      '#main footer [aria-label="Attach"]',
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
  const getCompose = () => {
    const el = qs(SEL.compose);
    return el && visible(el) ? el : null;
  };

  function headerTitle() {
    const header = qs(SEL.header);
    if (!header) return '';
    const t = header.querySelector('span[dir="auto"][title]') || header.querySelector('span[dir="auto"]');
    return t ? (t.getAttribute('title') || t.textContent || '').trim() : '';
  }

  /** Informações da conversa aberta (nome/telefone), com o melhor dado disponível */
  async function activeChatInfo() {
    if (!qs(SEL.main)) return null;
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
    const footer = qs('#main footer');
    if (!footer) return null;
    const icon = qsa(SEL.sendIcon, footer).find(visible);
    return icon ? clickable(icon) : null;
  };

  /** Botão de enviar da tela de pré-visualização de mídia (fora do rodapé) */
  const mediaSendButton = () => {
    const footer = qs('#main footer');
    const icons = qsa(SEL.sendIcon).filter((e) => visible(e) && !(footer && footer.contains(e)) && !e.closest('#side, #pane-side'));
    return icons.length ? clickable(icons[icons.length - 1]) : null;
  };

  const captionBox = () => {
    const compose = qs(SEL.compose);
    const direct = qsa(SEL.captionBox).filter((e) => visible(e) && e !== compose);
    if (direct.length) return direct[direct.length - 1];
    const all = qsa('div[contenteditable="true"]').filter((e) => visible(e) && e !== compose && !e.closest('#side, #pane-side, #main footer'));
    return all.length ? all[all.length - 1] : null;
  };

  async function waitPendingClear(timeout = 30000) {
    await sleep(400);
    await waitFor(() => !qsa(SEL.pending).some(visible), timeout, 400);
  }

  /* ---------------- envio ---------------- */
  async function sendText(text) {
    const box = await waitFor(getCompose, 8000);
    if (!box) throw new Error('Campo de mensagem não encontrado');
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
    const btn = qs(SEL.attachBtn);
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
    const box = await waitFor(getCompose, 8000);
    if (!box) throw new Error('Campo de mensagem não encontrado');
    await clearBox(box);
    const file = ZF.dataURLtoFile(fileRec.data, fileRec.name, fileRec.mime);

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

  /** Envia uma sequência de blocos (já renderizados) na conversa aberta */
  async function sendBlocks(blocks) {
    const list = blocks.filter((b) => (b.type === 'text' ? b.text && b.text.trim() : b.fileId));
    if (!list.length) throw new Error('Mensagem vazia');
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.type === 'text') await sendText(b.text);
      else {
        const rec = await ZF.store.getFile(b.fileId);
        if (!rec) throw new Error(`Arquivo "${b.name}" não encontrado`);
        await sendFile(rec, b.caption);
      }
      if (i < list.length - 1) await sleep(ZF.rand(900, 1800));
    }
  }

  /** Coloca o texto no campo (sem enviar). Arquivos são apenas anexados na pré-visualização. */
  async function insertBlocks(blocks) {
    const box = getCompose();
    if (!box) throw new Error('Abra uma conversa primeiro');
    const texts = blocks.filter((b) => b.type === 'text' && b.text.trim()).map((b) => b.text);
    const files = blocks.filter((b) => b.type === 'file');
    if (texts.length) await insertText(box, texts.join('\n\n'));
    if (files.length && !texts.length) {
      const rec = await ZF.store.getFile(files[0].fileId);
      if (rec) {
        placeCaretAtEnd(box);
        const dt = new DataTransfer();
        dt.items.add(ZF.dataURLtoFile(rec.data, rec.name, rec.mime));
        box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      }
    }
    return { skippedFiles: texts.length ? files.length : Math.max(0, files.length - 1) };
  }

  /* ---------------- abrir conversas ---------------- */
  /** Tenta abrir sem recarregar. Retorna {ok} ou {ok:false, reason}. */
  async function openChatFast({ phone, chatId }) {
    const r = await bridge('openChat', { phone, chatId }, 20000);
    if (!r || !r.ok) return r || { ok: false };
    const box = await waitFor(getCompose, 8000);
    return box ? r : { ok: false, reason: 'no_compose' };
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
      chatOpen: !!qs(SEL.main),
      compose: !!getCompose(),
      attach: !!qs(SEL.attachBtn),
      bridge: ping && ping.ok ? ping.modules : null,
    };
  }

  /** Modo seguro: abre a conversa pelo link oficial (recarrega o WhatsApp Web) */
  const openChatByLink = (phone) => {
    location.href = `https://web.whatsapp.com/send?phone=${encodeURIComponent(phone)}`;
  };

  ZF.wa = {
    SEL, qs, qsa, waitFor, visible, bridge,
    isReady, getCompose, headerTitle, activeChatInfo,
    insertText, sendText, sendFile, sendBlocks, insertBlocks,
    openChatFast, openChatByLink, waitChatAfterNavigation, waitPendingClear, diagnostics,
  };
})();
