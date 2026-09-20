// Testes do backup: prazos do backup automático, resumo do arquivo e exportar/importar.
// Uso: npm test
import fs from 'fs';
import vm from 'vm';

const SRC = new URL('../src/', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, SRC), 'utf8');

// chrome.storage.local em memória
const mem = {};
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const chrome = {
  storage: {
    local: {
      async get(keys) {
        if (keys == null) return clone(mem);
        const list = Array.isArray(keys) ? keys : [keys];
        const out = {};
        list.forEach((k) => { if (k in mem) out[k] = clone(mem[k]); });
        return out;
      },
      async set(obj) { Object.entries(obj).forEach(([k, v]) => (mem[k] = clone(v))); },
      async remove(keys) { (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete mem[k]); },
      async clear() { Object.keys(mem).forEach((k) => delete mem[k]); },
    },
    onChanged: { addListener() {}, removeListener() {} },
  },
};

const ctx = {
  window: {}, document: { hidden: false }, console, setTimeout, clearTimeout, Date, Math, Promise, Intl, chrome,
  TextEncoder, TextDecoder, Blob, Response, DataView, Uint8Array, Uint32Array, ArrayBuffer, URLSearchParams, File,
};
vm.createContext(ctx);
['content/util.js', 'content/store.js', 'content/actions.js', 'content/backup.js'].forEach((f) => vm.runInContext(read(f), ctx));
const ZF = ctx.window.ZF;
const B = ZF.backup;

let fails = 0;
const eq = (name, got, exp) => {
  const ok = JSON.stringify(got) === JSON.stringify(exp);
  if (!ok) fails++;
  console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `\n   got: ${JSON.stringify(got)}\n   exp: ${JSON.stringify(exp)}`);
};
const day = (y, m, d, h = 10) => new Date(y, m - 1, d, h).getTime();
const fmt = (ts) => ZF.fmtDateTime(ts);

/* ---------------- prazos ---------------- */
eq('mensal: mesmo dia do mês seguinte', fmt(B.addPeriod(day(2026, 9, 19), 'monthly')), '19/10/2026 10:00');
eq('mensal: 31/01 vira 28/02', fmt(B.addPeriod(day(2026, 1, 31), 'monthly')), '28/02/2026 10:00');
eq('mensal: dezembro vira janeiro', fmt(B.addPeriod(day(2026, 12, 5), 'monthly')), '05/01/2027 10:00');
eq('semanal: +7 dias', fmt(B.addPeriod(day(2026, 9, 28), 'weekly')), '05/10/2026 10:00');
eq('desligado', B.nextDue('off', { lastOkAt: day(2026, 9, 1) }), null);
eq('nunca feito: sai logo', B.nextDue('monthly', {}), 0);
eq('depois de um backup: um mês', fmt(B.nextDue('monthly', { lastOkAt: day(2026, 9, 19), lastAttemptAt: day(2026, 9, 19) })), '19/10/2026 10:00');
eq('falhou: tenta de novo em 1 h', fmt(B.nextDue('monthly', { lastOkAt: day(2026, 9, 19), lastAttemptAt: day(2026, 10, 19, 10) })), '19/10/2026 11:00');
eq('nunca deu certo e falhou: 1 h', fmt(B.nextDue('weekly', { lastAttemptAt: day(2026, 9, 19, 8) })), '19/09/2026 09:00');
eq('2 falhas: ainda de hora em hora', fmt(B.nextDue('weekly', { lastAttemptAt: day(2026, 9, 19, 8), fails: 2 })), '19/09/2026 09:00');
eq('3 falhas: espera o proximo periodo', fmt(B.nextDue('weekly', { lastAttemptAt: day(2026, 9, 19, 8), fails: 3 })), '26/09/2026 08:00');
eq('3 falhas no mensal: espera um mes', fmt(B.nextDue('monthly', { lastAttemptAt: day(2026, 9, 19, 8), fails: 5 })), '19/10/2026 08:00');

/* ---------------- resumo ---------------- */
const sample = {
  app: 'ZapFlow', version: 2, exportedAt: new Date(day(2026, 9, 19, 8)).toISOString(),
  data: {
    replies: [{ id: 'r1', actions: [] }, { id: 'r2', actions: [] }, { id: 's1', kind: 'script', steps: [] }],
    crmTags: [{ id: 't1', name: 'Pacientes' }],
    crmChats: { a: { tags: ['t1'], notes: [{ id: 'n1' }, { id: 'n2' }] }, b: { tags: [], notes: [] } },
    schedules: [{ id: 'x', status: 'pending' }, { id: 'y', status: 'sent' }],
    reminders: [{ id: 'z', status: 'done' }],
    'file:abc': { id: 'abc', data: 'data:,' },
  },
};
const info = B.describe(sample);
eq('resumo: texto', info.text, '2 respostas rápidas · 1 script · 1 aba · 2 contatos no CRM · 2 notas · 1 agendamento');
eq('resumo: data e arquivos', [fmt(info.at), info.count.files], ['19/09/2026 08:00', 1]);
eq('resumo: backup vazio', B.describe({ app: 'ZapFlow', data: {} }).text, '0 respostas rápidas · 0 abas · 0 contatos no CRM');
eq('nome do arquivo', B.fileName(day(2026, 3, 7)), 'zapflow-backup-2026-03-07.json');

const lines = (freq, st, now) => B.statusLines(freq, st, now).map((l) => l.type + ': ' + l.text);
eq('situação: nunca feito', lines('monthly', {}), ['info: Nenhum backup enviado ainda.', 'info: Próximo backup: em instantes (com o WhatsApp Web aberto).']);
eq('situação: feito e com falha depois', lines('monthly', {
  lastOkAt: day(2026, 9, 19), lastAttemptAt: day(2026, 10, 19), lastError: 'Sem internet', lastAuto: true, lastToSelf: true, lastSize: 2048,
}, day(2026, 10, 19, 10) + 60000), [
  'ok: Último backup: 19/09/2026 10:00 (automático, enviado para o seu WhatsApp, 2 KB)',
  'error: A última tentativa falhou (19/10/2026 10:00): Sem internet',
  'info: Próxima tentativa: 19/10/2026 11:00.',
]);
eq('situação: em dia', lines('monthly', { lastOkAt: day(2026, 9, 19), lastAttemptAt: day(2026, 9, 19), lastToSelf: false, lastTo: '5511987654321' }, day(2026, 9, 20)), [
  'ok: Último backup: 19/09/2026 10:00 (manual, enviado para +55 (11) 98765-4321)',
  'info: Próximo backup: 19/10/2026 (ou na primeira vez que o WhatsApp Web for aberto depois disso).',
]);
eq('situação: desligado', lines('off', {})[1], 'warn: Backup automático desligado.');

/* ---------------- exportar / importar ---------------- */
await chrome.storage.local.set({
  settings: { panelOpen: true, backupFreq: 'weekly' },
  replies: [{ id: 'r1', title: 'Oi', actions: [] }],
  crmTags: [{ id: 't1', name: 'Pacientes' }],
  crmChats: { k1: { name: 'Ana', tags: ['t1'], notes: [{ id: 'n1', text: 'a' }] } },
  aiKey: 'sk-segredo',
  backupState: { lastOkAt: 123 },
  runner: { current: null },
  'file:f1': { id: 'f1', name: 'a.png', data: 'data:,' },
});
const exported = await ZF.store.exportAll();
eq('exportar: sem chave da IA nem estado interno', ['aiKey', 'backupState', 'runner'].filter((k) => k in exported.data), []);
eq('exportar: leva arquivos e dados', [exported.app, !!exported.data['file:f1'], exported.data.replies.length], ['ZapFlow', true, 1]);

// juntar: mantém o atual e adiciona o que falta
await chrome.storage.local.set({ replies: [{ id: 'r9', title: 'Novo aqui', actions: [] }], crmChats: { k1: { name: 'Ana', tags: [], notes: [{ id: 'n2', text: 'b' }] } } });
await ZF.store.importAll(exported, 'merge');
const merged = await chrome.storage.local.get(['replies', 'crmChats']);
eq('juntar: respostas somadas', merged.replies.map((r) => r.id), ['r9', 'r1']);
eq('juntar: abas e notas somadas', [merged.crmChats.k1.tags, merged.crmChats.k1.notes.map((n) => n.id)], [['t1'], ['n2', 'n1']]);

// substituir: fica igual ao backup, mas a chave da IA e o estado do backup continuam
await chrome.storage.local.set({ backupState: { lastOkAt: 999 } });
await ZF.store.importAll(exported, 'replace');
const replaced = await chrome.storage.local.get(null);
eq('substituir: dados do backup', replaced.replies.map((r) => r.id), ['r1']);
eq('substituir: mantém chave e estado do backup', [replaced.aiKey, replaced.backupState.lastOkAt], ['sk-segredo', 999]);

let err = null;
try { await ZF.store.importAll({ foo: 1 }, 'merge'); } catch (e) { err = e.message; }
eq('importar arquivo errado', err, 'Arquivo de backup inválido');

/* ---------------- backup parcial ("Selecione o conteúdo") ---------------- */
await chrome.storage.local.clear();
await chrome.storage.local.set({
  settings: { panelOpen: true },
  replies: [{ id: 'r1', title: 'Oi', actions: [{ id: 'a', type: 'image', fileId: 'f1' }] }],
  categories: [{ id: 'c1', name: 'Consultas' }],
  schedules: [{ id: 's1', status: 'pending', blocks: [{ type: 'file', fileId: 'f2' }] }],
  crmTags: [{ id: 't1', name: 'Pacientes' }],
  crmChats: { k1: { name: 'Ana', tags: ['t1'], notes: [{ id: 'n1' }] }, k2: { name: 'Bia', tags: ['t1'], notes: [] } },
  'file:f1': { id: 'f1', data: 'data:,1' },
  'file:f2': { id: 'f2', data: 'data:,2' },
});
const onlyReplies = await ZF.store.exportAll(['replies']);
eq('parcial: só respostas e o arquivo delas', [onlyReplies.parts, Object.keys(onlyReplies.data).sort()], [['replies'], ['categories', 'file:f1', 'replies']]);
const onlyNotes = await ZF.store.exportAll(['notes']);
eq('parcial: notas sem as abas', onlyNotes.data.crmChats, { k1: { name: 'Ana', tags: [], notes: [{ id: 'n1' }] } });
eq('parcial: resumo mostra só o escolhido', B.describe(onlyReplies).text, '1 resposta rápida');
eq('parcial: nomes das partes', B.describe(onlyNotes).partial, ['Notas']);

// substituir com backup parcial troca só aquelas partes
await chrome.storage.local.set({ replies: [{ id: 'rX', title: 'Outra', actions: [] }], crmChats: { k1: { name: 'Ana', tags: ['t1'], notes: [{ id: 'n9' }] } } });
await ZF.store.importAll(onlyReplies, 'replace');
await ZF.store.importAll(onlyNotes, 'replace');
const after = await chrome.storage.local.get(null);
eq('parcial substituir: respostas trocadas', after.replies.map((r) => r.id), ['r1']);
eq('parcial substituir: resto intacto', [after.crmTags.length, after.schedules.length, !!after['file:f2']], [1, 1, true]);
eq('parcial substituir: notas trocadas, abas mantidas', after.crmChats.k1, { name: 'Ana', tags: ['t1'], notes: [{ id: 'n1' }] });

/* ---------------- assinatura ---------------- */
const txt = [{ type: 'text', text: 'Olá!' }, { type: 'text', text: 'Tudo bem?' }];
eq('assinatura no primeiro texto', ZF.signBlocks(txt, 'Kaique').map((b) => b.text), ['*Kaique:*\nOlá!', 'Tudo bem?']);
eq('assinatura não repete', ZF.signBlocks(ZF.signBlocks(txt, 'Kaique'), 'Kaique')[0].text, '*Kaique:*\nOlá!');
eq('sem nome não assina', ZF.signBlocks(txt, ' ')[0].text, 'Olá!');
eq('só arquivo: sem assinatura', ZF.signBlocks([{ type: 'file', fileId: 'x' }], 'Kaique'), [{ type: 'file', fileId: 'x' }]);

if (fails) {
  console.log(`\n${fails} teste(s) falharam`);
  process.exit(1);
}
console.log('\nTodos os testes de backup passaram');
