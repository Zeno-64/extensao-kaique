// Testa o service worker (background.js) no Node: chrome.* simulado e rede interceptada (nada sai para a internet).
// Confere a chamada à API do Claude (modelo, cabeçalhos, fallback), erros, lembretes e alarmes. Uso: npm test

let fails = 0;
const eq = (name, got, exp) => {
  const ok = JSON.stringify(got) === JSON.stringify(exp);
  if (!ok) fails++;
  console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `\n   got: ${JSON.stringify(got)}\n   exp: ${JSON.stringify(exp)}`);
};

/* ---- chrome.* simulado ---- */
const storage = {};
const listeners = { message: [], alarm: [], changed: [], btn: [], click: [], installed: [], startup: [], action: [] };
const alarms = new Map();
const notifications = [];
const sentToTabs = [];
const ev = (arr) => ({ addListener: (fn) => arr.push(fn) });
globalThis.chrome = {
  runtime: {
    onInstalled: ev(listeners.installed), onStartup: ev(listeners.startup), onMessage: ev(listeners.message),
    getURL: (p) => 'chrome-extension://test/' + p, lastError: null,
  },
  storage: {
    local: {
      get: async (keys) => { const out = {}; [].concat(keys).forEach((k) => { if (k in storage) out[k] = structuredClone(storage[k]); }); return out; },
      set: async (obj) => { const ch = {}; for (const k in obj) { ch[k] = { newValue: obj[k] }; storage[k] = structuredClone(obj[k]); } listeners.changed.forEach((f) => f(ch, 'local')); },
      remove: async (k) => { [].concat(k).forEach((x) => delete storage[x]); },
    },
    session: { get: async () => ({}), set: async () => {} },
    onChanged: ev(listeners.changed),
  },
  alarms: {
    create: (name, info) => alarms.set(name, { name, scheduledTime: info.when || Date.now() + 60000, ...info }),
    getAll: async () => [...alarms.values()],
    clear: async (n) => alarms.delete(n),
    onAlarm: ev(listeners.alarm),
  },
  tabs: {
    query: async () => [{ id: 7, windowId: 1, url: 'https://web.whatsapp.com/' }],
    sendMessage: async (id, msg) => { sentToTabs.push(msg); },
    create: async () => {}, reload: () => {}, update: async () => {},
  },
  windows: { update: async () => {} },
  notifications: {
    create: (id, opts, cb) => { notifications.push({ id, ...opts }); cb && cb(); },
    clear: () => {}, onButtonClicked: ev(listeners.btn), onClicked: ev(listeners.click),
  },
  action: { onClicked: ev(listeners.action) },
};

/* ---- fetch interceptado (API do Claude) ---- */
const requests = [];
let nextResponse = null;
globalThis.fetch = async (url, init) => {
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  requests.push({ url: String(url), headers, body: JSON.parse(init.body) });
  const r = nextResponse;
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json', 'request-id': 'req_test' } });
};

await import(new URL('../src/background.js', import.meta.url).href);

const send = (msg) => new Promise((resolve) => {
  let async = false;
  for (const fn of listeners.message) {
    const r = fn(msg, {}, resolve);
    if (r === true) async = true;
  }
  if (!async) setTimeout(() => resolve('(sync)'), 0);
});
const okBody = (text, extra = {}) => ({
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5',
  content: [{ type: 'thinking', thinking: '', signature: 'x' }, { type: 'text', text }],
  stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 }, ...extra,
});

// 1) sem chave
eq('no key', (await send({ type: 'ZF_AI', system: 's', messages: [{ role: 'user', content: 'oi' }] })).code, 'no_key');

// 2) salvar chave e checar
await send({ type: 'ZF_AI_KEY', key: '  sk-ant-api03-TESTKEY-1234  ' });
eq('key saved trimmed', storage.aiKey, 'sk-ant-api03-TESTKEY-1234');
const hk = await send({ type: 'ZF_AI_HAS_KEY' });
eq('has key', [hk.hasKey, hk.hint], [true, 'sk-ant-api…1234']);

// 3) chamada com o modelo padrão (Opus 5): beta fallbacks + effort
storage.settings = { aiModel: 'claude-opus-5', aiEffort: 'low' };
nextResponse = { status: 200, body: okBody('Olá, Maria! Sua consulta está confirmada.') };
const r1 = await send({ type: 'ZF_AI', system: 'sistema', messages: [{ role: 'user', content: 'sugira' }], maxTokens: 8000 });
eq('ai ok text', [r1.ok, r1.text], [true, 'Olá, Maria! Sua consulta está confirmada.']);
const q1 = requests.at(-1);
eq('ai request url', q1.url.replace(/\?.*$/, ''), 'https://api.anthropic.com/v1/messages');
eq('ai request body', { model: q1.body.model, max_tokens: q1.body.max_tokens, system: q1.body.system, fallbacks: q1.body.fallbacks, output_config: q1.body.output_config, hasBetasInBody: 'betas' in q1.body },
  { model: 'claude-opus-5', max_tokens: 8000, system: 'sistema', fallbacks: 'default', output_config: { effort: 'low' }, hasBetasInBody: false });
eq('ai headers', [q1.headers['x-api-key'], q1.headers['anthropic-beta'], q1.headers['anthropic-dangerous-direct-browser-access'], !!q1.headers['anthropic-version']],
  ['sk-ant-api03-TESTKEY-1234', 'server-side-fallback-2026-07-01', 'true', true]);

// 4) Haiku: sem fallbacks nem effort
storage.settings = { aiModel: 'claude-haiku-4-5', aiEffort: 'low' };
nextResponse = { status: 200, body: okBody('ok haiku', { model: 'claude-haiku-4-5' }) };
await send({ type: 'ZF_AI', system: 's', messages: [{ role: 'user', content: 'x' }] });
const q2 = requests.at(-1);
eq('haiku request', [q2.body.model, 'fallbacks' in q2.body, 'output_config' in q2.body, q2.headers['anthropic-beta'] || null], ['claude-haiku-4-5', false, false, null]);

// 5) recusa
storage.settings = { aiModel: 'claude-opus-5' };
nextResponse = { status: 200, body: okBody('', { content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: null } }) };
eq('refusal', (await send({ type: 'ZF_AI', system: 's', messages: [{ role: 'user', content: 'x' }] })).code, 'refusal');

// 6) erros HTTP mapeados
for (const [status, type, code] of [[401, 'authentication_error', 'auth'], [429, 'rate_limit_error', 'rate'], [404, 'not_found_error', 'model'], [402, 'billing_error', 'billing']]) {
  nextResponse = { status, body: { type: 'error', error: { type, message: 'x' } } };
  const r = await send({ type: 'ZF_AI', system: 's', messages: [{ role: 'user', content: 'x' }] });
  eq(`http ${status}`, r.code, code);
}

// 7) lembrete vencido -> notificação com botões; concluir via botão (repetição diária reagenda)
const past = Date.now() - 1000;
await chrome.storage.local.set({
  settings: {}, reminders: [
    { id: 'r1', title: 'Ligar p/ Ana', dueAt: past, status: 'pending', repeat: 'none', chat: { name: 'Ana', phone: '5511' } },
    { id: 'r2', title: 'Tomar água', dueAt: past, status: 'pending', repeat: 'daily', anchorDay: 1 },
  ],
});
listeners.alarm.forEach((f) => f({ name: 'zf-rem:r1' }));
await new Promise((r) => setTimeout(r, 50));
eq('notifications', notifications.filter((n) => n.id.startsWith('zf-rem:')).map((n) => [n.id, n.title, n.buttons.length]), [['zf-rem:r1', '🔔 Ligar p/ Ana', 2], ['zf-rem:r2', '🔔 Tomar água', 2]]);
eq('marked notified', storage.reminders.every((r) => r.notifiedAt), true);
listeners.btn.forEach((f) => f('zf-rem:r1', 0));
listeners.btn.forEach((f) => f('zf-rem:r2', 0));
await new Promise((r) => setTimeout(r, 50));
const [r1b, r2b] = storage.reminders;
eq('done once', [r1b.status, !!r1b.doneAt], ['done', true]);
eq('daily rescheduled', [r2b.status, r2b.dueAt > Date.now(), r2b.notifiedAt], ['pending', true, null]);
listeners.click.forEach((f) => f('zf-rem:r1'));
await new Promise((r) => setTimeout(r, 50));
eq('click opens reminder in tab', sentToTabs.some((m) => m.type === 'ZF_OPEN_REMINDER' && m.id === 'r1'), true);

// 8) alarmes sincronizados para agendamentos/lembretes futuros
await chrome.storage.local.set({ schedules: [{ id: 's9', status: 'pending', sendAt: Date.now() + 3600000 }], reminders: [{ id: 'r9', status: 'pending', dueAt: Date.now() + 7200000 }] });
await new Promise((r) => setTimeout(r, 700));
eq('alarms', ['zf-at:s:s9', 'zf-rem:r9'].map((n) => alarms.has(n)), [true, true]);

console.log(fails ? `\n${fails} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
process.exit(fails ? 1 : 0);
