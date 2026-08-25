'use strict';

const STORAGE_KEY = 'bwh_records_v1';
const STORAGE_KEY_SETTINGS = 'bwh_settings_v1';
const STORAGE_KEY_LOGS = 'bwh_logs_v1';
const AUTO_SYNC_ALARM = 'bwh-auto-sync';
const APP_NAME = 'bilibili-watch-history';
const APP_VERSION = '1.3.0';
const MINUTE_MS = 60 * 1000;
const API_BASE = 'https://api.bilibili.com';
const LOG_CAP = 500;

const DEFAULT_SETTINGS = {
  theme: {
    primary: '#fb7299',
    primaryDark: '#f25d8e',
    bg: '#f1f2f3',
    card: '#ffffff',
    text: '#18191c',
    text2: '#61666d',
    text3: '#9499a0',
    border: '#e3e5e7'
  },
  backgroundImage: '',
  autoSync: { enabled: false, intervalMinutes: 60 },
  viewMode: 'list', // 列表 / 网格
  lastSyncAt: 0
};

/* ---------------- 日志（多等级：debug / warn / error） ---------------- */

let logBuffer = [];
let logFlushTimer = null;

function log(level, tag, msg, data) {
  const entry = {
    ts: Date.now(),
    level: level === 'warn' || level === 'error' ? level : 'debug',
    tag: String(tag || ''),
    msg: String(msg || ''),
    data: data === undefined ? undefined : safeData(data)
  };
  logBuffer.push(entry);
  if (logBuffer.length > LOG_CAP) {
    logBuffer.splice(0, logBuffer.length - LOG_CAP);
  }
  scheduleLogFlush();
}

function safeData(data) {
  try {
    return JSON.parse(JSON.stringify(data));
  } catch (e) {
    return String(data);
  }
}

function scheduleLogFlush() {
  if (logFlushTimer) return;
  logFlushTimer = setTimeout(() => {
    logFlushTimer = null;
    flushLogs().catch(() => {});
  }, 200);
}

async function flushLogs() {
  if (!logBuffer.length) return;
  const batch = logBuffer.splice(0, logBuffer.length);
  try {
    const existing = await storageGet(STORAGE_KEY_LOGS);
    const arr = Array.isArray(existing) ? existing : [];
    arr.push.apply(arr, batch);
    if (arr.length > LOG_CAP) arr.splice(0, arr.length - LOG_CAP);
    await storageSet({ [STORAGE_KEY_LOGS]: arr });
  } catch (e) {
    /* 日志写入失败不影响主流程 */
  }
}

async function getLogs() {
  await flushLogs();
  const existing = await storageGet(STORAGE_KEY_LOGS);
  return Array.isArray(existing) ? existing : [];
}

async function clearLogs() {
  const count = (await getLogs()).length;
  logBuffer = [];
  await storageSet({ [STORAGE_KEY_LOGS]: [] });
  return count;
}

/* ---------------- MD5（WBI 签名需要） ---------------- */

const hexChr = '0123456789abcdef'.split('');

function add32(a, b) {
  return (a + b) & 0xffffffff;
}

function cmn(q, a, b, x, s, t) {
  a = add32(add32(a, q), add32(x, t));
  return add32((a << s) | (a >>> (32 - s)), b);
}
function ff(a, b, c, d, x, s, t) { return cmn((b & c) | (~b & d), a, b, x, s, t); }
function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & ~d), a, b, x, s, t); }
function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | ~d), a, b, x, s, t); }

function md5blk(s) {
  const md5blks = [];
  for (let i = 0; i < 64; i += 4) {
    md5blks[i >> 2] =
      s.charCodeAt(i) +
      (s.charCodeAt(i + 1) << 8) +
      (s.charCodeAt(i + 2) << 16) +
      (s.charCodeAt(i + 3) << 24);
  }
  return md5blks;
}

function md5cycle(x, k) {
  let a = x[0];
  let b = x[1];
  let c = x[2];
  let d = x[3];

  a = ff(a, b, c, d, k[0], 7, -680876936);
  d = ff(d, a, b, c, k[1], 12, -389564586);
  c = ff(c, d, a, b, k[2], 17, 606105819);
  b = ff(b, c, d, a, k[3], 22, -1044525330);
  a = ff(a, b, c, d, k[4], 7, -176418897);
  d = ff(d, a, b, c, k[5], 12, 1200080426);
  c = ff(c, d, a, b, k[6], 17, -1473231341);
  b = ff(b, c, d, a, k[7], 22, -45705983);
  a = ff(a, b, c, d, k[8], 7, 1770035416);
  d = ff(d, a, b, c, k[9], 12, -1958414417);
  c = ff(c, d, a, b, k[10], 17, -42063);
  b = ff(b, c, d, a, k[11], 22, -1990404162);
  a = ff(a, b, c, d, k[12], 7, 1804603682);
  d = ff(d, a, b, c, k[13], 12, -40341101);
  c = ff(c, d, a, b, k[14], 17, -1502002290);
  b = ff(b, c, d, a, k[15], 22, 1236535329);

  a = gg(a, b, c, d, k[1], 5, -165796510);
  d = gg(d, a, b, c, k[6], 9, -1069501632);
  c = gg(c, d, a, b, k[11], 14, 643717713);
  b = gg(b, c, d, a, k[0], 20, -373897302);
  a = gg(a, b, c, d, k[5], 5, -701558691);
  d = gg(d, a, b, c, k[10], 9, 38016083);
  c = gg(c, d, a, b, k[15], 14, -660478335);
  b = gg(b, c, d, a, k[4], 20, -405537848);
  a = gg(a, b, c, d, k[9], 5, 568446438);
  d = gg(d, a, b, c, k[14], 9, -1019803690);
  c = gg(c, d, a, b, k[3], 14, -187363961);
  b = gg(b, c, d, a, k[8], 20, 1163531501);
  a = gg(a, b, c, d, k[13], 5, -1444681467);
  d = gg(d, a, b, c, k[2], 9, -51403784);
  c = gg(c, d, a, b, k[7], 14, 1735328473);
  b = gg(b, c, d, a, k[12], 20, -1926607734);

  a = hh(a, b, c, d, k[5], 4, -378558);
  d = hh(d, a, b, c, k[8], 11, -2022574463);
  c = hh(c, d, a, b, k[11], 16, 1839030562);
  b = hh(b, c, d, a, k[14], 23, -35309556);
  a = hh(a, b, c, d, k[1], 4, -1530992060);
  d = hh(d, a, b, c, k[4], 11, 1272893353);
  c = hh(c, d, a, b, k[7], 16, -155497632);
  b = hh(b, c, d, a, k[10], 23, -1094730640);
  a = hh(a, b, c, d, k[13], 4, 681279174);
  d = hh(d, a, b, c, k[0], 11, -358537222);
  c = hh(c, d, a, b, k[3], 16, -722521979);
  b = hh(b, c, d, a, k[6], 23, 76029189);
  a = hh(a, b, c, d, k[9], 4, -640364487);
  d = hh(d, a, b, c, k[12], 11, -421815835);
  c = hh(c, d, a, b, k[15], 16, 530742520);
  b = hh(b, c, d, a, k[2], 23, -995338651);

  a = ii(a, b, c, d, k[0], 6, -198630844);
  d = ii(d, a, b, c, k[7], 10, 1126891415);
  c = ii(c, d, a, b, k[14], 15, -1416354905);
  b = ii(b, c, d, a, k[5], 21, -57434055);
  a = ii(a, b, c, d, k[12], 6, 1700485571);
  d = ii(d, a, b, c, k[3], 10, -1894986606);
  c = ii(c, d, a, b, k[10], 15, -1051523);
  b = ii(b, c, d, a, k[1], 21, -2054922799);
  a = ii(a, b, c, d, k[8], 6, 1873313359);
  d = ii(d, a, b, c, k[15], 10, -30611744);
  c = ii(c, d, a, b, k[6], 15, -1560198380);
  b = ii(b, c, d, a, k[13], 21, 1309151649);
  a = ii(a, b, c, d, k[4], 6, -145523070);
  d = ii(d, a, b, c, k[11], 10, -1120210379);
  c = ii(c, d, a, b, k[2], 15, 718787259);
  b = ii(b, c, d, a, k[9], 21, -343485551);

  x[0] = add32(a, x[0]);
  x[1] = add32(b, x[1]);
  x[2] = add32(c, x[2]);
  x[3] = add32(d, x[3]);
}

function rhex(n) {
  let s = '';
  for (let j = 0; j < 4; j++) {
    s += hexChr[(n >> (j * 8 + 4)) & 0x0f] + hexChr[(n >> (j * 8)) & 0x0f];
  }
  return s;
}

function md5(s) {
  const str = String(s);
  const n = str.length;
  const state = [1732584193, -271733879, -1732584194, 271733878];
  let i;
  for (i = 64; i <= str.length; i += 64) {
    md5cycle(state, md5blk(str.substring(i - 64, i)));
  }
  let tail = str.substring(i - 64);
  const words = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let j = 0; j < tail.length; j++) {
    words[j >> 2] |= tail.charCodeAt(j) << ((j % 4) << 3);
  }
  words[tail.length >> 2] |= 0x80 << ((tail.length % 4) << 3);
  if (tail.length > 55) {
    md5cycle(state, words);
    for (let j = 0; j < 16; j++) words[j] = 0;
  }
  words[14] = n * 8;
  md5cycle(state, words);
  let hexOut = '';
  for (let j = 0; j < state.length; j++) hexOut += rhex(state[j]);
  return hexOut;
}

/* ---------------- WBI 签名 ---------------- */

// 官方 mixin key 置换表（bilibili-API-collect）
const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
  61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
  36, 20, 34, 44, 52
];

function getMixinKey(orig) {
  return MIXIN_KEY_ENC_TAB.map((n) => orig[n]).join('').slice(0, 32);
}

// 对参数签名，返回完整 query（含 wts 与签名参数；参数名默认 w_rid，可指定 wbi_sign）
function encWbi(params, imgKey, subKey, signName) {
  const mixinKey = getMixinKey(imgKey + subKey);
  const wts = Math.floor(Date.now() / 1000);
  const name = signName === 'wbi_sign' ? 'wbi_sign' : 'w_rid';
  const p = Object.assign({}, params, { wts: wts });
  const query = Object.keys(p)
    .sort()
    .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(String(p[k])).replace(/[!'()*]/g, ''))
    .join('&');
  const wbiSign = md5(query + mixinKey);
  return query + '&' + name + '=' + wbiSign;
}

let wbiKeysCache = null;
let wbiKeysAt = 0;
const WBI_CACHE_MS = 6 * 60 * 60 * 1000;

// 从 nav 接口获取 wbi 密钥（公开接口，无需登录）
async function getWbiKeys() {
  if (wbiKeysCache && Date.now() - wbiKeysAt < WBI_CACHE_MS) return wbiKeysCache;
  try {
    const json = await apiFetch(API_BASE + '/x/web-interface/nav');
    const wbiImg = json.data && json.data.wbi_img;
    const img = (wbiImg && wbiImg.img_url) || '';
    const sub = (wbiImg && wbiImg.sub_url) || '';
    const imgKey = ((img.match(/([0-9a-f]{32})\.png/) || [])[1] || '').trim();
    const subKey = ((sub.match(/([0-9a-f]{32})\.png/) || [])[1] || '').trim();
    if (!imgKey || !subKey) throw new Error('wbi 密钥缺失');
    wbiKeysCache = { imgKey: imgKey, subKey: subKey };
    wbiKeysAt = Date.now();
    log('debug', 'wbi', '获取 WBI 密钥成功');
    return wbiKeysCache;
  } catch (e) {
    log('warn', 'wbi', '获取 WBI 密钥失败，将使用无签名请求', (e && e.message) || String(e));
    return null;
  }
}

// 上次成功的历史接口请求模式，下次优先尝试
let historyModeCache = null;

async function buildHistoryUrl(params, mode) {
  const base = API_BASE + '/x/web-interface/history/cursor';
  const qs = (p) =>
    Object.keys(p)
      .sort()
      .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(String(p[k])))
      .join('&');
  const p = Object.assign({}, params);
  if (mode === 'plain-nobiz') delete p.business;
  if (mode === 'w_rid' || mode === 'wbi_sign') {
    const keys = await getWbiKeys();
    if (keys) {
      try {
        return base + '?' + encWbi(p, keys.imgKey, keys.subKey, mode);
      } catch (e) {
        log('warn', 'wbi', 'WBI 签名失败: ' + mode, (e && e.message) || String(e));
      }
    }
  }
  return base + '?' + qs(p);
}

async function buildHistoryAttemptUrls(params) {
  const modes = ['w_rid', 'wbi_sign', 'plain', 'plain-nobiz'];
  if (historyModeCache && modes.indexOf(historyModeCache) >= 0) {
    modes.splice(modes.indexOf(historyModeCache), 1);
    modes.unshift(historyModeCache);
  }
  const urls = [];
  for (const mode of modes) urls.push(await buildHistoryUrl(params, mode));
  return urls;
}

function modeOfUrl(url) {
  if (url.indexOf('w_rid=') >= 0) return 'w_rid';
  if (url.indexOf('wbi_sign=') >= 0) return 'wbi_sign';
  return url.indexOf('business=') >= 0 ? 'plain' : 'plain-nobiz';
}

// 历史接口请求回退链：w_rid 签名 → wbi_sign 签名 → 无签名 → 无签名且去掉 business
// 遇到 -400/-403/-352（签名/参数/风控问题）时自动尝试下一种方式，并记住成功方式下次优先
async function fetchHistoryWithFallback(params) {
  const urls = await buildHistoryAttemptUrls(params);
  let lastErr = null;
  for (const url of urls) {
    try {
      const json = await apiFetch(url);
      historyModeCache = modeOfUrl(url);
      log('debug', 'sync', '历史接口请求成功（模式: ' + historyModeCache + '）');
      return json;
    } catch (e) {
      lastErr = e;
      if (e.code === -400 || e.code === -403 || e.code === -352) continue; // 尝试下一种方式
      throw e; // 其他错误（网络、未登录等）直接抛出
    }
  }
  log('error', 'sync', '历史接口所有请求方式均失败', (lastErr && lastErr.message) || String(lastErr));
  throw lastErr || new Error('历史接口请求失败');
}

/* ---------------- 工具 ---------------- */

function truncateToMinute(ts) {
  return Math.floor(ts / MINUTE_MS) * MINUTE_MS;
}

function canonicalizeUrl(url) {
  return String(url || '').split(/[?#]/)[0].replace(/\/+$/, '');
}

function videoUrl(bvid) {
  return 'https://www.bilibili.com/video/' + bvid;
}

function clampInterval(v) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 1) return 60;
  return Math.min(n, 10080); // 最多一周
}

/* av → BV 转换（bilibili-API-collect 算法），部分历史接口只返回 aid */
function av2bv(aid) {
  const XOR_CODE = 23442827791579n;
  const MAX_AID = 1n << 51n;
  const BASE = 58n;
  const TABLE = 'FcwAPNKTMug3GV5Lj7EJnHpWsx4tb8haYeviqBz6rkCy12mUSDQX9RdoZf';
  const bytes = ['B', 'V', '1', '0', '0', '0', '0', '0', '0', '0', '0', '0'];
  let bvIndex = bytes.length - 1;
  let tmp = (MAX_AID | BigInt(aid)) ^ XOR_CODE;
  while (tmp > 0n) {
    bytes[bvIndex] = TABLE[Number(tmp % BASE)];
    tmp = tmp / BASE;
    bvIndex -= 1;
  }
  let t = bytes[3];
  bytes[3] = bytes[9];
  bytes[9] = t;
  t = bytes[4];
  bytes[4] = bytes[7];
  bytes[7] = t;
  return bytes.join('');
}

function av2bvSafe(aid) {
  try {
    return av2bv(aid);
  } catch (e) {
    return '';
  }
}

/* ---------------- B 站 API ---------------- */

const API_HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'Referer': 'https://www.bilibili.com/'
};

async function apiFetch(url, opts) {
  log('debug', 'api', '请求: ' + url);
  let resp;
  try {
    resp = await fetch(url, Object.assign({ credentials: 'include', headers: API_HEADERS }, opts || {}));
  } catch (e) {
    log('error', 'api', '网络错误: ' + url, (e && e.message) || String(e));
    throw new Error('网络错误: ' + ((e && e.message) || e));
  }
  const text = await resp.text().catch(() => '');
  if (!resp.ok) {
    log('error', 'api', 'HTTP ' + resp.status + ': ' + url, text.slice(0, 300));
    throw new Error('HTTP ' + resp.status);
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    log('error', 'api', '响应非 JSON: ' + url, text.slice(0, 300));
    throw new Error('响应非 JSON');
  }
  if (json && typeof json.code === 'number' && json.code !== 0) {
    const lv = json.code === -101 ? 'warn' : 'error';
    log(lv, 'api', 'code=' + json.code + ' (' + (json.message || '') + '): ' + url, { body: text.slice(0, 200) });
    const err = new Error(json.message || ('code ' + json.code));
    err.code = json.code;
    throw err;
  }
  return json;
}

// 获取视频信息（标题 / UP主 / UP主mid / 封面）—— 优先使用 API
async function fetchViewByBvid(bvid) {
  const url = API_BASE + '/x/web-interface/view?bvid=' + encodeURIComponent(bvid);
  const json = await apiFetch(url);
  const d = json.data;
  if (!d) throw new Error('view API 无数据');
  return {
    title: String(d.title || '').trim(),
    up: String((d.owner && d.owner.name) || '').trim(),
    mid: String((d.owner && d.owner.mid) || ''),
    pic: String(d.pic || '')
  };
}

// 拉取官方观看历史（回退接口：x/web-interface/history/cursor，自动尝试 WBI 签名与无签名方式）
async function fetchHistoryCursor(maxPages) {
  log('debug', 'sync', '使用 cursor 接口拉取官方观看历史');
  const all = [];
  let max = 0;
  let viewAt = 0;
  for (let i = 0; i < maxPages; i++) {
    const params = { ps: 50, business: 'archive' };
    if (max > 0) {
      params.max = max;
      params.view_at = viewAt;
    }
    const json = await fetchHistoryWithFallback(params);
    const data = json.data || {};
    const list = data.list || [];
    all.push.apply(all, list);
    log('debug', 'sync', 'cursor 第 ' + (i + 1) + ' 页拉取 ' + list.length + ' 条');
    const cursor = data.cursor || {};
    if (!list.length || !cursor.max || cursor.max <= 0) break;
    max = cursor.max;
    viewAt = cursor.view_at || 0;
  }
  log('debug', 'sync', 'cursor 接口共拉取 ' + all.length + ' 条');
  return all;
}

// x/v2/history：pn 分页（1~4），接口返回上限约 300 条（约 75 条/页）
async function fetchHistoryV2(maxPages) {
  log('debug', 'sync', '使用 x/v2/history 接口拉取官方观看历史');
  const all = [];
  for (let pn = 1; pn <= maxPages; pn++) {
    const params = { pn: pn }; // 与官方约定一致：https://api.bilibili.com/x/v2/history?pn=N
    const json = await fetchV2WithFallback(params);
    const list = extractV2List(json);
    if (pn === 1) {
      // 记录响应结构，便于排查接口变更
      const d = json && json.data;
      log(
        'debug',
        'sync',
        'v2 响应 data 结构: ' +
          (Array.isArray(d) ? 'array(' + d.length + ')' : (d && typeof d === 'object' ? 'object，键: ' + Object.keys(d).slice(0, 10).join(',') : String(typeof d)))
      );
    }
    all.push.apply(all, list);
    log('debug', 'sync', 'x/v2/history 第 ' + pn + ' 页拉取 ' + list.length + ' 条');
    if (!list.length) break; // 空页 = 已到末尾
  }
  log('debug', 'sync', 'x/v2/history 共拉取 ' + all.length + ' 条');
  return all;
}

// 兼容多种 v2 响应结构：data 数组 / { list } / { items } / { data }
function extractV2List(json) {
  const d = json && json.data;
  if (Array.isArray(d)) return d;
  if (d && typeof d === 'object') {
    for (const key of ['list', 'items', 'vlist', 'data']) {
      if (Array.isArray(d[key])) return d[key];
    }
  }
  return [];
}

// x/v2/history 请求回退链：无签名 → w_rid 签名 → wbi_sign 签名
async function fetchV2WithFallback(params) {
  const base = API_BASE + '/x/v2/history';
  const qs = (p) =>
    Object.keys(p)
      .sort()
      .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(String(p[k])))
      .join('&');
  const urls = [base + '?' + qs(params)];
  const keys = await getWbiKeys();
  if (keys) {
    try {
      urls.push(base + '?' + encWbi(params, keys.imgKey, keys.subKey, 'w_rid'));
    } catch (e) { /* 忽略签名失败 */ }
    try {
      urls.push(base + '?' + encWbi(params, keys.imgKey, keys.subKey, 'wbi_sign'));
    } catch (e) { /* 忽略签名失败 */ }
  }
  let lastErr = null;
  for (const url of urls) {
    try {
      const json = await apiFetch(url);
      log('debug', 'sync', 'x/v2/history 请求成功');
      return json;
    } catch (e) {
      lastErr = e;
      if (e.code === -400 || e.code === -403 || e.code === -352) continue; // 尝试下一种方式
      throw e; // 其他错误（网络、未登录等）直接抛出
    }
  }
  log('error', 'sync', 'x/v2/history 所有请求方式均失败', (lastErr && lastErr.message) || String(lastErr));
  throw lastErr || new Error('x/v2/history 请求失败');
}

// 同步入口：优先 x/v2/history，失败时回退 cursor 接口
async function fetchOfficialHistory(maxPages) {
  log('debug', 'sync', '开始同步官方观看历史');
  try {
    return await fetchHistoryV2(maxPages);
  } catch (e) {
    log('warn', 'sync', 'x/v2/history 拉取失败，回退 cursor 接口', (e && e.message) || String(e));
  }
  return await fetchHistoryCursor(maxPages);
}

function extractBvid(item) {
  if (!item) return '';
  const raw = item.bvid || (item.history && item.history.bvid) || '';
  if (typeof raw === 'string' && /^BV[0-9A-Za-z]+$/.test(raw)) return raw;
  // 从链接字段提取（部分条目只带链接）
  const link = String(item.url || item.redirect_link || item.short_link || '');
  const m = link.match(/\/video\/(BV[0-9A-Za-z]+)/);
  if (m) return m[1];
  // aid → bvid
  if (item.aid) return av2bvSafe(Number(item.aid));
  return '';
}

function itemToRecord(item) {
  if (!item) return null;
  const bvid = extractBvid(item);
  const title = String(item.title || item.name || item.long_title || '').trim();
  if (!bvid || !title) return null;
  // 仅排除明确的非投稿视频业务类型；其余（含未知业务）一律记录，避免误判为重复/被过滤
  const business = String(item.business || '');
  if (business === 'pgc' || business === 'cheese' || business === 'bangumi') return null;
  const up = String(
    item.author_name || item.owner_name || item.up_name ||
    (item.author && item.author.name) ||
    (item.owner && item.owner.name) || ''
  ).trim();
  const mid = String(
    (item.owner && item.owner.mid) || item.author_mid || item.mid || ''
  );
  const rawViewAt = Number(item.view_at);
  const viewAt = rawViewAt > 1e12 ? rawViewAt : rawViewAt * 1000; // 兼容秒 / 毫秒
  return {
    title: title,
    bvid: bvid,
    up: up,
    mid: mid,
    lastWatchedAt: truncateToMinute(viewAt || Date.now())
  };
}

/* ---------------- 封面缓存（独立于记录存储，保持记录只有 4 个字段） ---------------- */

const COVER_CACHE_KEY = 'bwh_cover_cache_v1';
const coverCache = new Map(); // bvid -> 封面 url
let coverCacheLoaded = false;

async function loadCoverCache() {
  if (coverCacheLoaded) return;
  coverCacheLoaded = true;
  try {
    if (!chrome.storage || !chrome.storage.session) return;
    const raw = await new Promise((resolve) => {
      chrome.storage.session.get(COVER_CACHE_KEY, (res) => resolve(res && res[COVER_CACHE_KEY]));
    });
    if (raw && typeof raw === 'object') {
      for (const k of Object.keys(raw)) {
        if (typeof raw[k] === 'string' && raw[k]) coverCache.set(k, raw[k]);
      }
    }
  } catch (e) {
    /* session 存储不可用时仅使用内存缓存 */
  }
}

async function saveCoverCache() {
  try {
    if (!chrome.storage || !chrome.storage.session) return;
    const obj = {};
    const entries = Array.from(coverCache.entries());
    for (const [k, v] of entries.slice(-300)) obj[k] = v;
    await new Promise((resolve) => chrome.storage.session.set({ [COVER_CACHE_KEY]: obj }, resolve));
  } catch (e) {
    /* 忽略 */
  }
}

// 获取单个封面（缓存命中直接返回；失败返回空串）
async function fetchCover(bvid) {
  await loadCoverCache();
  if (coverCache.has(bvid)) return coverCache.get(bvid);
  try {
    const info = await fetchViewByBvid(bvid);
    if (info.pic) {
      coverCache.set(bvid, info.pic);
      saveCoverCache().catch(() => {});
      return info.pic;
    }
  } catch (e) {
    log('warn', 'cover', '获取封面失败: ' + bvid, (e && e.message) || String(e));
  }
  return '';
}

// 同步时把接口返回的封面（v2 的 pic / cursor 的 cover）预填进缓存
function seedCoverCacheFromItems(items) {
  let changed = false;
  for (const item of items) {
    const pic = String(item.pic || item.cover || '').trim();
    const bvid = extractBvid(item);
    if (pic && bvid && !coverCache.has(bvid)) {
      coverCache.set(bvid, pic);
      changed = true;
    }
  }
  if (changed) saveCoverCache().catch(() => {});
}

/* ---------------- 导入（本扩展导出的 JSON） ---------------- */

function bvidFromUrl(url) {
  const m = String(url || '').match(/\/video\/(BV[0-9A-Za-z]+)/);
  return m ? m[1] : '';
}

// 合并导入条目（信息不全的跳过），返回统计
async function mergeImportedItems(items) {
  const list = await getRecords();
  let added = 0;
  let updated = 0;
  let skipped = 0;
  for (const s of items) {
    if (!s || !s.bvid) continue;
    if (!s.title && !s.up) {
      skipped++;
      continue;
    }
    const rec = {
      title: s.title || '',
      bvid: s.bvid,
      up: s.up || '',
      mid: s.mid || '',
      lastWatchedAt: truncateToMinute(s.viewAt || Date.now())
    };
    const r = mergeRecord(list, rec);
    if (r.added) added++;
    else if (r.updated) updated++;
  }
  await saveRecords(list);
  return { added: added, updated: updated, skipped: skipped, total: list.length };
}


async function handleImportJson(msg) {
  let data;
  try {
    data = JSON.parse(String(msg.json || ''));
  } catch (e) {
    return { ok: false, error: 'JSON 解析失败：' + ((e && e.message) || String(e)) };
  }
  const records = Array.isArray(data)
    ? data
    : data && Array.isArray(data.records)
      ? data.records
      : null;
  if (!records || !records.length) {
    return { ok: false, error: 'JSON 结构无效：应为本扩展导出的 { records: [...] } 或记录数组' };
  }
  const items = [];
  for (const r of records) {
    if (!r || typeof r !== 'object') continue;
    const bvid = String(r.bvid || '') || bvidFromUrl(r.url);
    if (!bvid) continue;
    items.push({
      bvid: bvid,
      title: String(r.title || ''),
      up: String(r.up || ''),
      mid: String(r.mid || ''),
      viewAt: Number(r.lastWatchedAt) || 0,
      pic: ''
    });
  }
  if (!items.length) return { ok: false, error: 'JSON 中未找到有效记录' };
  const res = await mergeImportedItems(items);
  log('debug', 'import', 'JSON 导入完成：解析 ' + items.length + '，新增 ' + res.added + '，更新 ' + res.updated);
  return { ok: true, parsed: items.length, added: res.added, updated: res.updated, skipped: res.skipped, total: res.total };
}

/* ---------------- 存储 ---------------- */

function storageGet(key) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(key, (res) => {
      if (chrome.runtime.lastError) {
        return reject(new Error(chrome.runtime.lastError.message));
      }
      resolve(res && res[key]);
    });
  });
}

function storageSet(obj) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(obj, () => {
      if (chrome.runtime.lastError) {
        return reject(new Error(chrome.runtime.lastError.message));
      }
      resolve();
    });
  });
}

async function getRecords() {
  const list = await storageGet(STORAGE_KEY);
  if (!Array.isArray(list)) return [];
  // 兼容旧数据：无 bvid 的旧记录由 url 推导 bvid，并补齐 mid 字段
  const out = [];
  for (const r of list) {
    const n = normalizeRecord(r);
    if (n) out.push(n);
  }
  return out;
}

// 记录规范化：{title, bvid, up, mid, lastWatchedAt}（url 由 bvid 推导）
function normalizeRecord(r) {
  if (!r || typeof r !== 'object') return null;
  const bvid = String(r.bvid || '') || bvidFromUrl(r.url || '');
  if (!bvid) return null;
  return {
    title: r.title || '',
    bvid: bvid,
    up: r.up || '',
    mid: String(r.mid || ''),
    lastWatchedAt: r.lastWatchedAt || 0
  };
}

async function saveRecords(list) {
  await storageSet({ [STORAGE_KEY]: list });
}

/* 设置：合并默认值，保证结构完整 */
function normalizeSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const theme = Object.assign({}, DEFAULT_SETTINGS.theme, s.theme || {});
  const autoSync = Object.assign({}, DEFAULT_SETTINGS.autoSync, s.autoSync || {});
  return {
    theme: {
      primary: typeof theme.primary === 'string' && theme.primary ? theme.primary : DEFAULT_SETTINGS.theme.primary,
      primaryDark: typeof theme.primaryDark === 'string' && theme.primaryDark ? theme.primaryDark : DEFAULT_SETTINGS.theme.primaryDark,
      bg: typeof theme.bg === 'string' && theme.bg ? theme.bg : DEFAULT_SETTINGS.theme.bg,
      card: typeof theme.card === 'string' && theme.card ? theme.card : DEFAULT_SETTINGS.theme.card,
      text: typeof theme.text === 'string' && theme.text ? theme.text : DEFAULT_SETTINGS.theme.text,
      text2: typeof theme.text2 === 'string' && theme.text2 ? theme.text2 : DEFAULT_SETTINGS.theme.text2,
      text3: typeof theme.text3 === 'string' && theme.text3 ? theme.text3 : DEFAULT_SETTINGS.theme.text3,
      border: typeof theme.border === 'string' && theme.border ? theme.border : DEFAULT_SETTINGS.theme.border
    },
    backgroundImage: typeof s.backgroundImage === 'string' ? s.backgroundImage : '',
    autoSync: {
      enabled: !!autoSync.enabled,
      intervalMinutes: clampInterval(autoSync.intervalMinutes)
    },
    viewMode: s.viewMode === 'grid' ? 'grid' : 'list',
    lastSyncAt: Number(s.lastSyncAt) || 0
  };
}

async function getSettings() {
  const raw = await storageGet(STORAGE_KEY_SETTINGS);
  return normalizeSettings(raw);
}

async function saveSettings(settings) {
  await storageSet({ [STORAGE_KEY_SETTINGS]: normalizeSettings(settings) });
}

/* 去重合并：同一 bvid 只保留一条记录，更新标题 / UP主 / mid / 最后观看时间 */
function mergeRecord(list, record) {
  const bvid = String(record.bvid || '') || bvidFromUrl(record.url || '');
  if (!bvid) return { added: false, updated: false };
  const idx = list.findIndex((r) => (String(r.bvid || '') || bvidFromUrl(r.url || '')) === bvid);
  let added = false;
  let updated = false;
  if (idx >= 0) {
    const old = list[idx];
    if (!old.bvid) old.bvid = bvid; // 旧数据补齐
    if (record.title && record.title !== old.title) {
      old.title = record.title;
      updated = true;
    }
    if (record.up && record.up !== old.up) {
      old.up = record.up;
      updated = true;
    }
    if (record.mid && record.mid !== old.mid) {
      old.mid = record.mid;
      updated = true;
    }
    if (!old.lastWatchedAt || record.lastWatchedAt > old.lastWatchedAt) {
      old.lastWatchedAt = record.lastWatchedAt;
      updated = true;
    }
    list[idx] = old;
  } else {
    list.push({
      title: record.title || '',
      bvid: bvid,
      up: record.up || '',
      mid: record.mid || '',
      lastWatchedAt: record.lastWatchedAt || 0
    });
    added = true;
  }
  list.sort((a, b) => (b.lastWatchedAt || 0) - (a.lastWatchedAt || 0));
  return { added: added, updated: updated };
}

/* 搜索：支持视频标题与 UP主（不区分大小写） */
function searchRecords(list, q) {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return list.slice();
  return list.filter(
    (r) =>
      String(r.title || '').toLowerCase().indexOf(needle) >= 0 ||
      String(r.up || '').toLowerCase().indexOf(needle) >= 0
  );
}

/* ---------------- 同步 ---------------- */

async function handleSyncFromBili() {
  const items = await fetchOfficialHistory(4); // x/v2/history 分页 1~4，接口上限约 300 条
  const list = await getRecords();
  let added = 0;
  let updated = 0;
  for (const item of items) {
    const rec = itemToRecord(item);
    if (!rec) continue;
    const r = mergeRecord(list, rec);
    if (r.added) added++;
    else if (r.updated) updated++;
  }
  await saveRecords(list);
  seedCoverCacheFromItems(items); // 预填封面缓存（不写入记录本身）
  log('debug', 'sync', '同步完成：拉取 ' + items.length + '，新增 ' + added + '，更新 ' + updated);
  return {
    ok: true,
    fetched: items.length,
    added: added,
    updated: updated,
    total: list.length
  };
}

// 同步并记录上次同步时间
async function runSync() {
  const result = await handleSyncFromBili();
  if (result.ok) {
    const settings = await getSettings();
    settings.lastSyncAt = Date.now();
    await saveSettings(settings);
    result.lastSyncAt = settings.lastSyncAt;
  }
  return result;
}

/* ---------------- 自动同步（chrome.alarms） ---------------- */

function scheduleAutoSync(settings) {
  const a = (settings && settings.autoSync) || {};
  if (a.enabled && a.intervalMinutes > 0) {
    const mins = clampInterval(a.intervalMinutes);
    chrome.alarms.create(AUTO_SYNC_ALARM, {
      delayInMinutes: mins,
      periodInMinutes: mins
    });
    log('debug', 'alarm', '自动同步已调度，间隔 ' + mins + ' 分钟');
    return mins;
  }
  chrome.alarms.clear(AUTO_SYNC_ALARM);
  return 0;
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_SYNC_ALARM) {
    log('debug', 'alarm', '自动同步 alarm 触发');
    runSync().catch((e) => {
      log('error', 'alarm', '自动同步失败', (e && e.message) || String(e));
    });
  }
});

/* ---------------- 消息处理 ---------------- */

async function handleRecord(msg) {
  const bvid = String(msg.bvid || '').trim();
  if (!bvid) return { ok: false, error: '缺少 bvid' };

  let info = null;
  let usedApi = false;
  try {
    info = await fetchViewByBvid(bvid);
    usedApi = true;
  } catch (e) {
    info = null; // API 不可用时回退页面 DOM 数据
    log('warn', 'record', 'view API 失败，使用 DOM 数据: ' + bvid, (e && e.message) || String(e));
  }

  const fb = msg.fallback || {};
  const record = {
    title: (info && info.title) || String(fb.title || '').trim(),
    bvid: bvid,
    up: (info && info.up) || String(fb.up || '').trim(),
    mid: (info && info.mid) || String(fb.mid || ''),
    lastWatchedAt: truncateToMinute(Date.now())
  };
  if (!record.title) {
    log('warn', 'record', '未能获取视频标题: ' + bvid);
    return { ok: false, error: '未能获取视频标题', api: usedApi };
  }

  const list = await getRecords();
  const r = mergeRecord(list, record);
  await saveRecords(list);
  log('debug', 'record', (usedApi ? 'API' : 'DOM') + ' 记录 ' + bvid + (r.added ? '（新增）' : '（更新）'));
  return { ok: true, added: r.added, updated: r.updated, api: usedApi };
}

async function dispatch(msg) {
  switch (msg && msg.type) {
    case 'record':
      return await handleRecord(msg);

    case 'get-records':
      return { ok: true, records: await getRecords() };

    case 'search':
      return { ok: true, records: searchRecords(await getRecords(), msg.q) };

    case 'export': {
      const list = await getRecords();
      const records = list.map((r) => ({
        title: r.title,
        bvid: r.bvid,
        up: r.up,
        mid: r.mid || '',
        lastWatchedAt: r.lastWatchedAt
      }));
      const json = JSON.stringify(
        {
          app: APP_NAME,
          version: APP_VERSION,
          exportedAt: new Date().toISOString(),
          count: records.length,
          records: records
        },
        null,
        2
      );
      return { ok: true, json: json };
    }

    case 'remove': {
      const bvid = String(msg.bvid || '') || bvidFromUrl(msg.url);
      const list = await getRecords();
      const next = list.filter((r) => r.bvid !== bvid);
      const removed = next.length !== list.length;
      await saveRecords(next);
      return { ok: true, removed: removed };
    }

    case 'clear': {
      const list = await getRecords();
      await saveRecords([]);
      return { ok: true, count: list.length };
    }

    case 'sync-from-bili': {
      try {
        return await runSync();
      } catch (e) {
        log('error', 'sync', '同步失败', (e && e.message) || String(e));
        throw e;
      }
    }

    // 导入本扩展导出的 JSON 文件
    case 'import-json': {
      try {
        return await handleImportJson(msg);
      } catch (e) {
        log('error', 'import', 'JSON 导入失败', (e && e.message) || String(e));
        throw e;
      }
    }

    case 'get-settings':
      return { ok: true, settings: await getSettings() };

    case 'save-settings': {
      const old = await getSettings();
      const next = normalizeSettings(msg.settings);
      await saveSettings(next);
      const scheduledMinutes = scheduleAutoSync(next);
      log('debug', 'settings', '设置已保存', { scheduledMinutes: scheduledMinutes });
      let sync = null;
      // 刚启用自动同步时，立即同步一次
      if (next.autoSync.enabled && !old.autoSync.enabled) {
        try {
          sync = await runSync();
        } catch (e) {
          sync = { ok: false, error: (e && e.message) || String(e) };
        }
      }
      return { ok: true, settings: next, scheduledMinutes: scheduledMinutes, sync: sync };
    }

    case 'reset-settings': {
      await saveSettings(DEFAULT_SETTINGS);
      const settings = await getSettings();
      scheduleAutoSync(settings);
      log('debug', 'settings', '设置已恢复默认');
      return { ok: true, settings: settings };
    }

    case 'open-settings':
      chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
      return { ok: true };

    case 'get-logs':
      return { ok: true, logs: await getLogs() };

    case 'clear-logs': {
      const count = await clearLogs();
      return { ok: true, count: count };
    }

    // 内容脚本上报日志（调试 / 警告 / 错误）
    case 'log': {
      const lv = String(msg.level || 'debug');
      log(lv === 'warn' || lv === 'error' ? lv : 'debug', String(msg.tag || 'content'), String(msg.msg || ''), msg.data);
      return { ok: true };
    }

    // 诊断：检查 B 站登录态（同步官方历史的前提）
    case 'check-login': {
      try {
        const json = await apiFetch(API_BASE + '/x/web-interface/nav');
        const d = json.data || {};
        const isLogin = !!d.isLogin;
        log('debug', 'login', '登录态检查 isLogin=' + isLogin + (d.uname ? ' uname=' + d.uname : ''));
        return { ok: true, isLogin: isLogin, uname: d.uname || '', mid: d.mid || 0 };
      } catch (e) {
        return { ok: false, error: (e && e.message) || String(e) };
      }
    }

    // 批量获取封面（bvid → 封面 url）；命中缓存不重复请求
    case 'get-covers': {
      const bvids = (Array.isArray(msg.bvids) ? msg.bvids : [])
        .map((b) => String(b).trim())
        .filter((b) => /^BV[0-9A-Za-z]+$/.test(b));
      const covers = {};
      const missing = [];
      await loadCoverCache();
      for (const bvid of bvids) {
        if (coverCache.has(bvid)) covers[bvid] = coverCache.get(bvid);
        else missing.push(bvid);
      }
      const POOL = 4; // 控制并发，避免触发风控
      for (let i = 0; i < missing.length; i += POOL) {
        const slice = missing.slice(i, i + POOL);
        const results = await Promise.all(
          slice.map(async (bvid) => {
            const pic = await fetchCover(bvid);
            return [bvid, pic];
          })
        );
        for (const [bvid, pic] of results) {
          if (pic) {
            covers[bvid] = pic;
            coverCache.set(bvid, pic);
          }
        }
      }
      if (missing.length) saveCoverCache().catch(() => {});
      log('debug', 'cover', 'get-covers: 请求 ' + missing.length + ' 个，命中缓存 ' + (bvids.length - missing.length) + ' 个');
      return { ok: true, covers: covers };
    }

    default:
      return { ok: false, error: '未知消息类型: ' + (msg && msg.type) };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  dispatch(msg)
    .then(sendResponse)
    .catch((err) => {
      sendResponse({ ok: false, error: (err && err.message) || String(err) });
    });
  return true; // 异步响应
});

/* ---------------- 初始化 ---------------- */

// 点击扩展图标：打开（或聚焦）查询页
if (chrome.action && chrome.action.onClicked) {
  chrome.action.onClicked.addListener(() => {
    const url = chrome.runtime.getURL('history.html');
    chrome.tabs.query({ url: url }, (tabs) => {
      const existing = tabs && tabs.find((t) => t.id != null);
      if (existing) {
        chrome.tabs.update(existing.id, { active: true });
      } else {
        chrome.tabs.create({ url: url });
      }
    });
  });
}

// Service Worker 每次启动时恢复自动同步调度（alarm 由浏览器持久化，重复创建无害）
(async function init() {
  try {
    log('debug', 'init', APP_NAME + ' v' + APP_VERSION + ' 启动');
    const settings = await getSettings();
    scheduleAutoSync(settings);
  } catch (e) {
    log('error', 'init', '初始化失败', (e && e.message) || String(e));
  }
})();

/* ---------------- 单元测试导出（浏览器环境忽略） ---------------- */

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    md5: md5,
    getMixinKey: getMixinKey,
    encWbi: encWbi,
    av2bv: av2bv,
    truncateToMinute: truncateToMinute,
    canonicalizeUrl: canonicalizeUrl,
    normalizeSettings: normalizeSettings,
    mergeRecord: mergeRecord,
    searchRecords: searchRecords,
    itemToRecord: itemToRecord,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS
  };
}
