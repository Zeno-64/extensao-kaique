// Testes da lógica pura (telefones, CSV, variáveis, recorrência, planilhas .xlsx, Google Agenda).
// Uso: npm test
import fs from 'fs';
import vm from 'vm';
import zlib from 'zlib';

const SRC = new URL('../src/', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, SRC), 'utf8');

const ctx = {
  window: {}, document: { hidden: false }, console, setTimeout, clearTimeout, Date, Math, Promise, Intl,
  TextEncoder, TextDecoder, Blob, Response, DecompressionStream, DataView, Uint8Array, Uint32Array, ArrayBuffer, URLSearchParams, File,
};
vm.createContext(ctx);
vm.runInContext(read('content/util.js'), ctx);
const ZF = ctx.window.ZF;
ZF.readFileAsText = async (f) => Buffer.from(await f.arrayBuffer()).toString('utf8');

let fails = 0;
const eq = (name, got, exp) => {
  const ok = JSON.stringify(got) === JSON.stringify(exp);
  if (!ok) fails++;
  console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `\n   got: ${JSON.stringify(got)}\n   exp: ${JSON.stringify(exp)}`);
};

/* ---------------- telefones ---------------- */
eq('phone 11 dig', ZF.normalizePhone('(11) 98765-4321'), '5511987654321');
eq('phone 10 dig', ZF.normalizePhone('11 8765-4321'), '551187654321');
eq('phone DDD 55 (RS)', ZF.normalizePhone('55 99123-4567'), '5555991234567');
eq('phone with cc', ZF.normalizePhone('+55 11 98765-4321'), '5511987654321');
eq('phone 13 dig', ZF.normalizePhone('5511987654321'), '5511987654321');
eq('phone leading 0', ZF.normalizePhone('011 98765-4321'), '5511987654321');
eq('phone foreign +', ZF.normalizePhone('+1 202 555 0123'), '12025550123');
eq('phone too short', ZF.normalizePhone('12345'), null);
eq('fmtPhone', ZF.fmtPhone('5511987654321'), '+55 (11) 98765-4321');

/* ---------------- modelos ---------------- */
const vars = { nome: 'Maria Silva', primeiro_nome: 'Maria', horario: '14:00' };
eq('render vars', ZF.renderTemplate('Olá {primeiro_nome}, às {horario}. {Nome}', vars), 'Olá Maria, às 14:00. Maria Silva');
eq('render unknown empty', ZF.renderTemplate('x{foo}y', vars), 'xy');
eq('render unknown keep', ZF.renderTemplate('x{foo}y', vars, true), 'x{foo}y');
const spin = new Set();
for (let i = 0; i < 200; i++) spin.add(ZF.renderTemplate('{Oi|Olá|E aí}', {}));
eq('spintax variants', [...spin].sort(), ['E aí', 'Oi', 'Olá']);
eq('findVars', ZF.findVars('{saudacao} {Horário} {a|b} {data_consulta}'), ['saudacao', 'horario', 'data_consulta']);
eq('missingVars', ZF.missingVars([{ type: 'text', text: '{nome} {horario} {valor}' }], { horario: '1' }), ['valor']);
eq('builtin nome numero', ZF.builtinVars({ name: '+55 11 98765-4321' }).nome, '');
eq('greeting', [8, 13, 21, 3].map((hh) => ZF.greeting(new Date(2026, 0, 1, hh))), ['Bom dia', 'Boa tarde', 'Boa noite', 'Boa noite']);
eq('messageType', [
  ZF.messageType([{ type: 'text' }]), ZF.messageType([{ type: 'file', mime: 'image/png' }]),
  ZF.messageType([{ type: 'file', mime: 'application/pdf' }, { type: 'text' }]), ZF.messageType([{ type: 'file' }, { type: 'file' }]),
], ['texto', 'imagem', 'documento', 'multiplos']);

/* ---------------- contatos ---------------- */
let p = ZF.parseContacts('11987654321;Maria Silva\nJoão, 21 99876-5432\nlixo\n(11) 98765-4321\nAna 11912345678');
eq('paste contacts', p.contacts.map((c) => [c.phone, c.name]), [['5511987654321', 'Maria Silva'], ['5521998765432', 'João'], ['5511912345678', 'Ana']]);
eq('paste invalid', p.invalid, ['lixo']);
eq('paste duplicates', p.duplicates, 1);
p = ZF.parseContacts('Nome;Celular;Horário\n"Silva, Ana";11 91234-5678;09:30\nBeto;11912345679;10:00');
eq('csv header', p.contacts.map((c) => [c.phone, c.name, c.vars.horario]), [['5511912345678', 'Silva, Ana', '09:30'], ['5511912345679', 'Beto', '10:00']]);
eq('csv columns', p.columns, ['nome', 'horario']);
eq('toCSV quoting', ZF.toCSV([['a;b', 'c"d']]), '﻿"a;b";"c""d"');

/* ---------------- recorrência (copiada do runner) ---------------- */
const runnerSrc = read('content/runner.js');
const fnSrc = runnerSrc.slice(runnerSrc.indexOf('function nextOccurrence'), runnerSrc.indexOf('runner.nextOccurrence ='));
const withNow = (now) => vm.runInNewContext(`(${fnSrc})`, { Date: class extends Date { static now() { return now; } } });
const nextOccurrence = withNow(Date.now());
eq('daily next', (() => { const d = nextOccurrence(Date.now() - 3600000, 'daily'); return d > Date.now() && d - Date.now() <= 86400000; })(), true);
const fri = new Date(2026, 8, 18, 10); // sexta-feira
eq('weekdays skips weekend', new Date(withNow(fri.getTime() + 1000)(fri.getTime(), 'weekdays')).getDay(), 1);
eq('monthly Jan31 -> Feb28', new Date(withNow(new Date(2026, 0, 31, 10).getTime())(new Date(2026, 0, 31, 9).getTime(), 'monthly', 31)).getDate(), 28);
eq('yearly', new Date(withNow(new Date(2026, 5, 1).getTime())(new Date(2026, 4, 1, 9).getTime(), 'yearly')).getFullYear(), 2027);

/* ---------------- planilhas .xlsx ---------------- */
// zip com compressão "deflate", como o Excel grava
const zipDeflate = (files) => {
  const chunks = [], central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBuf = Buffer.from(name), raw = Buffer.from(text), comp = zlib.deflateRawSync(raw);
    const crc = zlib.crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    chunks.push(local, nameBuf, comp);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(8, 10);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(raw.length, 24); cen.writeUInt16LE(nameBuf.length, 28); cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cenBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cenBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cenBuf, end]);
};
const excelLike = zipDeflate({
  'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="Pacientes" sheetId="7" r:id="rId9"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId3" Target="sharedStrings.xml"/><Relationship Id="rId9" Type="worksheet" Target="worksheets/sheet2.xml"/></Relationships>',
  'xl/sharedStrings.xml': '<sst><si><t>Nome</t></si><si><t>Celular</t></si><si><t>Horário</t></si><si><t>Ana &amp; Bia &lt;teste&gt;</t></si><si><r><rPr><b/></rPr><t>José</t></r><r><t xml:space="preserve"> Ávila</t></r></si></sst>',
  'xl/worksheets/sheet2.xml': '<worksheet><sheetData>'
    + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>'
    + '<row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>5511987654321</v></c><c r="C2" t="inlineStr"><is><t>09:00</t></is></c></row>'
    + '<row r="3"><c r="A3" t="s"><v>4</v></c><c r="C3" t="str"><v>10:30</v></c><c r="B3"><v>21998887777</v></c></row>'
    + '</sheetData></worksheet>',
});
const rows = await ZF.readXlsx(new File([excelLike], 'pacientes.xlsx'));
eq('xlsx (Excel-like) rows', rows, [['Nome', 'Celular', 'Horário'], ['Ana & Bia <teste>', '5511987654321', '09:00'], ['José Ávila', '21998887777', '10:30']]);
eq('xlsx -> contacts', ZF.parseContactRows(rows).contacts.map((c) => [c.phone, c.name, c.vars.horario]), [['5511987654321', 'Ana & Bia <teste>', '09:00'], ['5521998887777', 'José Ávila', '10:30']]);

const data = [['Nome', 'Telefone', 'Obs'], ['Maria "Mari"', '5511900001111', 'linha1\nlinha2'], ['<João> & cia', 5511, 'ção ✅']];
const back = await ZF.readXlsx(new File([Buffer.from(await ZF.xlsxBlob(data, 'Contatos').arrayBuffer())], 'x.xlsx'));
eq('xlsx roundtrip', back, [['Nome', 'Telefone', 'Obs'], ['Maria "Mari"', '5511900001111', 'linha1\nlinha2'], ['<João> & cia', '5511', 'ção ✅']]);
eq('readSpreadsheet csv', await ZF.readSpreadsheet(new File(['telefone;nome\n11988887777;Carla'], 'lista.csv', { type: 'text/csv' })), [['telefone', 'nome'], ['11988887777', 'Carla']]);

/* ---------------- Google Agenda e chave de conversa ---------------- */
const url = new URL(ZF.gcalUrl({ title: 'Consulta — Maria', details: 'Linha 1\nLinha 2', start: new Date(2026, 8, 21, 9, 30).getTime(), end: new Date(2026, 8, 21, 10, 30).getTime() }));
eq('gcal', [url.origin + url.pathname, url.searchParams.get('action'), url.searchParams.get('text'), url.searchParams.get('dates')],
  ['https://calendar.google.com/calendar/render', 'TEMPLATE', 'Consulta — Maria', '20260921T093000/20260921T103000']);
eq('chatKey', [
  ZF.chatKey({ phone: '+55 11 98765-4321', chatId: '123@lid' }), ZF.chatKey({ isGroup: true, chatId: '120363@g.us' }),
  ZF.chatKey({ chatId: '999@lid' }), ZF.chatKey({ name: 'Fulano' }), ZF.chatKey(null),
], ['p:5511987654321', 'g:120363@g.us', 'c:999@lid', 'n:Fulano', null]);

console.log(fails ? `\n${fails} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
process.exit(fails ? 1 : 0);
