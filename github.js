(function (root) {
  'use strict';

  const repository = Object.freeze({ owner: 'HsiaoSeanHS', repo: 'InkTrace-Web', branch: 'main' });
  const backupPath = '/contents/backups/latest.json';

  function requireSecureContext() {
    if (root.top && root.top !== root) throw Error('請直接開啟網站，不能在嵌入頁面中輸入 Token。');
    if (root.location && (root.isSecureContext !== true ||
      (root.location.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(root.location.hostname)))) {
      throw Error('請使用 HTTPS 網址開啟網站，再輸入 Token。');
    }
  }

  function configure(owner, repo, token) {
    if (owner !== repository.owner || repo !== repository.repo) {
      throw Error('個人版僅使用 HsiaoSeanHS/InkTrace-Web。');
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(owner)) {
      throw Error('GitHub 帳號名稱格式不正確。');
    }
    if (!/^[A-Za-z0-9_.-]{1,100}$/.test(repo) || repo === '.' || repo === '..') {
      throw Error('倉庫名稱格式不正確。');
    }
    if (!/^[A-Za-z0-9_]{10,512}$/.test(token)) {
      throw Error('請填入有效的 Personal Access Token。');
    }
    return {
      owner,
      repo,
      token,
      configured: true
    };
  }

  async function readBackup(response) {
    const limit = root.InkTraceBackup.maxBytes;
    const tooLarge = () => Error('Repo 備份超過 20 MB，已停止下載，未變更本機資料。');
    if (Number(response.headers?.get('Content-Length')) > limit) {
      await response.body?.cancel();
      throw tooLarge();
    }
    if (!response.body?.getReader) {
      const raw = await response.text();
      if (new TextEncoder().encode(raw).length > limit) throw tooLarge();
      return raw;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let size = 0;
    let raw = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) throw tooLarge();
        raw += decoder.decode(value, { stream: true });
      }
      return raw + decoder.decode();
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  async function request(config, path, body, format = 'json') {
    requireSecureContext();
    if (!config.configured || !config.token) throw Error('請為這次操作輸入 Token。');
    configure(config.owner, config.repo, config.token);
    if (config.signal?.aborted) {
      const error = Error('已取消 GitHub 操作。');
      error.name = 'TokenCancelledError';
      throw error;
    }
    const headers = { Authorization: `Bearer ${config.token}`, Accept: format === 'raw' ? 'application/vnd.github.raw+json' :
      format === 'object' ? 'application/vnd.github.object+json' : 'application/vnd.github+json' };
    if (body) {
      headers['Content-Type'] = 'application/json';
    }
    const controller = new AbortController();
    const cancel = () => controller.abort();
    config.signal?.addEventListener('abort', cancel, { once: true });
    const timeout = setTimeout(cancel, 25000);
    try {
      const response = await fetch(`https://api.github.com/repos/${config.owner}/${config.repo}${path}`, {
        method: body ? 'PUT' : 'GET',
        headers,
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        redirect: 'error',
        signal: controller.signal,
      });
      if (response.ok) {
        return format === 'raw' ? await readBackup(response) : await response.json();
      }
      const messages = {
        401: 'Token 無效或已過期。',
        403: 'GitHub 拒絕存取，請確認 Contents 讀寫權限。',
        404: '找不到倉庫、main 分支或檔案。',
        409: 'GitHub 檔案有衝突，請重試。',
        422: 'GitHub 拒絕寫入，請檢查 main 分支規則。',
      };
      const error = Error(messages[response.status] || `GitHub 回報 HTTP ${response.status}。`);
      error.status = response.status;
      throw error;
    } catch (error) {
      if (config.signal?.aborted) {
        const cancelled = Error('已取消 GitHub 操作。');
        cancelled.name = 'TokenCancelledError';
        throw cancelled;
      }
      if (error.name === 'AbortError' || error instanceof TypeError) {
        throw Error('無法連線 GitHub。若已送出上傳，請先確認倉庫，再重試。');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      config.signal?.removeEventListener('abort', cancel);
    }
  }

  async function check(config) {
    const repo = await request(config, '');
    if (repo.archived || repo.permissions?.push === false) {
      throw Error('倉庫唯讀或沒有寫入權限。');
    }
    await request(config, '/branches/main');
  }

  async function upload(config, title, character, side, svg, filename = root.InkTrace.name(character)) {
    const folders = ['font_dataset', root.InkTrace.title(title)];
    if (side === 'rough') {
      folders.push('潦草');
    }
    else {
      folders.push('工整')
    }
    const path = [...folders, filename].map(encodeURIComponent).join('/');
    const endpoint = `/contents/${path}`;
    let sha;
    try {
      const old = await request(config, `${endpoint}?ref=main`);
      if (old.type !== 'file' || !old.sha) {
        throw Error('目標路徑不是一般檔案。');
      }
      sha = old.sha;
    } catch (error) {
      if (error.status !== 404) {
        throw error;
      }
    }
    // Generated SVG contains only ASCII XML markup and numeric coordinates.
    const body = { message: `Update ${side} SVG for ${character}`, content: btoa(svg), branch: 'main' };
    if (sha) {
      body.sha = sha;
    }
    const result = await request(config, endpoint, body);
    if (!result.content?.sha) {
      throw Error('GitHub 未確認檔案，請到倉庫檢查。');
    }
    return { sha: result.content.sha, url: `https://github.com/${config.owner}/${config.repo}/blob/main/${path}` };
  }

  async function backup(config, data) {
    let sha;
    try {
      const existing = await request(config, `${backupPath}?ref=main`, undefined, 'object');
      if (existing.type !== 'file' || !existing.sha) throw Error('備份路徑不是一般檔案。');
      sha = existing.sha;
    } catch (error) {
      if (error.status !== 404) throw error;
    }
    const bytes = new TextEncoder().encode(JSON.stringify(data));
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    const result = await request(config, backupPath, {
      message: `Backup InkTrace personal data (${data.createdAt})`,
      content: btoa(binary), branch: 'main', ...(sha ? { sha } : {}),
    });
    if (!result.content?.sha) throw Error('GitHub 未確認備份，請到倉庫檢查。');
  }

  async function restore(config) {
    try {
      return await request(config, `${backupPath}?ref=main`, undefined, 'raw');
    } catch (error) {
      if (error.status !== 404) throw error;
      // GitHub also uses 404 for inaccessible repositories/branches. Confirm both
      // before reporting an absent backup, without requiring write permission.
      await request(config, '');
      await request(config, '/branches/main');
      const missing = Error('Repo 尚無完整備份（backups/latest.json）。請先在保有草稿與進度的裝置按「備份到 Repo」，再於此裝置還原。只上傳 SVG 不會建立進度備份；本機資料未變更。');
      missing.status = 404;
      missing.code = 'BACKUP_NOT_FOUND';
      throw missing;
    }
  }

  root.InkTraceGitHub = { repository, requireSecureContext, configure, check, upload, backup, restore };
})(globalThis);
