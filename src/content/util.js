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
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
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
    text = String(text || '').replace(/^﻿/, '');
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
  ZF.parseContacts = (text, cc = '55') => {
    const rows = ZF.parseCSV(text);
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

  ZF.toCSV = (rows) => '﻿' + rows.map((r) => r.map((c) => {
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

  ZF.log = (...a) => console.debug('[ZapFlow]', ...a);
})();
