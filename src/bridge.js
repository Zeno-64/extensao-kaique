/*
 * ZapFlow — ponte no contexto da página (world: MAIN).
 *
 * Usa as funções internas do WhatsApp Web (as mesmas que a interface dele usa)
 * para: enviar texto/mídia sem abrir a conversa, abrir conversas sem recarregar,
 * listar conversas, contatos, etiquetas e participantes de grupos.
 *
 * Nomes verificados no WhatsApp Web de set/2026: WAWebChatCollection, WAWebCmd,
 * WAWebWidFactory, WAWebFindChatAction, WAWebQueryExistsJob, WAWebSendTextMsgChatAction,
 * WAWebMediaOpaqueData, WAWebPrepRawMedia, WAWebComposeBoxActions, WAWebContactCollection,
 * WAWebLabelCollection, WAWebGroupMetadataCollection, WAWebLidMigrationUtils.
 * Se algo falhar, o content script cai para a automação pela interface.
 */
(() => {
  'use strict';
  if (window.__zapflowBridge) return;
  window.__zapflowBridge = true;

  /* ---------------- acesso aos módulos ---------------- */
  const defined = (name) => {
    try {
      const map = window.require('__debug').modulesMap;
      return !!(map && map[name]);
    } catch (e) {
      return typeof window.require === 'function';
    }
  };
  /** Namespace do módulo (inicializa se preciso). require() devolve o export padrão; importNamespace() o módulo inteiro. */
  const mod = (name) => {
    if (typeof window.require !== 'function' || !defined(name)) return null;
    let def = null, ns = null;
    try { def = window.require(name); } catch (e) { /* ignora */ }
    try { ns = typeof window.importNamespace === 'function' ? window.importNamespace(name) : null; } catch (e) { /* ignora */ }
    return ns || def || null;
  };
  const pick = (name, key) => {
    const m = mod(name);
    if (!m) return undefined;
    if (m[key] !== undefined) return m[key];
    return m.default && m.default[key] !== undefined ? m.default[key] : undefined;
  };
  const legacy = (key) => { const m = mod('WAWebCollections'); return m ? m[key] : null; };

  const Chats = () => pick('WAWebChatCollection', 'ChatCollection') || legacy('Chat');
  const Contacts = () => pick('WAWebContactCollection', 'ContactCollection') || legacy('Contact');
  const Labels = () => pick('WAWebLabelCollection', 'LabelCollection') || legacy('Label');
  const GroupMetas = () => { const m = mod('WAWebGroupMetadataCollection'); return m ? m.default || m.GroupMetadataCollection || null : legacy('GroupMetadata'); };

  const models = (col) => {
    if (!col) return [];
    try { if (typeof col.getModelsArray === 'function') return col.getModelsArray(); } catch (e) { /* ignora */ }
    return col.models || col._models || [];
  };
  /** Lê um campo pelo "getter" oficial e, se não der, pela propriedade do modelo */
  const field = (getterModule, fn, model, prop) => {
    if (!model) return undefined;
    try {
      const f = pick(getterModule, fn);
      if (typeof f === 'function') {
        const v = f(model);
        if (v !== undefined) return v;
      }
    } catch (e) { /* ignora */ }
    try { return model[prop]; } catch (e) { return undefined; }
  };
  const ser = (id) => (id ? id._serialized || (typeof id.toString === 'function' ? id.toString() : String(id)) : '');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------------- informações ---------------- */
  function phoneOf(wid, contact) {
    if (!wid) return null;
    if (wid.server === 'c.us') return wid.user;
    if (wid.server === 'lid') {
      for (const [m, fn] of [['WAWebLidMigrationUtils', 'toPn'], ['WAWebApiContact', 'getPhoneNumber']]) {
        try {
          const f = pick(m, fn);
          const pn = typeof f === 'function' ? f(wid) : null;
          if (pn && pn.user) return pn.user;
        } catch (e) { /* ignora */ }
      }
    }
    if (contact) {
      const pn = field('WAWebFrontendContactGetters', 'getPhoneNumber', contact, 'phoneNumber');
      if (pn && pn.user) return pn.user;
    }
    return null;
  }

  function chatInfo(chat) {
    if (!chat || !chat.id) return null;
    const id = chat.id;
    const contact = field('WAWebFrontendChatGetters', 'getContact', chat, 'contact');
    const isGroup = id.server === 'g.us';
    const pushname = contact ? field('WAWebContactGetters', 'getPushname', contact, 'pushname') || '' : '';
    const labels = field('WAWebChatGetters', 'getLabels', chat, 'labels');
    return {
      chatId: ser(id),
      isGroup,
      phone: isGroup ? null : phoneOf(id, contact),
      name: field('WAWebFrontendChatGetters', 'getFormattedTitle', chat, 'formattedTitle')
        || field('WAWebChatGetters', 'getName', chat, 'name')
        || (contact && (contact.name || pushname)) || '',
      pushname,
      unread: Number(field('WAWebChatGetters', 'getUnreadCount', chat, 'unreadCount')) || 0,
      archived: !!field('WAWebChatGetters', 'getArchive', chat, 'archive'),
      labels: Array.isArray(labels) ? labels.map(String) : [],
      t: Number(field('WAWebChatGetters', 'getT', chat, 't')) || 0,
    };
  }

  function getActive() {
    const C = Chats();
    if (!C) return null;
    try {
      const a = typeof C.getActive === 'function' ? C.getActive() : null;
      if (a) return a;
    } catch (e) { /* ignora */ }
    return models(C).find((c) => field('WAWebFrontendChatGetters', 'getActive', c, 'active')) || null;
  }
  const isActive = (chat) => {
    const a = getActive();
    return !!a && (a === chat || ser(a.id) === ser(chat.id));
  };

  const isUsableChat = (info) => info && info.chatId && !/@(broadcast|newsletter)$/.test(info.chatId) && info.chatId !== 'status@broadcast';

  /* ---------------- localizar / abrir conversas ---------------- */
  async function findOrCreate(wid) {
    const FC = mod('WAWebFindChatAction');
    const fn = FC && (FC.findOrCreateLatestChat || FC.findChat);
    if (typeof fn !== 'function') return null;
    const r = await fn(wid, 'newChatFlow');
    return (r && r.chat) || (r && r.id ? r : null);
  }

  /** Encontra o modelo da conversa. Retorna { chat } ou { error } */
  async function resolveChat({ phone, chatId }) {
    const C = Chats();
    if (!C) return { error: 'unavailable' };
    if (chatId) {
      let chat = null;
      try { chat = C.get(chatId); } catch (e) { /* ignora */ }
      if (!chat) chat = models(C).find((c) => ser(c.id) === chatId) || null;
      if (chat) return { chat };
      if (!phone) {
        const WF = mod('WAWebWidFactory');
        try {
          const found = WF && WF.createWid ? await findOrCreate(WF.createWid(chatId)) : null;
          if (found) return { chat: found };
        } catch (e) { /* ignora */ }
        return { error: 'no_chat' };
      }
    }
    if (!phone) return { error: 'no_target' };

    const WF = mod('WAWebWidFactory');
    if (!WF || typeof WF.createWid !== 'function') return { error: 'unavailable' };
    let wid = WF.createWid(`${phone}@c.us`);
    // Confirma que o número tem WhatsApp (e corrige o 9º dígito de números antigos)
    const QE = mod('WAWebQueryExistsJob');
    if (QE && typeof QE.queryWidExists === 'function') {
      let r;
      try { r = await QE.queryWidExists(wid); } catch (e) { r = undefined; }
      if (r === null) return { error: 'not_found' };
      if (r && r.wid) wid = r.wid;
    }
    let chat = null;
    try { chat = typeof C.getLatestChatForWid === 'function' ? C.getLatestChatForWid(wid) : C.get(wid); } catch (e) { /* ignora */ }
    if (!chat) {
      try { chat = await findOrCreate(wid); } catch (e) { return { error: 'find_failed', detail: String((e && e.message) || e) }; }
    }
    return chat ? { chat } : { error: 'no_chat' };
  }

  async function openChatModel(chat) {
    if (isActive(chat)) return true;
    const Cmd = pick('WAWebCmd', 'Cmd') || (legacy('Cmd'));
    if (!Cmd) return false;
    const attempts = [
      () => Cmd.openChatBottom({ chat, chatEntryPoint: 'Chatlist' }),
      () => Cmd.openChatAt({ chat, chatEntryPoint: 'Chatlist' }),
      () => Cmd.openChatBottom(chat),
    ];
    for (const run of attempts) {
      try { await run(); } catch (e) { /* tenta a próxima */ }
      for (let i = 0; i < 15; i++) {
        if (isActive(chat)) return true;
        await wait(100);
      }
    }
    return false;
  }

  /** Aguarda promessas de envio e interpreta o resultado */
  async function settleSend(res) {
    let out = res;
    if (Array.isArray(res)) {
      const results = [];
      for (const p of res) results.push(await p);
      out = results[results.length - 1];
    } else if (res && typeof res.then === 'function') {
      out = await res;
    }
    const code = out && typeof out === 'object' ? out.messageSendResult || out.status : out;
    if (typeof code === 'string' && code.toUpperCase() !== 'OK' && /ERROR|FAIL/i.test(code)) throw new Error(code);
    return true;
  }

  /* ---------------- ações expostas ---------------- */
  const actions = {
    ping() {
      return {
        ok: true,
        modules: {
          chats: !!Chats(),
          cmd: !!pick('WAWebCmd', 'Cmd'),
          widFactory: defined('WAWebWidFactory'),
          findChat: defined('WAWebFindChatAction'),
          queryExists: defined('WAWebQueryExistsJob'),
          sendText: defined('WAWebSendTextMsgChatAction'),
          sendMedia: defined('WAWebPrepRawMedia') && defined('WAWebMediaOpaqueData'),
          compose: defined('WAWebComposeBoxActions'),
          contacts: !!Contacts(),
          labels: !!Labels(),
          groups: defined('WAWebGroupMetadataCollection'),
        },
      };
    },

    getActiveChat() {
      const info = chatInfo(getActive());
      return info ? { ok: true, ...info } : { ok: false };
    },

    async queryExists({ phone }) {
      const r = await resolveChat({ phone });
      if (r.error === 'not_found') return { ok: true, exists: false };
      return r.chat ? { ok: true, exists: true, ...chatInfo(r.chat) } : { ok: false, reason: r.error };
    },

    async openChat({ phone, chatId }) {
      const r = await resolveChat({ phone, chatId });
      if (!r.chat) return { ok: false, reason: r.error };
      const opened = await openChatModel(r.chat);
      return opened ? { ok: true, ...chatInfo(r.chat) } : { ok: false, reason: 'open_failed' };
    },

    async sendText({ phone, chatId, text }) {
      const S = mod('WAWebSendTextMsgChatAction');
      if (!S || typeof S.sendTextMsgToChat !== 'function') return { ok: false, reason: 'unavailable' };
      const r = await resolveChat({ phone, chatId });
      if (!r.chat) return { ok: false, reason: r.error };
      // erro daqui em diante = 'send_error' (a mensagem pode ter saído; não repetir pela interface)
      try {
        await settleSend(await S.sendTextMsgToChat(r.chat, text));
      } catch (e) {
        return { ok: false, reason: 'send_error', error: String((e && e.message) || e) };
      }
      return { ok: true, ...chatInfo(r.chat) };
    },

    /** mode: 'auto' | 'ptt' (áudio de voz) | 'audio' | 'document' */
    async sendMedia({ phone, chatId, file, caption, mode }) {
      const OD = pick('WAWebMediaOpaqueData', 'createFromData') ? mod('WAWebMediaOpaqueData') : null;
      const OpaqueData = OD && (OD.default || OD);
      const prepRawMedia = pick('WAWebPrepRawMedia', 'prepRawMedia');
      if (!OpaqueData || typeof OpaqueData.createFromData !== 'function' || typeof prepRawMedia !== 'function') {
        return { ok: false, reason: 'unavailable' };
      }
      const r = await resolveChat({ phone, chatId });
      if (!r.chat) return { ok: false, reason: r.error };
      let prep;
      try {
        const opaque = await OpaqueData.createFromData(file, file.type);
        const opts = {};
        if (mode === 'ptt') opts.isPtt = true;
        else if (mode === 'audio') opts.isAudio = true;
        else if (mode === 'document') opts.asDocument = true;
        prep = prepRawMedia(opaque, opts);
        const data = await prep.waitForPrep();
        const stage = data && data.mediaStage;
        if (stage && /ERROR/i.test(String(stage))) return { ok: false, reason: 'media_error', error: String(stage) };
      } catch (e) {
        return { ok: false, reason: 'media_error', error: String((e && e.message) || e) };
      }
      try {
        const options = { caption: caption || undefined, filename: file.name || undefined };
        await settleSend(await prep.sendToChat({ chat: r.chat, options }));
      } catch (e) {
        return { ok: false, reason: 'send_error', error: String((e && e.message) || e) };
      }
      return { ok: true, ...chatInfo(r.chat) };
    },

    /** Coloca texto no campo de mensagem da conversa aberta (sem enviar) */
    composeInsert({ text, replace }) {
      const chat = getActive();
      const CBA = pick('WAWebComposeBoxActions', 'ComposeBoxActions');
      if (!chat || !CBA) return { ok: false, reason: chat ? 'unavailable' : 'no_chat' };
      if (replace && typeof CBA.setTextContent === 'function') CBA.setTextContent(chat, text);
      else CBA.paste(chat, text);
      try { CBA.focus(chat); } catch (e) { /* ignora */ }
      return { ok: true };
    },

    /** Abre a pré-visualização de arquivos da conversa aberta */
    composeFiles({ files }) {
      const chat = getActive();
      const CBA = pick('WAWebComposeBoxActions', 'ComposeBoxActions');
      if (!chat || !CBA || typeof CBA.pasteFiles !== 'function') return { ok: false, reason: 'unavailable' };
      CBA.pasteFiles(chat, files);
      return { ok: true };
    },

    listChats() {
      const C = Chats();
      if (!C) return { ok: false, reason: 'unavailable' };
      const chats = models(C).map(chatInfo).filter(isUsableChat).sort((a, b) => b.t - a.t);
      return { ok: true, chats };
    },

    listLabels() {
      const L = Labels();
      if (!L) return { ok: false, reason: 'unavailable' };
      const counts = {};
      models(Chats()).forEach((c) => {
        const ls = field('WAWebChatGetters', 'getLabels', c, 'labels');
        (Array.isArray(ls) ? ls : []).forEach((id) => { counts[String(id)] = (counts[String(id)] || 0) + 1; });
      });
      const labels = models(L).map((l) => ({
        id: String(l.id),
        name: l.name || '',
        color: l.hexColor || l.color || null,
        type: l.type || null,
        count: counts[String(l.id)] || l.chatCount || l.count || 0,
      })).filter((l) => l.name);
      return { ok: true, labels };
    },

    listContacts() {
      const CC = Contacts();
      if (!CC) return { ok: false, reason: 'unavailable' };
      const seen = new Set();
      const contacts = [];
      models(CC).forEach((c) => {
        const id = c.id;
        if (!id || (id.server !== 'c.us' && id.server !== 'lid')) return;
        if (field('WAWebContactGetters', 'getIsMe', c, 'isMe')) return;
        const phone = phoneOf(id, c);
        const key = phone || ser(id);
        if (seen.has(key)) return;
        seen.add(key);
        const name = field('WAWebContactGetters', 'getName', c, 'name') || '';
        const saved = field('WAWebFrontendContactGetters', 'getIsMyContact', c, 'isMyContact');
        contacts.push({
          id: ser(id),
          phone,
          name,
          pushname: field('WAWebContactGetters', 'getPushname', c, 'pushname') || '',
          saved: saved === undefined ? !!name : !!saved,
          business: !!field('WAWebContactGetters', 'getIsBusiness', c, 'isBusiness'),
        });
      });
      return { ok: true, contacts };
    },

    async groupParticipants({ chatId }) {
      const r = await resolveChat({ chatId });
      if (!r.chat) return { ok: false, reason: r.error };
      let meta = field('WAWebFrontendChatGetters', 'getGroupMetadata', r.chat, 'groupMetadata');
      if (!meta || !models(meta.participants).length) {
        const GM = GroupMetas();
        for (const load of [
          () => pick('WAWebFindGroupMetadataAction', 'findGroupMetadata')(r.chat.id),
          () => GM.find(r.chat.id),
        ]) {
          try {
            const m = await load();
            if (m && m.participants) { meta = m; break; }
          } catch (e) { /* tenta o próximo */ }
        }
        if ((!meta || !meta.participants) && GM) { try { meta = GM.get(r.chat.id) || meta; } catch (e) { /* ignora */ } }
      }
      if (!meta || !meta.participants) return { ok: false, reason: 'no_metadata' };
      const CC = Contacts();
      const participants = models(meta.participants).map((p) => {
        let contact = null;
        try { contact = CC ? CC.get(p.id) : null; } catch (e) { /* ignora */ }
        return {
          id: ser(p.id),
          phone: phoneOf(p.id, contact),
          name: contact ? field('WAWebContactGetters', 'getName', contact, 'name') || field('WAWebContactGetters', 'getPushname', contact, 'pushname') || '' : '',
          isAdmin: !!(p.isAdmin || p.isSuperAdmin),
        };
      });
      return { ok: true, group: chatInfo(r.chat).name, participants };
    },

    /** Últimas mensagens da conversa (padrão: a aberta) — usado pelo Assistente de IA */
    async getMessages({ chatId, limit = 30 }) {
      let chat = null;
      if (chatId) { const r = await resolveChat({ chatId }); chat = r.chat; } else chat = getActive();
      if (!chat) return { ok: false, reason: 'no_chat' };
      const msgs = field('WAWebFrontendChatGetters', 'getMsgs', chat, 'msgs');
      const list = models(msgs).slice(-limit).map((m) => {
        const type = m.type || '';
        const text = type === 'chat' ? m.body || '' : m.caption || (type ? `[${type}]` : '');
        const sender = m.senderObj ? m.senderObj.name || m.senderObj.pushname || '' : '';
        return { fromMe: !!(m.id && m.id.fromMe), text: typeof text === 'string' ? text : '', type, t: m.t || 0, sender };
      }).filter((m) => m.text);
      return { ok: true, name: chatInfo(chat).name, messages: list };
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
