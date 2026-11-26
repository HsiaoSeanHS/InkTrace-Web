(function (root) {
  'use strict';

  function cancelled() {
    const error = Error('已取消 GitHub 操作。');
    error.name = 'TokenCancelledError';
    return error;
  }

  function create({ dialog, form, input, password, confirmation, confirmationField, setupFields, message, heading, submitButton,
    vault = root.InkTraceTokenVault.create(), onChange = () => {}, now = Date.now, idleMs = 15 * 60 * 1000 }) {
    let busy = false;
    let pending = null;
    let active = null;
    let controller = null;
    let generation = 0;
    let lastActivity = 0;
    let idleTimer;
    let submitting = false;

    function clearInputs() { input.value = password.value = confirmation.value = ''; }
    function lock() {
      generation++;
      clearTimeout(idleTimer);
      vault.lock();
      clearInputs();
      controller?.abort();
      if (active) { active.token = ''; active.configured = false; }
      if (pending) {
        const { reject } = pending;
        pending = null;
        reject(cancelled());
      }
      if (dialog.open) dialog.close();
      onChange();
    }
    function isUnlocked() {
      if (!vault.isUnlocked()) return false;
      if (now() - lastActivity >= idleMs) { lock(); return false; }
      return true;
    }
    function touch() {
      if (!isUnlocked()) return;
      lastActivity = now();
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (now() - lastActivity >= idleMs) lock();
      }, idleMs);
    }
    function rememberActivity() {
      lastActivity = now();
      touch();
      onChange();
    }

    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!pending || submitting) return;
      submitting = true;
      submitButton.disabled = true;
      const ticket = generation;
      const { setup } = pending;
      const token = input.value.trim();
      const secret = password.value;
      const repeated = confirmation.value;
      clearInputs();
      message.textContent = setup ? '正在加密保存…' : '正在解鎖…';
      try {
        if (setup) await vault.save(token, secret, repeated);
        else await vault.unlock(secret);
        if (generation !== ticket) return;
        rememberActivity();
        const { resolve } = pending;
        pending = null;
        dialog.close();
        resolve();
      } catch (error) {
        if (generation !== ticket) return;
        message.textContent = error.message;
        (setup ? input : password).focus();
      } finally {
        submitting = false;
        submitButton.disabled = false;
      }
    });
    dialog.addEventListener('close', () => {
      if (dialog.open) return;
      clearInputs();
      if (pending) lock();
    });
    dialog.addEventListener('cancel', event => { event.preventDefault(); lock(); });

    async function authorize(label, replace) {
      if (!replace && isUnlocked()) return;
      const setup = replace || !vault.hasSaved();
      await new Promise((resolve, reject) => {
        pending = { resolve, reject, setup };
        heading.textContent = setup ? '設定加密 Token' : `解鎖 Token · ${label}`;
        clearInputs();
        setupFields.hidden = confirmationField.hidden = !setup;
        input.required = confirmation.required = setup;
        password.autocomplete = setup ? 'new-password' : 'current-password';
        password.minLength = setup ? 12 : 1;
        submitButton.textContent = setup ? '加密保存並繼續' : '解鎖並繼續';
        message.textContent = '';
        dialog.showModal();
        (setup ? input : password).focus();
      });
    }

    return {
      cancel: lock,
      lock,
      touch,
      isUnlocked,
      hasSaved: () => vault.hasSaved(),
      forget() { lock(); vault.forget(); onChange(); },
      async run(label, action, replace = false) {
        if (busy) throw Error('請先完成目前的 GitHub 操作。');
        root.InkTraceGitHub.requireSecureContext();
        busy = true;
        controller = new AbortController();
        try {
          await authorize(label, replace);
          if (controller.signal.aborted) throw cancelled();
          const token = await vault.token();
          if (controller.signal.aborted) throw cancelled();
          const { owner, repo } = root.InkTraceGitHub.repository;
          active = { ...root.InkTraceGitHub.configure(owner, repo, token), signal: controller.signal };
          return await action(active);
        } catch (error) {
          if (error.status === 401) lock();
          throw error;
        } finally {
          pending = null;
          clearInputs();
          if (active) { active.token = ''; active.configured = false; }
          active = null;
          controller = null;
          busy = false;
          if (dialog.open) dialog.close();
          if (isUnlocked()) touch();
          onChange();
        }
      },
    };
  }

  function clearLegacy(storage) { storage.removeItem('inktrace-github'); }
  root.InkTraceTokenAccess = { create, clearLegacy };
  if (typeof module !== 'undefined') module.exports = root.InkTraceTokenAccess;
})(globalThis);
