/* ZapFlow — utilitários compartilhados pelos content scripts */
(() => {
  'use strict';
  const ZF = (window.ZF = window.ZF || {});

  ZF.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  /*
   * Em abas ocultas o Chrome limita setTimeout a ~1 vez por minuto.
   * Nesse caso a espera é feita pelo service worker, que não sofre esse limite.
   */
  const timeoutSleep = (ms) => new Promise((r) => setTimeout(r, ms));
  ZF.sleep = async (ms) => {
    if (!document.hidden || ms < 20) return timeoutSleep(ms);
    const end = Date.now() + ms;
    while (Date.now() < end - 5) {
      const chunk = Math.min(end - Date.now(), 20000);
      try {
        await chrome.runtime.sendMessage({ type: 'ZF_SLEEP', ms: chunk });
      } catch (e) {
        return timeoutSleep(Math.max(0, end - Date.now()));
      }
    }
  };
  ZF.rand = (min, max) => Math.floor(min + Math.random() * (max - min + 1));
  ZF.pad = (n) => String(n).padStart(2, '0');
  ZF.clone = (o) => JSON.parse(JSON.stringify(o));

  /* ---------- eventos internos ---------- */
  const listeners = {};
  ZF.on = (evt, fn) => ((listeners[evt] = listeners[evt] || []).push(fn), () => ZF.off(evt, fn));
  ZF.off = (evt, fn) => (listeners[evt] = (listeners[evt] || []).filter((f) => f !== fn));
  ZF.emit = (evt, data) => (listeners[evt] || []).forEach((fn) => { try { fn(data); } catch (e) { console.error('[ZapFlow]', e); } });

  /* ---------- datas ---------- */
  const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  ZF.fmtDate = (d) => { d = new Date(d); return `${ZF.pad(d.getDate())}/${ZF.pad(d.getMonth() + 1)}/${d.getFullYear()}`; };
  ZF.fmtTime = (d) => { d = new Date(d); return `${ZF.pad(d.getHours())}:${ZF.pad(d.getMinutes())}`; };
  ZF.fmtDateTime = (d) => `${ZF.fmtDate(d)} ${ZF.fmtTime(d)}`;
  ZF.weekday = (d) => WEEKDAYS[new Date(d).getDay()];
  ZF.greeting = (d = new Date()) => { const h = d.getHours(); return h >= 5 && h < 12 ? 'Bom dia' : h >= 12 && h < 18 ? 'Boa tarde' : 'Boa noite'; };
  /** Converte timestamp para o valor aceito por <input type="datetime-local"> */
  ZF.toLocalInput = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${ZF.pad(d.getMonth() + 1)}-${ZF.pad(d.getDate())}T${ZF.pad(d.getHours())}:${ZF.pad(d.getMinutes())}`; };
  ZF.fromLocalInput = (v) => (v ? new Date(v).getTime() : NaN);
  ZF.relTime = (ts) => {
    const diff = ts - Date.now();
    const abs = Math.abs(diff);
    const m = Math.round(abs / 60000);
    let s;
    if (m < 1) s = 'menos de 1 min';
    else if (m < 60) s = `${m} min`;
    else if (m < 60 * 24) s = `${Math.floor(m / 60)}h${m % 60 ? ZF.pad(m % 60) : ''}`;
    else s = `${Math.round(m / 1440)} dia(s)`;
    return diff >= 0 ? `em ${s}` : `há ${s}`;
  };
  ZF.fmtDuration = (ms) => {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}min ${ZF.pad(s % 60)}s`;
    return `${Math.floor(m / 60)}h ${ZF.pad(m % 60)}min`;
  };
  ZF.fmtSize = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`);

  /* ---------- telefones ---------- */
  ZF.onlyDigits = (s) => String(s == null ? '' : s).replace(/\D/g, '');
  /**
   * Normaliza para o formato internacional só com dígitos (ex.: 5511999998888).
   * Números com até 11 dígitos recebem o DDI padrão, a menos que comecem com "+".
   */
  ZF.normalizePhone = (raw, cc = '55') => {
    const str = String(raw == null ? '' : raw).trim();
    let d = ZF.onlyDigits(str);
    if (!d) return null;
    const hasPlus = str.startsWith('+') || str.startsWith('00');
    d = d.replace(/^0+/, '');
    if (!hasPlus && cc && d.length <= 11) d = cc + d;
    if (d.length < 10 || d.length > 15) return null;
    return d;
  };
  ZF.fmtPhone = (d) => {
    d = ZF.onlyDigits(d);
    const m = d.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
    if (m) return `+55 (${m[1]}) ${m[2]}-${m[3]}`;
    return d ? `+${d}` : '';
  };

  /* ---------- modelos de mensagem ---------- */
  ZF.normKey = (s) => String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  ZF.firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';

  ZF.BUILTIN_VARS = ['nome', 'primeiro_nome', 'telefone', 'saudacao', 'data', 'hora', 'dia_semana', 'amanha'];
  ZF.VAR_HELP = {
    saudacao: 'Bom dia / Boa tarde / Boa noite',
    nome: 'Nome do contato',
    primeiro_nome: 'Primeiro nome do contato',
    telefone: 'Telefone do contato',
    data: 'Data de hoje',
    hora: 'Hora atual',
    dia_semana: 'Dia da semana de hoje',
    amanha: 'Data de amanhã',
  };

  /** Variáveis automáticas para um contato */
  ZF.builtinVars = (contact = {}, now = new Date()) => {
    const tomorrow = new Date(now.getTime() + 86400000);
    let name = String(contact.name || '').trim();
    if (/^\+?[\d\s()-]{8,}$/.test(name)) name = ''; // nome que é só número
    return {
      nome: name,
      primeiro_nome: ZF.firstName(name),
      telefone: contact.phone ? ZF.fmtPhone(contact.phone) : '',
      saudacao: ZF.greeting(now),
      data: ZF.fmtDate(now),
      hora: ZF.fmtTime(now),
      dia_semana: ZF.weekday(now),
      amanha: ZF.fmtDate(tomorrow),
    };
  };

  const TOKEN_RE = /\{([^{}\n]+)\}/g;

  /** Lista variáveis usadas no texto (ignora spintax {a|b}) */
  ZF.findVars = (text) => {
    const out = new Set();
    String(text || '').replace(TOKEN_RE, (m, inner) => {
      if (!inner.includes('|')) out.add(ZF.normKey(inner));
      return m;
    });
    out.delete('');
    return [...out];
  };
  ZF.findVarsInBlocks = (blocks = []) => {
    const out = new Set();
    blocks.forEach((b) => ZF.findVars(b.type === 'text' ? b.text : b.caption).forEach((v) => out.add(v)));
    return [...out];
  };
  /** Variáveis que não são automáticas nem foram fornecidas */
  ZF.missingVars = (blocks, vars = {}) => ZF.findVarsInBlocks(blocks).filter((v) => !ZF.BUILTIN_VARS.includes(v) && !(v in vars));

  /**
   * Renderiza {variavel} e spintax {Olá|Oi|E aí}.
   * Variáveis desconhecidas ficam vazias quando keepUnknown=false.
   */
  ZF.renderTemplate = (text, vars = {}, keepUnknown = false) => {
    const norm = {};
    Object.keys(vars).forEach((k) => (norm[ZF.normKey(k)] = vars[k]));
    return String(text || '').replace(TOKEN_RE, (m, inner) => {
      if (inner.includes('|')) {
        const opts = inner.split('|');
        return opts[Math.floor(Math.random() * opts.length)];
      }
      const k = ZF.normKey(inner);
      if (k in norm && norm[k] != null) return String(norm[k]);
      return keepUnknown ? m : '';
    });
  };
  ZF.renderBlocks = (blocks = [], vars = {}, keepUnknown = false) => blocks.map((b) => (
    b.type === 'text'
      ? { ...b, text: ZF.renderTemplate(b.text, vars, keepUnknown) }
      : { ...b, caption: ZF.renderTemplate(b.caption || '', vars, keepUnknown) }
  ));

  /** Tipo de uma mensagem (para filtros e ícones) */
  ZF.messageType = (blocks = []) => {
    const files = blocks.filter((b) => b.type === 'file');
    if (!files.length) return 'texto';
    if (files.length > 1) return 'multiplos';
    const mime = files[0].mime || '';
    if (mime.startsWith('image/')) return 'imagem';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    return 'documento';
  };
  ZF.TYPE_LABELS = { texto: 'Texto', imagem: 'Imagem', video: 'Vídeo', audio: 'Áudio', documento: 'Documento', multiplos: 'Múltiplos arquivos' };
  ZF.TYPE_ICONS = { texto: 'fileText', imagem: 'image', video: 'film', audio: 'music', documento: 'file', multiplos: 'layers' };

  ZF.blocksPreview = (blocks = [], max = 90) => {
    const parts = blocks.map((b) => (b.type === 'text' ? b.text : `📎 ${b.name}${b.caption ? ' — ' + b.caption : ''}`));
    const s = parts.join(' • ').replace(/\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  };

  /* ---------- CSV / lista de contatos ---------- */
  ZF.parseCSV = (text) => {
    text = String(text || '').replace(/^\uFEFF/, '');
    const firstLine = text.split(/\r?\n/)[0] || '';
    const counts = { ';': 0, ',': 0, '\t': 0 };
    for (const ch of firstLine) if (ch in counts) counts[ch]++;
    const delim = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c));
  };

  const PHONE_HEADERS = ['telefone', 'phone', 'numero', 'celular', 'whatsapp', 'fone', 'contato', 'tel', 'mobile', 'number'];
  const NAME_HEADERS = ['nome', 'name', 'cliente', 'paciente', 'nome_completo'];
  const looksPhone = (s) => ZF.onlyDigits(s).length >= 8 && /^[\d\s+().-]+$/.test(String(s).trim());

  /**
   * Converte texto colado ou CSV em contatos.
   * Aceita "numero;nome", "nome,numero" ou CSV com cabeçalho (colunas extras viram variáveis).
   */
  ZF.parseContacts = (text, cc = '55') => ZF.parseContactRows(ZF.parseCSV(text), cc);

  /** Mesmo que parseContacts, a partir de linhas já separadas (CSV ou planilha .xlsx) */
  ZF.parseContactRows = (inputRows, cc = '55') => {
    const rows = inputRows.map((r) => r.map((c) => String(c == null ? '' : c).trim())).filter((r) => r.some((c) => c));
    const result = { contacts: [], invalid: [], duplicates: 0, columns: [] };
    if (!rows.length) return result;
    let header = null;
    const first = rows[0];
    if (!first.some(looksPhone) && first.length > 1) {
      header = first.map(ZF.normKey);
      rows.shift();
    }
    let phoneIdx = -1, nameIdx = -1;
    if (header) {
      phoneIdx = header.findIndex((h) => PHONE_HEADERS.some((p) => h === p || h.startsWith(p)));
      nameIdx = header.findIndex((h) => NAME_HEADERS.some((p) => h === p || h.startsWith(p)));
      result.columns = header.filter((h, i) => h && i !== phoneIdx);
    }
    const seen = new Set();
    rows.forEach((r) => {
      let pIdx = phoneIdx;
      if (pIdx < 0 || !looksPhone(r[pIdx] || '')) pIdx = r.findIndex(looksPhone);
      if (pIdx < 0 && !header) {
        // texto colado com separadores misturados: "João, 21 99876-5432" ou "Maria 11987654321"
        const line = r.join(' ');
        const m = line.match(/\+?\d[\d\s().-]{7,}\d/);
        if (m) {
          const rest = (line.slice(0, m.index) + ' ' + line.slice(m.index + m[0].length)).replace(/[;,\t|]+/g, ' ').replace(/\s+/g, ' ').trim();
          r = [m[0], rest];
          pIdx = 0;
        }
      }
      const phone = pIdx >= 0 ? ZF.normalizePhone(r[pIdx], cc) : null;
      if (!phone) { result.invalid.push(r.join(' ; ')); return; }
      if (seen.has(phone)) { result.duplicates++; return; }
      seen.add(phone);
      let name = '';
      if (nameIdx >= 0 && nameIdx !== pIdx) name = r[nameIdx] || '';
      else if (!header) name = r.filter((c, i) => i !== pIdx && c && !looksPhone(c))[0] || '';
      const vars = {};
      if (header) header.forEach((h, i) => { if (h && i !== pIdx) vars[h] = r[i] || ''; });
      result.contacts.push({ phone, name: name.trim(), vars });
    });
    return result;
  };

  ZF.toCSV = (rows) => '\uFEFF' + rows.map((r) => r.map((c) => {
    const s = String(c == null ? '' : c);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(';')).join('\r\n');

  /* ---------- arquivos ---------- */
  ZF.readFileAsDataURL = (file) => new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
  ZF.readFileAsText = (file) => new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsText(file);
  });
  ZF.dataURLtoFile = (dataUrl, name, mime) => {
    const [head, b64] = dataUrl.split(',');
    const type = mime || (head.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new File([arr], name || 'arquivo', { type, lastModified: Date.now() });
  };
  ZF.downloadText = (filename, text, mime = 'text/plain') => {
    const url = URL.createObjectURL(new Blob([text], { type: mime + ';charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.documentElement.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  ZF.pickFile = (accept = '*/*') => new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.style.display = 'none';
    inp.onchange = () => { resolve(inp.files[0] || null); inp.remove(); };
    document.documentElement.appendChild(inp);
    inp.click();
  });

  /* ---------- DOM ---------- */
  /** Cria elementos: h('div', {class:'x', onclick}, 'texto', filho) */
  ZF.h = (tag, props, ...children) => {
    const el = tag === 'svg' || tag === 'path' ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k === 'value' || k === 'checked' || k === 'selected' || k === 'disabled') el[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    return ZF.append(el, ...children);
  };

  /** Como Element.append, mas ignora null/false e aceita listas aninhadas */
  ZF.append = (el, ...children) => {
    const add = (c) => {
      if (c == null || c === false || c === '') return;
      if (Array.isArray(c)) c.forEach(add);
      else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    };
    children.forEach(add);
    return el;
  };

  /* Ícones (traços no estilo Feather, MIT) */
  const ICONS = {
    zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    more: '<circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>',
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    chevronDown: '<polyline points="6 9 12 15 18 9"/>',
    chevronUp: '<polyline points="18 15 12 9 6 15"/>',
    chevronLeft: '<polyline points="15 18 9 12 15 6"/>',
    fileText: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
    file: '<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
    film: '<rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
    shapes: '<polygon points="12 2 16.5 9 7.5 9 12 2"/><rect x="3" y="13" width="8" height="8" rx="1"/><circle cx="17" cy="17" r="4"/>',
    paperclip: '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
    edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 4 1-4 9.5-9.5z"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    play: '<polygon points="5 3 19 12 5 21 5 3"/>',
    pause: '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
    stop: '<rect x="4" y="4" width="16" height="16" rx="2"/>',
    folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    repeat: '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    alert: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    arrowUp: '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>',
    arrowDown: '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>',
    corner: '<polyline points="9 10 4 15 9 20"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/>',
    loader: '<line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>',
    tag: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
    bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
    sparkles: '<path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 14l.8 2.2 2.2.8-2.2.8L19 20l-.8-2.2-2.2-.8 2.2-.8z"/>',
    megaphone: '<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>',
    mic: '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>',
    externalLink: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
    grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/>',
    refresh: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
    checkSquare: '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    note: '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
    globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    square: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>',
  };
  ZF.icon = (name, size = 18, cls = '') => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    if (cls) svg.setAttribute('class', cls);
    // monta os elementos sem innerHTML (compatível com páginas que exigem Trusted Types)
    const src = ICONS[name] || ICONS.file;
    for (const [, tag, attrs] of src.matchAll(/<(\w+)([^>]*)\/>/g)) {
      const child = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [, k, v] of attrs.matchAll(/([\w-]+)="([^"]*)"/g)) child.setAttribute(k, v);
      svg.appendChild(child);
    }
    return svg;
  };

  /* ---------- conversas ---------- */
  /** Chave estável de uma conversa para notas/etiquetas: telefone para contatos, id para grupos */
  ZF.chatKey = (info) => {
    if (!info) return null;
    if (info.isGroup && info.chatId) return 'g:' + info.chatId;
    if (info.phone) return 'p:' + ZF.onlyDigits(info.phone);
    if (info.chatId) return 'c:' + info.chatId;
    return info.name ? 'n:' + info.name : null;
  };

  /* ---------- Google Agenda (sem login: abre o formulário de novo evento) ---------- */
  const gcalStamp = (ts) => {
    const d = new Date(ts);
    return `${d.getFullYear()}${ZF.pad(d.getMonth() + 1)}${ZF.pad(d.getDate())}T${ZF.pad(d.getHours())}${ZF.pad(d.getMinutes())}00`;
  };
  ZF.gcalUrl = ({ title, details, location, start, end }) => {
    const p = new URLSearchParams({ action: 'TEMPLATE', text: title || '' });
    p.set('dates', `${gcalStamp(start)}/${gcalStamp(end || start + 3600000)}`);
    try { p.set('ctz', Intl.DateTimeFormat().resolvedOptions().timeZone); } catch (e) { /* usa o fuso da conta */ }
    if (details) p.set('details', details);
    if (location) p.set('location', location);
    return 'https://calendar.google.com/calendar/render?' + p.toString();
  };
  ZF.openGcal = (event) => window.open(ZF.gcalUrl(event), '_blank', 'noopener');

  /* ---------- planilhas .xlsx (leitura e escrita, sem bibliotecas) ---------- */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = (bytes) => {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const xmlEsc = (s) => String(s == null ? '' : s).replace(/[<>&"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[ch])
    // remove caracteres de controle inválidos em XML
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  const xmlUnesc = (s) => String(s).replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e) => {
    const map = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
    if (map[e.toLowerCase()]) return map[e.toLowerCase()];
    return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  });

  /** Monta um .zip sem compressão (suficiente para .xlsx) */
  const zipStore = (files) => {
    const enc = new TextEncoder();
    const chunks = [], central = [];
    let offset = 0;
    files.forEach(({ name, data }) => {
      const nameBytes = enc.encode(name);
      const bytes = typeof data === 'string' ? enc.encode(data) : data;
      const crc = crc32(bytes);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
      local.setUint16(8, 0, true); local.setUint32(14, crc, true);
      local.setUint32(18, bytes.length, true); local.setUint32(22, bytes.length, true);
      local.setUint16(26, nameBytes.length, true);
      chunks.push(new Uint8Array(local.buffer), nameBytes, bytes);
      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true);
      cen.setUint32(16, crc, true); cen.setUint32(20, bytes.length, true); cen.setUint32(24, bytes.length, true);
      cen.setUint16(28, nameBytes.length, true); cen.setUint32(42, offset, true);
      central.push(new Uint8Array(cen.buffer), nameBytes);
      offset += 30 + nameBytes.length + bytes.length;
    });
    const centralSize = central.reduce((s, c) => s + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true); end.setUint32(16, offset, true);
    return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
  };

  const colName = (i) => { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

  /** Gera um .xlsx (primeira linha em negrito). rows: array de arrays */
  ZF.xlsxBlob = (rows, sheetName = 'Planilha1') => {
    const sheetRows = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
      const ref = `${colName(ci)}${ri + 1}`;
      const style = ri === 0 ? ' s="1"' : '';
      if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
    }).join('')}</row>`).join('');
    const widths = (rows[0] || []).map((_, ci) => Math.min(60, Math.max(10, ...rows.slice(0, 200).map((r) => String(r[ci] == null ? '' : r[ci]).length + 2))));
    const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
    return zipStore([
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEsc(sheetName).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
      { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { name: 'xl/styles.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>' },
      { name: 'xl/worksheets/sheet1.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${sheetRows}</sheetData></worksheet>` },
    ]);
  };
  ZF.downloadXlsx = (filename, rows, sheetName) => {
    const url = URL.createObjectURL(ZF.xlsxBlob(rows, sheetName));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.endsWith('.xlsx') ? filename : filename + '.xlsx';
    document.documentElement.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  /** Lê os arquivos de um .zip (métodos "store" e "deflate") */
  const unzip = async (buffer) => {
    const bytes = new Uint8Array(buffer);
    const dv = new DataView(buffer);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Arquivo não é uma planilha .xlsx válida');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const dec = new TextDecoder();
    const out = {};
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const localOff = dv.getUint32(p + 42, true);
      const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
      p += 46 + nameLen + extraLen + commentLen;
      const lNameLen = dv.getUint16(localOff + 26, true);
      const lExtraLen = dv.getUint16(localOff + 28, true);
      const start = localOff + 30 + lNameLen + lExtraLen;
      const raw = bytes.subarray(start, start + csize);
      out[name] = async () => {
        if (method === 0) return dec.decode(raw);
        if (method !== 8) throw new Error('Compressão não suportada na planilha');
        const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new Response(stream).text();
      };
    }
    return out;
  };

  const cellIndex = (ref) => {
    const letters = (ref.match(/^[A-Z]+/i) || ['A'])[0].toUpperCase();
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  };
  const textOf = (xml) => { const parts = []; xml.replace(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g, (m, t) => parts.push(xmlUnesc(t))); return parts.join(''); };

  /** Lê a primeira aba de um .xlsx e devolve as linhas (array de arrays de texto) */
  ZF.readXlsx = async (file) => {
    const files = await unzip(await file.arrayBuffer());
    const read = async (name) => (files[name] ? files[name]() : null);
    const shared = [];
    const ss = await read('xl/sharedStrings.xml');
    if (ss) ss.replace(/<si>([\s\S]*?)<\/si>/g, (m, si) => { shared.push(textOf(si)); return m; });
    let sheetPath = 'xl/worksheets/sheet1.xml';
    const wb = await read('xl/workbook.xml');
    const rels = await read('xl/_rels/workbook.xml.rels');
    if (wb && rels) {
      const firstId = (wb.match(/<sheet\b[^>]*\br:id="([^"]+)"/) || [])[1];
      const rel = firstId && (rels.match(new RegExp(`<Relationship\\b[^>]*Id="${firstId}"[^>]*>`)) || [])[0];
      const target = rel && (rel.match(/Target="([^"]+)"/) || [])[1];
      if (target) sheetPath = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    }
    const sheet = await read(sheetPath);
    if (!sheet) throw new Error('Não encontrei a primeira aba da planilha');
    const rows = [];
    sheet.replace(/<row\b[^>]*>([\s\S]*?)<\/row>/g, (m, rowXml) => {
      const row = [];
      rowXml.replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, (cm, attrs, inner = '') => {
        const ref = (attrs.match(/\br="([A-Z]+\d+)"/i) || [])[1];
        const t = (attrs.match(/\bt="([^"]+)"/) || [])[1];
        const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        let val = '';
        if (t === 's') val = shared[Number(v)] || '';
        else if (t === 'inlineStr') val = textOf(inner);
        else if (v != null) val = xmlUnesc(v);
        const idx = ref ? cellIndex(ref) : row.length;
        while (row.length < idx) row.push('');
        row[idx] = val;
        return cm;
      });
      rows.push(row);
      return m;
    });
    return rows;
  };

  /** Lê CSV/TXT ou XLSX e devolve linhas */
  ZF.readSpreadsheet = async (file) => {
    if (/\.xlsx$/i.test(file.name) || file.type.includes('spreadsheetml')) return ZF.readXlsx(file);
    let text = await ZF.readFileAsText(file);
    if (text.includes('\uFFFD')) text = new TextDecoder('windows-1252').decode(await file.arrayBuffer());
    return ZF.parseCSV(text);
  };

  ZF.log = (...a) => console.debug('[ZapFlow]', ...a);
})();
