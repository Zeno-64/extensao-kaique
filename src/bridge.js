/*
 * ZapFlow — ponte no contexto da página (world: MAIN).
 * Usa os módulos internos do WhatsApp Web (quando disponíveis) apenas para
 * descobrir a conversa ativa e abrir uma conversa sem recarregar a página.
 * Tudo aqui é "melhor esforço": se algo mudar no WhatsApp, o content script
 * cai automaticamente no modo seguro (abrir via link /send?phone=).
 */
(() => {
  'use strict';
  if (window.__zapflowBridge) return;
  window.__zapflowBridge = true;

  const mod = (name) => {
    try {
      if (typeof window.importNamespace === 'function') {
        const m = window.importNamespace(name);
        if (m) return m;
      }
    } catch (e) { /* tenta require */ }
    try {
      if (typeof window.require === 'function') return window.require(name);
    } catch (e) { /* indisponível */ }
    return null;
  };

  const ser = (id) => (id ? id._serialized || (typeof id.toString === 'function' ? id.toString() : String(id)) : '');
  const models = (col) => {
    if (!col) return [];
    if (typeof col.getModelsArray === 'function') return col.getModelsArray();
    return col.models || col._models || [];
  };

  const chatInfo = (chat) => {
    if (!chat) return null;
    const id = chat.id || {};
    const server = id.server || '';
    const contact = chat.contact || {};
    let phone = null;
    if (server === 'c.us') phone = id.user;
    else if (contact.phoneNumber && contact.phoneNumber.user) phone = contact.phoneNumber.user;
    return {
      chatId: ser(id),
      isGroup: server === 'g.us',
      phone,
      name: chat.formattedTitle || chat.name || contact.name || contact.pushname || contact.verifiedName || '',
      pushname: contact.pushname || '',
    };
  };

  const getActive = () => {
    const C = mod('WAWebCollections');
    if (!C || !C.Chat) return null;
    try {
      if (typeof C.Chat.getActive === 'function') {
        const a = C.Chat.getActive();
        if (a) return a;
      }
    } catch (e) { /* ignora */ }
    return models(C.Chat).find((c) => c.active) || null;
  };

  const isActive = (chat) => {
    const a = getActive();
    return !!a && (a === chat || ser(a.id) === ser(chat.id));
  };

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function openChatModel(chat) {
    const CmdMod = mod('WAWebCmd');
    const Cmd = (CmdMod && (CmdMod.Cmd || CmdMod)) || null;
    if (!Cmd) return false;
    const attempts = [
      () => Cmd.openChatBottom && Cmd.openChatBottom({ chat, chatEntryPoint: 'Chatlist' }),
      () => Cmd.openChatBottom && Cmd.openChatBottom(chat),
      () => Cmd.openChatAt && Cmd.openChatAt({ chat, chatEntryPoint: 'Chatlist' }),
      () => Cmd.openChatAt && Cmd.openChatAt(chat),
    ];
    for (const fn of attempts) {
      try { await fn(); } catch (e) { /* tenta a próxima assinatura */ }
      for (let i = 0; i < 10; i++) {
        if (isActive(chat)) return true;
        await wait(100);
      }
    }
    return false;
  }

  const actions = {
    ping() {
      const C = mod('WAWebCollections');
      return {
        ok: true,
        modules: {
          collections: !!(C && C.Chat),
          cmd: !!mod('WAWebCmd'),
          widFactory: !!mod('WAWebWidFactory'),
          findChat: !!mod('WAWebFindChatAction'),
          queryExists: !!mod('WAWebQueryExistsJob'),
        },
      };
    },

    getActiveChat() {
      const chat = getActive();
      return chat ? { ok: true, ...chatInfo(chat) } : { ok: false };
    },

    async openChat({ phone, chatId }) {
      const C = mod('WAWebCollections');
      if (!C || !C.Chat) return { ok: false, reason: 'unavailable' };
      let chat = null;

      if (chatId) {
        try { chat = C.Chat.get(chatId); } catch (e) { /* ignora */ }
        if (!chat) chat = models(C.Chat).find((c) => ser(c.id) === chatId) || null;
      }

      if (!chat && phone) {
        const WF = mod('WAWebWidFactory');
        const FC = mod('WAWebFindChatAction');
        if (!WF || !WF.createWid || !FC) return { ok: false, reason: 'unavailable' };
        let wid = WF.createWid(phone + '@c.us');

        // Confirma se o número existe (corrige o 9º dígito de números antigos, etc.)
        const QE = mod('WAWebQueryExistsJob');
        if (QE && typeof QE.queryWidExists === 'function') {
          try {
            const r = await QE.queryWidExists(wid);
            if (!r) return { ok: false, reason: 'not_found' };
            if (r.wid) wid = r.wid;
          } catch (e) { /* segue sem a verificação */ }
        }

        try { chat = C.Chat.get(wid); } catch (e) { /* ignora */ }
        if (!chat) chat = models(C.Chat).find((c) => ser(c.id) === ser(wid)) || null;
        if (!chat) {
          try {
            const fn = FC.findOrCreateLatestChat || FC.findChat;
            if (fn) {
              const r = await fn(wid, 'newChatFlow');
              chat = (r && r.chat) || r || null;
            }
          } catch (e) {
            return { ok: false, reason: 'find_failed', error: String((e && e.message) || e) };
          }
        }
      }

      if (!chat || !chat.id) return { ok: false, reason: 'no_chat' };
      if (isActive(chat)) return { ok: true, ...chatInfo(chat) };
      const opened = await openChatModel(chat);
      return opened ? { ok: true, ...chatInfo(chat) } : { ok: false, reason: 'open_failed' };
    },
  };

  window.addEventListener('message', async (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.__zapflow !== 'req' || !actions[d.action]) return;
    let result;
    try {
      result = await actions[d.action](d.args || {});
    } catch (e) {
      result = { ok: false, reason: 'error', error: String((e && e.message) || e) };
    }
    window.postMessage({ __zapflow: 'res', id: d.id, result }, location.origin);
  });
})();
