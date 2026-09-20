/* ZapFlow — inicialização no WhatsApp Web */
(() => {
  'use strict';
  const ZF = window.ZF;
  if (window.top !== window || ZF.started) return;
  ZF.started = true;

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return;
    if (msg.type === 'ZF_TOGGLE') {
      ZF.ui.toggle();
      sendResponse({ ok: true });
    }
    if (msg.type === 'ZF_PING') sendResponse({ ok: true, ready: ZF.wa.isReady() });
  });

  const boot = async () => {
    try {
      await ZF.store.migrate().catch((e) => { if (ZF.isContextGone(e)) ZF.shutdown(); else console.warn('[ZapFlow] migração', e); });
      await ZF.ui.mount();
      ZF.topbar.mount();
      ZF.runner.start();
      ZF.store.gcFiles().catch(() => {});
    } catch (e) {
      if (ZF.isContextGone(e)) ZF.shutdown();
      else console.error('[ZapFlow] falha ao iniciar', e);
    }
  };
  if (document.body) boot();
  else document.addEventListener('DOMContentLoaded', boot);
})();
