/* ZapFlow — camada de dados (chrome.storage.local) */
(() => {
  'use strict';
  const ZF = window.ZF;

  const DEFAULT_SETTINGS = {
    panelOpen: true,
    pushLayout: true,
    panelWidth: 380,
    clickAction: 'insert', // 'insert' | 'send'
    countryCode: '55',
    directSend: true, // enviar pelas funções internas do WhatsApp, sem abrir a conversa
    allowReload: false, // último recurso: recarregar a página para abrir a conversa pelo link
    restoreChat: true, // voltar para a conversa anterior quando o envio precisou abrir outra conversa
    lateToleranceMin: 720, // agendamentos atrasados além disso viram "perdidos" (0 = sem limite)
    autoOpenWhatsApp: true,
    notifications: true,
    bulkMinDelay: 15,
    bulkMaxDelay: 40,
    bulkPauseEvery: 20,
    bulkPauseMinutes: 5,
    filesMaxMB: 30,
    eventMinutes: 60, // duração padrão dos eventos do Google Agenda
    aiModel: 'claude-opus-5',
    aiEffort: 'low',
    aiInstructions: '',
    aiLanguage: 'inglês',
    dock: true, // botões flutuantes na lateral do WhatsApp
    topBar: true, // barra de abas/etiquetas no topo
    barMode: 'tabs', // 'tabs' (abas do CRM) | 'labels' (etiquetas do WhatsApp)
  };

  const DEFAULTS = {
    settings: DEFAULT_SETTINGS,
    categories: [],
    replies: [],
    schedules: [],
    campaigns: [],
    reminders: [],
    crmChats: {}, // { [chave da conversa]: { name, phone, chatId, isGroup, tags:[], notes:[] } }
    crmTags: [],
    runner: {},
  };
  // chaves que nunca vão para o backup (a chave da API da IA fica só neste navegador)
  const PRIVATE_KEYS = ['runner', 'runnerLock', 'aiKey'];

  // Fila por chave para evitar escritas concorrentes dentro desta aba
  const locks = {};
  const withLock = (key, fn) => {
    const prev = locks[key] || Promise.resolve();
    const next = prev.then(fn, fn);
    locks[key] = next.catch(() => {});
    return next;
  };

  const store = {
    DEFAULT_SETTINGS,

    async get(key) {
      const r = await chrome.storage.local.get(key);
      const def = DEFAULTS[key];
      if (r[key] === undefined) return def === undefined ? undefined : ZF.clone(def);
      if (key === 'settings') return { ...DEFAULT_SETTINGS, ...r[key] };
      return r[key];
    },
    async getMany(keys) {
      const r = await chrome.storage.local.get(keys);
      const out = {};
      keys.forEach((k) => {
        out[k] = r[k] === undefined ? ZF.clone(DEFAULTS[k]) : r[k];
        if (k === 'settings') out[k] = { ...DEFAULT_SETTINGS, ...out[k] };
      });
      return out;
    },
    set(key, value) {
      return chrome.storage.local.set({ [key]: value });
    },
    /** Lê, altera e grava de forma serializada. fn pode alterar o objeto ou retornar um novo. */
    update(key, fn) {
      return withLock(key, async () => {
        const cur = await store.get(key);
        const res = await fn(cur);
        const next = res === undefined ? cur : res;
        await store.set(key, next);
        return next;
      });
    },
    /** Atualiza um item de uma lista pelo id */
    updateItem(key, id, fn) {
      return store.update(key, (list) => {
        const i = list.findIndex((x) => x.id === id);
        if (i < 0) return list;
        const res = fn(list[i]);
        if (res !== undefined) list[i] = res;
        return list;
      });
    },
    async settings() {
      return store.get('settings');
    },
    saveSettings(patch) {
      return store.update('settings', (s) => ({ ...s, ...patch }));
    },

    /* ----- arquivos (base64 em chaves separadas) ----- */
    async saveFile(file) {
      const s = await store.settings();
      if (file.size > s.filesMaxMB * 1048576) throw new Error(`Arquivo maior que ${s.filesMaxMB} MB`);
      const id = ZF.uid();
      const data = await ZF.readFileAsDataURL(file);
      await chrome.storage.local.set({ ['file:' + id]: { id, name: file.name, mime: file.type || 'application/octet-stream', size: file.size, data } });
      return { fileId: id, name: file.name, mime: file.type || 'application/octet-stream', size: file.size };
    },
    async getFile(id) {
      const r = await chrome.storage.local.get('file:' + id);
      return r['file:' + id] || null;
    },
    /** Remove arquivos que não são mais usados por nenhuma resposta/agendamento/campanha */
    async gcFiles() {
      const all = await chrome.storage.local.get(null);
      const used = new Set();
      const scan = (blocks) => (blocks || []).forEach((b) => {
        if (b.fileId) used.add(b.fileId);
        if (b.linkPreview && b.linkPreview.thumbFileId) used.add(b.linkPreview.thumbFileId);
      });
      (all.replies || []).forEach((r) => { scan(r.blocks); scan(r.actions); });
      (all.schedules || []).forEach((s) => scan(s.blocks));
      (all.campaigns || []).forEach((c) => scan(c.blocks));
      const drop = Object.keys(all).filter((k) => k.startsWith('file:') && !used.has(k.slice(5)));
      if (drop.length) await chrome.storage.local.remove(drop);
      return drop.length;
    },

    /* ----- backup ----- */
    async exportAll() {
      const all = await chrome.storage.local.get(null);
      PRIVATE_KEYS.forEach((k) => delete all[k]);
      return { app: 'ZapFlow', version: 2, exportedAt: new Date().toISOString(), data: all };
    },
    async importAll(json, mode = 'merge') {
      if (!json || json.app !== 'ZapFlow' || !json.data) throw new Error('Arquivo de backup inválido');
      const d = { ...json.data };
      PRIVATE_KEYS.forEach((k) => delete d[k]);
      if (mode === 'replace') {
        const keep = await chrome.storage.local.get('aiKey');
        await chrome.storage.local.clear();
        await chrome.storage.local.set({ ...d, ...keep });
        await store.migrate();
        return;
      }
      const cur = await store.getMany(['categories', 'replies', 'schedules', 'campaigns', 'reminders', 'crmTags', 'crmChats']);
      const merge = (a, b) => {
        const ids = new Set(a.map((x) => x.id));
        return a.concat((b || []).filter((x) => !ids.has(x.id)));
      };
      const mergeChats = (a, b) => {
        const out = { ...a };
        Object.entries(b || {}).forEach(([k, v]) => {
          if (!out[k]) out[k] = v;
          else {
            out[k] = { ...v, ...out[k] };
            out[k].tags = [...new Set([...(out[k].tags || []), ...(v.tags || [])])];
            out[k].notes = merge(out[k].notes || [], v.notes);
          }
        });
        return out;
      };
      const files = {};
      Object.keys(d).filter((k) => k.startsWith('file:')).forEach((k) => (files[k] = d[k]));
      await chrome.storage.local.set({
        ...files,
        categories: merge(cur.categories, d.categories),
        replies: merge(cur.replies, d.replies),
        schedules: merge(cur.schedules, d.schedules),
        campaigns: merge(cur.campaigns, d.campaigns),
        reminders: merge(cur.reminders, d.reminders),
        crmTags: merge(cur.crmTags, d.crmTags),
        crmChats: mergeChats(cur.crmChats, d.crmChats),
      });
      await store.migrate();
    },

    /** Converte dados de versões anteriores (respostas com "blocks" → "actions") */
    async migrate() {
      const { replies } = await chrome.storage.local.get('replies');
      if (!Array.isArray(replies) || !replies.some((r) => !Array.isArray(r.actions))) return false;
      await store.update('replies', (list) => list.map(ZF.migrateReply));
      return true;
    },

    /** Escuta alterações: onChange(['replies','categories'], (changes) => ...) */
    onChange(keys, cb) {
      const fn = (changes, area) => {
        if (area !== 'local') return;
        if (keys.some((k) => k in changes)) cb(changes);
      };
      chrome.storage.onChanged.addListener(fn);
      return () => chrome.storage.onChanged.removeListener(fn);
    },
  };

  ZF.store = store;
})();
