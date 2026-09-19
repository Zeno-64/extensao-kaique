/*
 * ZapFlow — service worker (módulo).
 * - Acorda a aba do WhatsApp na hora dos agendamentos (e abre uma se não houver).
 * - Lembretes: alarme + notificação do sistema com botões.
 * - Assistente de IA: chama a API do Claude com a chave guardada só neste navegador.
 * - "sleep" sem limitação para abas em segundo plano, notificações e botão da extensão.
 */
import Anthropic from '../vendor/anthropic-sdk.mjs';

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

/* ---------------- recorrência (mesma regra do content script) ---------------- */
function nextOccurrence(ts, repeat, anchorDay) {
  const d = new Date(ts);
  const now = Date.now();
  let guard = 0;
  do {
    if (repeat === 'daily') d.setDate(d.getDate() + 1);
    else if (repeat === 'weekdays') {
      do d.setDate(d.getDate() + 1); while (d.getDay() === 0 || d.getDay() === 6);
    } else if (repeat === 'weekly') d.setDate(d.getDate() + 7);
    else if (repeat === 'yearly') d.setFullYear(d.getFullYear() + 1);
    else if (repeat === 'monthly') {
      const day = anchorDay || d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + 1);
      d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
    } else return null;
  } while (d.getTime() <= now && ++guard < 1000);
  return d.getTime();
}

/* ---------------- alarmes ---------------- */
async function syncAlarms() {
  const { schedules = [], campaigns = [], reminders = [] } = await chrome.storage.local.get(['schedules', 'campaigns', 'reminders']);
  const now = Date.now();
  const want = new Map();
  schedules.filter((s) => s.status === 'pending' && s.sendAt > now).forEach((s) => want.set('zf-at:s:' + s.id, s.sendAt));
  campaigns.filter((c) => c.status === 'scheduled' && c.startAt > now).forEach((c) => want.set('zf-at:c:' + c.id, c.startAt));
  reminders.filter((r) => r.status === 'pending' && !r.notifiedAt && r.dueAt > now).forEach((r) => want.set('zf-rem:' + r.id, r.dueAt));

  const existing = await chrome.alarms.getAll();
  const keep = new Set();
  for (const a of existing) {
    if (!a.name.startsWith('zf-at:') && !a.name.startsWith('zf-rem:')) continue;
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
  if (area !== 'local' || !(changes.schedules || changes.campaigns || changes.reminders)) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncAlarms, 500);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name.startsWith('zf-rem:')) {
    notifyDueReminders();
    return;
  }
  if (alarm.name === TICK_ALARM) notifyDueReminders();
  if (alarm.name === TICK_ALARM || alarm.name.startsWith('zf-at:')) wakeWhatsApp(alarm.name !== TICK_ALARM);
});

/** Há algo para enviar agora (ou em até 30s)? */
async function hasDueWork() {
  const { schedules = [], campaigns = [] } = await chrome.storage.local.get(['schedules', 'campaigns']);
  const soon = Date.now() + 30000;
  return schedules.some((s) => s.status === 'pending' && s.sendAt <= soon)
    || campaigns.some((c) => c.status === 'running' || (c.status === 'scheduled' && c.startAt <= soon));
}

async function waTabs() {
  return chrome.tabs.query({ url: WA_MATCH });
}

async function wakeWhatsApp(force = false) {
  if (!force && !(await hasDueWork())) return;
  const { settings = {} } = await chrome.storage.local.get('settings');
  const tabs = await waTabs();

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

/* ---------------- lembretes ---------------- */
// Grava a lista de lembretes em fila, para duas atualizações seguidas não se sobrescreverem
let reminderQueue = Promise.resolve();
const withReminders = (fn) => (reminderQueue = reminderQueue.then(fn, fn));

function notifyDueReminders() {
  return withReminders(notifyDueRemindersNow);
}
async function notifyDueRemindersNow() {
  const { reminders = [], settings = {} } = await chrome.storage.local.get(['reminders', 'settings']);
  const now = Date.now();
  const due = reminders.filter((r) => r.status === 'pending' && r.dueAt <= now + 5000 && !r.notifiedAt);
  if (!due.length) return;
  if (settings.notifications !== false) {
    due.forEach((r) => chrome.notifications.create('zf-rem:' + r.id, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: '🔔 ' + r.title,
      message: [r.chat ? r.chat.name || r.chat.phone : '', r.notes || ''].filter(Boolean).join(' — ') || 'Lembrete do ZapFlow',
      buttons: [{ title: 'Concluir' }, { title: 'Adiar 10 min' }],
      requireInteraction: true,
      priority: 2,
    }, () => void chrome.runtime.lastError));
  }
  const ids = new Set(due.map((r) => r.id));
  await chrome.storage.local.set({ reminders: reminders.map((r) => (ids.has(r.id) ? { ...r, notifiedAt: now } : r)) });
}

function updateReminder(id, fn) {
  return withReminders(async () => {
    const { reminders = [] } = await chrome.storage.local.get('reminders');
    await chrome.storage.local.set({ reminders: reminders.map((r) => (r.id === id ? fn({ ...r }) : r)) });
  });
}

chrome.notifications.onButtonClicked.addListener(async (nid, index) => {
  if (!nid.startsWith('zf-rem:')) return;
  const id = nid.slice(7);
  if (index === 0) {
    await updateReminder(id, (r) => {
      if (r.repeat && r.repeat !== 'none') return { ...r, dueAt: nextOccurrence(r.dueAt, r.repeat, r.anchorDay), notifiedAt: null, lastDoneAt: Date.now() };
      return { ...r, status: 'done', doneAt: Date.now() };
    });
  } else {
    await updateReminder(id, (r) => ({ ...r, dueAt: Date.now() + 10 * 60000, notifiedAt: null }));
  }
  chrome.notifications.clear(nid);
});

chrome.notifications.onClicked.addListener(async (nid) => {
  const tabs = await waTabs();
  if (tabs[0]) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
    if (nid.startsWith('zf-rem:')) chrome.tabs.sendMessage(tabs[0].id, { type: 'ZF_OPEN_REMINDER', id: nid.slice(7) }).catch(() => {});
  } else {
    chrome.tabs.create({ url: WA_URL });
  }
  chrome.notifications.clear(nid);
});

/* ---------------- Assistente de IA (Claude) ---------------- */
const USES_FALLBACKS = /^claude-(opus-5|fable-5)/;

async function callClaude({ system, messages, maxTokens }) {
  const { aiKey, settings = {} } = await chrome.storage.local.get(['aiKey', 'settings']);
  if (!aiKey) return { ok: false, code: 'no_key', error: 'Configure sua chave da API na aba IA.' };
  const model = settings.aiModel || 'claude-opus-5';
  // a extensão chama a API direto do navegador, com a chave que o próprio usuário salvou
  const client = new Anthropic({ apiKey: aiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
  const params = { model, max_tokens: maxTokens || 8000, system, messages };
  if (!/haiku/.test(model) && settings.aiEffort) params.output_config = { effort: settings.aiEffort };

  try {
    // Opus 5 / Fable: se a IA recusar por segurança, o servidor tenta o modelo recomendado
    const response = USES_FALLBACKS.test(model)
      ? await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
      : await client.messages.create(params);
    if (response.stop_reason === 'refusal') return { ok: false, code: 'refusal', error: 'A IA não pôde atender a este pedido.' };
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    return { ok: true, text, model: response.model, truncated: response.stop_reason === 'max_tokens' };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { ok: false, code: 'auth', error: 'Chave da API inválida. Confira na aba IA.' };
    if (e instanceof Anthropic.PermissionDeniedError) return { ok: false, code: 'permission', error: 'Sua chave não tem permissão para este modelo.' };
    if (e instanceof Anthropic.NotFoundError) return { ok: false, code: 'model', error: `Modelo "${model}" não encontrado.` };
    if (e instanceof Anthropic.RateLimitError) return { ok: false, code: 'rate', error: 'Limite de uso atingido. Tente de novo em instantes.' };
    if (e instanceof Anthropic.APIConnectionError) return { ok: false, code: 'network', error: 'Sem conexão com a API. Verifique a internet.' };
    if (e instanceof Anthropic.APIError) {
      if (e.status === 402 || e.type === 'billing_error') return { ok: false, code: 'billing', error: 'Sem créditos na conta da API (console.anthropic.com).' };
      return { ok: false, code: 'api', error: `Erro da API (${e.status || '?'}): ${e.message}` };
    }
    return { ok: false, code: 'unknown', error: String((e && e.message) || e) };
  }
}

/* ---------------- mensagens dos content scripts ---------------- */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === 'ZF_SLEEP') {
    setTimeout(() => sendResponse(true), Math.max(0, Math.min(Number(msg.ms) || 0, 25000)));
    return true;
  }
  if (msg.type === 'ZF_KEEPALIVE') {
    sendResponse(true);
    return;
  }
  if (msg.type === 'ZF_AI') {
    callClaude(msg).then(sendResponse, (e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
    return true;
  }
  if (msg.type === 'ZF_AI_KEY') {
    const op = msg.key ? chrome.storage.local.set({ aiKey: msg.key.trim() }) : chrome.storage.local.remove('aiKey');
    op.then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'ZF_AI_HAS_KEY') {
    chrome.storage.local.get('aiKey').then(({ aiKey }) => sendResponse({ ok: true, hasKey: !!aiKey, hint: aiKey ? aiKey.slice(0, 10) + '…' + aiKey.slice(-4) : '' }));
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

/* ---------------- botão da extensão ---------------- */
chrome.action.onClicked.addListener(async (tab) => {
  if (tab && tab.url && tab.url.startsWith(WA_URL)) {
    chrome.tabs.sendMessage(tab.id, { type: 'ZF_TOGGLE' }).catch(() => chrome.tabs.reload(tab.id));
    return;
  }
  const tabs = await waTabs();
  if (tabs.length) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    chrome.tabs.create({ url: WA_URL });
  }
});
