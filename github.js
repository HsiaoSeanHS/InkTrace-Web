(function (root) {
  'use strict';

  const repository = Object.freeze({ owner: 'HsiaoSeanHS', repo: 'InkTrace-Web', branch: 'main' });
  const backupPath = '/contents/backups/latest.json';

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

  async function request(config, path, body, raw = false) {
    if (!config.configured) {
      throw Error('請先設定 GitHub。');
    }
    const headers = { Authorization: `Bearer ${config.token}`, Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json' };
    if (body) {
      headers['Content-Type'] = 'application/json';
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(`https://api.github.com/repos/${config.owner}/${config.repo}${path}`, {
        method: body ? 'PUT' : 'GET',
        headers,
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'omit',
        redirect: 'error',
        signal: controller.signal,
      });
      if (response.ok) {
        return raw ? await response.text() : await response.json();
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
      if (error.name === 'AbortError' || error instanceof TypeError) {
        throw Error('無法連線 GitHub。若已送出上傳，請先確認倉庫，再重試。');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
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
      const existing = await request(config, `${backupPath}?ref=main`);
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
    return request(config, `${backupPath}?ref=main`, undefined, true);
  }

  root.InkTraceGitHub = { repository, configure, check, upload, backup, restore };
})(globalThis);
