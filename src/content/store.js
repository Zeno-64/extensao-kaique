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
    dockSide: 'right', // lado de referência dos botões flutuantes: 'right' | 'left'
    dockX: 14, // distância até esse lado da área do WhatsApp, em px (muda arrastando)
    dockBottom: null, // distância da parte de baixo da tela, em px (null = padrão)
    rail: true, // barra fixa à esquerda do WhatsApp (atalhos do ZapFlow)
    hideMonitor: false, // esconde a linha de status dos envios automáticos no painel
    signature: false, // assina as mensagens enviadas pelo ZapFlow com *Nome:*
    signatureCustom: false, // usa signatureName em vez do nome do perfil do WhatsApp
    signatureName: '',
    theme: 'auto', // 'auto' (igual ao WhatsApp) | 'light' | 'dark'
    labelOrder: [], // ordem das etiquetas do WhatsApp na barra e no cartão (ids; veio do WaSpeed)
    topBar: true, // barra de abas/etiquetas no topo
    barMode: 'tabs', // 'tabs' (abas do CRM) | 'labels' (etiquetas do WhatsApp)
    backupFreq: 'monthly', // backup automático enviado ao próprio WhatsApp: 'monthly' | 'weekly' | 'off'
    backupTo: '', // vazio = o próprio número da conta
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
  const PRIVATE_KEYS = ['runner', 'runnerLock', 'aiKey', 'backupState'];

  // Partes que dá para escolher no backup. "crm": parte dos dados de cada conversa (crmChats)
  const PARTS = {
    replies: { label: 'Respostas rápidas e scripts', icon: 'zap', keys: ['replies', 'categories'] },
    schedules: { label: 'Agendamentos', icon: 'calendarClock', keys: ['schedules'] },
    notes: { label: 'Notas', icon: 'clipboardEdit', crm: 'notes' },
    tabs: { label: 'Abas do CRM (e a ordem delas)', icon: 'folderArrow', keys: ['crmTags'], crm: 'tags' },
    campaigns: { label: 'Envio em massa', icon: 'send', keys: ['campaigns'] },
    reminders: { label: 'Lembretes', icon: 'alarm', keys: ['reminders'] },
    settings: { label: 'Configurações (inclui o backup automático)', icon: 'settings', keys: ['settings'] },
  };

  /** Ids dos arquivos usados por respostas (ações), agendamentos e campanhas (blocos) */
  const fileIdsIn = (list, ids = new Set()) => {
    (list || []).forEach((item) => [item.blocks, item.actions].forEach((arr) => (arr || []).forEach((b) => {
      if (b.fileId) ids.add(b.fileId);
      if (b.linkPreview && b.linkPreview.thumbFileId) ids.add(b.linkPreview.thumbFileId);
    })));
    return ids;
  };

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
    PARTS,

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
      [all.replies, all.schedules, all.campaigns].forEach((list) => fileIdsIn(list, used));
      const drop = Object.keys(all).filter((k) => k.startsWith('file:') && !used.has(k.slice(5)));
      if (drop.length) await chrome.storage.local.remove(drop);
      return drop.length;
    },

    /* ----- backup ----- */
    /** Backup completo; com parts (ex.: ['replies','tabs']) leva só essas partes e os arquivos que elas usam */
    async exportAll(parts = null) {
      const all = await chrome.storage.local.get(null);
      PRIVATE_KEYS.forEach((k) => delete all[k]);
      const exportedAt = new Date().toISOString();
      if (!parts) return { app: 'ZapFlow', version: 2, exportedAt, data: all };
      const sel = Object.keys(PARTS).filter((p) => parts.includes(p));
      const data = {};
      sel.forEach((p) => (PARTS[p].keys || []).forEach((k) => { if (all[k] !== undefined) data[k] = all[k]; }));
      const crm = sel.map((p) => PARTS[p].crm).filter(Boolean);
      if (crm.length && all.crmChats) {
        data.crmChats = {};
        Object.entries(all.crmChats).forEach(([k, c]) => {
          const out = { ...c, tags: crm.includes('tags') ? c.tags || [] : [], notes: crm.includes('notes') ? c.notes || [] : [] };
          if (out.tags.length || out.notes.length) data.crmChats[k] = out;
        });
      }
      fileIdsIn(data.replies).forEach((id) => { if (all['file:' + id]) data['file:' + id] = all['file:' + id]; });
      fileIdsIn(data.schedules).forEach((id) => { if (all['file:' + id]) data['file:' + id] = all['file:' + id]; });
      fileIdsIn(data.campaigns).forEach((id) => { if (all['file:' + id]) data['file:' + id] = all['file:' + id]; });
      return { app: 'ZapFlow', version: 2, exportedAt, parts: sel, data };
    },
    async importAll(json, mode = 'merge') {
      if (!json || json.app !== 'ZapFlow' || !json.data) throw new Error('Arquivo de backup inválido');
      const d = { ...json.data };
      PRIVATE_KEYS.forEach((k) => delete d[k]);
      if (mode === 'replace' && Array.isArray(json.parts)) {
        // backup parcial: troca só as partes que estão no arquivo
        const parts = json.parts.filter((p) => PARTS[p]);
        const out = {};
        parts.forEach((p) => (PARTS[p].keys || []).forEach((k) => (out[k] = d[k] !== undefined ? d[k] : ZF.clone(DEFAULTS[k]))));
        const crm = parts.map((p) => PARTS[p].crm).filter(Boolean);
        if (crm.length) {
          const cur = await store.get('crmChats');
          const next = {};
          new Set([...Object.keys(cur), ...Object.keys(d.crmChats || {})]).forEach((k) => {
            const a = cur[k] || {}, b = (d.crmChats || {})[k] || {};
            const rec = { ...a, ...b };
            rec.tags = crm.includes('tags') ? b.tags || [] : a.tags || [];
            rec.notes = crm.includes('notes') ? b.notes || [] : a.notes || [];
            if (rec.tags.length || rec.notes.length) next[k] = rec;
          });
          out.crmChats = next;
        }
        Object.keys(d).filter((k) => k.startsWith('file:')).forEach((k) => (out[k] = d[k]));
        await chrome.storage.local.set(out);
        await store.migrate();
        return;
      }
      if (mode === 'replace') {
        const keep = await chrome.storage.local.get(['aiKey', 'backupState']);
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
