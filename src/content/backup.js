/*
 * ZapFlow — backup automático e importação.
 * O backup vai como documento para a conversa "Você" do próprio WhatsApp (ou para
 * outro número escolhido), todo mês ou toda semana. Roda dentro do laço do runner.
 */
(() => {
  'use strict';
  const ZF = window.ZF;

  const FREQS = [
    { value: 'monthly', label: 'Todo mês (recomendado)' },
    { value: 'weekly', label: 'Toda semana' },
    { value: 'off', label: 'Desligado' },
  ];
  const RETRY_MS = 60 * 60000; // depois de uma falha, tenta de novo em 1 h
  const bootAt = Date.now();
  let running = false;

  /* ---------------- regras (sem efeitos colaterais; cobertas pelos testes) ---------------- */
  /** Soma um período. Mensal: mesmo dia do mês seguinte (ou o último dia, se não existir). */
  function addPeriod(ts, freq) {
    const d = new Date(ts);
    if (freq === 'weekly') {
      d.setDate(d.getDate() + 7);
      return d.getTime();
    }
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + 1);
    d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
    return d.getTime();
  }

  /** Quando sai o próximo backup automático: null = desligado; 0 = nunca foi feito (sai logo). */
  function nextDue(freq, st = {}) {
    if (!freq || freq === 'off') return null;
    let due = st.lastOkAt ? addPeriod(st.lastOkAt, freq) : 0;
    const failed = st.lastAttemptAt && st.lastAttemptAt > (st.lastOkAt || 0);
    if (failed) due = Math.max(due, st.lastAttemptAt + RETRY_MS);
    return due;
  }

  /** Resumo do conteúdo de um backup */
  function describe(json) {
    const d = (json && json.data) || {};
    const arr = (k) => (Array.isArray(d[k]) ? d[k] : []);
    const replies = arr('replies');
    const chats = Object.values(d.crmChats && typeof d.crmChats === 'object' ? d.crmChats : {});
    const count = {
      replies: replies.filter((r) => r && r.kind !== 'script').length,
      scripts: replies.filter((r) => r && r.kind === 'script').length,
      categories: arr('categories').length,
      tabs: arr('crmTags').length,
      contacts: chats.length,
      notes: chats.reduce((n, c) => n + ((c && Array.isArray(c.notes) && c.notes.length) || 0), 0),
      schedules: arr('schedules').filter((s) => s && s.status === 'pending').length,
      reminders: arr('reminders').filter((r) => r && r.status === 'pending').length,
      campaigns: arr('campaigns').length,
      files: Object.keys(d).filter((k) => k.startsWith('file:')).length,
    };
    const n = (v, one, many) => `${v} ${v === 1 ? one : many}`;
    // backup parcial (json.parts): mostra só o que foi escolhido
    const only = json && Array.isArray(json.parts) ? json.parts : null;
    const has = (p) => !only || only.includes(p);
    const parts = [
      has('replies') && n(count.replies, 'resposta rápida', 'respostas rápidas'),
      has('replies') && count.scripts && n(count.scripts, 'script', 'scripts'),
      has('tabs') && n(count.tabs, 'aba', 'abas'),
      (has('tabs') || has('notes')) && n(count.contacts, 'contato no CRM', 'contatos no CRM'),
      has('notes') && (only || count.notes) && n(count.notes, 'nota', 'notas'),
      has('schedules') && (only || count.schedules) && n(count.schedules, 'agendamento', 'agendamentos'),
      has('reminders') && (only || count.reminders) && n(count.reminders, 'lembrete', 'lembretes'),
      has('campaigns') && (only || count.campaigns) && n(count.campaigns, 'campanha', 'campanhas'),
      only && only.includes('settings') && 'configurações',
    ].filter(Boolean);
    const at = json && json.exportedAt ? Date.parse(json.exportedAt) : NaN;
    const partial = only ? only.map((p) => (ZF.store && ZF.store.PARTS[p] ? ZF.store.PARTS[p].label : p)) : null;
    return { count, parts, partial, text: parts.join(' · '), at: Number.isFinite(at) ? at : null };
  }

  const fileName = (ts) => {
    const d = new Date(ts);
    return `zapflow-backup-${d.getFullYear()}-${ZF.pad(d.getMonth() + 1)}-${ZF.pad(d.getDate())}.json`;
  };

  /** Linhas de situação para a tela de Configurações */
  function statusLines(freq, st = {}, now = Date.now()) {
    const lines = [];
    if (st.lastOkAt) {
      const how = st.lastAuto ? 'automático' : 'manual';
      const to = st.lastToSelf === false && st.lastTo ? `para ${ZF.fmtPhone(st.lastTo)}` : 'para o seu WhatsApp';
      lines.push({ type: 'ok', text: `Último backup: ${ZF.fmtDateTime(st.lastOkAt)} (${how}, enviado ${to}${st.lastSize ? ', ' + ZF.fmtSize(st.lastSize) : ''})` });
    } else {
      lines.push({ type: 'info', text: 'Nenhum backup enviado ainda.' });
    }
    const failed = st.lastError && st.lastAttemptAt > (st.lastOkAt || 0);
    if (failed) lines.push({ type: 'error', text: `A última tentativa falhou (${ZF.fmtDateTime(st.lastAttemptAt)}): ${st.lastError}` });
    const due = nextDue(freq, st);
    if (due === null) lines.push({ type: 'warn', text: 'Backup automático desligado.' });
    else if (due <= now) lines.push({ type: 'info', text: 'Próximo backup: em instantes (com o WhatsApp Web aberto).' });
    else if (failed) lines.push({ type: 'info', text: `Próxima tentativa: ${ZF.fmtDateTime(due)}.` });
    else lines.push({ type: 'info', text: `Próximo backup: ${ZF.fmtDate(due)} (ou na primeira vez que o WhatsApp Web for aberto depois disso).` });
    return lines;
  }

  /* ---------------- estado ---------------- */
  const getState = async () => (await chrome.storage.local.get('backupState')).backupState || {};
  const saveState = async (patch) => {
    const st = { ...(await getState()), ...patch };
    await chrome.storage.local.set({ backupState: st });
    return st;
  };

  /** Número da própria conta: pela ponte e, se não der, pela preferência salva pelo WhatsApp */
  async function myPhone() {
    const r = await ZF.wa.bridge('me', {}, 3000);
    if (r && r.ok && r.phone) return { phone: ZF.onlyDigits(r.phone), name: r.name || '' };
    try {
      for (const k of ['last-wid-md', 'last-wid']) {
        const m = String(localStorage.getItem(k) || '').match(/(\d{8,15})[:@]/);
        if (m) return { phone: m[1], name: '' };
      }
    } catch (e) { /* ignora */ }
    return null;
  }

  async function build() {
    const json = await ZF.store.exportAll();
    const info = describe(json);
    const name = fileName(Date.now());
    const file = new File([JSON.stringify(json)], name, { type: 'application/json' });
    return { json, info, name, file };
  }

  /* ---------------- envio ---------------- */
  /** Gera o backup e envia como documento. Lança erro se não conseguir. */
  async function send({ auto = false } = {}) {
    const settings = await ZF.store.settings();
    const custom = String(settings.backupTo || '').trim();
    let to = custom ? ZF.normalizePhone(custom, settings.countryCode) : null;
    if (custom && !to) throw new Error(`O número em "Enviar para" (${custom}) não é válido`);
    const toSelf = !to;
    if (toSelf) {
      const me = await myPhone();
      if (!me || !me.phone) throw new Error('Não encontrei o seu número no WhatsApp Web. Preencha "Enviar para" com o seu número.');
      to = me.phone;
    }
    const b = await build();
    const caption = [
      `💾 Backup do ZapFlow — ${ZF.fmtDateTime(Date.now())}`,
      b.info.text,
      'Para restaurar: baixe este arquivo e use ZapFlow → Configurações → Backup → Importar backup.',
    ].join('\n');
    const block = {
      type: 'file', name: b.name, mime: 'application/json', size: b.file.size, asDocument: true, caption,
      inline: { name: b.name, mime: 'application/json', size: b.file.size, file: b.file },
    };
    let res;
    try {
      res = await ZF.wa.deliver({ type: 'phone', phone: to, name: toSelf ? 'Você' : 'Backup' }, [block], settings);
    } catch (e) {
      res = { ok: false, error: e.message || String(e) };
    }
    if (res.usedUi && settings.restoreChat && res.prevChat && res.prevChat.ok && res.prevChat.chatId) {
      await ZF.wa.bridge('openChat', { chatId: res.prevChat.chatId }, 8000);
    }
    if (!res.ok) {
      const msg = res.invalid ? `O número ${ZF.fmtPhone(to)} não tem WhatsApp` : res.error || 'Falha no envio';
      throw new Error(msg);
    }
    const now = Date.now();
    return saveState({ lastOkAt: now, lastAttemptAt: now, lastError: null, lastAuto: auto, lastTo: to, lastToSelf: toSelf, lastSize: b.file.size, failNotified: false });
  }

  /** Envio manual (botão "Enviar backup agora") */
  async function sendNow() {
    const ui = ZF.ui;
    ui.setBusy('Enviando backup para o WhatsApp…');
    try {
      await ZF.runner.exclusive(() => send({ auto: false }));
      ui.toast('Backup enviado para o WhatsApp', 'ok', 3500);
    } catch (e) {
      await saveState({ lastAttemptAt: Date.now(), lastError: e.message || String(e) });
      throw e;
    } finally {
      ui.setBusy(null);
    }
  }

  /** Chamado pelo runner (com a trava dos envios) a cada volta do laço */
  async function autoTick() {
    if (running || Date.now() - bootAt < ZF.backup.bootDelayMs || !ZF.wa.isReady()) return false;
    const settings = await ZF.store.settings();
    const st = await getState();
    const due = nextDue(settings.backupFreq, st);
    if (due === null || due > Date.now()) return false;
    // sem envio direto, o envio abre a conversa na tela: espera o usuário parar de digitar
    if (ZF.runner.userTyping() && !(await ZF.runner.directAvailable())) return false;
    running = true;
    ZF.runner.setState('sending', 'Enviando o backup automático para o seu WhatsApp…');
    try {
      await send({ auto: true });
      if (ZF.ui && ZF.ui.toast) ZF.ui.toast('Backup automático enviado para o seu WhatsApp', 'ok', 5000);
    } catch (e) {
      const error = e.message || String(e);
      if (ZF.isContextGone(e)) { ZF.shutdown(); return; }
      console.warn('[ZapFlow] backup automático', e);
      await saveState({ lastAttemptAt: Date.now(), lastError: error, failNotified: true });
      if (!st.failNotified) ZF.runner.notify('Backup automático não enviado', `${error}. Nova tentativa em 1 hora.`);
    } finally {
      running = false;
    }
    return true;
  }

  /* ---------------- importação ---------------- */
  const NOT_BACKUP = (f) => new Error(`"${f.name}" não é um backup do ZapFlow nem do WaSpeed. Use o arquivo zapflow-backup….json ou o backup_….json do WaSpeed.`);
  async function readJson(f) {
    try { return JSON.parse(await ZF.readFileAsText(f)); } catch (e) { throw NOT_BACKUP(f); }
  }
  async function readBackupFile(f) {
    const json = await readJson(f);
    if (!json || json.app !== 'ZapFlow' || !json.data || typeof json.data !== 'object') throw NOT_BACKUP(f);
    return json;
  }

  /** Escolhe (ou recebe arrastado) um arquivo, mostra o conteúdo e pergunta como importar */
  async function importFlow(file) {
    const { h, icon, ui, store } = ZF;
    const f = file || (await ZF.pickFile('.json,application/json'));
    if (!f) return false;
    const raw = await readJson(f);
    if (ZF.waspeed && ZF.waspeed.isWaSpeed(raw)) return importWaSpeed(raw, f);
    const json = await readBackupFile(f);
    const info = describe(json);

    const choice = (value, title, text, checked, danger) => h('label', { class: 'zf-choice' + (danger ? ' danger' : '') },
      h('input', { type: 'radio', name: 'zf-import-mode', value, checked }),
      h('div', {}, h('b', {}, title), h('span', {}, text)));
    const merge = choice('merge', 'Juntar com os dados atuais', 'Mantém tudo o que já existe aqui e adiciona o que falta do backup. Nada é apagado.', true, false);
    const replace = info.partial
      ? choice('replace', 'Substituir essas partes', 'Troca só o que está no backup pelos dados dele. O resto continua como está.', false, true)
      : choice('replace', 'Substituir tudo', 'Apaga as respostas, abas, notas, agendamentos e configurações deste navegador e deixa tudo igual ao backup.', false, true);
    const safety = ui.checkbox('Baixar antes uma cópia dos dados atuais (por segurança)', true);
    safety.style.display = 'none';
    const body = h('div', {},
      h('div', { class: 'zf-note info' }, icon('download', 15), h('div', {},
        h('div', {}, h('b', {}, f.name)),
        h('div', {}, info.at ? `Feito em ${ZF.fmtDateTime(info.at)}` : 'Data desconhecida'))),
      info.partial ? h('div', { class: 'zf-hint' }, `Backup parcial: ${info.partial.join(', ')}.`) : null,
      h('div', { class: 'zf-h3' }, 'O que tem no backup'),
      h('ul', { class: 'zf-list-plain' }, info.parts.map((p) => h('li', {}, p))),
      h('div', { class: 'zf-h3' }, 'Como importar'),
      merge, replace, safety);
    body.addEventListener('change', () => {
      safety.style.display = replace.querySelector('input').checked ? '' : 'none';
    });

    return new Promise((resolve) => {
      let done = false;
      ui.modal({
        title: 'Importar backup',
        global: true,
        body,
        onClose: () => { if (!done) resolve(false); },
        actions: [
          { label: 'Cancelar' },
          {
            label: 'Importar', class: 'primary', icon: 'upload',
            onClick: async () => {
              const mode = replace.querySelector('input').checked ? 'replace' : 'merge';
              if (mode === 'replace' && safety.querySelector('input').checked) {
                const cur = await store.exportAll();
                ZF.downloadText(fileName(Date.now()).replace('backup', 'antes-de-importar'), JSON.stringify(cur), 'application/json');
              }
              await store.importAll(json, mode);
              done = true;
              ui.toast(mode === 'replace' ? 'Backup restaurado' : 'Backup juntado com os dados atuais', 'ok', 3500);
              ui.rerender();
              resolve(true);
            },
          },
        ],
      });
    });
  }

  /**
   * Backup do WaSpeed: converte o que é legível (respostas rápidas, arquivos, agendamentos, ordem das
   * etiquetas) e junta com os dados atuais. Os agendamentos entram pausados, a não ser que o usuário
   * escolha o contrário — assim ninguém recebe mensagem em dobro enquanto o WaSpeed estiver instalado.
   */
  async function importWaSpeed(raw, f) {
    const { h, icon, ui, store } = ZF;
    // nomes das conversas (para {nome} e {primeiro_nome} dos agendamentos)
    const names = new Map();
    if (ZF.wa.isReady()) {
      const r = await ZF.wa.bridge('listChats', {}, 20000);
      ((r && r.ok && r.chats) || []).forEach((c) => {
        if (!c.name) return;
        if (c.phone) names.set(ZF.onlyDigits(c.phone), c.name);
        if (c.chatId) names.set(c.chatId, c.name);
      });
    }
    const preview = ZF.waspeed.convert(raw, { names });
    const rep = preview.report;
    if (!rep.replies && !rep.schedules) throw new Error('Não encontrei respostas rápidas nem agendamentos legíveis neste backup do WaSpeed.');
    const mb = Object.keys(preview.backup.data).filter((k) => k.startsWith('file:'))
      .reduce((n, k) => n + (preview.backup.data[k].size || 0), 0) / 1048576;

    const choice = (value, title, text, checked) => h('label', { class: 'zf-choice' },
      h('input', { type: 'radio', name: 'zf-ws-sched', value, checked }),
      h('div', {}, h('b', {}, title), h('span', {}, text)));
    const paused = choice('paused', 'Importar pausados (recomendado)', 'Ficam em Agendamentos como "Pausado". Apague no WaSpeed e clique em Retomar em cada um — assim o paciente não recebe a mensagem duas vezes.', true);
    const active = choice('active', 'Importar já ativos', 'Use só se os agendamentos já foram apagados ou parados no WaSpeed.', false);
    const li = (t) => h('li', {}, t);
    const body = h('div', {},
      h('div', { class: 'zf-note info' }, icon('download', 15), h('div', {},
        h('div', {}, h('b', {}, f.name)),
        h('div', {}, 'Backup do WaSpeed'))),
      h('div', { class: 'zf-h3' }, 'O que vai ser importado'),
      h('ul', { class: 'zf-list-plain' },
        rep.replies ? li(`${rep.replies} respostas rápidas, na categoria "Importadas do WaSpeed" (com "aguarde", "digitando…" e etiquetas)`) : null,
        rep.files ? li(`${rep.files} ${rep.files === 1 ? 'arquivo' : 'arquivos'} (${mb.toFixed(1)} MB) — imagens e PDFs das respostas`) : null,
        rep.schedules ? li(`${rep.schedules} agendamentos (próximos envios, com a mesma repetição)`) : null,
        rep.labelOrder ? li('Ordem das etiquetas do WhatsApp') : null),
      h('div', { class: 'zf-h3' }, 'O que não dá para trazer'),
      h('ul', { class: 'zf-list-plain' },
        rep.encrypted.length ? li(`O WaSpeed guarda criptografados: ${rep.encrypted.join(', ')}. Por isso cada resposta ganha um título tirado do próprio texto (dá para renomear depois).`) : null,
        rep.history ? li(`${rep.history} registros de envios antigos (histórico do WaSpeed).`) : null,
        rep.skippedPast ? li(`${rep.skippedPast} agendamento(s) que já passaram e não se repetem.`) : null),
      rep.schedules ? h('div', { class: 'zf-h3' }, 'Agendamentos') : null,
      rep.schedules ? paused : null,
      rep.schedules ? active : null,
      h('div', { class: 'zf-hint' }, 'Nada do que já está no ZapFlow é apagado. Importar o mesmo arquivo de novo não duplica nada.'));

    return new Promise((resolve) => {
      let done = false;
      ui.modal({
        title: 'Importar backup do WaSpeed',
        global: true,
        body,
        onClose: () => { if (!done) resolve(false); },
        actions: [
          { label: 'Cancelar' },
          {
            label: 'Importar', class: 'primary', icon: 'upload',
            onClick: async () => {
              const activeSchedules = !!active.querySelector('input').checked;
              const { backup } = ZF.waspeed.convert(raw, { names, activeSchedules });
              await store.importAll(backup, 'merge');
              if (rep.labelOrder) await store.saveSettings({ labelOrder: rep.labelOrder });
              done = true;
              ui.toast(`Importado do WaSpeed: ${rep.replies} respostas rápidas e ${rep.schedules} agendamentos`, 'ok', 5000);
              ui.rerender();
              resolve(true);
            },
          },
        ],
      });
    });
  }

  /** "Selecione o conteúdo para realizar o backup": escolhe as partes e baixa o arquivo */
  function exportFlow() {
    const { h, icon, ui, store } = ZF;
    const keys = Object.keys(store.PARTS);
    const sel = new Set(keys);
    const sw = {};
    const all = ui.switch(true, (v) => {
      keys.forEach((k) => { if (v) sel.add(k); else sel.delete(k); sw[k].querySelector('input').checked = v; });
    });
    const line = (ic, label, control) => h('div', { class: 'zf-bk-row' }, h('span', { class: 'zf-bk-ic' }, icon(ic, 19)), h('span', { class: 'zf-grow' }, label), control);
    const rows = keys.map((k) => {
      sw[k] = ui.switch(true, (v) => {
        if (v) sel.add(k); else sel.delete(k);
        all.querySelector('input').checked = sel.size === keys.length;
      });
      return line(store.PARTS[k].icon, store.PARTS[k].label, sw[k]);
    });
    ui.modal({
      title: 'Selecione o conteúdo para realizar o backup',
      global: true,
      body: h('div', { class: 'zf-bk-list' }, line('checks', 'Selecionar todos', all), rows),
      actions: [{
        label: 'Exportar Backup', class: 'primary', icon: 'download',
        onClick: async () => {
          if (!sel.size) { ui.toast('Escolha pelo menos um item', 'error'); return false; }
          const parts = sel.size === keys.length ? null : [...sel];
          const json = await store.exportAll(parts);
          const name = fileName(Date.now());
          ZF.downloadText(parts ? name.replace('backup', 'backup-parcial') : name, JSON.stringify(json), 'application/json');
          ui.toast('Backup baixado', 'ok');
          return true;
        },
      }],
    });
  }

  /** Detalhes do backup automático (para quem enviar, situação, enviar agora); aceita o arquivo arrastado para importar */
  function autoBox() {
    const { h, icon, ui, store } = ZF;
    const ICONS = { ok: 'check', error: 'alert', warn: 'alert', info: 'clock' };
    const statusEl = h('div', { class: 'zf-backup-status' });
    const paint = async () => {
      const [settings, st] = [await store.settings(), await getState()];
      statusEl.replaceChildren(...statusLines(settings.backupFreq, st).map((l) =>
        h('div', { class: 'zf-backup-line ' + l.type }, icon(ICONS[l.type], 14), h('span', {}, l.text))));
    };
    paint();
    const off = store.onChange(['backupState', 'settings'], () => (statusEl.isConnected ? paint() : off()));

    const s = ui.settings || store.DEFAULT_SETTINGS;
    const meHint = h('div', { class: 'zf-srow-hint' }, 'Vazio = você mesmo (a conversa "Você" do WhatsApp).');
    myPhone().then((me) => {
      if (me) meHint.textContent = `Vazio = você mesmo: ${ZF.fmtPhone(me.phone)} (a conversa "Você" do WhatsApp).`;
    }).catch(() => {});
    const toInput = ui.input({
      value: s.backupTo || '', placeholder: 'Seu número (automático)', style: { width: '210px' },
      onchange: (e) => {
        const raw = e.target.value.trim();
        if (raw && !ZF.normalizePhone(raw, s.countryCode)) return ui.toast('Número inválido', 'error');
        store.saveSettings({ backupTo: raw }).then(() => ui.toast('Configuração salva', 'ok', 1200));
      },
    });
    const download = ui.safe(async () => {
      ZF.downloadText(fileName(Date.now()), JSON.stringify(await store.exportAll()), 'application/json');
    });
    const box = h('div', { class: 'zf-backup-box zf-drop' },
      h('div', { class: 'zf-row', style: { gap: '10px', flexWrap: 'wrap', alignItems: 'center' } },
        h('span', { class: 'zf-srow-label' }, 'Enviar para'), toInput),
      meHint,
      statusEl,
      h('div', { class: 'zf-row', style: { flexWrap: 'wrap', gap: '6px', marginTop: '10px' } },
        h('button', { class: 'zf-btn sm primary', onclick: ui.safe(() => sendNow()) }, icon('send', 14), 'Enviar backup agora'),
        h('button', { class: 'zf-btn sm', onclick: download }, icon('download', 14), 'Baixar tudo')),
      h('div', { class: 'zf-srow-hint', style: { marginTop: '8px' } },
        'Para restaurar: no WhatsApp, abra a conversa "Você", baixe o arquivo zapflow-backup….json e use Importar backup (ou arraste o arquivo para este quadro).'));
    const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    box.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); box.classList.add('over'); });
    box.addEventListener('dragleave', (e) => { if (!box.contains(e.relatedTarget)) box.classList.remove('over'); });
    box.addEventListener('drop', ui.safe(async (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      box.classList.remove('over');
      const f = e.dataTransfer.files[0];
      if (f) await importFlow(f);
    }));
    return box;
  }

  ZF.backup = {
    bootDelayMs: 90000, // espera o WhatsApp terminar de carregar as conversas
    FREQS, addPeriod, nextDue, describe, fileName, statusLines, getState, myPhone, send, sendNow, autoTick, importFlow, exportFlow, autoBox, readBackupFile };
})();
