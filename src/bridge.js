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
 * v1.2 (set/2026): WAWebMsgDataUtils + addAndSendTextMsg (cartão de contato), prepRawMedia asSticker,
 * LabelCollection.addOrRemoveLabels, WAWebPresenceChatAction, Cmd.archiveChat/pinChat,
 * WAWebUpdateUnreadChatAction, WAWebProfilePicThumbCollection.
 * v1.3 (set/2026): WAWebUserPrefsMeUser.getMaybeMePnUser / getMaybeMeLidUser (número da própria conta),
 * WAWebLabelGetters.getHexColor / WAWebListUtils.colorIndexToHex (cor das etiquetas).
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
      pinned: Number(field('WAWebChatGetters', 'getPin', chat, 'pin')) > 0,
      favorite: !!field('WAWebFrontendChatGetters', 'getIsFavorite', chat, 'isFavorite'),
      labels: Array.isArray(labels) ? labels.map(String) : [],
      t: Number(field('WAWebChatGetters', 'getT', chat, 't')) || 0,
    };
  }

  /** Texto curto da última mensagem (para listas) */
  function previewOf(chat) {
    let msg = null;
    try {
      const f = pick('WAWebFrontendChatGetters', 'getPreviewMessage');
      msg = typeof f === 'function' ? f(chat) : null;
    } catch (e) { /* ignora */ }
    if (!msg) {
      const msgs = field('WAWebFrontendChatGetters', 'getMsgs', chat, 'msgs');
      const arr = models(msgs);
      msg = arr[arr.length - 1] || null;
    }
    if (!msg) return null;
    const type = msg.type || '';
    const LABELS = { image: '📷 Foto', video: '🎥 Vídeo', ptt: '🎤 Áudio', audio: '🎵 Áudio', document: '📄 Documento', sticker: 'Figurinha', vcard: '👤 Contato', location: '📍 Localização' };
    let text = type === 'chat' ? msg.body : msg.caption || LABELS[type] || '';
    if (typeof text !== 'string') text = '';
    return { text: text.slice(0, 160), fromMe: !!(msg.id && msg.id.fromMe), t: msg.t || 0 };
  }

  function picOf(chat) {
    try {
      const PP = pick('WAWebProfilePicThumbCollection', 'ProfilePicThumbCollection');
      const p = PP && typeof PP.get === 'function' ? PP.get(chat.id) : null;
      const url = p && (p.img || p.eurl);
      return typeof url === 'string' && /^https:/.test(url) ? url : null;
    } catch (e) { return null; }
  }

  /*
   * Cor da etiqueta/lista: o modelo guarda só o índice (colorIndex). O WhatsApp converte com
   * WAWebLabelGetters.getHexColor → WAWebListUtils.colorIndexToHex; a paleta abaixo é a de
   * WAWebLabelPillColors (set/2026), usada se nenhum dos dois existir.
   */
  const LABEL_PALETTE = ['#EA0038', '#FF2E74', '#CB2910', '#C15ADD', '#FA6533', '#C0835D', '#FBEB1E', '#FFB938', '#DDCFBC', '#AFE966', '#25D366',
    '#8A962E', '#D1C4FF', '#42C7B8', '#009DE2', '#B6D9FE', '#6A6C6C', '#FFABC7', '#7F66FF', '#025AB7', '#03776D', '#8D9599'];
  const isHex = (v) => typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v);
  function labelColor(l) {
    try {
      const f = pick('WAWebLabelGetters', 'getHexColor');
      const v = typeof f === 'function' ? f(l) : null;
      if (isHex(v)) return v;
    } catch (e) { /* ignora */ }
    if (isHex(l.hexColor)) return l.hexColor;
    if (isHex(l.color)) return l.color;
    const idx = Number(l.colorIndex);
    if (!Number.isInteger(idx) || idx < 0) return null;
    try {
      const f = pick('WAWebListUtils', 'colorIndexToHex');
      const v = typeof f === 'function' ? f(idx) : null;
      if (isHex(v)) return v;
    } catch (e) { /* ignora */ }
    return LABEL_PALETTE[idx % LABEL_PALETTE.length];
  }
  // Listas automáticas do WhatsApp (WAWebSchemaLabel.ListType): Não lidas, Grupos, Favoritos, Comunidades,
  // Rascunhos, Canais, Menções — são filtros, não dá para colocar uma conversa nelas
  const AUTO_LISTS = [1, 2, 3, 6, 8, 10, 17];

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
          vcard: defined('WAWebMsgDataUtils'),
          presence: defined('WAWebPresenceChatAction'),
          labelEdit: !!(Labels() && typeof Labels().addOrRemoveLabels === 'function'),
          me: defined('WAWebUserPrefsMeUser'),
        },
      };
    },

    /** Número da própria conta (o backup automático vai para a conversa "Você") */
    me() {
      let pn = null, lid = null, name = '';
      try { const f = pick('WAWebUserPrefsMeUser', 'getMaybeMePnUser'); pn = typeof f === 'function' ? f() : null; } catch (e) { /* ignora */ }
      try { const f = pick('WAWebUserPrefsMeUser', 'getMaybeMeLidUser'); lid = typeof f === 'function' ? f() : null; } catch (e) { /* ignora */ }
      try { const f = pick('WAWebUserPrefsMeUser', 'getMaybeMeDisplayName'); name = (typeof f === 'function' && f()) || ''; } catch (e) { /* ignora */ }
      const phone = (pn && pn.user && String(pn.user)) || phoneOf(lid);
      return phone ? { ok: true, phone, name } : { ok: false, reason: 'unavailable' };
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

    /** linkPreview (opcional): { url, title, description, thumbnail (JPEG em base64) } — "link com banner" */
    async sendText({ phone, chatId, text, linkPreview }) {
      const S = mod('WAWebSendTextMsgChatAction');
      if (!S || typeof S.sendTextMsgToChat !== 'function') return { ok: false, reason: 'unavailable' };
      const r = await resolveChat({ phone, chatId });
      if (!r.chat) return { ok: false, reason: r.error };
      const opts = {};
      if (linkPreview && linkPreview.url) {
        opts.linkPreview = {
          canonicalUrl: linkPreview.url,
          matchedText: linkPreview.url,
          title: linkPreview.title || '',
          description: linkPreview.description || '',
          richPreviewType: 0,
          doNotPlayInline: true,
        };
        if (linkPreview.thumbnail) opts.linkPreview.thumbnail = linkPreview.thumbnail;
      }
      // erro daqui em diante = 'send_error' (a mensagem pode ter saído; não repetir pela interface)
      try {
        await settleSend(await S.sendTextMsgToChat(r.chat, text, opts));
      } catch (e) {
        return { ok: false, reason: 'send_error', error: String((e && e.message) || e) };
      }
      return { ok: true, ...chatInfo(r.chat) };
    },

    /** Cartão de contato (vCard) — o mesmo tipo de mensagem de "Anexar → Contato" */
    async sendVcard({ phone, chatId, name, vcard }) {
      const MDU = mod('WAWebMsgDataUtils');
      const S = mod('WAWebSendTextMsgChatAction');
      if (!MDU || typeof MDU.genOutgoingMsgData !== 'function' || !S || typeof S.addAndSendTextMsg !== 'function') return { ok: false, reason: 'unavailable' };
      const r = await resolveChat({ phone, chatId });
      if (!r.chat) return { ok: false, reason: r.error };
      let data;
      try {
        const base = await MDU.genOutgoingMsgData(r.chat, 'vcard');
        let eph = {};
        try { const f = pick('WAWebGetEphemeralFieldsMsgActionsUtils', 'getEphemeralFields'); if (typeof f === 'function') eph = f(r.chat) || {}; } catch (e) { /* ignora */ }
        data = { ...base, ...eph, type: 'vcard', body: vcard, vcardFormattedName: name };
      } catch (e) {
        return { ok: false, reason: 'unavailable', error: String((e && e.message) || e) };
      }
      try {
        await settleSend(await S.addAndSendTextMsg(r.chat, data));
      } catch (e) {
        return { ok: false, reason: 'send_error', error: String((e && e.message) || e) };
      }
      return { ok: true, ...chatInfo(r.chat) };
    },

    /** mode: 'auto' | 'ptt' (áudio de voz) | 'audio' | 'document' | 'sticker' */
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
        else if (mode === 'sticker') opts.asSticker = true;
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
      const labels = models(L)
        .filter((l) => l.name && l.isActive !== false && !AUTO_LISTS.includes(Number(l.type)))
        .map((l) => ({
          id: String(l.id),
          name: l.name || '',
          color: labelColor(l),
          type: l.type == null ? null : l.type,
          count: counts[String(l.id)] || l.chatCount || l.count || 0,
        }));
      return { ok: true, labels };
    },

    /** Prévia da última mensagem e foto de algumas conversas (lista filtrada por aba/etiqueta) */
    chatDetails({ chatIds = [] }) {
      const C = Chats();
      if (!C) return { ok: false, reason: 'unavailable' };
      const out = {};
      chatIds.slice(0, 300).forEach((id) => {
        let chat = null;
        try { chat = C.get(id); } catch (e) { /* ignora */ }
        if (!chat) return;
        out[id] = { preview: previewOf(chat), pic: picOf(chat) };
      });
      return { ok: true, details: out };
    },

    /** archive | unarchive | pin | unpin | markUnread | markRead */
    async chatAction({ phone, chatId, action }) {
      const Cmd = pick('WAWebCmd', 'Cmd');
      const r = await resolveChat({ phone, chatId });
      if (!r.chat) return { ok: false, reason: r.error };
      const chat = r.chat;
      const run = {
        archive: () => Cmd.archiveChat(chat, true, false),
        unarchive: () => Cmd.archiveChat(chat, false, false),
        pin: () => Cmd.pinChat(chat, true),
        unpin: () => Cmd.pinChat(chat, false),
        markUnread: () => {
          const f = pick('WAWebUpdateUnreadChatAction', 'markUnread');
          return typeof f === 'function' ? f(chat, true) : Cmd.markChatUnread(chat, true);
        },
        markRead: () => {
          const f = pick('WAWebUpdateUnreadChatAction', 'sendSeen');
          return typeof f === 'function' ? f({ chat, threadId: undefined }) : Cmd.markChatUnread(chat, false);
        },
      }[action];
      if (!run) return { ok: false, reason: 'bad_action' };
      if (!Cmd && !['markUnread', 'markRead'].includes(action)) return { ok: false, reason: 'unavailable' };
      await run();
      return { ok: true };
    },

    /** Mostra "digitando…" / "gravando áudio…" para o contato. state: composing | recording | paused */
    async presence({ phone, chatId, state }) {
      const P = mod('WAWebPresenceChatAction');
      const fn = P && { composing: P.markComposing, recording: P.markRecording, paused: P.markPaused }[state];
      if (typeof fn !== 'function') return { ok: false, reason: 'unavailable' };
      const r = await resolveChat({ phone, chatId });
      if (!r.chat) return { ok: false, reason: r.error };
      await fn(r.chat);
      return { ok: true };
    },

    /** Etiquetas/listas do WhatsApp da conversa: add/remove = ids; clear = remove todas */
    async editLabels({ phone, chatId, add = [], remove = [], clear = false }) {
      const L = Labels();
      if (!L || typeof L.addOrRemoveLabels !== 'function') return { ok: false, reason: 'unavailable' };
      const r = await resolveChat({ phone, chatId });
      if (!r.chat) return { ok: false, reason: r.error };
      const current = (field('WAWebChatGetters', 'getLabels', r.chat, 'labels') || []).map(String);
      const ops = [];
      const rm = clear ? current : remove.map(String).filter((id) => current.includes(id));
      rm.forEach((id) => ops.push({ id, type: 'remove' }));
      add.map(String).filter((id) => !current.includes(id) && !rm.includes(id)).forEach((id) => ops.push({ id, type: 'add' }));
      if (!ops.length) return { ok: true, changed: 0 };
      await L.addOrRemoveLabels(ops, [r.chat]);
      return { ok: true, changed: ops.length };
    },

    /** Código do link de convite do grupo, se o WhatsApp já o tiver carregado */
    async groupInvite({ chatId }) {
      const r = await resolveChat({ chatId });
      if (!r.chat) return { ok: false, reason: r.error };
      const meta = field('WAWebFrontendChatGetters', 'getGroupMetadata', r.chat, 'groupMetadata');
      const code = meta && typeof meta.inviteCode === 'string' ? meta.inviteCode : null;
      return { ok: true, code, link: code ? `https://chat.whatsapp.com/${code}` : null };
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
