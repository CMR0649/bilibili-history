(() => {
  'use strict';
  if (window.__bwhContentLoaded) return;
  window.__bwhContentLoaded = true;

  const MINUTE_MS = 60 * 1000;
  const MIN_PLAY_SECONDS = 5; // 观看超过 5 秒即记录

  let currentBvid = '';
  let videoEl = null;
  let played = 0; // 累计播放秒数
  let recorded = false;
  let lastReportedMinute = 0;

  // 上报日志到后台（多等级：debug / warn / error），失败静默
  function sendLog(level, tag, msg) {
    try {
      chrome.runtime.sendMessage({ type: 'log', level: level, tag: tag, msg: msg }).catch(() => {});
    } catch (e) {
      /* 扩展被禁用等情况，忽略 */
    }
  }

  function parseBvid(pathname) {
    const m = (pathname || location.pathname).match(/\/video\/(BV[0-9A-Za-z]+)/);
    return m ? m[1] : '';
  }

  // 兜底方案：从页面 DOM 提取标题、UP主与 UP主mid（API 失败时使用）
  function extractDomInfo() {
    let title = '';
    const h1 = document.querySelector('h1.video-title');
    if (h1) title = (h1.textContent || '').trim();
    if (!title) {
      const t = (document.title || '').replace(/_哔哩哔哩_bilibili\s*$/, '').trim();
      if (t) title = t;
    }
    let up = '';
    let mid = '';
    const upEl = document.querySelector(
      '.up-info-container .name, .up-info-container .up-name, ' +
      '.up-name-text, .up-info .name, a.username'
    );
    if (upEl) up = (upEl.textContent || '').trim();
    // 从 UP主链接中提取 mid（如 //space.bilibili.com/370185591/）
    const midLink = document.querySelector(
      '.up-info-container a[href*="space.bilibili.com"], a.username[href*="space.bilibili.com"]'
    );
    if (midLink) {
      const m = (midLink.getAttribute('href') || '').match(/space\.bilibili\.com\/(\d+)/);
      if (m) mid = m[1];
    }
    return { title: title, up: up, mid: mid };
  }

  function report() {
    if (!currentBvid || played < MIN_PLAY_SECONDS) return;
    const minute = Math.floor(Date.now() / MINUTE_MS);
    if (recorded && minute === lastReportedMinute) return; // 同一分钟内不重复上报
    recorded = true;
    lastReportedMinute = minute;
    const info = extractDomInfo();
    const msg = {
      type: 'record',
      bvid: currentBvid,
      url: 'https://www.bilibili.com/video/' + currentBvid,
      fallback: { title: info.title, up: info.up, mid: info.mid }
    };
    sendLog('debug', 'content', '上报观看 ' + currentBvid + '（已播 ' + Math.round(played) + 's）');
    try {
      chrome.runtime.sendMessage(msg).catch(() => {});
    } catch (e) {
      /* 扩展被禁用等情况，静默忽略 */
    }
  }

  function bindVideo(v) {
    if (videoEl === v) return;
    videoEl = v;
    played = 0;
    recorded = false;
    lastReportedMinute = 0;
    sendLog('debug', 'content', '绑定播放器 ' + currentBvid);
    v.addEventListener(
      'timeupdate',
      () => {
        if (!v.paused && v.currentTime > played) played = v.currentTime;
        if (played >= MIN_PLAY_SECONDS) report();
      },
      { passive: true }
    );
    v.addEventListener(
      'ended',
      () => {
        played = Math.max(played, v.currentTime || 0);
        report();
      },
      { passive: true }
    );
  }

  function scan() {
    const bvid = parseBvid(location.pathname);
    if (!bvid) return;
    if (bvid !== currentBvid) {
      currentBvid = bvid;
      videoEl = null;
      played = 0;
      recorded = false;
      lastReportedMinute = 0;
      sendLog('debug', 'content', '检测到视频页 ' + bvid);
    }
    const v = document.querySelector('video');
    if (v) bindVideo(v);
  }

  // B 站为 Vue SPA：轮询检测路由变化（如从列表切到视频页、连播下一个视频）
  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      currentBvid = '';
      videoEl = null;
      played = 0;
      recorded = false;
      lastReportedMinute = 0;
      scan();
    }
  }, 1000);

  // 离开页面前补一次上报，确保最后观看时间最新
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') report();
  });
  window.addEventListener('pagehide', report);

  // 播放器可能晚于脚本加载，监听 DOM 变化直到找到 video 元素
  const observer = new MutationObserver(scan);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  scan();
})();
