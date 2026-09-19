/*
 * ZapFlow — executor de envios (agendamentos e campanhas).
 * Roda dentro da aba do WhatsApp Web; o estado fica no storage para
 * sobreviver a recarregamentos (ex.: quando a conversa é aberta via link).
 */
(() => {
  'use strict';
  const ZF = window.ZF;
  const { store, wa } = ZF;

  const LOCK_STALE_MS = 90000;
  const NAV_TIMEOUT_MS = 3 * 60000;
  const MAX_CONSECUTIVE_FAILS = 5;

  // Mesmo id após recarregar a aba (sessionStorage é por aba)
  let instanceId;
  try {
    instanceId = sessionStorage.getItem('zapflow-instance');
    if (!instanceId) sessionStorage.setItem('zapflow-instance', (instanceId = ZF.uid()));
  } catch (e) {
    instanceId = ZF.uid();
  }

  const runner = {
    busy: false,
    navigating: false,
    state: { phase: 'idle', text: '' },
    lastUserInput: 0,
  };

  const setState = (phase, text, extra = {}) => {
    runner.state = { phase, text, ...extra, at: Date.now() };
    ZF.emit('runner', runner.state);
  };

  // Atividade real do usuário no WhatsApp (fora do painel) adia envios automáticos
  ['keydown', 'mousedown'].forEach((evt) => document.addEventListener(evt, (e) => {
    if (!e.isTrusted) return;
    if (e.composedPath().some((n) => n && n.id === 'zapflow-root')) return;
    runner.lastUserInput = Date.now();
  }, true));
  const userIsBusy = (dueSince) => Date.now() - runner.lastUserInput < 6000 && Date.now() - dueSince < 3 * 60000;

  const notify = async (title, message) => {
    const s = await store.settings();
    if (!s.notifications) return;
    try { await chrome.runtime.sendMessage({ type: 'ZF_NOTIFY', title, message }); } catch (e) { /* ignora */ }
  };

  async function acquireLock() {
    const { runnerLock: l } = await chrome.storage.local.get('runnerLock');
    if (l && l.owner !== instanceId && Date.now() - l.ts < LOCK_STALE_MS) return false;
    if (!l || l.owner !== instanceId || Date.now() - l.ts > 30000) {
      await chrome.storage.local.set({ runnerLock: { owner: instanceId, ts: Date.now() } });
    }
    return true;
  }

  const saveCurrent = (current) => store.update('runner', (r) => ({ ...r, current }));

  /* ---------------- recorrência ---------------- */
  function nextOccurrence(ts, repeat, anchorDay) {
    const d = new Date(ts);
    const now = Date.now();
    let guard = 0;
    do {
      if (repeat === 'daily') d.setDate(d.getDate() + 1);
      else if (repeat === 'weekdays') {
        do d.setDate(d.getDate() + 1); while (d.getDay() === 0 || d.getDay() === 6);
      } else if (repeat === 'weekly') d.setDate(d.getDate() + 7);
      else if (repeat === 'yearly') d.setFullYear(d.getFullYear() + 1);
      else if (repeat === 'monthly') {
        const day = anchorDay || d.getDate();
        d.setDate(1);
        d.setMonth(d.getMonth() + 1);
        const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        d.setDate(Math.min(day, last));
      } else return null;
    } while (d.getTime() <= now && ++guard < 1000);
    return d.getTime();
  }
  runner.nextOccurrence = nextOccurrence;

  /* ---------------- finalização ---------------- */
  async function finishSchedule(id, result) {
    let done = null;
    await store.updateItem('schedules', id, (s) => {
      s.history = (s.history || []).slice(-19);
      s.history.push({ at: Date.now(), ok: !!result.ok, error: result.error || null });
      s.lastRunAt = Date.now();
      s.lastError = result.ok ? null : result.error || 'Falha no envio';
      const repeats = s.repeat && s.repeat !== 'none';
      if (repeats && (result.ok || result.missed)) {
        s.sendAt = nextOccurrence(s.sendAt, s.repeat, s.anchorDay);
        s.status = 'pending';
      } else if (result.ok) {
        s.status = 'sent';
        s.sentAt = Date.now();
      } else {
        s.status = result.missed ? 'missed' : 'failed';
      }
      done = s;
    });
    if (done && !result.ok && !result.missed) notify('Agendamento não enviado', `${done.target.name || ZF.fmtPhone(done.target.phone)}: ${result.error || 'falha'}`);
  }

  async function finishCampaignContact(campaignId, index, result) {
    let finished = null, autoPaused = null;
    await store.updateItem('campaigns', campaignId, (c) => {
      const ct = c.contacts[index];
      if (!ct || ct.status !== 'pending') return;
      ct.status = result.ok ? 'sent' : result.invalid ? 'invalid' : 'failed';
      ct.error = result.ok ? null : result.error || null;
      ct.at = Date.now();

      let delay = ZF.rand(c.minDelay, c.maxDelay) * 1000;
      if (result.invalid) delay = ZF.rand(3, 6) * 1000;
      if (result.ok) {
        c.consecutiveFails = 0;
        c.batchCount = (c.batchCount || 0) + 1;
        if (c.pauseEvery > 0 && c.batchCount >= c.pauseEvery) {
          c.batchCount = 0;
          delay += c.pauseMinutes * 60000;
        }
      } else if (!result.invalid) {
        c.consecutiveFails = (c.consecutiveFails || 0) + 1;
        if (c.consecutiveFails >= MAX_CONSECUTIVE_FAILS) {
          c.status = 'paused';
          c.pauseReason = `${MAX_CONSECUTIVE_FAILS} falhas seguidas — verifique o WhatsApp e retome.`;
          autoPaused = c;
        }
      }
      c.nextAt = Date.now() + delay;
      if (!c.contacts.some((x) => x.status === 'pending')) {
        c.status = 'done';
        c.finishedAt = Date.now();
        finished = c;
      }
    });
    if (finished) {
      const sent = finished.contacts.filter((x) => x.status === 'sent').length;
      notify('Campanha concluída', `"${finished.name}": ${sent} de ${finished.contacts.length} enviadas.`);
    }
    if (autoPaused) notify('Campanha pausada', autoPaused.pauseReason);
  }

  const finishJob = (job, result) => (job.kind === 'schedule'
    ? finishSchedule(job.refId, result)
    : finishCampaignContact(job.refId, job.index, result));

  /* ---------------- execução ---------------- */
  /** Depois de recarregar pelo link (só se permitido), envia os blocos restantes na conversa aberta */
  async function sendAfterReload(job) {
    await saveCurrent({ job, phase: 'sending', startedAt: Date.now() });
    let result;
    try {
      await wa.sendBlocks(job.rendered);
      result = { ok: true };
    } catch (e) {
      result = { ok: false, error: e.message || String(e) };
    }
    await saveCurrent(null);
    await finishJob(job, result);
  }

  async function runJob(job) {
    const label = job.target.name || ZF.fmtPhone(job.target.phone) || 'contato';
    setState('sending', `Enviando para ${label}…`, { kind: job.kind, refId: job.refId });
    const settings = await store.settings();
    job.rendered = ZF.renderBlocks(job.blocks, job.vars, false);

    await saveCurrent({ job, phase: 'sending', startedAt: Date.now() });
    let res;
    try {
      // envia sem recarregar: direto (sem trocar de conversa) ou abrindo a conversa na interface
      res = await wa.deliver(job.target, job.rendered, settings);
    } catch (e) {
      res = { ok: false, error: e.message || String(e) };
    }

    if (res.needReload) {
      if (settings.allowReload && job.target.phone) {
        job.rendered = res.remaining;
        await saveCurrent({ job, phase: 'nav', startedAt: Date.now() });
        runner.navigating = true;
        setState('sending', `Abrindo conversa com ${label}…`);
        wa.openChatByLink(job.target.phone);
        return;
      }
      res = { ok: false, error: `${res.error}. Veja Configurações → Diagnóstico.` };
    }
    await saveCurrent(null);
    await finishJob(job, res);

    if (res.usedUi && settings.restoreChat && res.prevChat && res.prevChat.ok && res.prevChat.chatId) {
      const now = await wa.bridge('getActiveChat', {}, 2000);
      if (!now || now.chatId !== res.prevChat.chatId) await wa.bridge('openChat', { chatId: res.prevChat.chatId }, 8000);
    }
  }

  // Com envio direto disponível, envios automáticos não mexem na tela — não precisa esperar o usuário parar de digitar
  let directCache = { at: 0, ok: false };
  async function directAvailable() {
    if (Date.now() - directCache.at < 5 * 60000) return directCache.ok;
    const s = await store.settings();
    const p = s.directSend === false ? null : await wa.bridge('ping', {}, 3000);
    directCache = { at: Date.now(), ok: !!(p && p.ok && p.modules.sendText && p.modules.chats) };
    return directCache.ok;
  }

  /** Retoma um envio que estava em andamento antes de a página recarregar */
  async function resumeInterrupted() {
    const { current: cur } = await store.get('runner');
    if (!cur || !cur.job) return false;
    if (cur.phase === 'nav') {
      if (Date.now() - cur.startedAt > NAV_TIMEOUT_MS) {
        await saveCurrent(null);
        await finishJob(cur.job, { ok: false, error: 'Tempo esgotado ao abrir a conversa' });
        return true;
      }
      setState('sending', 'Abrindo conversa…');
      const r = await wa.waitChatAfterNavigation(60000);
      if (!r.ok) {
        await saveCurrent(null);
        await finishJob(cur.job, r.invalid
          ? { ok: false, invalid: true, error: 'Número não tem WhatsApp' }
          : { ok: false, error: 'Não foi possível abrir a conversa' });
        return true;
      }
      await ZF.sleep(ZF.rand(1200, 2000));
      await sendAfterReload(cur.job);
      return true;
    }
    if (cur.phase === 'sending') {
      await saveCurrent(null);
      await finishJob(cur.job, { ok: false, error: 'Envio interrompido — confira se a mensagem saiu' });
      return true;
    }
    await saveCurrent(null);
    return false;
  }

  async function processSchedules() {
    const [schedules, settings] = [await store.get('schedules'), await store.settings()];
    const now = Date.now();
    const due = schedules.filter((s) => s.status === 'pending' && s.sendAt <= now).sort((a, b) => a.sendAt - b.sendAt);
    for (const s of due) {
      if (settings.lateToleranceMin > 0 && now - s.sendAt > settings.lateToleranceMin * 60000) {
        await finishSchedule(s.id, { ok: false, missed: true, error: 'Horário perdido (WhatsApp Web estava fechado)' });
        return true;
      }
      if (userIsBusy(s.sendAt) && !(await directAvailable())) {
        setState('waiting', 'Agendamento pronto — aguardando você parar de digitar…');
        scheduleWake(Date.now() + 6000);
        return false;
      }
      const vars = { ...ZF.builtinVars(s.target), ...(s.vars || {}) };
      await runJob({ kind: 'schedule', refId: s.id, target: s.target, blocks: s.blocks, vars });
      return true;
    }
    return false;
  }

  async function processCampaigns() {
    const now = Date.now();
    let campaigns = await store.get('campaigns');
    if (campaigns.some((c) => c.status === 'scheduled' && c.startAt <= now)) {
      campaigns = await store.update('campaigns', (list) => {
        list.forEach((c) => {
          if (c.status === 'scheduled' && c.startAt <= now) {
            c.status = 'running';
            c.startedAt = c.startedAt || now;
            c.nextAt = now;
          }
        });
        return list;
      });
    }
    const c = campaigns.filter((x) => x.status === 'running').sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0))[0];
    if (!c) return false;

    const idx = c.contacts.findIndex((x) => x.status === 'pending');
    if (idx < 0) {
      await store.updateItem('campaigns', c.id, (x) => { x.status = 'done'; x.finishedAt = Date.now(); });
      return true;
    }
    if (c.nextAt && c.nextAt > now) {
      const sent = c.contacts.filter((x) => x.status !== 'pending').length;
      setState('waiting', `"${c.name}" — ${sent}/${c.contacts.length}`, { campaignId: c.id, nextAt: c.nextAt });
      scheduleWake(c.nextAt);
      return false;
    }
    if (userIsBusy(c.nextAt || now) && !(await directAvailable())) {
      setState('waiting', 'Envio em massa aguardando você parar de digitar…', { campaignId: c.id });
      scheduleWake(Date.now() + 6000);
      return false;
    }
    const contact = c.contacts[idx];
    const vars = { ...ZF.builtinVars(contact), ...(contact.vars || {}) };
    // contatos vindos de grupos/etiquetas podem ter só o id da conversa (ex.: grupos)
    const target = contact.chatId
      ? { type: 'chat', chatId: contact.chatId, phone: contact.phone || null, name: contact.name }
      : { type: 'phone', phone: contact.phone, name: contact.name };
    await runJob({ kind: 'campaign', refId: c.id, index: idx, target, blocks: c.blocks, vars });
    return true;
  }

  /* ---------------- laço principal ---------------- */
  let wakeToken = 0;
  function scheduleWake(ts) {
    const token = ++wakeToken;
    const ms = Math.max(500, Math.min(ts - Date.now(), 60000));
    ZF.sleep(ms).then(() => { if (token === wakeToken) tick(); });
  }

  async function tick() {
    if (runner.busy || runner.navigating || !wa.isReady()) return;
    runner.busy = true;
    const stamp = Date.now();
    try {
      if (!(await acquireLock())) {
        setState('standby', 'Outra aba do WhatsApp está cuidando dos envios');
        return;
      }
      await resumeInterrupted();
      let guard = 0;
      while (!runner.navigating && guard++ < 30) {
        const did = (await processSchedules()) || (await processCampaigns());
        if (!did) break;
        await chrome.storage.local.set({ runnerLock: { owner: instanceId, ts: Date.now() } });
      }
      if (!runner.navigating && ZF.backup) await ZF.backup.autoTick();
      if (!runner.navigating && (runner.state.at < stamp || runner.state.phase === 'sending')) setState('idle', '');
    } catch (e) {
      console.error('[ZapFlow] runner', e);
      if (String(e).includes('Extension context invalidated')) return;
      setState('error', e.message || String(e));
    } finally {
      runner.busy = false;
    }
  }

  /** Executa uma ação manual (ex.: resposta rápida) sem colidir com envios automáticos */
  runner.exclusive = async (fn) => {
    const until = Date.now() + 120000;
    while (runner.busy && Date.now() < until) await ZF.sleep(300);
    if (runner.busy) throw new Error('Um envio automático está em andamento. Tente novamente em instantes.');
    runner.busy = true;
    try { return await fn(); } finally { runner.busy = false; setTimeout(tick, 1000); }
  };

  runner.tick = tick;
  runner.setState = setState;
  runner.notify = notify;
  runner.directAvailable = directAvailable;
  runner.userTyping = () => Date.now() - runner.lastUserInput < 6000;
  runner.start = () => {
    setInterval(tick, 5000);
    store.onChange(['schedules', 'campaigns'], () => setTimeout(tick, 400));
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'ZF_TICK') tick();
    });
    const boot = setInterval(() => {
      if (wa.isReady()) { clearInterval(boot); tick(); }
    }, 1000);
  };

  ZF.runner = runner;
})();
