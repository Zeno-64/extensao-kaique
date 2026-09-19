// Testes da importação do backup do WaSpeed (dados de exemplo, no mesmo formato do arquivo real).
// Uso: npm test
import fs from 'fs';
import vm from 'vm';

const SRC = new URL('../src/', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, SRC), 'utf8');
const ctx = {
  window: {}, document: { hidden: false }, console, setTimeout, clearTimeout, Date, Math, Promise, Intl,
  TextEncoder, TextDecoder, Blob, Response, DataView, Uint8Array, Uint32Array, ArrayBuffer, URLSearchParams, File,
};
vm.createContext(ctx);
['content/util.js', 'content/actions.js', 'content/import-waspeed.js'].forEach((f) => vm.runInContext(read(f), ctx));
const ZF = ctx.window.ZF;
const W = ZF.waspeed;

let fails = 0;
const eq = (name, got, exp) => {
  const ok = JSON.stringify(got) === JSON.stringify(exp);
  if (!ok) fails++;
  console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `\n   got: ${JSON.stringify(got)}\n   exp: ${JSON.stringify(exp)}`);
};
const day = (y, m, d, h = 10, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();
const fmt = (ts) => ZF.fmtDateTime(ts);

const PDF = 'data:application/pdf;base64,JVBERi0xLjQKJcfsj6IK';
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const txt = (mensagem, aguarde = 0, composing = 0) => ({ id: 'a' + Math.random(), type: 'txt', propriedades: { aguarde, composing, mensagem } });
const sample = {
  respostasRapidas: 'U2FsdGVkX1+abc',
  categoria: 'U2FsdGVkX1+def',
  notes: 'U2FsdGVkX1+ghi',
  userTabs: 'U2FsdGVkX1+jkl',
  respostasRapidasAcao: [
    { id: 'r1', acao: [
      txt('Perfeito, #primeiroNome. Segue o manual:', 3, 2),
      { id: 'd1', type: 'doc', propriedades: { base64: PDF, base64Name: 'Manual.pdf' } },
      { id: 'd2', type: 'doc', propriedades: { base64: PNG, base64Name: 'Guia - Bangu.png' } },
      { id: 'l1', type: 'addLabel', propriedades: { labelID: '5' } },
    ] },
    { id: 'r2', acao: [
      txt('Perfeito, #primeiroNome. Segue o manual:', 0, 0),
      { id: 'd3', type: 'doc', propriedades: { base64: PDF, base64Name: 'Manual.pdf' } },
      { id: 'd4', type: 'doc', propriedades: { base64: 'data:image/png;base64,AAAA', base64Name: 'Guia - Tijuca.png' } },
    ] },
    { id: 'r3', acao: [txt('#periodo-dia, #primeiroNome. {Nome}, por que {está caro}? {Oi|Olá}!', 5, 5)] },
    { id: 'r4', acao: [{ id: 'i1', type: 'image', propriedades: { aguarde: 0, composing: 1, base64: PNG, mensagem: 'Planos *online*', isViewOnce: false } }] },
    { id: 'r5', acao: [{ id: 'x1', type: 'enquete', propriedades: {} }] },
  ],
  agendamentos: [
    { id: 's1', userID: '5521999990001', data: '2026-09-25', hora: '14:20', recorrencia: 'semanal', recorrenciaManual: false, tipo: 'txt', mensagem: 'Boa tarde, Ana! #primeiroNome', base64: '', base64Name: '', respostaRapida: '', status: 'enviado', titulo: 'Não Definido' },
    { id: 's2', userID: '5521999990002', data: '2026-09-11', hora: '14:20', recorrencia: '14', recorrenciaManual: true, tipo: 'txt', mensagem: 'Check-in', base64: '', base64Name: '', respostaRapida: '', status: 'enviado', titulo: 'Não Definido' },
    { id: 's3', userID: '120363000000000001', data: '2026-10-06', hora: '10:00', recorrencia: '21', recorrenciaManual: true, tipo: 'respostaRapida', mensagem: '', base64: '', base64Name: '', respostaRapida: 'r1', status: 'enviado', titulo: 'Não Definido' },
    { id: 's4', userID: '5521999990004', data: '2026-09-05', hora: '11:30', recorrencia: '', recorrenciaManual: false, tipo: 'txt', mensagem: 'Já passou', base64: '', base64Name: '', respostaRapida: '', status: 'enviado', titulo: 'Não Definido' },
  ],
  agendamentosNaoDisparados: [{ id: 'h1' }, { id: 'h2' }],
  useOrderLabels: { orderLabels: ['1', '10', '5'] },
};

eq('reconhece o formato', [W.isWaSpeed(sample), W.isWaSpeed({ app: 'ZapFlow', data: {} }), W.isWaSpeed({ foo: 1 })], [true, false, false]);
eq('variáveis e chaves', W.convertText('#periodo-dia, #primeiroNome. {Nome}, {está caro} {Oi|Olá} #nomeCompleto'),
  '{saudacao}, {primeiro_nome}. [Nome], [está caro] {Oi|Olá} #nomeCompleto');
eq('título tirado do texto', W.titleFrom('{saudacao}, {primeiro_nome}. Tudo bem ? Estou passando para confirmar a sua consulta', 'x'), 'Tudo bem? Estou passando para confirmar a sua…');
eq('título: nome no meio', W.titleFrom('Perfeito, {primeiro_nome}. Segue o manual:', 'x'), 'Perfeito. Segue o manual:');

const now = day(2026, 9, 19, 18);
const names = new Map([['5521999990001', 'Ana Souza'], ['120363000000000001@g.us', 'Grupo Check-in']]);
const { backup, report } = W.convert(sample, { now, names });
const d = backup.data;
eq('relatório', [report.replies, report.files, report.schedules, report.skippedPast, report.history, report.unknownActions, report.labelOrder],
  [4, 3, 3, 1, 2, 1, ['1', '10', '5']]);
eq('partes criptografadas', report.encrypted, ['títulos e atalhos das respostas rápidas', 'categorias', 'abas', 'notas']);
eq('backup do ZapFlow parcial', [backup.app, backup.source, backup.parts], ['ZapFlow', 'waspeed', ['replies', 'schedules']]);

const r1 = d.replies.find((r) => r.id === 'r1');
eq('ações: aguarde, digitando, texto, documentos, etiqueta', r1.actions.map((a) => a.type), ['wait', 'typing', 'text', 'document', 'document', 'label_add']);
eq('aguarde e digitando em segundos', [r1.actions[0].seconds, r1.actions[1].seconds], [3, 2]);
eq('etiqueta do WhatsApp', [r1.actions[5].labelId], ['5']);
eq('mesmo PDF vira um arquivo só', [r1.actions[3].fileId === d.replies.find((r) => r.id === 'r2').actions[1].fileId, Object.keys(d).filter((k) => k.startsWith('file:')).length], [true, 3]);
eq('arquivo guardado', (({ name, mime, size }) => ({ name, mime, size }))(d['file:' + r1.actions[3].fileId]), { name: 'Manual.pdf', mime: 'application/pdf', size: 15 });
eq('títulos diferenciados', [r1.title, d.replies.find((r) => r.id === 'r2').title], ['Perfeito. Segue o manual: · Bangu', 'Perfeito. Segue o manual: · Tijuca']);
const r3 = d.replies.find((r) => r.id === 'r3');
eq('texto com variáveis do ZapFlow', r3.actions.find((a) => a.type === 'text').text, '{saudacao}, {primeiro_nome}. [Nome], por que [está caro]? {Oi|Olá}!');
const r4 = d.replies.find((r) => r.id === 'r4');
eq('imagem com legenda', [r4.actions.map((a) => a.type), r4.actions[1].caption, r4.title], [['typing', 'image'], 'Planos *online*', 'Planos online']);
eq('categoria das importadas', [d.categories[0].name, d.replies.every((r) => r.categoryId === W.CATEGORY_ID)], ['Importadas do WaSpeed', true]);
eq('resposta sem ação conhecida fica de fora', d.replies.some((r) => r.id === 'r5'), false);

const s = Object.fromEntries(d.schedules.map((x) => [x.id, x]));
eq('agendamentos entram pausados', d.schedules.map((x) => x.status), ['paused', 'paused', 'paused']);
eq('semanal', [s.s1.repeat, fmt(s.s1.sendAt), s.s1.target], ['weekly', '25/09/2026 14:20', { type: 'phone', phone: '5521999990001', chatId: null, name: 'Ana Souza' }]);
eq('a cada 14 dias, data passada avança', [s.s2.repeat, s.s2.everyDays, fmt(s.s2.sendAt)], ['days', 14, '25/09/2026 14:20']);
eq('grupo com resposta rápida', [s.s3.target.chatId, s.s3.target.name, s.s3.blocks.map((b) => b.type)], ['120363000000000001@g.us', 'Grupo Check-in', ['text', 'file', 'file']]);
eq('texto do agendamento convertido', s.s1.blocks[0].text, 'Boa tarde, Ana! {primeiro_nome}');
eq('ativos se escolher', W.convert(sample, { now, activeSchedules: true }).backup.data.schedules.map((x) => x.status), ['pending', 'pending', 'pending']);

/* próxima ocorrência "a cada X dias" */
eq('a cada 21 dias', fmt(ZF.nextOccurrence(day(2026, 9, 1, 9), 'days', 1, 21, day(2026, 9, 19))), '22/09/2026 09:00');
eq('a cada 56 dias (já no futuro: pula um período)', fmt(ZF.nextOccurrence(day(2026, 10, 2, 14, 20), 'days', 2, 56, day(2026, 9, 19))), '27/11/2026 14:20');
eq('rótulo da repetição', [ZF.repeatLabel({ repeat: 'days', everyDays: 14 }), ZF.repeatLabel({ repeat: 'weekly' })], ['A cada 14 dias', 'Toda semana']);
eq('ordem das etiquetas', ZF.sortLabels([{ id: '5' }, { id: '2' }, { id: '10' }, { id: '1' }], ['1', '10', '5']).map((l) => l.id), ['1', '10', '5', '2']);

if (fails) {
  console.log(`\n${fails} teste(s) falharam`);
  process.exit(1);
}
console.log('\nTodos os testes da importação do WaSpeed passaram');
