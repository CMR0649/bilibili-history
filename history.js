/*!
 * Bilibili 观看记录增强 —— 独立查询页
 * 打开方式：点击扩展图标 → 「查询页面」，或直接访问
 * chrome-extension://<扩展ID>/history.html
 */
(() => {
  'use strict';
  BWH.createApp(document.body, { standalone: true, autoSync: false });
})();
