/*
 * ZapFlow — ações das respostas rápidas.
 * Uma resposta rápida é uma sequência de ações: mensagens (texto, mídia, Pix, contato…),
 * mudanças no CRM/etiquetas, temporizadores, utilitários e transferência de atendimento.
 * A parte "pura" (catálogo, Pix, vCard, conversões) não mexe no DOM e é testada no Node.
 */
(() => {
  'use strict';
  const ZF = window.ZF;

  /* ---------------- catálogo (mesma ordem dos menus) ---------------- */
  const hm = (amount, unit, time) => ({ amount, unit, time });
  const TYPES = {
    text: { label: 'Texto', icon: 'textT', msg: true, def: () => ({ text: '' }) },
    image: { label: 'Imagem', icon: 'image', msg: true, file: 'image/*', def: () => ({ caption: '' }) },
    video: { label: 'Vídeo', icon: 'video', msg: true, file: 'video/*', def: () => ({ caption: '' }) },
    audio: { label: 'Áudio', icon: 'mic', msg: true, file: 'audio/*', def: () => ({ asVoice: true }) },
    document: { label: 'Documentos', icon: 'folder', msg: true, file: '*/*', def: () => ({ caption: '' }) },
    pix: { label: 'Pix', icon: 'pix', msg: true, def: () => ({ keyType: 'cpf', key: '', name: '', city: '', amount: '', message: 'Segue a chave Pix para pagamento 👇', copyPaste: true }) },
    group_invite: { label: 'Convite para Grupo', icon: 'users', msg: true, def: () => ({ chatId: null, groupName: '', link: '', text: 'Entre no nosso grupo pelo link abaixo 👇' }) },
    contact: { label: 'Contato', icon: 'contactCard', msg: true, def: () => ({ name: '', phone: '' }) },
    link: { label: 'Link com Banner', icon: 'linkBanner', msg: true, file: 'image/*', def: () => ({ url: '', title: '', description: '', text: '' }) },
    sticker: { label: 'Figurinha', icon: 'sticker', msg: true, file: 'image/*', def: () => ({}) },
    list: { label: 'Lista', icon: 'list', msg: true, def: () => ({ title: '', items: '', footer: 'Responda com o número da opção.', style: 'numbers' }) },
    location: { label: 'Localização', icon: 'mapPin', msg: true, def: () => ({ name: '', address: '' }) },

    crm_add: { label: 'Adicionar a um CRM', icon: 'folderPlus', def: () => ({ tabId: null }) },
    crm_remove: { label: 'Remover de um CRM', icon: 'folderMinus', def: () => ({ tabId: null }) },
    crm_clear: { label: 'Remover de todos CRMs', icon: 'folderX', danger: true, def: () => ({}) },

    label_add: { label: 'Adicionar a uma Etiqueta', icon: 'labelPlus', def: () => ({ labelId: null, labelName: '' }) },
    label_remove: { label: 'Remover de uma Etiqueta', icon: 'labelMinus', def: () => ({ labelId: null, labelName: '' }) },
    label_clear: { label: 'Remover de todas as Etiquetas', icon: 'labelOff', danger: true, def: () => ({}) },

    wait: { label: 'Aguardar', icon: 'timer', def: () => ({ seconds: 5 }) },
    typing: { label: 'Digitando…', icon: 'keyboard', def: () => ({ seconds: 3 }) },
    recording: { label: 'Gravando áudio…', icon: 'mic', def: () => ({ seconds: 3 }) },

    schedule: { label: 'Agendar mensagem', icon: 'calendarClock', noRender: ['text'], def: () => ({ text: '', replyId: null, ...hm(1, 'days', '09:00') }) },
    reminder: { label: 'Criar lembrete', icon: 'alarm', def: () => ({ title: 'Retornar para {nome}', ...hm(1, 'days', '09:00') }) },
    note: { label: 'Adicionar nota', icon: 'clipboardEdit', def: () => ({ text: '' }) },
    gcal: { label: 'Evento no Google Agenda', icon: 'calendarDays', def: () => ({ title: 'Consulta — {nome}', minutes: 60, ...hm(1, 'days', '09:00') }) },
    mark_unread: { label: 'Marcar como não lida', icon: 'mailUnread', def: () => ({}) },
    archive: { label: 'Arquivar conversa', icon: 'archive', def: () => ({}) },
    pin: { label: 'Fixar conversa', icon: 'pin', def: () => ({}) },

    transfer: {
      label: 'Transferir para atendente', icon: 'transfer',
      def: () => ({
        name: '', phone: '', tabId: null,
        toClient: 'Vou te transferir para {atendente}, que vai continuar o seu atendimento. 😊',
        toAgent: '🔁 *Atendimento transferido para você*\n*{nome}* — {telefone}\nhttps://wa.me/{numero}',
      }),
    },
    finish: { label: 'Finalizar atendimento', icon: 'flag', def: () => ({ text: '', clearTabs: true, markRead: true, archive: false }) },
  };
  const GROUPS = [
    { key: 'msg', label: 'Enviar Mensagem', icon: 'messageSquare', types: ['text', 'image', 'video', 'audio', 'document', 'pix', 'group_invite', 'contact', 'link', 'sticker', 'list', 'location'] },
    { key: 'crm', label: 'Aba do CRM', icon: 'folderArrow', types: ['crm_add', 'crm_remove', 'crm_clear'] },
    { key: 'label', label: 'Etiquetas', icon: 'label', types: ['label_add', 'label_remove', 'label_clear'] },
    { key: 'timer', label: 'Temporizadores', icon: 'timer', types: ['wait', 'typing', 'recording'] },
    { key: 'util', label: 'Utilitários', icon: 'apps', types: ['schedule', 'reminder', 'note', 'gcal', 'mark_unread', 'archive', 'pin'] },
    { key: 'transfer', label: 'Transferir Atendimento', icon: 'transfer', types: ['transfer', 'finish'] },
  ];
  ZF.ACTION_TYPES = TYPES;
  ZF.ACTION_GROUPS = GROUPS;
  ZF.newAction = (type) => ({ id: ZF.uid(), type, ...(TYPES[type] ? TYPES[type].def() : {}) });

  /* ---------------- Pix (BR Code "copia e cola") ---------------- */
  /** CRC16-CCITT (0x1021, inicial 0xFFFF) usado no BR Code */
  ZF.crc16 = (str) => {
    let crc = 0xffff;
    for (const b of new TextEncoder().encode(str)) {
      crc ^= b << 8;
      for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  };
  const tlv = (id, v) => id + String(v.length).padStart(2, '0') + v;
  const ascii = (s, max) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 .,@&/-]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

  ZF.PIX_KEY_TYPES = { cpf: 'CPF', cnpj: 'CNPJ', phone: 'Celular', email: 'E-mail', random: 'Chave aleatória' };
  ZF.pixKey = (type, key) => {
    const k = String(key || '').trim();
    if (type === 'cpf' || type === 'cnpj') return ZF.onlyDigits(k);
    if (type === 'phone') {
      const d = ZF.onlyDigits(k);
      if (!d) return '';
      return '+' + (d.length <= 11 ? '55' + d : d);
    }
    if (type === 'email') return k.toLowerCase();
    return k;
  };
  ZF.pixKeyDisplay = (type, key) => {
    const k = ZF.pixKey(type, key);
    if (type === 'cpf' && k.length === 11) return k.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    if (type === 'cnpj' && k.length === 14) return k.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    if (type === 'phone') return ZF.fmtPhone(k);
    return k;
  };
  /** "1.234,56" | "10,5" | "10.50" → 1234.56 (0 se vazio/inválido) */
  ZF.parseMoney = (v) => {
    let s = String(v == null ? '' : v).trim().replace(/[R$\s]/g, '');
    if (!s) return 0;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
  };
  ZF.fmtMoney = (n) => 'R$ ' + Number(n).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  /** Código Pix copia e cola (BR Code estático, padrão do Banco Central) */
  ZF.pixPayload = ({ keyType, key, name, city, amount, txid, description }) => {
    const k = ZF.pixKey(keyType, key);
    if (!k) throw ZF.userError('Informe a chave Pix');
    let mai = tlv('00', 'br.gov.bcb.pix') + tlv('01', k);
    const desc = ascii(description, Math.max(0, 99 - mai.length - 4));
    if (desc) mai += tlv('02', desc);
    let p = tlv('00', '01') + tlv('26', mai) + tlv('52', '0000') + tlv('53', '986');
    const amt = ZF.parseMoney(amount);
    if (amt > 0) p += tlv('54', amt.toFixed(2));
    p += tlv('58', 'BR') + tlv('59', ascii(name, 25) || 'RECEBEDOR') + tlv('60', ascii(city, 15) || 'BRASIL');
    p += tlv('62', tlv('05', String(txid || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***'));
    p += '6304';
    return p + ZF.crc16(p);
  };

  /* ---------------- contato (vCard) ---------------- */
  ZF.vcard = ({ name, phone }) => {
    const d = ZF.onlyDigits(phone);
    const n = String(name || '').replace(/[\r\n;]+/g, ' ').trim() || ZF.fmtPhone(d);
    return ['BEGIN:VCARD', 'VERSION:3.0', `N:;${n};;;`, `FN:${n}`, `TEL;type=CELL;type=VOICE;waid=${d}:${ZF.fmtPhone(d)}`, 'END:VCARD'].join('\n');
  };
  /** Mesmo contato como texto (quando o cartão não pode ser enviado) */
  ZF.vcardText = ({ name, phone }) => {
    const d = ZF.onlyDigits(phone);
    return [`👤 *${String(name || '').trim() || ZF.fmtPhone(d)}*`, `📞 ${ZF.fmtPhone(d)}`, `https://wa.me/${d}`].join('\n');
  };

  /* ---------------- lista de opções ---------------- */
  const keycap = (i) => (i < 9 ? `${i + 1}\ufe0f\u20e3` : i === 9 ? '\u{1F51F}' : `${i + 1}.`);
  ZF.formatList = ({ title, items, footer, style }) => {
    const lines = String(items || '').split('\n').map((s) => s.trim()).filter(Boolean);
    const mark = (i) => (style === 'emoji' ? keycap(i) : style === 'bullets' ? '•' : `*${i + 1}.*`);
    return [title ? `*${String(title).trim()}*` : '', lines.map((l, i) => `${mark(i)} ${l}`).join('\n'), footer ? `_${String(footer).trim()}_` : '']
      .filter(Boolean).join('\n\n');
  };

  /* ---------------- conversão ações ⇄ blocos de envio ---------------- */
  const fileOf = (a) => ({ fileId: a.fileId, name: a.name, mime: a.mime, size: a.size });

  /** Blocos de envio de uma ação de mensagem (templates ainda não renderizados) */
  ZF.actionToBlocks = (a) => {
    switch (a.type) {
      case 'text': return a.text && a.text.trim() ? [{ type: 'text', text: a.text }] : [];
      case 'image':
      case 'video': return a.fileId ? [{ type: 'file', ...fileOf(a), caption: a.caption || '' }] : [];
      case 'document': return a.fileId ? [{ type: 'file', ...fileOf(a), caption: a.caption || '', asDocument: true }] : [];
      case 'audio': return a.fileId ? [{ type: 'file', ...fileOf(a), caption: '', asVoice: a.asVoice !== false }] : [];
      case 'sticker': return a.fileId ? [{ type: 'file', ...fileOf(a), caption: '', asSticker: true }] : [];
      case 'pix': {
        if (!ZF.pixKey(a.keyType, a.key)) return [];
        const amt = ZF.parseMoney(a.amount);
        const info = [
          `💠 *Chave Pix (${ZF.PIX_KEY_TYPES[a.keyType] || 'Chave'}):* ${ZF.pixKeyDisplay(a.keyType, a.key)}`,
          a.name ? `👤 *Favorecido:* ${a.name}` : '',
          amt ? `💰 *Valor:* ${ZF.fmtMoney(amt)}` : '',
        ].filter(Boolean).join('\n');
        const out = [{ type: 'text', text: [a.message, info].filter((x) => x && x.trim()).join('\n\n') }];
        if (a.copyPaste !== false) out.push({ type: 'text', text: ZF.pixPayload(a) });
        return out;
      }
      case 'group_invite': return a.link ? [{ type: 'text', text: [a.text, a.link].filter((x) => x && x.trim()).join('\n') }] : [];
      case 'contact': {
        const phone = ZF.normalizePhone(a.phone) || ZF.onlyDigits(a.phone);
        return phone ? [{ type: 'vcard', name: a.name || '', phone }] : [];
      }
      case 'link': return a.url ? [{
        type: 'text',
        text: [a.text, a.url].filter((x) => x && x.trim()).join('\n'),
        linkPreview: { url: a.url, title: a.title || '', description: a.description || '', thumbFileId: a.fileId || null },
      }] : [];
      case 'list': {
        const t = ZF.formatList(a);
        return t.trim() ? [{ type: 'text', text: t }] : [];
      }
      case 'location': {
        const q = [a.name, a.address].filter(Boolean).join(', ');
        if (!q) return [];
        return [{ type: 'text', text: [a.name ? `📍 *${a.name}*` : '📍', a.address || '', `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`].filter(Boolean).join('\n') }];
      }
      default: return [];
    }
  };
  /** Intervalo de uma campanha, em segundos (campanhas antigas guardavam mínimo/máximo) */
  ZF.campaignDelay = (c = {}) => {
    const d = Number(c.delay);
    if (d > 0) return d;
    const a = Number(c.minDelay) || 0;
    const b = Number(c.maxDelay) || a;
    return Math.round((a + b) / 2) || 15;
  };
  /** Duração da pausa longa, em segundos (antes era em minutos) */
  ZF.campaignPause = (c = {}) => (c.pauseSeconds != null ? Math.max(0, Number(c.pauseSeconds) || 0) : Math.max(0, Number(c.pauseMinutes) || 0) * 60);

  /** Segundos de "digitando…" e de espera guardados na própria ação de mensagem */
  ZF.actionPace = (a) => ({
    typing: Math.max(0, Math.min(120, Number(a && a.typingSeconds) || 0)),
    after: Math.max(0, Math.min(3600, Number(a && a.afterSeconds) || 0)),
  });
  /** Leva o "digitando…" e a espera da ação para os blocos (primeiro e último) */
  ZF.paceBlocks = (a, blocks) => {
    const { typing, after } = ZF.actionPace(a);
    if (!blocks.length || (!typing && !after)) return blocks;
    const out = blocks.map((b) => ({ ...b }));
    if (typing) out[0].typingSeconds = typing;
    if (after) out[out.length - 1].afterSeconds = after;
    return out;
  };
  ZF.actionsToBlocks = (actions = []) => actions.flatMap((a) => (TYPES[a.type] && TYPES[a.type].msg ? ZF.paceBlocks(a, ZF.actionToBlocks(a)) : []));

  /** Blocos antigos (v1.0/v1.1) → ações */
  ZF.blocksToActions = (blocks = []) => blocks.map((b) => {
    if (b.type === 'text') return { id: ZF.uid(), type: 'text', text: b.text || '' };
    if (b.type === 'vcard') return { id: ZF.uid(), type: 'contact', name: b.name || '', phone: b.phone || '' };
    const mime = b.mime || '';
    const f = fileOf(b);
    if (b.asSticker) return { id: ZF.uid(), type: 'sticker', ...f };
    if (mime.startsWith('audio/')) return { id: ZF.uid(), type: 'audio', ...f, asVoice: b.asVoice !== false };
    const type = b.asDocument ? 'document' : mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : 'document';
    return { id: ZF.uid(), type, ...f, caption: b.caption || '' };
  });
  /** Garante o formato novo de uma resposta rápida */
  ZF.migrateReply = (r) => {
    if (!r || Array.isArray(r.actions)) return r;
    const { blocks, ...rest } = r;
    return { ...rest, kind: rest.kind || 'reply', actions: ZF.blocksToActions(blocks || []) };
  };

  /* ---------------- variáveis ---------------- */
  const NOT_TEMPLATE = new Set(['id', 'type', 'fileId', 'mime', 'size', 'chatId', 'labelId', 'tabId', 'unit', 'time', 'keyType', 'style', 'url', 'key', 'replyId', 'link']);
  const templateEntries = (a) => Object.entries(a).filter(([k, v]) => typeof v === 'string' && !NOT_TEMPLATE.has(k) && !(TYPES[a.type] && TYPES[a.type].file && k === 'name'));
  ZF.findVarsInActions = (actions = []) => {
    const out = new Set();
    actions.forEach((a) => templateEntries(a).forEach(([, v]) => ZF.findVars(v).forEach((x) => out.add(x))));
    out.delete('atendente');
    return [...out];
  };
  /** Cópia da ação com os textos já preenchidos */
  ZF.renderAction = (a, vars = {}) => {
    const skip = new Set((TYPES[a.type] && TYPES[a.type].noRender) || []);
    const out = { ...a };
    let v = vars;
    if (a.type === 'transfer') {
      out.name = ZF.renderTemplate(a.name || '', vars);
      v = { ...vars, atendente: out.name || 'nossa equipe' };
    }
    templateEntries(a).forEach(([k, val]) => {
      if (skip.has(k) || (a.type === 'transfer' && k === 'name')) return;
      out[k] = ZF.renderTemplate(val, v);
    });
    return out;
  };

  /* ---------------- descrições para a interface ---------------- */
  const UNITS = { minutes: 'min', hours: 'h', days: 'dia(s)' };
  ZF.delayLabel = (a) => {
    const n = Number(a.amount) || 0;
    if (a.unit === 'days') return n === 0 ? `hoje às ${a.time || '09:00'}` : `em ${n} dia(s) às ${a.time || '09:00'}`;
    return `em ${n} ${UNITS[a.unit] || 'min'}`;
  };
  /** Momento de execução de ações com prazo (agendar, lembrete, evento) */
  ZF.delayTs = (a, now = Date.now()) => {
    const n = Math.max(0, Number(a.amount) || 0);
    if (a.unit === 'minutes') return now + n * 60000;
    if (a.unit === 'hours') return now + n * 3600000;
    const d = new Date(now);
    d.setDate(d.getDate() + n);
    const [hh, mm] = String(a.time || '09:00').split(':').map(Number);
    d.setHours(Number.isFinite(hh) ? hh : 9, Number.isFinite(mm) ? mm : 0, 0, 0);
    if (d.getTime() < now) d.setDate(d.getDate() + 1);
    return d.getTime();
  };

  const cut = (s, n = 70) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  /** Resumo de uma linha. names: { tab(id), label(id), reply(id) } */
  ZF.actionSummary = (a, names = {}) => {
    const base = summaryOf(a, names);
    const { typing, after } = ZF.actionPace(a);
    const extra = [typing ? `digitando ${typing}s` : '', after ? `espera ${after}s` : ''].filter(Boolean).join(', ');
    return extra ? `${base} • ${extra}` : base;
  };
  const summaryOf = (a, names = {}) => {
    const tab = (id) => (names.tab && names.tab(id)) || 'escolha a aba';
    switch (a.type) {
      case 'text': return cut(a.text) || 'Mensagem vazia';
      case 'image': case 'video': case 'document': return a.fileId ? cut(`${a.name}${a.caption ? ' — ' + a.caption : ''}`) : 'Nenhum arquivo';
      case 'audio': return a.fileId ? `${cut(a.name, 40)}${a.asVoice !== false ? ' (voz)' : ''}` : 'Nenhum áudio';
      case 'sticker': return a.fileId ? cut(a.name, 40) : 'Nenhuma imagem';
      case 'pix': return a.key ? cut(`${ZF.PIX_KEY_TYPES[a.keyType] || 'Chave'}: ${ZF.pixKeyDisplay(a.keyType, a.key)}${ZF.parseMoney(a.amount) ? ' • ' + ZF.fmtMoney(ZF.parseMoney(a.amount)) : ''}`) : 'Informe a chave';
      case 'group_invite': return cut(a.groupName || a.link) || 'Escolha o grupo';
      case 'contact': return a.phone ? cut(`${a.name || ''} ${ZF.fmtPhone(ZF.normalizePhone(a.phone) || a.phone)}`) : 'Informe o contato';
      case 'link': return cut(a.title || a.url) || 'Informe o link';
      case 'list': return `${cut(a.title, 40) || 'Lista'} • ${String(a.items || '').split('\n').filter((x) => x.trim()).length} opção(ões)`;
      case 'location': return cut(a.name || a.address) || 'Informe o endereço';
      case 'crm_add': case 'crm_remove': return `Aba: ${tab(a.tabId)}`;
      case 'crm_clear': return 'Tira a conversa de todas as abas';
      case 'label_add': case 'label_remove': return `Etiqueta: ${a.labelName || (names.label && names.label(a.labelId)) || 'escolha a etiqueta'}`;
      case 'label_clear': return 'Tira todas as etiquetas do WhatsApp';
      case 'wait': case 'typing': case 'recording': return `${Number(a.seconds) || 0} segundo(s)`;
      case 'schedule': return `${ZF.delayLabel(a)}: ${a.replyId ? (names.reply && names.reply(a.replyId)) || 'resposta rápida' : cut(a.text, 40) || 'mensagem vazia'}`;
      case 'reminder': return `${ZF.delayLabel(a)}: ${cut(a.title, 40)}`;
      case 'note': return cut(a.text) || 'Nota vazia';
      case 'gcal': return `${cut(a.title, 40)} — ${ZF.delayLabel(a)}`;
      case 'mark_unread': return 'A conversa volta a aparecer como não lida';
      case 'archive': return 'Move a conversa para Arquivadas';
      case 'pin': return 'Fixa a conversa no topo';
      case 'transfer': return a.phone ? `Para ${a.name || ZF.fmtPhone(ZF.normalizePhone(a.phone) || a.phone)}` : 'Informe o atendente';
      case 'finish': return [a.text ? 'despedida' : '', a.clearTabs ? 'sai das abas' : '', a.markRead ? 'marca como lida' : '', a.archive ? 'arquiva' : ''].filter(Boolean).join(', ') || 'Encerrar';
      default: return '';
    }
  };

  /** Tipo principal de uma resposta (ícone e filtro "Por Tipo") */
  const MSG_TYPE = { text: 'texto', pix: 'texto', group_invite: 'texto', link: 'texto', list: 'texto', location: 'texto', image: 'imagem', video: 'video', audio: 'audio', document: 'documento', contact: 'contato', sticker: 'figurinha' };
  ZF.replyType = (r) => {
    if (!r) return 'texto';
    if (r.kind === 'script') return 'script';
    const acts = r.actions || [];
    const msgs = acts.filter((a) => TYPES[a.type] && TYPES[a.type].msg);
    if (!msgs.length) return acts.length ? 'automacao' : 'texto';
    if (msgs.length > 1) return 'multiplos';
    return MSG_TYPE[msgs[0].type] || 'texto';
  };
  /** Texto pesquisável de uma resposta */
  ZF.replySearchText = (r) => [r.title, ...(r.actions || []).map((a) => ZF.actionSummary(a) + ' ' + (a.text || a.caption || a.message || ''))].join(' ');

  /* ---------------- execução ---------------- */
  const clamp = (v, min, max) => Math.max(min, Math.min(max, Number(v) || min));

  /**
   * Executa as ações numa conversa. target = {chatId, phone, name, isGroup}.
   * isOpen: a conversa é a que está aberta (o envio pela interface não precisa trocar de conversa).
   * onStep(i, total, action) é chamado antes de cada ação.
   */
  ZF.runActions = async (actions, { target, vars = {}, isOpen = true, onStep } = {}) => {
    const { wa, store } = ZF;
    const settings = await store.settings();
    const chatArgs = { chatId: target.chatId || undefined, phone: target.phone || undefined };
    const customVars = {};
    Object.keys(vars).forEach((k) => { if (!ZF.BUILTIN_VARS.includes(k)) customVars[k] = vars[k]; });
    const list = (actions || []).filter((a) => a && TYPES[a.type]);

    const send = async (to, blocks, open) => {
      if (!blocks.length) return;
      const res = await wa.deliver(to, blocks, settings, { isOpen: open });
      if (!res.ok) throw new Error(res.invalid ? 'Número sem WhatsApp' : res.error || 'Falha no envio');
      // o envio precisou abrir outra conversa: volta para a do cliente
      if (!open && res.usedUi && res.prevChat && res.prevChat.chatId) await wa.bridge('openChat', { chatId: res.prevChat.chatId }, 8000);
    };
    const crmUpdate = (fn) => {
      if (!ZF.crm) throw new Error('CRM indisponível');
      return ZF.crm.upsert(target, fn);
    };

    let lastWasMsg = false;
    for (let i = 0; i < list.length; i++) {
      const a = ZF.renderAction(list[i], vars);
      const def = TYPES[a.type];
      if (onStep) onStep(i, list.length, a);
      try {
        if (def.msg) {
          if (lastWasMsg) await ZF.sleep(ZF.rand(700, 1400));
          // o "digitando…" e a espera desta ação viajam nos blocos (quem cumpre é o envio)
          await send(target, ZF.paceBlocks(a, ZF.actionToBlocks(a)), isOpen);
          lastWasMsg = !ZF.actionPace(a).after;
          continue;
        }
        lastWasMsg = false;
        switch (a.type) {
          case 'wait': await ZF.sleep(clamp(a.seconds, 1, 3600) * 1000); break;
          case 'typing':
          case 'recording': {
            const r = await wa.bridge('presence', { ...chatArgs, state: a.type === 'typing' ? 'composing' : 'recording' }, 5000);
            await ZF.sleep(clamp(a.seconds, 1, 120) * 1000);
            if (r && r.ok) await wa.bridge('presence', { ...chatArgs, state: 'paused' }, 5000);
            break;
          }
          case 'crm_add':
            if (!a.tabId) throw ZF.userError('Escolha a aba');
            await crmUpdate((c) => { c.tags = [...new Set([...(c.tags || []), a.tabId])]; });
            break;
          case 'crm_remove': await crmUpdate((c) => { c.tags = (c.tags || []).filter((t) => t !== a.tabId); }); break;
          case 'crm_clear': await crmUpdate((c) => { c.tags = []; }); break;
          case 'label_add':
          case 'label_remove': {
            let id = a.labelId;
            if (!id && a.labelName) {
              // etiqueta informada pelo nome (quando a lista não pôde ser lida ao criar a resposta)
              const r = await wa.call('listLabels', {}, 15000);
              const found = r.labels.find((l) => ZF.normKey(l.name) === ZF.normKey(a.labelName));
              id = found && found.id;
            }
            if (!id) throw new Error('Etiqueta não encontrada no WhatsApp');
            await wa.call('editLabels', { ...chatArgs, [a.type === 'label_add' ? 'add' : 'remove']: [id] });
            break;
          }
          case 'label_clear': await wa.call('editLabels', { ...chatArgs, clear: true }); break;
          case 'schedule': {
            const replies = a.replyId ? await store.get('replies') : [];
            const src = replies.find((r) => r.id === a.replyId);
            const blocks = src ? ZF.actionsToBlocks(src.actions) : a.text && a.text.trim() ? [{ type: 'text', text: a.text }] : [];
            if (!blocks.length) throw new Error('Mensagem do agendamento vazia');
            const sendAt = ZF.delayTs(a);
            await store.update('schedules', (arr) => {
              arr.push({
                id: ZF.uid(), createdAt: Date.now(), history: [],
                target: { type: target.phone ? 'phone' : 'chat', phone: target.phone || '', chatId: target.chatId || null, name: target.name || '' },
                blocks, vars: customVars, sendAt, repeat: 'none', anchorDay: new Date(sendAt).getDate(),
                status: 'pending', lastError: null, updatedAt: Date.now(),
              });
              return arr;
            });
            break;
          }
          case 'reminder': {
            const dueAt = ZF.delayTs(a);
            await store.update('reminders', (arr) => {
              arr.push({
                id: ZF.uid(), createdAt: Date.now(), title: a.title || 'Lembrete', notes: '', dueAt, repeat: 'none', anchorDay: new Date(dueAt).getDate(),
                chat: { key: ZF.chatKey(target), name: target.name || '', phone: target.phone || null, chatId: target.chatId || null, isGroup: !!target.isGroup },
                status: 'pending', notifiedAt: null, updatedAt: Date.now(),
              });
              return arr;
            });
            break;
          }
          case 'note':
            if (a.text && a.text.trim()) await crmUpdate((c) => { c.notes = [...(c.notes || []), { id: ZF.uid(), text: a.text.trim(), createdAt: Date.now() }]; });
            break;
          case 'gcal': {
            const start = ZF.delayTs(a);
            const url = ZF.gcalUrl({ title: a.title || 'Compromisso', details: [target.name, target.phone ? ZF.fmtPhone(target.phone) : ''].filter(Boolean).join('\n'), start, end: start + clamp(a.minutes, 5, 1440) * 60000 });
            try { await chrome.runtime.sendMessage({ type: 'ZF_OPEN_URL', url }); } catch (e) { window.open(url, '_blank', 'noopener'); }
            break;
          }
          case 'mark_unread': await wa.call('chatAction', { ...chatArgs, action: 'markUnread' }); break;
          case 'archive': await wa.call('chatAction', { ...chatArgs, action: 'archive' }); break;
          case 'pin': await wa.call('chatAction', { ...chatArgs, action: 'pin' }); break;
          case 'transfer': {
            const agent = ZF.normalizePhone(a.phone, settings.countryCode);
            if (!agent) throw new Error('Telefone do atendente inválido');
            if (a.toClient && a.toClient.trim()) await send(target, [{ type: 'text', text: a.toClient }], isOpen);
            if (a.toAgent && a.toAgent.trim()) {
              await ZF.sleep(ZF.rand(600, 1200));
              await send({ phone: agent, name: a.name }, [{ type: 'text', text: a.toAgent }], false);
            }
            if (a.tabId) await crmUpdate((c) => { c.tags = [...new Set([...(c.tags || []), a.tabId])]; });
            break;
          }
          case 'finish':
            if (a.text && a.text.trim()) await send(target, [{ type: 'text', text: a.text }], isOpen);
            if (a.clearTabs) await crmUpdate((c) => { c.tags = []; });
            if (a.markRead) await wa.bridge('chatAction', { ...chatArgs, action: 'markRead' }, 8000);
            if (a.archive) await wa.call('chatAction', { ...chatArgs, action: 'archive' });
            break;
          default: break;
        }
      } catch (e) {
        throw new Error(`Ação ${i + 1} (${def.label}): ${(e && e.message) || e}`);
      }
    }
  };
})();
