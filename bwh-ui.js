/*!
 * Bilibili 观看记录增强 —— 共享 UI 逻辑
 *
 * 同时被以下场景使用：
 *  - 独立查询页 history.html
 *  - 设置页 settings.html
 *
 * 功能：列表 / 网格视图切换（持久化到设置）、按日期筛选（日历日期选择）、
 * 封面从 B 站 API 获取并懒加载（只加载进入视口的封面，通过 IntersectionObserver
 * + 批量请求实现）。
 */
(function (global) {
  'use strict';

  const HOUR_MS = 60 * 60 * 1000;

  const BWH = {};

  /* ---------------- 基础工具 ---------------- */

  BWH.formatHour = function (ts) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return (
      d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':00'
    );
  };

  BWH.send = function (msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (resp) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(resp || { ok: false, error: '无响应' });
          }
        });
      } catch (e) {
        resolve({ ok: false, error: String((e && e.message) || e) });
      }
    });
  };

  BWH.downloadJson = function (json, filename) {
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 500);
  };

  /* ---------------- 主题 / 背景 ---------------- */

  // 把自定义设置以 CSS 变量的形式应用到根元素，并设置背景图片
  BWH.applyTheme = function (root, settings) {
    if (!root) return;
    const t = (settings && settings.theme) || {};
    const style = root.style;
    if (t.primary) style.setProperty('--bwh-pink', t.primary);
    if (t.primaryDark) style.setProperty('--bwh-pink-dark', t.primaryDark);
    if (t.bg) style.setProperty('--bwh-bg', t.bg);
    if (t.card) style.setProperty('--bwh-card', t.card);
    if (t.text) style.setProperty('--bwh-text', t.text);
    if (t.text2) style.setProperty('--bwh-text-2', t.text2);
    if (t.text3) style.setProperty('--bwh-text-3', t.text3);
    if (t.border) style.setProperty('--bwh-border', t.border);

    const img = settings && settings.backgroundImage;
    if (img) {
      style.backgroundImage = 'url("' + String(img).replace(/"/g, '%22') + '")';
      style.backgroundSize = 'cover';
      style.backgroundPosition = 'center';
      style.backgroundRepeat = 'no-repeat';
      style.backgroundAttachment = 'fixed';
    } else {
      style.backgroundImage = 'none';
      style.backgroundSize = '';
      style.backgroundPosition = '';
      style.backgroundRepeat = '';
      style.backgroundAttachment = '';
    }
  };

  // 读取设置并应用（忽略失败）
  BWH.applyStoredTheme = async function (root) {
    const res = await BWH.send({ type: 'get-settings' });
    if (res && res.ok && res.settings) {
      BWH.applyTheme(root, res.settings);
      return res.settings;
    }
    return null;
  };

  /* ---------------- 内部 DOM 工具 ---------------- */

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  BWH.showToast = function (root, msg, isError) {
    let t = root.querySelector('.bwh-toast');
    if (!t) {
      t = el('div', 'bwh-toast');
      root.appendChild(t);
    }
    t.textContent = msg;
    t.classList.toggle('error', !!isError);
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), 2600);
  };

  /* ---------------- 封面懒加载 ---------------- */

  function bvidOf(record) {
    const m = String(record.url || '').match(/\/video\/(BV[0-9A-Za-z]+)/);
    return m ? m[1] : '';
  }

  function setCoverImg(coverEl, url) {
    const img = coverEl.querySelector('.bwh-cover-img');
    if (!img || img.getAttribute('data-loaded') === url) return;
    img.setAttribute('data-loaded', url);
    img.onload = () => {
      img.hidden = false;
    };
    img.onerror = () => {
      img.hidden = true;
    };
    img.src = url;
  }

  // 封面懒加载核心：只为进入视口的项目请求封面（批量、去重）
  function createCoverLoader(app) {
    const state = {
      covers: {}, // bvid -> url（页面级缓存）
      pending: new Set(), // 已排队待请求的 bvid
      failed: new Set(), // 已请求但无封面的 bvid（避免反复请求）
      batchTimer: null,
      observer: null
    };

    function flush() {
      const batch = Array.from(state.pending).slice(0, 50);
      for (const b of batch) state.pending.delete(b);
      if (!batch.length) return;
      BWH.send({ type: 'get-covers', bvids: batch }).then((res) => {
        const got = (res && res.ok && res.covers) || {};
        for (const b of batch) {
          if (got[b]) state.covers[b] = got[b];
          else state.failed.add(b);
        }
        // 给已挂载且属于本批的封面元素设置图片
        app.root.querySelectorAll('.bwh-cover[data-bvid]').forEach((coverEl) => {
          const bvid = coverEl.getAttribute('data-bvid');
          if (got[bvid]) setCoverImg(coverEl, got[bvid]);
        });
      });
    }

    function ensure(coverEl) {
      const bvid = coverEl.getAttribute('data-bvid');
      if (!bvid) return;
      if (state.covers[bvid]) {
        setCoverImg(coverEl, state.covers[bvid]);
        return;
      }
      if (state.failed.has(bvid) || state.pending.has(bvid)) return; // 已失败或已在队列中
      state.pending.add(bvid);
      clearTimeout(state.batchTimer);
      state.batchTimer = setTimeout(flush, 80); // 合并为一次批量请求
    }

    function observe() {
      const covers = app.root.querySelectorAll('.bwh-cover[data-bvid]');
      if (typeof IntersectionObserver === 'undefined') {
        // 不支持 IntersectionObserver 时直接加载
        covers.forEach((coverEl) => ensure(coverEl));
        return;
      }
      if (state.observer) state.observer.disconnect();
      state.observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) ensure(entry.target);
          }
        },
        { rootMargin: '300px 0px' } // 提前 300px 加载，滚动无感
      );
      covers.forEach((coverEl) => state.observer.observe(coverEl));
    }

    return { state: state, ensure: ensure, observe: observe, flush: flush };
  }

  /* ---------------- 应用 ---------------- */

  BWH.createApp = function (root, opts) {
    const app = { root: root, opts: opts || {} };

    const wrap = el('div', 'bwh-wrap');

    // 头部：标题 + 计数 + 搜索框 + 操作按钮
    const header = el('div', 'bwh-header');
    header.appendChild(el('div', 'bwh-header-title', 'B站观看记录'));
    const countBadge = el('div', 'bwh-header-sub', '');
    header.appendChild(countBadge);

    const search = el('input', 'bwh-search');
    search.type = 'text';
    search.placeholder = '搜索视频标题 / UP主';
    header.appendChild(search);

    const actions = el('div', 'bwh-actions');
    const btnView = el('button', 'bwh-btn', '网格');
    const btnSettings = el('button', 'bwh-btn', '设置');
    const btnSync = el('button', 'bwh-btn', '同步B站记录');
    actions.appendChild(btnView);
    actions.appendChild(btnSettings);
    actions.appendChild(btnSync);
    header.appendChild(actions);
    wrap.appendChild(header);

    // 按日期筛选（日历样式日期选择）
    const filterRow = el('div', 'bwh-filter-row');
    filterRow.appendChild(el('span', 'bwh-filter-label', '按日期：'));
    const dateFrom = el('input', 'bwh-date');
    dateFrom.type = 'date';
    const dateTo = el('input', 'bwh-date');
    dateTo.type = 'date';
    const btnClearDate = el('button', 'bwh-btn bwh-btn-clear-date', '清除日期筛选');
    filterRow.appendChild(dateFrom);
    filterRow.appendChild(el('span', 'bwh-filter-sep', '至'));
    filterRow.appendChild(dateTo);
    filterRow.appendChild(btnClearDate);
    wrap.appendChild(filterRow);

    const status = el('div', 'bwh-status', '');
    wrap.appendChild(status);

    const list = el('div', 'bwh-list');
    wrap.appendChild(list);

    const empty = el('div', 'bwh-empty', '暂无观看记录，去 B 站看个视频吧~');
    empty.hidden = true;
    wrap.appendChild(empty);

    root.appendChild(wrap);
    root.appendChild(el('div', 'bwh-toast'));

    app.elements = { search, status, list, empty, countBadge, filterRow };
    app.state = { records: [], query: '', viewMode: 'list', dateFrom: '', dateTo: '' };
    app.covers = createCoverLoader(app);

    app.setStatus = function (text, isError) {
      status.textContent = text || '';
      status.classList.toggle('error', !!isError);
    };

    app.refresh = async function (silent) {
      const res = await BWH.send({ type: 'get-records' });
      if (!res.ok) {
        app.setStatus('读取记录失败：' + (res.error || ''), true);
        return;
      }
      app.state.records = res.records || [];
      if (!silent) app.render();
    };

    // 日期区间判断（本地日期，含边界）
    function inDateRange(ts, from, to) {
      if (!from && !to) return true;
      const d = new Date(ts);
      const ymd =
        d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
      if (from && ymd < from) return false;
      if (to && ymd > to) return false;
      return true;
    }

    app.render = function () {
      const q = app.state.query.trim().toLowerCase();
      const { dateFrom: df, dateTo: dt } = app.state;
      const records = app.state.records.filter((r) => {
        if (q && (r.title || '').toLowerCase().indexOf(q) < 0 && (r.up || '').toLowerCase().indexOf(q) < 0) {
          return false;
        }
        return inDateRange(r.lastWatchedAt, df, dt);
      });
      const filtered = (app.state.dateFrom || app.state.dateTo) ? records.length : null;
      countBadge.textContent = filtered == null
        ? '共 ' + app.state.records.length + ' 条'
        : '共 ' + app.state.records.length + ' 条（筛选 ' + filtered + ' 条）';
      list.textContent = '';
      empty.hidden = records.length > 0;
      for (const r of records) {
        list.appendChild(renderItem(app, r));
      }
      applyViewMode();
      app.covers.observe(); // 只观察当前 DOM 中的封面，视口外的不会触发请求
    };

    function applyViewMode() {
      list.classList.toggle('bwh-grid', app.state.viewMode === 'grid');
      btnView.textContent = app.state.viewMode === 'grid' ? '列表' : '网格';
    }

    function renderItem(app, r) {
      const item = el('div', 'bwh-item');
      const bvid = bvidOf(r);

      // 封面：先占位，懒加载到视口后再从 API 获取并显示
      const cover = el('div', 'bwh-cover');
      cover.setAttribute('data-bvid', bvid);
      cover.appendChild(el('span', 'bwh-cover-fallback', (r.title || '?').trim().charAt(0)));
      const img = el('img', 'bwh-cover-img');
      img.alt = '';
      img.hidden = true;
      img.loading = 'lazy';
      cover.appendChild(img);
      cover.appendChild(el('i', ''));
      item.appendChild(cover);

      const info = el('div', 'bwh-info');
      const titleLink = el('a', 'bwh-title', r.title || '(无标题)');
      titleLink.href = r.url || '#';
      titleLink.target = '_blank';
      titleLink.rel = 'noopener noreferrer';
      titleLink.title = r.title || '';
      info.appendChild(titleLink);

      const meta = el('div', 'bwh-meta');
      meta.appendChild(el('span', 'bwh-up', 'UP主：' + (r.up || '未知')));
      meta.appendChild(el('span', 'bwh-time', '最后观看：' + BWH.formatHour(r.lastWatchedAt)));
      info.appendChild(meta);
      item.appendChild(info);

      const del = el('button', 'bwh-del', '删除');
      del.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!confirm('确定删除这条记录吗？')) return;
        const res = await BWH.send({ type: 'remove', url: r.url });
        BWH.showToast(root, res.ok ? '已删除' : ('删除失败：' + (res.error || '')), !res.ok);
        if (res.ok) app.refresh();
      });
      item.appendChild(del);

      return item;
    }

    /* ---------------- 事件绑定 ---------------- */

    search.addEventListener('input', () => {
      app.state.query = search.value;
      app.render();
    });

    btnView.addEventListener('click', async () => {
      const next = app.state.viewMode === 'grid' ? 'list' : 'grid';
      app.state.viewMode = next;
      app.render();
      // 持久化视图模式
      const res = await BWH.send({ type: 'get-settings' });
      if (res.ok && res.settings) {
        res.settings.viewMode = next;
        await BWH.send({ type: 'save-settings', settings: res.settings });
      }
    });

    btnSettings.addEventListener('click', () => {
      BWH.send({ type: 'open-settings' });
    });

    btnSync.addEventListener('click', async () => {
      btnSync.disabled = true;
      btnSync.textContent = '同步中…';
      const res = await BWH.send({ type: 'sync-from-bili' });
      btnSync.disabled = false;
      btnSync.textContent = '同步B站记录';
      if (!res.ok) {
        BWH.showToast(root, '同步失败：' + (res.error || '请确认已登录B站'), true);
        return;
      }
      BWH.showToast(
        root,
        '同步完成：新增 ' + res.added + ' 条，更新 ' + res.updated + ' 条（共 ' + res.total + ' 条）'
      );
      app.refresh();
    });

    // 按日期筛选（日历样式日期选择）
    dateFrom.addEventListener('change', () => {
      app.state.dateFrom = dateFrom.value || '';
      app.render();
    });
    dateTo.addEventListener('change', () => {
      app.state.dateTo = dateTo.value || '';
      app.render();
    });
    btnClearDate.addEventListener('click', () => {
      dateFrom.value = '';
      dateTo.value = '';
      app.state.dateFrom = '';
      app.state.dateTo = '';
      app.render();
    });

    /* ---------------- 初始化 ---------------- */

    app.refresh(true).then(() => app.render());

    // 应用自定义主题与背景图片，并恢复视图模式
    BWH.applyStoredTheme(root).then((settings) => {
      app.settings = settings;
      if (settings && settings.viewMode === 'grid') {
        app.state.viewMode = 'grid';
        app.render();
      }
    });

    return app;
  };

  /* ---------------- 导出 ---------------- */

  if (typeof module !== 'undefined' && module.exports) module.exports = BWH;
  global.BWH = BWH;
})(typeof globalThis !== 'undefined' ? globalThis : this);
