// Testes das ações das respostas rápidas (Pix, contato, listas, migração, variáveis, prazos).
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
vm.runInContext(read('content/util.js'), ctx);
vm.runInContext(read('content/actions.js'), ctx);
const ZF = ctx.window.ZF;

let fails = 0;
const eq = (name, got, exp) => {
  const ok = JSON.stringify(got) === JSON.stringify(exp);
  if (!ok) fails++;
  console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `\n   got: ${JSON.stringify(got)}\n   exp: ${JSON.stringify(exp)}`);
};
const plain = (o) => JSON.parse(JSON.stringify(o));

/* ---------------- Pix ---------------- */
// Exemplo oficial do Manual de Padrões para Iniciação do Pix (Banco Central)
eq('pix exemplo BCB', ZF.pixPayload({ keyType: 'random', key: '123e4567-e12b-12d1-a456-426655440000', name: 'Fulano de Tal', city: 'BRASILIA' }),
  '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D');
eq('crc16 123456789', ZF.crc16('123456789'), '29B1');
eq('pix chave celular', ZF.pixKey('phone', '(11) 98765-4321'), '+5511987654321');
eq('pix chave cpf', ZF.pixKey('cpf', '123.456.789-09'), '12345678909');
eq('pix chave email', ZF.pixKey('email', ' Ana@Clinica.com '), 'ana@clinica.com');
eq('pix mostrar cpf', ZF.pixKeyDisplay('cpf', '12345678909'), '123.456.789-09');
eq('dinheiro', [ZF.parseMoney('1.234,56'), ZF.parseMoney('10,5'), ZF.parseMoney('10.50'), ZF.parseMoney('R$ 99'), ZF.parseMoney(''), ZF.parseMoney('abc')], [1234.56, 10.5, 10.5, 99, 0, 0]);
eq('fmtMoney', ZF.fmtMoney(1234.5), 'R$ 1.234,50');
const withAmount = ZF.pixPayload({ keyType: 'cpf', key: '12345678909', name: 'Clínica São João', city: 'São Paulo', amount: '150,00' });
eq('pix valor e acentos', [withAmount.includes('5406150.00'), withAmount.includes('5916Clinica Sao Joao'), withAmount.includes('6009Sao Paulo')], [true, true, true]);
eq('pix crc confere', ZF.crc16(withAmount.slice(0, -4)), withAmount.slice(-4));
let err = null;
try { ZF.pixPayload({ keyType: 'cpf', key: '' }); } catch (e) { err = e.message; }
eq('pix sem chave', err, 'Informe a chave Pix');
const pixBlocks = ZF.actionToBlocks({ type: 'pix', keyType: 'cpf', key: '12345678909', name: 'Ana', amount: '50', message: 'Segue o Pix, {primeiro_nome}:', copyPaste: true });
eq('pix blocos', [pixBlocks.length, pixBlocks[0].text.includes('*Chave Pix (CPF):* 123.456.789-09'), pixBlocks[0].text.includes('R$ 50,00'), pixBlocks[1].text.startsWith('000201')], [2, true, true, true]);
eq('pix sem copia e cola', ZF.actionToBlocks({ type: 'pix', keyType: 'email', key: 'a@b.com', copyPaste: false, message: '' }).length, 1);

/* ---------------- contato ---------------- */
eq('vcard', ZF.vcard({ name: 'Maria Silva', phone: '5511987654321' }).split('\n'),
  ['BEGIN:VCARD', 'VERSION:3.0', 'N:;Maria Silva;;;', 'FN:Maria Silva', 'TEL;type=CELL;type=VOICE;waid=5511987654321:+55 (11) 98765-4321', 'END:VCARD']);
eq('vcard texto', ZF.vcardText({ name: 'Maria', phone: '5511987654321' }), '👤 *Maria*\n📞 +55 (11) 98765-4321\nhttps://wa.me/5511987654321');
eq('contato bloco', plain(ZF.actionToBlocks({ type: 'contact', name: 'Maria', phone: '+55 11 98765-4321' })), [{ type: 'vcard', name: 'Maria', phone: '5511987654321' }]);
eq('contato sem DDI', plain(ZF.actionToBlocks({ type: 'contact', name: 'Ana', phone: '21 99876-5432' })), [{ type: 'vcard', name: 'Ana', phone: '5521998765432' }]);
eq('contato vazio', ZF.actionToBlocks({ type: 'contact', name: 'x', phone: '' }).length, 0);

/* ---------------- lista, localização, link, convite ---------------- */
eq('lista números', ZF.formatList({ title: 'Opções', items: 'Agendar\n\n Remarcar ', footer: 'Responda com o número', style: 'numbers' }),
  '*Opções*\n\n*1.* Agendar\n*2.* Remarcar\n\n_Responda com o número_');
eq('lista emojis', ZF.formatList({ items: 'a\nb', style: 'emoji' }), '1\ufe0f\u20e3 a\n2\ufe0f\u20e3 b');
eq('lista marcadores', ZF.formatList({ items: 'a\nb', style: 'bullets' }), '• a\n• b');
eq('localização', ZF.actionToBlocks({ type: 'location', name: 'Consultório', address: 'Rua A, 10' })[0].text,
  '📍 *Consultório*\nRua A, 10\nhttps://www.google.com/maps/search/?api=1&query=Consult%C3%B3rio%2C%20Rua%20A%2C%2010');
eq('link com banner', plain(ZF.actionToBlocks({ type: 'link', url: 'https://x.com', title: 'T', description: 'D', text: 'Veja:', fileId: 'f1' })),
  [{ type: 'text', text: 'Veja:\nhttps://x.com', linkPreview: { url: 'https://x.com', title: 'T', description: 'D', thumbFileId: 'f1' } }]);
eq('convite grupo', ZF.actionToBlocks({ type: 'group_invite', link: 'https://chat.whatsapp.com/abc', text: 'Entre:' })[0].text, 'Entre:\nhttps://chat.whatsapp.com/abc');
eq('figurinha/documento', plain(ZF.actionToBlocks({ type: 'sticker', fileId: 'f', name: 'a.png', mime: 'image/png', size: 1 })).concat(plain(ZF.actionToBlocks({ type: 'document', fileId: 'g', name: 'b.png', mime: 'image/png', size: 2, caption: 'c' }))),
  [{ type: 'file', fileId: 'f', name: 'a.png', mime: 'image/png', size: 1, caption: '', asSticker: true }, { type: 'file', fileId: 'g', name: 'b.png', mime: 'image/png', size: 2, caption: 'c', asDocument: true }]);
eq('ações sem mensagem não viram blocos', ZF.actionsToBlocks([{ type: 'wait', seconds: 3 }, { type: 'crm_add', tabId: 't' }, { type: 'text', text: 'oi' }]).length, 1);

/* ---------------- migração (v1.1 → v1.2) ---------------- */
const old = { id: 'r1', title: 'CC', categoryId: 'c1', uses: 2, blocks: [
  { type: 'text', text: 'Olá {nome}' },
  { type: 'file', fileId: 'a', name: 'x.ogg', mime: 'audio/ogg', size: 9, asVoice: true },
  { type: 'file', fileId: 'b', name: 'y.pdf', mime: 'application/pdf', size: 8, caption: 'doc' },
  { type: 'file', fileId: 'c', name: 'z.jpg', mime: 'image/jpeg', size: 7, caption: '' },
] };
const mig = ZF.migrateReply(old);
eq('migração tipos', mig.actions.map((a) => a.type), ['text', 'audio', 'document', 'image']);
eq('migração mantém dados', [mig.id, mig.title, mig.categoryId, mig.uses, mig.kind, 'blocks' in mig, mig.actions[1].asVoice, mig.actions[2].caption], ['r1', 'CC', 'c1', 2, 'reply', false, true, 'doc']);
eq('migração idempotente', ZF.migrateReply(mig) === mig, true);
eq('ida e volta', plain(ZF.actionsToBlocks(mig.actions)).map((b) => b.type + ':' + (b.fileId || b.text)), ['text:Olá {nome}', 'file:a', 'file:b', 'file:c']);

/* ---------------- variáveis ---------------- */
const acts = [
  { type: 'text', text: '{saudacao}, {primeiro_nome}! Horário: {horario}' },
  { type: 'image', fileId: 'x', name: '{naoeh}.png', caption: 'Valor {valor}' },
  { type: 'transfer', name: 'Dra. Ana', phone: '11999999999', toClient: 'Vou te passar para {atendente}', toAgent: '{nome} {numero}' },
  { type: 'link', url: 'https://x.com/{naoeh}', title: '{titulo}' },
];
eq('vars nas ações', ZF.findVarsInActions(acts).sort(), ['horario', 'nome', 'numero', 'primeiro_nome', 'saudacao', 'titulo', 'valor']);
const r1 = ZF.renderAction(acts[2], { nome: 'Maria', numero: '5511' });
eq('transferência usa {atendente}', [r1.toClient, r1.toAgent], ['Vou te passar para Dra. Ana', 'Maria 5511']);
eq('agendar mantém modelo', ZF.renderAction({ type: 'schedule', text: 'Oi {nome}', amount: 1, unit: 'days' }, { nome: 'X' }).text, 'Oi {nome}');
eq('numero nas variáveis', ZF.builtinVars({ name: 'Ana', phone: '5511987654321' }).numero, '5511987654321');

/* ---------------- tipo principal ---------------- */
eq('replyType', [
  ZF.replyType({ actions: [{ type: 'text' }, { type: 'wait' }] }),
  ZF.replyType({ actions: [{ type: 'audio' }] }),
  ZF.replyType({ actions: [{ type: 'pix' }] }),
  ZF.replyType({ actions: [{ type: 'contact' }] }),
  ZF.replyType({ actions: [{ type: 'text' }, { type: 'image' }] }),
  ZF.replyType({ actions: [{ type: 'crm_add' }] }),
  ZF.replyType({ kind: 'script', steps: [] }),
], ['texto', 'audio', 'texto', 'contato', 'multiplos', 'automacao', 'script']);

/* ---------------- prazos ---------------- */
const base = new Date(2026, 8, 19, 10, 30, 0).getTime();
eq('delay minutos', ZF.delayTs({ amount: 30, unit: 'minutes' }, base) - base, 30 * 60000);
eq('delay horas', ZF.delayTs({ amount: 2, unit: 'hours' }, base) - base, 2 * 3600000);
const d1 = new Date(ZF.delayTs({ amount: 1, unit: 'days', time: '09:15' }, base));
eq('delay dias com hora', [d1.getDate(), d1.getHours(), d1.getMinutes()], [20, 9, 15]);
const d0 = new Date(ZF.delayTs({ amount: 0, unit: 'days', time: '08:00' }, base));
eq('hoje com hora que já passou = amanhã', [d0.getDate(), d0.getHours()], [20, 8]);
eq('delayLabel', [ZF.delayLabel({ amount: 3, unit: 'hours' }), ZF.delayLabel({ amount: 1, unit: 'days', time: '09:00' })], ['em 3 h', 'em 1 dia(s) às 09:00']);

/* ---------------- catálogo ---------------- */
const allTypes = ZF.ACTION_GROUPS.flatMap((g) => g.types);
eq('todo tipo do menu existe', allTypes.filter((t) => !ZF.ACTION_TYPES[t]), []);
eq('grupos do print', ZF.ACTION_GROUPS.map((g) => g.label), ['Enviar Mensagem', 'Aba do CRM', 'Etiquetas', 'Temporizadores', 'Utilitários', 'Transferir Atendimento']);
eq('itens de Enviar Mensagem', ZF.ACTION_GROUPS[0].types.map((t) => ZF.ACTION_TYPES[t].label).slice(0, 11),
  ['Texto', 'Imagem', 'Vídeo', 'Áudio', 'Documentos', 'Pix', 'Convite para Grupo', 'Contato', 'Link com Banner', 'Figurinha', 'Lista']);
eq('resumos sem erro', allTypes.every((t) => typeof ZF.actionSummary(ZF.newAction(t)) === 'string'), true);

console.log(fails ? `\n${fails} falha(s)` : '\nTodos os testes passaram');
process.exit(fails ? 1 : 0);
