(function (root) {
  'use strict';
  const storageKey = 'inktrace-token-vault-v1';
  const iterations = 600000;
  const { owner, repo } = root.InkTraceGitHub.repository;
  const context = new TextEncoder().encode(`InkTrace Token vault v1: ${owner}/${repo}`);
  const interrupted = () => Error('Token 已鎖定，請重新解鎖。');

  function encode(bytes) {
    return btoa(String.fromCharCode(...bytes));
  }
  function decode(value, length) {
    if (typeof value !== 'string' || value.length > 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
      throw Error('加密 Token 資料損毀，請清除後重新設定。');
    }
    const bytes = Uint8Array.from(atob(value), char => char.charCodeAt(0));
    if ((length && bytes.length !== length) || (!length && (bytes.length < 26 || bytes.length > 528))) {
      throw Error('加密 Token 資料損毀，請清除後重新設定。');
    }
    return bytes;
  }
  function parse(raw) {
    let data;
    try { data = JSON.parse(raw); } catch { /* Reject below without echoing stored content. */ }
    if (!data || data.version !== 1 || data.algorithm !== 'AES-GCM' || data.kdf !== 'PBKDF2-SHA256' ||
      data.iterations !== iterations || data.owner !== owner || data.repo !== repo) {
      throw Error('不支援的加密 Token 格式，請清除後重新設定。');
    }
    return { salt: decode(data.salt, 16), iv: decode(data.iv, 12), ciphertext: decode(data.ciphertext) };
  }
  async function derive(password, salt) {
    if (!root.crypto?.subtle) throw Error('此瀏覽器無法使用安全加密，請使用 HTTPS 並更新 Safari。');
    const material = await root.crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return root.crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function decrypt(key, data) {
    try {
      const bytes = await root.crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.iv, additionalData: context, tagLength: 128 },
        key, data.ciphertext);
      const token = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      root.InkTraceGitHub.configure(owner, repo, token);
      return token;
    } catch {
      throw Error('密碼不正確或加密 Token 已損毀，請重試或重新設定。');
    }
  }

  function create(getStorage = () => root.localStorage) {
    let key = null;
    let unlockedRecord = null;
    let generation = 0;
    function read() {
      const raw = getStorage().getItem(storageKey);
      if (raw !== null && (typeof raw !== 'string' || raw.length > 4096)) {
        throw Error('加密 Token 資料損毀，請清除後重新設定。');
      }
      return raw;
    }
    function lock() { generation++; key = null; unlockedRecord = null; }
    function isUnlocked() {
      try {
        if (key && read() !== unlockedRecord) lock();
      } catch {
        lock();
      }
      return key !== null;
    }
    return {
      hasSaved: () => read() !== null,
      isUnlocked,
      lock,
      forget() {
        lock();
        getStorage().removeItem(storageKey);
      },
      async save(token, password, confirmation) {
        root.InkTraceGitHub.requireSecureContext();
        root.InkTraceGitHub.configure(owner, repo, token);
        if (typeof password !== 'string' || password.trim().length < 12 || password.length > 1024) {
          throw Error('解鎖密碼需 12–1024 個字元，建議使用較長且獨立的密碼。');
        }
        if (password !== confirmation) throw Error('兩次輸入的解鎖密碼不一致。');
        const ticket = generation;
        const salt = root.crypto.getRandomValues(new Uint8Array(16));
        const iv = root.crypto.getRandomValues(new Uint8Array(12));
        const derived = await derive(password, salt);
        const ciphertext = await root.crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: context, tagLength: 128 },
          derived, new TextEncoder().encode(token));
        const raw = JSON.stringify({ version: 1, algorithm: 'AES-GCM', kdf: 'PBKDF2-SHA256', iterations,
          owner, repo, salt: encode(salt), iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) });
        if (generation !== ticket) throw interrupted();
        getStorage().setItem(storageKey, raw);
        key = derived;
        unlockedRecord = raw;
      },
      async unlock(password) {
        root.InkTraceGitHub.requireSecureContext();
        if (typeof password !== 'string' || !password.length || password.length > 1024) throw Error('請輸入解鎖密碼。');
        const raw = read();
        if (!raw) throw Error('尚未設定加密 Token。');
        const data = parse(raw);
        const ticket = generation;
        const derived = await derive(password, data.salt);
        await decrypt(derived, data);
        if (generation !== ticket || read() !== raw) throw interrupted();
        key = derived;
        unlockedRecord = raw;
      },
      async token() {
        root.InkTraceGitHub.requireSecureContext();
        if (!isUnlocked()) throw interrupted();
        const ticket = generation;
        const token = await decrypt(key, parse(unlockedRecord));
        if (generation !== ticket || !isUnlocked()) throw interrupted();
        return token;
      },
    };
  }
  root.InkTraceTokenVault = { create, storageKey };
  if (typeof module !== 'undefined') module.exports = root.InkTraceTokenVault;
})(globalThis);
