(function (root) {
  'use strict';

  function cancelled() {
    const error = Error('已取消 GitHub 操作。');
    error.name = 'TokenCancelledError';
    return error;
  }

  // The controller never writes credentials to browser storage or global settings.
  function create({ dialog, form, input, message, heading }) {
    let busy = false;
    let pending = null;
    let active = null;
    let controller = null;

    function cancel() {
      input.value = '';
      controller?.abort();
      if (active) {
        active.token = '';
        active.configured = false;
      }
      if (pending) {
        const { reject } = pending;
        pending = null;
        reject(cancelled());
      }
      if (dialog.open) dialog.close();
    }

    form.addEventListener('submit', event => {
      event.preventDefault();
      if (!pending) return;
      try {
        const { owner, repo } = root.InkTraceGitHub.repository;
        const config = root.InkTraceGitHub.configure(owner, repo, input.value.trim());
        input.value = '';
        active = config;
        const { resolve } = pending;
        pending = null;
        dialog.close();
        resolve(config);
      } catch (error) {
        input.value = '';
        message.textContent = error.message;
        input.focus();
      }
    });
    dialog.addEventListener('close', () => {
      // A queued close event from the prior run must not cancel a newly opened prompt.
      if (dialog.open) return;
      input.value = '';
      if (pending) {
        const { reject } = pending;
        pending = null;
        reject(cancelled());
      }
    });
    dialog.addEventListener('cancel', event => {
      event.preventDefault();
      cancel();
    });

    return {
      cancel,
      async run(label, action) {
        if (busy) throw Error('請先完成目前的 GitHub 操作。');
        root.InkTraceGitHub.requireSecureContext();
        busy = true;
        controller = new AbortController();
        try {
          const config = await new Promise((resolve, reject) => {
            pending = { resolve, reject };
            heading.textContent = label;
            input.value = '';
            message.textContent = '';
            dialog.showModal();
            input.focus();
          });
          config.signal = controller.signal;
          if (config.signal.aborted) throw cancelled();
          return await action(config);
        } finally {
          pending = null;
          input.value = '';
          if (active) {
            active.token = '';
            active.configured = false;
          }
          active = null;
          controller = null;
          busy = false;
          if (dialog.open) dialog.close();
        }
      },
    };
  }

  function clearLegacy(storage) {
    // Delete without reading or activating an old plaintext token.
    storage.removeItem('inktrace-github');
  }

  root.InkTraceTokenAccess = { create, clearLegacy };
  if (typeof module !== 'undefined') module.exports = root.InkTraceTokenAccess;
})(globalThis);
