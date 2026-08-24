(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);

  const COLOR_FIELDS = [
    ['theme-primary', 'primary'],
    ['theme-primary-dark', 'primaryDark'],
    ['theme-bg', 'bg'],
    ['theme-card', 'card'],
    ['theme-text', 'text'],
    ['theme-text2', 'text2'],
    ['theme-text3', 'text3'],
    ['theme-border', 'border']
  ];

  let current = null;

  function toast(msg, isError) {
    BWH.showToast(document.body, msg, isError);
  }

  function setColor(id, value) {
    const v = typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#fb7299';
    try {
      $(id).value = v;
    } catch (e) {
      /* 忽略非法值 */
    }
  }

  function draftSettings() {
    const theme = {};
    for (const [id, key] of COLOR_FIELDS) theme[key] = $(id).value;
    return {
      theme: theme,
      backgroundImage: $('bg-url').value.trim(),
      autoSync: {
        enabled: $('auto-sync-enabled').checked,
        intervalMinutes: Math.max(1, Math.floor(Number($('auto-sync-interval').value) || 60))
      },
      viewMode: $('view-mode').value === 'grid' ? 'grid' : 'list'
    };
  }

  function fillForm(s) {
    for (const [id, key] of COLOR_FIELDS) setColor(id, s.theme[key]);
    $('bg-url').value = s.backgroundImage || '';
    $('auto-sync-enabled').checked = !!s.autoSync.enabled;
    $('auto-sync-interval').value = s.autoSync.intervalMinutes;
    $('view-mode').value = s.viewMode === 'grid' ? 'grid' : 'list';
    $('last-sync').textContent = s.lastSyncAt
      ? '上次同步：' + new Date(s.lastSyncAt).toLocaleString()
      : '尚未同步过';
    preview();
  }

  function preview() {
    BWH.applyTheme(document.body, draftSettings());
  }

  async function load() {
    const res = await BWH.send({ type: 'get-settings' });
    if (!res.ok) {
      toast('读取设置失败：' + (res.error || ''), true);
      return;
    }
    current = res.settings;
    fillForm(res.settings);
  }

  /* ---------------- 事件 ---------------- */

  $('save').addEventListener('click', async () => {
    const btn = $('save');
    btn.disabled = true;
    const res = await BWH.send({ type: 'save-settings', settings: draftSettings() });
    btn.disabled = false;
    if (!res.ok) {
      toast('保存失败：' + (res.error || ''), true);
      return;
    }
    current = res.settings;
    let text = '设置已保存并生效';
    if (res.scheduledMinutes) text += '（自动同步每 ' + res.scheduledMinutes + ' 分钟执行）';
    if (res.sync) {
      if (res.sync.ok) text += '；已立即同步：新增 ' + res.sync.added + ' 条';
      else text += '；首次同步未成功：' + res.sync.error;
    }
    toast(text, res.sync && !res.sync.ok);
    $('last-sync').textContent = res.settings.lastSyncAt
      ? '上次同步：' + new Date(res.settings.lastSyncAt).toLocaleString()
      : '尚未同步过';
  });

  $('reset').addEventListener('click', async () => {
    if (!confirm('恢复默认主题与设置？')) return;
    const res = await BWH.send({ type: 'reset-settings' });
    if (!res.ok) {
      toast('重置失败：' + (res.error || ''), true);
      return;
    }
    current = res.settings;
    fillForm(res.settings);
    toast('已恢复默认设置');
  });

  $('bg-file').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      toast('请选择图片文件', true);
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      // 更换背景时，先删除应用数据中已存储的旧背景图
      try {
        await new Promise((resolve) => chrome.storage.local.remove('bwh_bg_image_data', resolve));
      } catch (e) {
        /* 忽略 */
      }
      // 小于 20MiB 的背景图移至应用数据目录（更换/清除时删除）
      if (file.size < 20 * 1024 * 1024) {
        try {
          await new Promise((resolve) => chrome.storage.local.set({ bwh_bg_image_data: dataUrl }, resolve));
        } catch (e) {
          /* 忽略 */
        }
      }
      $('bg-url').value = dataUrl;
      preview();
      toast(
        '已载入本地图片（' + (file.size / 1024 / 1024).toFixed(1) + ' MiB' +
        (file.size < 20 * 1024 * 1024 ? '，已存入应用数据' : '，超过 20MiB 未持久化到应用数据') +
        '），点击「保存设置」生效'
      );
    };
    reader.onerror = () => toast('读取图片失败', true);
    reader.readAsDataURL(file);
  });

  $('bg-clear').addEventListener('click', async () => {
    $('bg-url').value = '';
    // 清除背景时删除应用数据中已存储的背景图
    try {
      await new Promise((resolve) => chrome.storage.local.remove('bwh_bg_image_data', resolve));
    } catch (e) {
      /* 忽略 */
    }
    preview();
    toast('已清除背景图片，点击「保存设置」生效');
  });

  for (const [id] of COLOR_FIELDS) $(id).addEventListener('input', preview);
  $('bg-url').addEventListener('input', preview);
  $('auto-sync-enabled').addEventListener('change', preview);
  $('auto-sync-interval').addEventListener('input', preview);

  /* ---------------- 日志查看器 ---------------- */

  const LOG_ORDER = { debug: 0, warn: 1, error: 2 };
  let logFilter = 'all';
  let allLogs = [];

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function formatLogTime(ts) {
    const d = new Date(ts);
    return (
      d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds())
    );
  }

  function filteredLogs() {
    const min = logFilter === 'all' ? 0 : LOG_ORDER[logFilter];
    return allLogs.filter((l) => (LOG_ORDER[l.level] || 0) >= min);
  }

  function renderLogs() {
    const listEl = $('log-list');
    listEl.textContent = '';
    const shown = filteredLogs();
    if (!shown.length) {
      const empty = document.createElement('div');
      empty.className = 'bwh-log-empty';
      empty.textContent = '暂无日志';
      listEl.appendChild(empty);
      return;
    }
    const frag = document.createDocumentFragment();
    // 最新的显示在最上方
    for (const l of shown.slice().reverse()) {
      const item = document.createElement('div');
      item.className = 'bwh-log-item lv-' + (l.level || 'debug');

      const head = document.createElement('div');
      head.className = 'bwh-log-head';
      const time = document.createElement('span');
      time.className = 'bwh-log-time';
      time.textContent = formatLogTime(l.ts);
      const lv = document.createElement('span');
      lv.className = 'bwh-log-lv';
      lv.textContent = String(l.level || 'debug').toUpperCase();
      const tag = document.createElement('span');
      tag.className = 'bwh-log-tag';
      tag.textContent = '[' + (l.tag || '') + ']';
      const msg = document.createElement('span');
      msg.className = 'bwh-log-msg';
      msg.textContent = l.msg;
      head.appendChild(time);
      head.appendChild(lv);
      head.appendChild(tag);
      head.appendChild(msg);
      item.appendChild(head);

      if (l.data !== undefined) {
        const pre = document.createElement('pre');
        pre.className = 'bwh-log-data';
        pre.textContent = typeof l.data === 'string' ? l.data : JSON.stringify(l.data, null, 2);
        item.appendChild(pre);
      }
      frag.appendChild(item);
    }
    listEl.appendChild(frag);
  }

  async function loadLogs() {
    const res = await BWH.send({ type: 'get-logs' });
    if (!res.ok) {
      toast('读取日志失败：' + (res.error || ''), true);
      return;
    }
    allLogs = res.logs || [];
    renderLogs();
  }

  function formatLogs(logs) {
    const lines = [];
    for (const l of logs) {
      let line = '[' + formatLogTime(l.ts) + '] [' + String(l.level || 'debug').toUpperCase() + '] [' + (l.tag || '') + '] ' + l.msg;
      if (l.data !== undefined) {
        line += '\n    ' + (typeof l.data === 'string' ? l.data : JSON.stringify(l.data));
      }
      lines.push(line);
    }
    return lines.join('\n');
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) {
      /* 继续走兜底方案 */
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) {
      return false;
    }
  }

  $('log-refresh').addEventListener('click', loadLogs);

  $('log-login').addEventListener('click', async () => {
    const btn = $('log-login');
    btn.disabled = true;
    const res = await BWH.send({ type: 'check-login' });
    btn.disabled = false;
    if (!res.ok) {
      toast('登录态检查失败：' + (res.error || ''), true);
    } else if (res.isLogin) {
      toast('已登录 B 站：' + (res.uname || '(未知用户)'));
    } else {
      toast('未登录 B 站！同步官方历史需要先登录', true);
    }
    loadLogs();
  });

  $('log-copy').addEventListener('click', async () => {
    const shown = filteredLogs();
    if (!shown.length) {
      toast('暂无日志可复制', true);
      return;
    }
    const text = 'Bilibili 观看记录增强 日志\n筛选: ' + logFilter + '，共 ' + shown.length + ' 条\n\n' + formatLogs(shown);
    const ok = await copyText(text);
    toast(ok ? '日志已复制到剪贴板' : '复制失败，请手动选择复制', !ok);
  });

  $('log-clear').addEventListener('click', async () => {
    if (!confirm('清空全部日志？')) return;
    const res = await BWH.send({ type: 'clear-logs' });
    if (!res.ok) {
      toast('清空失败：' + (res.error || ''), true);
      return;
    }
    allLogs = [];
    renderLogs();
    toast('已清空 ' + res.count + ' 条日志');
  });

  $('log-filters').addEventListener('click', (e) => {
    const btn = e.target.closest('.bwh-log-filter');
    if (!btn) return;
    logFilter = btn.dataset.level;
    document.querySelectorAll('.bwh-log-filter').forEach((b) => {
      b.classList.toggle('active', b === btn);
    });
    renderLogs();
  });

  /* ---------------- 导入（历史记录页 HTML / 导出 JSON） ---------------- */

  function setImportStatus(text, isError) {
    const el = $('import-status');
    el.textContent = text;
    el.className = isError ? 'bwh-status error' : 'bwh-status';
  }

  async function readFileText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('读取文件失败'));
      reader.readAsText(file);
    });
  }

  async function doImport(file, type) {
    if (!file) return;
    setImportStatus('正在解析 ' + file.name + ' …');
    let text;
    try {
      text = await readFileText(file);
    } catch (e) {
      setImportStatus('读取文件失败：' + (e && e.message), true);
      return;
    }
    const res = await BWH.send({ type: type, [type === 'import-html' ? 'html' : 'json']: text });
    if (!res.ok) {
      setImportStatus(type === 'import-html' ? 'HTML 导入失败' : 'JSON 导入失败' + '：' + (res.error || ''), true);
      return;
    }
    setImportStatus(
      (type === 'import-html' ? 'HTML' : 'JSON') +
      ' 导入完成：新增 ' + res.added + ' 条，更新 ' + res.updated + ' 条（解析 ' + res.parsed + ' 条' +
      (res.skipped ? '，跳过 ' + res.skipped : '') + '）'
    );
    loadLogs();
  }

  $('import-html-file').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    doImport(file, 'import-html');
  });

  $('import-json-file').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    doImport(file, 'import-json');
  });

  /* ---------------- 导出与清空 ---------------- */

  function setRecordsStatus(text, isError) {
    const el = $('records-status');
    el.textContent = text;
    el.className = isError ? 'bwh-status error' : 'bwh-status';
  }

  $('export-json').addEventListener('click', async () => {
    const res = await BWH.send({ type: 'export' });
    if (!res.ok || !res.json) {
      setRecordsStatus('导出失败：' + (res.error || ''), true);
      return;
    }
    BWH.downloadJson(res.json, 'bilibili-watch-history-' + new Date().toISOString().slice(0, 10) + '.json');
    setRecordsStatus('已导出 JSON');
  });

  // 清空确认弹窗：需输入 YES 并点击确定才会清除（文字居中）
  function clearRecordsModal() {
    return new Promise((resolve) => {
      const mk = (tag, cls, text) => {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
      };

      const backdrop = mk('div', 'bwh-modal-backdrop');
      const box = mk('div', 'bwh-modal');

      const title = mk('div', 'bwh-modal-title', '确定要清空全部记录吗');
      title.style.textAlign = 'center';

      const body = mk('div', 'bwh-modal-body');
      body.style.textAlign = 'center';
      const line1 = mk('div', '');
      line1.appendChild(document.createTextNode('bilibili中的历史记录'));
      line1.appendChild(mk('strong', '', '不会同步清除'));
      const line2 = mk('div', '');
      line2.appendChild(document.createTextNode('如果确定要清空全部记录，请在下方输入 '));
      line2.appendChild(mk('strong', '', 'YES'));
      body.appendChild(line1);
      body.appendChild(line2);

      const input = mk('input', 'bwh-yes-input');
      input.type = 'text';
      input.placeholder = 'YES';
      input.autocomplete = 'off';

      const actions = mk('div', 'bwh-modal-actions');
      actions.style.justifyContent = 'center';
      const btnCancel = mk('button', 'bwh-btn', '取消');
      const btnOk = mk('button', 'bwh-btn bwh-btn-primary', '确定');
      btnOk.disabled = true;
      actions.appendChild(btnCancel);
      actions.appendChild(btnOk);

      box.appendChild(title);
      box.appendChild(body);
      box.appendChild(input);
      box.appendChild(actions);
      backdrop.appendChild(box);
      document.body.appendChild(backdrop);

      input.addEventListener('input', () => {
        btnOk.disabled = input.value.trim() !== 'YES';
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && input.value.trim() === 'YES') btnOk.click();
      });

      let done = false;
      function close(result) {
        if (done) return;
        done = true;
        backdrop.remove();
        resolve(result);
      }
      btnCancel.addEventListener('click', () => close(false));
      btnOk.addEventListener('click', () => {
        if (input.value.trim() === 'YES') close(true);
      });
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) close(false);
      });
      setTimeout(() => input.focus(), 0);
    });
  }

  $('clear-records').addEventListener('click', async () => {
    const ok = await clearRecordsModal();
    if (!ok) return;
    const res = await BWH.send({ type: 'clear' });
    setRecordsStatus(res.ok ? ('已清空 ' + res.count + ' 条记录') : ('清空失败：' + (res.error || '')), !res.ok);
    loadLogs();
  });

  loadLogs();
  // 每 10 秒自动刷新日志（页面打开期间）
  setInterval(loadLogs, 10000);

  load();
})();
