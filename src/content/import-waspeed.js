/*
 * ZapFlow — importação do backup do WaSpeed (arquivo backup_DD-MM-AAAA_HH：MM：SS.json).
 *
 * O que vem legível e é convertido:
 *   respostasRapidasAcao  → respostas rápidas (texto, imagem, documento, etiqueta, "aguarde" e "digitando")
 *   agendamentos          → agendamentos (texto ou resposta rápida; "semanal" ou a cada N dias)
 *   useOrderLabels        → ordem das etiquetas do WhatsApp
 * O WaSpeed criptografa (texto "U2FsdGVkX1…") os títulos/atalhos das respostas, categorias, abas,
 * notas e relatórios — isso não dá para ler, então cada resposta ganha um título tirado do texto.
 * "agendamentosNaoDisparados" é o histórico de envios passados (repete os agendamentos) e é ignorado.
 */
(() => {
  'use strict';
  const ZF = window.ZF;

  const CATEGORY_ID = 'waspeed-import';
  const ENCRYPTED = {
    respostasRapidas: 'títulos e atalhos das respostas rápidas',
    categoria: 'categorias',
    userTabs: 'abas',
    notes: 'notas',
    relatorio: 'relatório de envios',
    pinChat: 'conversas fixadas',
    agrupamentos: 'agrupamentos',
    groupments: 'agrupamentos',
    backupAutomatico: 'configuração do backup automático',
  };
  const isEncrypted = (v) => typeof v === 'string' && v.startsWith('U2FsdGVkX1');

  const isWaSpeed = (json) => !!json && typeof json === 'object' && json.app !== 'ZapFlow'
    && (Array.isArray(json.respostasRapidasAcao) || Array.isArray(json.agendamentos) || 'respostasRapidas' in json);

  /* ---------------- texto ---------------- */
  // variáveis do WaSpeed → variáveis do ZapFlow
  const VARS = { 'periodo-dia': '{saudacao}', primeironome: '{primeiro_nome}', nome: '{nome}', telefone: '{telefone}', numero: '{numero}', data: '{data}', hora: '{hora}' };
  /**
   * No WaSpeed, {texto} é texto comum (ex.: "{Nome}, pela nossa experiência…"); no ZapFlow viraria
   * um campo perguntado na hora. Vira [texto], como os outros lembretes do próprio Kaique ([Nome]).
   * {a|b} (sorteio) continua igual.
   */
  function convertText(s) {
    return String(s || '')
      .replace(/\{([^{}|]{1,60})\}/g, '[$1]')
      .replace(/#(periodo-dia|primeiroNome|nome|telefone|numero|data|hora)\b/gi, (m, k) => VARS[k.toLowerCase()] || m);
  }

  /** Texto sem variáveis e sem marcações do WhatsApp (*negrito*, _itálico_, ~riscado~), numa linha só */
  const plain = (text) => String(text || '')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/[*_~]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1') // "Perfeito, ." → "Perfeito,."
    .replace(/,([.;:!?])/g, '$1') // "Perfeito,." → "Perfeito."
    .trim();
  const cutWords = (t, max) => {
    if (t.length <= max) return t;
    const cut = t.slice(0, max);
    return (cut.lastIndexOf(' ') > max / 2 ? cut.slice(0, cut.lastIndexOf(' ')) : cut).replace(/[\s,.;:–—-]+$/, '') + '…';
  };
  /** Título a partir do texto: sem variáveis, até ~max letras, cortando numa palavra */
  function titleFrom(text, fallback, max = 48) {
    const t = cutWords(plain(text).replace(/^[\s,.;:!?–—-]+/, '').trim(), max);
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : fallback;
  }

  /**
   * Respostas com o mesmo começo (ex.: várias "Tudo bem? Estou passando para confirmar…") ganham
   * no título o trecho que as diferencia da versão mais parecida (ex.: "· Bangu", "· de amanhã às Xh").
   */
  function distinguish(items) {
    const lcp = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };
    items.forEach((it) => {
      const low = it.full.toLowerCase();
      let best = 0;
      items.forEach((o) => { if (o !== it) best = Math.max(best, lcp(low, o.full.toLowerCase())); });
      if (best >= it.full.length) { it.hint = 'versão curta'; return; }
      const start = best > 0 ? it.full.lastIndexOf(' ', best - 1) + 1 : 0;
      it.hint = cutWords(it.full.slice(start).replace(/^[\s,.;:!?–—-]+/, ''), 32);
    });
  }

  /* ---------------- arquivos ---------------- */
  const mimeOf = (dataUrl) => (String(dataUrl).match(/^data:([^;,]+)/) || [])[1] || 'application/octet-stream';
  const sizeOf = (dataUrl) => {
    const b64 = String(dataUrl).slice(String(dataUrl).indexOf(',') + 1);
    return Math.max(0, Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0));
  };
  const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf', 'video/mp4': 'mp4', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3' };

  /* ---------------- conversão ---------------- */
  /**
   * Converte o JSON do WaSpeed num backup do ZapFlow (parcial: respostas e agendamentos).
   * opts: { now, activeSchedules (false = importar pausados), names: Map(telefone|chatId → nome) }
   */
  function convert(json, { now = Date.now(), activeSchedules = false, names = new Map() } = {}) {
    const data = {};
    const files = new Map(); // dataURL → id (o mesmo PDF usado em várias respostas vira um arquivo só)
    const report = { replies: 0, files: 0, schedules: 0, skippedPast: 0, history: 0, unknownActions: 0, encrypted: [], labelOrder: null };

    const addFile = (dataUrl, name, idHint) => {
      if (!dataUrl || !String(dataUrl).startsWith('data:')) return null;
      let id = files.get(dataUrl);
      const mime = mimeOf(dataUrl);
      if (!id) {
        id = 'ws-' + idHint;
        files.set(dataUrl, id);
        data['file:' + id] = { id, name: name || `${mime.startsWith('image/') ? 'imagem' : 'arquivo'}.${EXT[mime] || 'bin'}`, mime, size: sizeOf(dataUrl), data: dataUrl };
      }
      const rec = data['file:' + id];
      return { fileId: id, name: name || rec.name, mime, size: rec.size };
    };

    /* respostas rápidas */
    const replies = [];
    const usedTitles = new Map();
    (Array.isArray(json.respostasRapidasAcao) ? json.respostasRapidasAcao : []).forEach((r, i) => {
      const actions = [];
      let firstText = '';
      let firstFile = '';
      (Array.isArray(r.acao) ? r.acao : []).forEach((a) => {
        const p = a.propriedades || {};
        const delay = () => {
          if (Number(p.aguarde) > 0) actions.push({ id: ZF.uid(), type: 'wait', seconds: Number(p.aguarde) });
          if (Number(p.composing) > 0) actions.push({ id: ZF.uid(), type: 'typing', seconds: Number(p.composing) });
        };
        if (a.type === 'txt') {
          const text = convertText(p.mensagem);
          if (!text.trim()) return;
          delay();
          actions.push({ id: ZF.uid(), type: 'text', text });
          if (!firstText) firstText = text;
        } else if (a.type === 'image' || a.type === 'doc' || a.type === 'video' || a.type === 'audio') {
          const f = addFile(p.base64, p.base64Name, a.id || ZF.uid());
          if (!f) return;
          delay();
          const mime = f.mime;
          const type = a.type === 'doc' ? 'document' : mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'document';
          const caption = convertText(p.mensagem);
          actions.push({ id: ZF.uid(), type, ...f, caption, ...(type === 'audio' ? { asVoice: true } : {}) });
          if (!firstText && caption.trim()) firstText = caption;
          if (!firstFile) firstFile = (f.name || '').replace(/\.[^.]+$/, '');
        } else if (a.type === 'addLabel' && p.labelID != null) {
          actions.push({ id: ZF.uid(), type: 'label_add', labelId: String(p.labelID), labelName: '' });
        } else if (a.type === 'removeLabel' && p.labelID != null) {
          actions.push({ id: ZF.uid(), type: 'label_remove', labelId: String(p.labelID), labelName: '' });
        } else {
          report.unknownActions++;
        }
      });
      if (!actions.length) return;
      const full = plain([...actions.filter((a) => a.type === 'text' || a.caption).map((a) => a.text || a.caption), ...actions.filter((a) => a.fileId).map((a) => (a.name || '').replace(/\.[^.]+$/, ''))].join(' '));
      const fallback = firstFile || `Resposta ${i + 1}`;
      replies.push({ id: String(r.id || ZF.uid()), kind: 'reply', title: titleFrom(firstText, fallback), categoryId: CATEGORY_ID, actions, uses: 0, order: i, createdAt: now, importedFrom: 'waspeed', _t: { firstText, fallback, full } });
    });
    // títulos iguais: acrescenta o que diferencia cada versão
    const groups = new Map();
    replies.forEach((r) => groups.set(r.title, [...(groups.get(r.title) || []), r]));
    groups.forEach((list) => {
      if (list.length < 2) return;
      const items = list.map((r) => ({ r, full: r._t.full }));
      distinguish(items);
      items.forEach(({ r, hint }) => { r.title = `${titleFrom(r._t.firstText, r._t.fallback, 34)} · ${hint}`; });
    });
    replies.forEach((r) => {
      delete r._t;
      const n = (usedTitles.get(r.title) || 0) + 1;
      usedTitles.set(r.title, n);
      if (n > 1) r.title += ` (${n})`;
    });
    report.replies = replies.length;
    if (replies.length) {
      data.replies = replies;
      data.categories = [{ id: CATEGORY_ID, name: 'Importadas do WaSpeed', color: 'blue', order: 999, collapsed: false }];
    }

    /* agendamentos (só os ativos; "agendamentosNaoDisparados" é histórico) */
    const byId = new Map(replies.map((r) => [r.id, r]));
    const schedules = [];
    (Array.isArray(json.agendamentos) ? json.agendamentos : []).forEach((s) => {
      const id = ZF.onlyDigits(s.userID);
      if (!id) return;
      const isGroup = id.length >= 15;
      const chatId = isGroup ? `${id}@g.us` : null;
      const target = isGroup
        ? { type: 'chat', chatId, phone: '', name: names.get(chatId) || '' }
        : { type: 'phone', phone: id, chatId: null, name: names.get(id) || '' };

      let blocks = [];
      if (s.tipo === 'respostaRapida' && byId.has(String(s.respostaRapida))) {
        blocks = ZF.actionsToBlocks(byId.get(String(s.respostaRapida)).actions);
      } else {
        const text = convertText(s.mensagem);
        if (text.trim()) blocks.push({ type: 'text', text });
        const f = addFile(s.base64, s.base64Name, s.id || ZF.uid());
        if (f) blocks.push({ type: 'file', ...f, caption: '' });
      }
      blocks = blocks.filter(ZF.blockHasContent);
      if (!blocks.length) return;

      const rec = String(s.recorrencia || '').trim().toLowerCase();
      let repeat = 'none', everyDays = null;
      if (rec === 'semanal') repeat = 'weekly';
      else if (rec === 'diario' || rec === 'diário') repeat = 'daily';
      else if (rec === 'mensal') repeat = 'monthly';
      else if (/^\d+$/.test(rec) && Number(rec) > 0) {
        if (Number(rec) === 7) repeat = 'weekly';
        else { repeat = 'days'; everyDays = Number(rec); }
      }
      const [y, m, d] = String(s.data || '').split('-').map(Number);
      const [hh, mm] = String(s.hora || '09:00').split(':').map(Number);
      let sendAt = new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0).getTime();
      if (!Number.isFinite(sendAt)) return;
      if (sendAt <= now) {
        if (repeat === 'none') { report.skippedPast++; return; }
        sendAt = ZF.nextOccurrence(sendAt, repeat, new Date(sendAt).getDate(), everyDays, now);
      }
      schedules.push({
        id: String(s.id || ZF.uid()), target, blocks, vars: {}, sendAt, repeat, everyDays,
        anchorDay: new Date(sendAt).getDate(), status: activeSchedules ? 'pending' : 'paused',
        lastError: null, history: [], createdAt: now, updatedAt: now, importedFrom: 'waspeed',
      });
    });
    report.schedules = schedules.length;
    report.history = Array.isArray(json.agendamentosNaoDisparados) ? json.agendamentosNaoDisparados.length : 0;
    if (schedules.length) data.schedules = schedules;

    report.files = files.size;
    const seen = new Set();
    Object.entries(ENCRYPTED).forEach(([k, label]) => {
      if (isEncrypted(json[k]) && !seen.has(label)) { seen.add(label); report.encrypted.push(label); }
    });
    const order = json.useOrderLabels && json.useOrderLabels.orderLabels;
    if (Array.isArray(order) && order.length) report.labelOrder = order.map(String);

    const parts = [replies.length && 'replies', schedules.length && 'schedules'].filter(Boolean);
    return {
      backup: { app: 'ZapFlow', version: 2, exportedAt: new Date(now).toISOString(), source: 'waspeed', parts, data },
      report,
    };
  }

  ZF.waspeed = { isWaSpeed, convert, convertText, titleFrom, distinguish, CATEGORY_ID };
})();
