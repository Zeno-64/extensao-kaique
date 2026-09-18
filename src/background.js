/*
 * ZapFlow — service worker.
 * - Acorda a aba do WhatsApp na hora dos agendamentos (e abre uma se não houver).
 * - Oferece "sleep" sem limitação para abas em segundo plano.
 * - Notificações e botão da extensão.
 */
const WA_URL = 'https://web.whatsapp.com/';
const WA_MATCH = 'https://web.whatsapp.com/*';
const TICK_ALARM = 'zf-tick';

/* ---------------- dados iniciais ---------------- */
const SEED = {
  categories: [
    { id: 'cat-confirmacoes', name: '📞 Confirmações de consulta', color: 'gray', order: 1, collapsed: false },
    { id: 'cat-dia-a-dia', name: '💼 Dia a Dia', color: 'peach', order: 2, collapsed: false },
  ],
  replies: [
    {
      id: 'rep-cc-amanha', title: 'CC - Amanhã', categoryId: 'cat-confirmacoes', order: 1, uses: 0,
      blocks: [{ type: 'text', text: '{saudacao}, {primeiro_nome}! 😊\n\nPassando para confirmar sua consulta *amanhã ({amanha})* às *{horario}*.\n\nPosso confirmar sua presença?' }],
    },
    {
      id: 'rep-cc-dia-d', title: 'CC - Dia D', categoryId: 'cat-confirmacoes', order: 2, uses: 0,
      blocks: [{ type: 'text', text: '{saudacao}, {primeiro_nome}! Lembrando que sua consulta é *hoje* às *{horario}*. Até logo! 🙌' }],
    },
    {
      id: 'rep-aceita-plano', title: 'Aceita plano?', categoryId: 'cat-dia-a-dia', order: 1, uses: 0,
      blocks: [{ type: 'text', text: 'Atendemos sim! Me envie, por favor, uma foto da carteirinha do plano e de um documento com foto. 📄' }],
    },
    {
      id: 'rep-checkin-ok', title: 'Check-in OK', categoryId: 'cat-dia-a-dia', order: 2, uses: 0,
      blocks: [{ type: 'text', text: 'Check-in recebido ✅ Obrigado(a), {primeiro_nome}! Vou analisar e te retorno em breve.' }],
    },
  ],
};

chrome.runtime.onInstalled.addListener(async (details) => {
  chrome.alarms.create(TICK_ALARM, { periodInMinutes: 1 });
  if (details.reason === 'install') {
    const cur = await chrome.storage.local.get(['replies', 'categories']);
    if (!cur.replies && !cur.categories) {
      const now = Date.now();
      await chrome.storage.local.set({
        categories: SEED.categories,
        replies: SEED.replies.map((r) => ({ ...r, createdAt: now })),
      });
    }
  }
  // Recarrega abas do WhatsApp já abertas para injetar a versão nova da extensão
  if (details.reason === 'install' || details.reason === 'update') {
    const tabs = await chrome.tabs.query({ url: WA_MATCH });
    tabs.forEach((t) => chrome.tabs.reload(t.id));
  }
  syncAlarms();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(TICK_ALARM, { periodInMinutes: 1 });
  syncAlarms();
});

/* ---------------- alarmes ---------------- */
async function syncAlarms() {
  const { schedules = [], campaigns = [] } = await chrome.storage.local.get(['schedules', 'campaigns']);
  const now = Date.now();
  const want = new Map();
  schedules.filter((s) => s.status === 'pending' && s.sendAt > now).forEach((s) => want.set('zf-at:s:' + s.id, s.sendAt));
  campaigns.filter((c) => c.status === 'scheduled' && c.startAt > now).forEach((c) => want.set('zf-at:c:' + c.id, c.startAt));

  const existing = await chrome.alarms.getAll();
  const keep = new Set();
  for (const a of existing) {
    if (!a.name.startsWith('zf-at:')) continue;
    const when = want.get(a.name);
    if (when && Math.abs(a.scheduledTime - when) < 1000) keep.add(a.name);
    else await chrome.alarms.clear(a.name);
  }
  for (const [name, when] of want) {
    if (!keep.has(name)) chrome.alarms.create(name, { when });
  }
  if (!existing.some((a) => a.name === TICK_ALARM)) chrome.alarms.create(TICK_ALARM, { periodInMinutes: 1 });
}

let syncTimer = null;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !(changes.schedules || changes.campaigns)) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncAlarms, 500);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TICK_ALARM || alarm.name.startsWith('zf-at:')) wakeWhatsApp(alarm.name !== TICK_ALARM);
});

/** Há algo para enviar agora (ou em até 30s)? */
async function hasDueWork() {
  const { schedules = [], campaigns = [] } = await chrome.storage.local.get(['schedules', 'campaigns']);
  const soon = Date.now() + 30000;
  return schedules.some((s) => s.status === 'pending' && s.sendAt <= soon)
    || campaigns.some((c) => c.status === 'running' || (c.status === 'scheduled' && c.startAt <= soon));
}

async function wakeWhatsApp(force = false) {
  if (!force && !(await hasDueWork())) return;
  const { settings = {} } = await chrome.storage.local.get('settings');
  const tabs = await chrome.tabs.query({ url: WA_MATCH });

  if (!tabs.length) {
    if (settings.autoOpenWhatsApp === false || !(await hasDueWork())) return;
    const { lastAutoOpen = 0 } = await chrome.storage.session.get('lastAutoOpen');
    if (Date.now() - lastAutoOpen < 5 * 60000) return; // evita abrir várias abas
    await chrome.storage.session.set({ lastAutoOpen: Date.now() });
    await chrome.tabs.create({ url: WA_URL, pinned: true, active: false });
    return;
  }
  for (const t of tabs) {
    if (t.discarded) {
      chrome.tabs.reload(t.id);
      continue;
    }
    chrome.tabs.sendMessage(t.id, { type: 'ZF_TICK' }).catch(() => {});
  }
}

/* ---------------- mensagens dos content scripts ---------------- */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === 'ZF_SLEEP') {
    setTimeout(() => sendResponse(true), Math.max(0, Math.min(Number(msg.ms) || 0, 25000)));
    return true;
  }
  if (msg.type === 'ZF_NOTIFY') {
    chrome.notifications.create('', {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: String(msg.title || 'ZapFlow'),
      message: String(msg.message || ''),
    }, () => void chrome.runtime.lastError);
    sendResponse(true);
  }
});

chrome.notifications.onClicked.addListener(async (id) => {
  const tabs = await chrome.tabs.query({ url: WA_MATCH });
  if (tabs[0]) {
    chrome.tabs.update(tabs[0].id, { active: true });
    chrome.windows.update(tabs[0].windowId, { focused: true });
  }
  chrome.notifications.clear(id);
});

/* ---------------- botão da extensão ---------------- */
chrome.action.onClicked.addListener(async (tab) => {
  if (tab && tab.url && tab.url.startsWith(WA_URL)) {
    chrome.tabs.sendMessage(tab.id, { type: 'ZF_TOGGLE' }).catch(() => chrome.tabs.reload(tab.id));
    return;
  }
  const tabs = await chrome.tabs.query({ url: WA_MATCH });
  if (tabs.length) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    chrome.tabs.create({ url: WA_URL });
  }
});
