// ==UserScript==
// @name         GitHub 加速代理 + 界面汉化
// @namespace    zjkl.ghproxy
// @version      1.3.0
// @description  【安装后必做】给篡改猴打开「允许用户脚本」和「允许访问文件 URL」两个开关，否则脚本不会执行。功能一：github.com 网络不稳时自动改用 gh.zjkl0330.dpdns.org —— 主动探测 + 资源加载失败 + 请求挂起（黑洞超时）三种信号，判定不稳后改写本页链接，正在卡住的页面整页搬到代理域。功能二：内置 GitHub 界面汉化（词库+引擎，主站与代理域都翻，只改界面文案不碰代码与正文），装了这一个脚本就不需要别的中文化插件
// @author       zjkl
// @match        *://github.com/*
// @match        *://www.github.com/*
// @match        *://gist.github.com/*
// @match        *://raw.githubusercontent.com/*
// @match        *://github.githubassets.com/*
// @match        *://avatars.githubusercontent.com/*
// @match        *://*.zjkl0330.dpdns.org/*
// @grant        GM_registerMenuCommand
// @run-at       document-start
// @noframes
// ==/UserScript==

// 限制 1：浏览器错误页（连接被重置/超时）里任何脚本都不会执行，所以必须靠「点之前改写链接」来规避。
// 限制 2：登录要走 Worker，密码会经过它；只有这个 Worker 是你自己部署时才可以这样用。
//         实测 _gh_sess 是 host-only cookie，能存到 gh. 域下，登录态可以保持；
//         带 domain=.github.com 的辅助 cookie（_octo、logged_in）会被浏览器丢掉，个别页面状态会不全。
// 限制 3：api.github.com / codeload / gist / Release 附件在这个部署上没挂路由，功能会缺。
// 汉化：词库与引擎已经内置在本文件末尾（原「GitHub 中文化（单文件版）」并入），主站和 gh. 代理域都翻，
//       不用再装别的中文化插件；只翻界面文案，代码块 / README 正文 / commit hash / 输入框内容不动。
//       想关掉汉化：删掉文件末尾「===== 内置界面汉化 =====」那一段 IIFE 即可，代理功能不受影响。
// 范围：@match 只覆盖 github 系域名和代理域名，不会在每个网站注入。
//       如果你希望「在别的网站（搜索页、博客）点 github 链接也自动改写」，在上面 @match 区补一行：
//           // @match *://*/*
//       代价是脚本注入所有页面、篡改猴图标常亮。

// 代理基域 + 界面域：两个功能块都要用，所以提到 IIFE 外面
const GH_BASE = 'zjkl0330.dpdns.org';
// 只有真正吐 HTML 界面的域才汉化；raw / assets / avatars 是文件与静态资源，翻了会污染内容
const UI_HOSTS = new Set([
  'github.com', 'www.github.com', 'gist.github.com', 'gh.' + GH_BASE,
]);

(() => {
  'use strict';

  const BASE = GH_BASE;

  // 实测可用（200）的映射
  const MAP = {
    'github.com': 'gh.' + BASE,
    'www.github.com': 'gh.' + BASE,
    'raw.githubusercontent.com': 'raw-githubusercontent-com-gh.' + BASE,
    'github.githubassets.com': 'github-githubassets-com-gh.' + BASE,
    'avatars.githubusercontent.com': 'avatars-githubusercontent-com-gh.' + BASE,
  };

  // 本部署没挂 Worker 路由（实测 522），改写过去更坏，保持直连
  const DIRECT_ONLY = [
    'api.github.com', 'codeload.github.com', 'gist.github.com',
    'gist.githubusercontent.com', 'objects.githubusercontent.com',
    'private-user-images.githubusercontent.com', 'user-images.githubusercontent.com',
    'media.github.com', 'collector.github.com', 'opengraph.githubassets.com',
  ];

  const KEY = 'gh-proxy-state-v2';
  const NOTICE_KEY = 'gh-proxy-notice-v1';
  const EDGE_TOGGLES = 'Edge/Chrome 要给篡改猴打开两个开关，否则脚本在任何页面都不会执行：扩展详情页（edge://extensions 或 chrome://extensions）→ 先开右上角「开发者模式」→ Tampermonkey → 详细信息 → 打开「允许用户脚本」和「允许访问文件 URL」。';
  // 测试可以注入更短的阈值（篡改猴里没有别的办法驱动定时器）
  const T = (typeof window !== 'undefined' && window.__ghProxyTest) || {};
  const PROBE_TTL = T.probeTtl || 60e3;    // 每分钟重测，别拿几分钟前「能连」的结论糊弄自己
  const FLAKY_MS = T.flakyMs || 1200;      // 能连但要 1.2 秒以上，同样按「快断了」处理
  const STICKY = T.sticky || 10 * 60e3;    // 一出现失败信号，10 分钟内坚持走代理
  const REDO = T.redo || 20e3;             // 同一 URL 20 秒内不重复整页跳转
  const STALL_MS = T.stallMs || 6000;      // 请求挂 6 秒没回 = 黑洞挂起（实测 github.com 有 12 秒连 TCP 都没建上的时候）
  const RECHECK = T.recheckMs || 30e3;     // 页面开着也要定期重测，别只在打开那一刻测一次

  const box = (storage) => ({
    read: () => {
      try { return JSON.parse(storage.getItem(KEY)) || {}; } catch { return {}; }
    },
    write: (v) => {
      try { storage.setItem(KEY, JSON.stringify(v)); } catch { /* 隐私模式忽略 */ }
    },
  });
  const crossTab = box(localStorage);
  const thisTab = box(sessionStorage);
  const state = () => crossTab.read();

  function useProxy() {
    const s = state();
    if (s.mode === 'direct') return false;
    if (s.mode === 'proxy') return s.proxyOk !== false;   // 优先代理：代理自己不通就回直连
    if (s.proxyOk === false) return false;
    return s.blocked === true || (s.stickyUntil || 0) > Date.now();
  }

  function markFlaky() {
    const s = state();
    s.blocked = true;
    s.ts = Date.now();
    s.stickyUntil = Date.now() + STICKY;
    crossTab.write(s);
  }

  // 返回 {ok, ms}：不通是一次信号，通但很慢是另一次信号，两者都说明这条链路在抖
  async function ping(url, timeout = 4000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    const started = Date.now();
    try {
      await fetch(url + (url.includes('?') ? '&' : '?') + '_p=' + Date.now(),
        { mode: 'no-cors', cache: 'no-store', signal: ctrl.signal });
      return { ok: true, ms: Date.now() - started };
    } catch {
      return { ok: false, ms: Infinity };
    } finally {
      clearTimeout(timer);
    }
  }

  async function refresh(force = false) {
    if (!force && Date.now() - (state().ts || 0) < PROBE_TTL) return;
    const [gh, proxy] = await Promise.all([
      ping('https://github.com/favicon.ico'),
      ping('https://gh.' + BASE + '/favicon.ico'),
    ]);
    const next = state();
    next.blocked = !gh.ok;
    next.proxyOk = proxy.ok;
    next.ghMs = gh.ms;
    next.proxyMs = proxy.ms;
    next.ts = Date.now();
    if (!gh.ok || gh.ms > FLAKY_MS) next.stickyUntil = Date.now() + STICKY;
    crossTab.write(next);
  }

  function rewrite(url) {
    let u;
    try { u = new URL(url); } catch { return null; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const target = MAP[u.hostname.toLowerCase()];
    if (!target) return null;
    u.hostname = target;
    u.protocol = 'https:';
    return u.href;
  }

  const fix = (a) => {
    const next = rewrite(a.href);
    if (next) a.href = next;
  };

  function fixTree(root) {
    if (!root || !root.querySelectorAll) return;
    if (root.tagName === 'A') fix(root);
    for (const a of root.querySelectorAll('a[href^="http"], a[href^="//"]')) fix(a);
  }

  // 改写本页 github 链接，并盯住之后插入的节点（GitHub 页面大量内容靠动态挂载）
  let anchorsDone = false;
  function rewriteAnchors() {
    if (anchorsDone) return;
    anchorsDone = true;
    fixTree(document.documentElement);
    const queue = new Set();
    const flush = () => { for (const n of queue) fixTree(n); queue.clear(); };
    new MutationObserver((recs) => {
      for (const r of recs) {
        if (r.type === 'attributes' && r.target.nodeType === 1) queue.add(r.target);
        else for (const n of r.addedNodes) if (n.nodeType === 1) queue.add(n);
      }
      if (queue.size) queueMicrotask(flush);
    }).observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['href'],
    });
  }

  // 第三方页面：拦截器常驻，是否改写每次点击现判 —— 不然「打开那一刻网络是好的」就永远不装
  function installInterceptor() {
    const onTap = (el) => {
      if (!useProxy()) return;
      const a = el && el.closest ? el.closest('a[href]') : null;
      if (a) fix(a);
    };
    addEventListener('pointerdown', (e) => onTap(e.target), true);
    addEventListener('click', (e) => {
      const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (a && useProxy() && rewrite(a.href)) e.preventDefault();
      onTap(e.target);
    }, true);
  }

  function proxyUrl(href) {
    const u = new URL(href);
    const target = MAP[u.hostname.toLowerCase()];
    if (!target) return null;
    u.hostname = target;
    u.protocol = 'https:';
    return u.href;
  }

  function bounceCurrent(force = false) {
    const next = proxyUrl(location.href);
    if (!next) return false;
    const u = new URL(next);
    const done = thisTab.read();
    const key = u.pathname + u.search;
    // 自动跳转才需要抑制重复；你从菜单里点「现在就搬」就是要立刻走
    if (!force && done[key] && Date.now() - done[key] < REDO) return false;
    done[key] = Date.now();
    thisTab.write(done);
    location.replace(next);
    return true;
  }

  function originOf(proxyHost) {
    for (const [orig, p] of Object.entries(MAP)) if (p === proxyHost) return orig;
    return null;
  }

  // ---- 卡住检测 ---------------------------------------------------------------
  // 黑洞挂起不会触发资源 error 事件（实测 github.com 有一次 12 秒连 TCP 都没建上），
  // GitHub 的页内导航又走 fetch 而不经过 <a>，所以「改写链接」救不了「点着点着没反应」。
  // 这里给同源请求自己计时：挂太久就把整页搬到代理域 —— 代理页里这些请求是同域，实测能跑完。
  const inflight = new Map();
  let seq = 0;
  const sameSite = (url) => {
    if (!url) return false;
    try {
      const u = new URL(String(url), location.href);
      if (!/^https?:$/.test(u.protocol)) return false;
      const h = u.hostname.toLowerCase();
      // 探针自己（带 _p= 的那个请求）不算「页面卡住」，否则是我们自己把自己踢走
      if (/[?&]_p=/.test(u.search)) return false;
      return h === location.hostname.toLowerCase() || h === 'github.com';
    } catch {
      return false;
    }
  };
  const track = (url) => {
    if (!sameSite(url)) return 0;
    const id = ++seq;
    inflight.set(id, Date.now());
    return id;
  };

  function installStallWatch() {
    const f = window.fetch;
    if (typeof f === 'function') {
      window.fetch = function (input, init) {
        const id = track(typeof input === 'string' ? input : input && input.url);
        const p = f.call(this, input, init);
        if (id) p.then(() => inflight.delete(id), () => inflight.delete(id));
        return p;
      };
    }
    const X = window.XMLHttpRequest;
    if (X && X.prototype && X.prototype.open) {
      const open = X.prototype.open;
      X.prototype.open = function (method, url) {
        const id = track(url);
        if (id) this.addEventListener('loadend', () => inflight.delete(id));
        return open.apply(this, arguments);
      };
    }
    setInterval(() => {
      if (!inflight.size) return;
      let oldest = Infinity;
      for (const t of inflight.values()) if (t < oldest) oldest = t;
      if (Date.now() - oldest < STALL_MS) return;
      inflight.clear();
      markFlaky();
      rewriteAnchors();
      // 正在输入框里打字时不要把页面换掉（没提交的内容会丢），只改写链接交给下一次点击
      const el = document.activeElement;
      const typing = el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName || '') && String(el.value || '').length;
      if (!typing && useProxy()) bounceCurrent();
    }, Math.max(1000, Math.floor(STALL_MS / 2))).unref?.();
  }

  const host = location.hostname.toLowerCase();
  const origin = originOf(host);
  const onGithubOrigin = !!MAP[host];

  // 首次跑起来时弹一次开关提醒：脚本能执行就说明开关是开的，但换浏览器/重装扩展后容易踩
  function showToggleNotice() {
    const el = document.createElement('div');
    el.setAttribute('style', 'position:fixed;right:12px;bottom:12px;z-index:2147483647;max-width:340px;'
      + 'padding:10px 12px;border-radius:8px;background:#1f2937;color:#e5e7eb;font:12px/1.6 system-ui,sans-serif;'
      + 'box-shadow:0 6px 24px rgba(0,0,0,.35)');
    el.textContent = EDGE_TOGGLES;
    const x = document.createElement('button');
    x.textContent = '知道了';
    x.setAttribute('style', 'margin-top:6px;padding:2px 10px;border-radius:4px;border:1px solid #4b5563;'
      + 'background:none;color:#e5e7eb;cursor:pointer');
    x.addEventListener('click', () => el.remove());
    el.appendChild(x);
    (document.body || document.documentElement).appendChild(el);
  }

  function firstRunNotice() {
    if (!onGithubOrigin && !origin) return;
    try {
      if (localStorage.getItem(NOTICE_KEY)) return;
      localStorage.setItem(NOTICE_KEY, '1');
    } catch { return; }
    if (document.readyState === 'loading') addEventListener('DOMContentLoaded', showToggleNotice);
    else showToggleNotice();
  }

  // 资源被连接重置通常比整页导航失败先发生，是「马上要断」的领先信号
  if (onGithubOrigin) {
    addEventListener('error', (e) => {
      const el = e.target;
      if (!el || el === window) return;
      const url = el.src || el.href || '';
      if (!/github\.com|githubusercontent\.com|githubassets\.com|github\.io/.test(url)) return;
      markFlaky();
      rewriteAnchors();
    }, true);
  }

  if (origin) {
    // 代理页要退回直连的两种情况：用户强制直连，或代理本身探测不通
    if (state().mode === 'direct' || state().proxyOk === false) {
      const u = new URL(location.href);
      u.hostname = origin;
      u.protocol = 'https:';
      location.replace(u.href);
    }
  } else if (onGithubOrigin) {
    installStallWatch();
    const decide = () => { if (useProxy()) rewriteAnchors(); };
    refresh().then(() => {
      decide();
      // 只有主站探测本身不通才整页换域名，而且代理得是通的；仅资源抖动时只改链接，不打断你正在用的页面
      if (useProxy() && state().blocked) bounceCurrent();
    });
    // 页面开着的时候也要复测：网络是间歇坏的，打开那一刻的结论几分钟前就作废了
    setInterval(() => { refresh(true).then(decide); }, RECHECK).unref?.();
  } else {
    const idle = (fn) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn) : setTimeout(fn, 1500));
    installInterceptor();
    idle(() => { refresh(); });
  }

  firstRunNotice();

  if (typeof GM_registerMenuCommand === 'function') {
    const status = () => {
      const s = state();
      const mode = s.mode === 'proxy' ? '优先代理' : s.mode === 'direct' ? '强制直连' : '自动';
      const ms = (v) => (typeof v === 'number' && isFinite(v) ? ` ${v}ms` : '');
      const net = `github ${s.blocked == null ? '未测' : s.blocked ? '不通' : '可达' + ms(s.ghMs)}`
        + ` / 代理 ${s.proxyOk == null ? '未测' : s.proxyOk ? '可达' + ms(s.proxyMs) : '不通'}`;
      const stick = s.stickyUntil > Date.now()
        ? `\n粘性代理剩余 ${Math.ceil((s.stickyUntil - Date.now()) / 60e3)} 分钟` : '';
      return `模式：${mode}\n${net}${stick}\n\n以下域名本部署没挂路由，仍走直连：\n${DIRECT_ONLY.join('\n')}`;
    };
    const setMode = (m) => { const s = state(); s.mode = m; s.stickyUntil = 0; crossTab.write(s); };
    const diagnose = () => {
      const s = state();
      const why = [];
      if (s.mode === 'direct') why.push('你设的是「强制直连」——脚本按你的要求不动手');
      if (s.proxyOk === false) why.push('代理本身探测不通，切过去更糟，所以故意不切');
      if (onGithubOrigin) {
        if (s.blocked) why.push('主站探测不通：本页应已整页搬到 gh.，若地址栏仍是 github.com 说明搬运被浏览器拦下，手动把域名改成 gh. 即可');
        else if ((s.stickyUntil || 0) > Date.now()) why.push('已判定网络抖动：本页 github 链接应已改写成 gh.（鼠标停在链接上看左下角地址确认）');
        else why.push('最近一次探测 github 可达、也没抓到失败信号，所以按兵不动');
      } else if (origin) {
        why.push('本页已经在代理域，页内链接由 Worker 自己改写；要回原站用菜单「本页在 直连 ↔ 代理 之间互跳」');
      } else {
        why.push('当前页不是 github 系域名，脚本只在你点击 github 链接的瞬间改写它');
      }
      const lang = (document.documentElement || {}).lang || '未设置';
      if (UI_HOSTS.has(host) && !/^zh/i.test(lang)) {
        why.push(`内置汉化没在这页生效（<html lang="${lang}">）：页面可能还没加载完，或这条文案不在词库里`);
      } else if (UI_HOSTS.has(host)) {
        why.push('内置汉化已生效（界面文案走词库，代码块与 README 正文刻意不翻）');
      } else if (!MAP[host]) {
        why.push('本页不是 GitHub 界面域，汉化不插手（raw / 静态资源上的文字属于文件内容，不改）');
      }
      if (DIRECT_ONLY.includes(host)) why.push(`${host} 在这个部署上没挂 Worker 路由（实测 522），脚本刻意不改写`);
      if (!why.filter((w) => !/没挂路由/.test(w)).length) why.push('一切正常：现在没有需要切的理由');
      return `自检结论：\n${why.map((w) => '· ' + w).join('\n')}\n\n如果连这条菜单都看不到、或弹窗里写着「此脚本还未被执行」：\n${EDGE_TOGGLES}\n\n${status()}`;
    };
    GM_registerMenuCommand('状态 / 为什么没生效', () => alert(diagnose()));
    GM_registerMenuCommand('切换模式（自动 → 优先代理 → 强制直连）', () => {
      const order = ['auto', 'proxy', 'direct'];
      const label = { auto: '自动（不通才切）', proxy: '优先代理（代理挂了自动回直连）', direct: '强制直连' };
      const cur = order.indexOf(state().mode || 'auto');
      const next = order[(cur + 1) % order.length];
      setMode(next);
      alert(`已切到：${label[next]}`);
    });
    GM_registerMenuCommand('本页在 直连 ↔ 代理 之间互跳', () => {
      const s = state();
      if (origin) {
        // 从代理域跳回原站：顺手把模式定成强制直连，否则下一页又被脚本搬回来
        s.mode = 'direct';
        s.stickyUntil = 0;
        crossTab.write(s);
        const u = new URL(location.href);
        u.hostname = origin;
        u.protocol = 'https:';
        location.replace(u.href);
        return;
      }
      const next = proxyUrl(location.href);
      if (!next) {
        alert(`这个域名搬不了（${location.hostname}）：不在映射里，或者本部署没挂路由。\n\n${status()}`);
        return;
      }
      s.mode = 'proxy';
      s.stickyUntil = Date.now() + STICKY;
      crossTab.write(s);
      rewriteAnchors();
      bounceCurrent(true);
    });
  }
})();

// ===== 内置界面汉化 =====
// 原「GitHub 中文化插件」只 @match github.com，页面被搬到 gh. 代理域后翻译就停了；
// 词库和引擎直接并进本脚本，代理域和主站都翻，你只需要装这一个脚本。
(() => {
  'use strict';

  // 只有真正吐 HTML 的界面域才翻（集合定义在文件顶部）
  const isUiHost = UI_HOSTS.has(location.hostname.toLowerCase());
  const T = (typeof window !== 'undefined' && window.__ghProxyTest) || {};
  if (T.expose) T.zhGate = { isUiHost };
  if (!isUiHost) return;
  // translate 依赖下面的词库常量，非界面域提前 return 时它还在 TDZ 里，只能在此之后暴露
  if (T.expose) T.zh = { translate, UI_HOSTS };

  // ===== 词库 + 引擎（从本地「GitHub 中文化（单文件版）」并入，一份脚本搞定）=====
  // 只翻界面文案：代码块 / Markdown 正文 / commit hash / 输入框内容都在跳过名单里。
  /* ===== 词库（内联） ===== */

  const STATIC = {
    // 全局导航 / 顶栏
    'Skip to content': '跳至内容',
    'Homepage': '首页',
    'Home': '主页',
    'Dashboard': '仪表板',
    'Pull requests': '拉取请求',
    'Issues': '问题',
    'Discussions': '讨论',
    'Codespaces': '代码空间',
    'Marketplace': '应用市场',
    'Explore': '发现',
    'Sponsors': '赞助',
    'Organizations': '组织',
    'Repositories': '仓库',
    'Projects': '项目',
    'Stars': 'Star',
    'Starred': '已加星',
    'Gists': '代码片段',
    'Collections': '集合',
    'Topics': '话题',
    'Trending': '趋势',
    'Learning': '学习',
    'Developers': '开发者',
    'Log in': '登录',
    'Sign in': '登录',
    'Sign up': '注册',
    'Sign out': '退出登录',
    'Log out': '退出登录',
    'Search or jump to…': '搜索或跳转至…',
    'Search or jump to...': '搜索或跳转至…',
    'Search GitHub': '搜索 GitHub',
    'Type a query': '输入查询内容',
    'Filter...': '筛选…',
    'Filter…': '筛选…',
    'Filter': '筛选',
    'Sort': '排序',
    'No results': '无结果',
    'In all of GitHub': '在 GitHub 全站',
    'Search results': '搜索结果',
    'Code results': '代码结果',
    'Issues results': '问题结果',
    'Pull Request results': '拉取请求结果',
    'Discussions results': '讨论结果',
    'Users': '用户',
    'Notifications': '通知',
    'Unread notifications': '未读通知',
    'Read all notifications': '全部标为已读',
    'Error loading notifications': '通知加载失败',
    'Inbox': '收件箱',
    'New': '新建',
    'New repository': '新建仓库',
    'New gist': '新建代码片段',
    'New project (Beta)': '新建项目（Beta）',
    'New workspace (Beta)': '新建工作区（Beta）',
    'Import repository': '导入仓库',
    'New organization': '新建组织',
    'Upgrade': '升级',
    'Your profile': '你的主页',
    'Your repositories': '你的仓库',
    'Your projects': '你的项目',
    'Your stars': '你的 Star',
    'Your gists': '你的代码片段',
    'Your copilot': '你的 Copilot',
    'Your codespaces': '你的代码空间',
    'Your enterprises': '你的企业',
    'Feature preview': '功能预览',
    'Settings': '设置',
    'Theme': '主题',
    'Dark mode': '深色模式',
    'Light mode': '浅色模式',
    'Sync with system': '跟随系统',
    'Help': '帮助',
    'Support': '支持',
    'Community forum': '社区论坛',
    'Customer support': '客户支持',
    'Chat to support agent': '与支持客服聊天',
    'Keyboard shortcuts': '键盘快捷键',
    'GitHub Status': 'GitHub 状态',
    'Contact GitHub': '联系 GitHub',
    'Feedback': '反馈',
    'Give feedback': '提交反馈',
    'Dismiss': '忽略',

    // 仓库内导航
    'Overview': '概览',
    'Code': '代码',
    'Actions': '动作',
    'Wiki': '维基',
    'Security': '安全',
    'Insights': '洞察',
    'Deployments': '部署',
    'Environments': '环境',
    'Packages': '包',
    'Releases': '发行版',
    'Tags': '标签',
    'Branches': '分支',
    'People': '人员',
    'Teams': '团队',
    'Languages': '语言',
    'Contributors': '贡献者',
    'Traffic': '流量',
    'Commit activity': '提交活动',
    'Code frequency': '代码频率',
    'Pulse': '脉搏',
    'Dependency graph': '依赖关系图',
    'Code scanning': '代码扫描',
    'Secret scanning': '密钥扫描',
    'Custom properties': '自定义属性',
    'Activity': '动态',
    'About': '关于',

    // 文件区 / 提交区
    'Add file': '添加文件',
    'Add files': '添加文件',
    'Create new file': '新建文件',
    'Upload files': '上传文件',
    'Go to file': '跳转至文件',
    'Find a file': '查找文件',
    'Edit this file': '编辑此文件',
    'Raw': '原文',
    'History': '历史记录',
    'Blame': '追溯',
    'Permalink': '永久链接',
    'Latest commit': '最新提交',
    'Commits': '提交',
    'Files': '文件',
    'Switch branches or tags': '切换分支或标签',
    'Find a branch': '查找分支',
    'Create branch': '创建分支',
    'Delete branch': '删除分支',
    'Compare': '比较',
    'Go to default branch': '转到默认分支',
    'Your recently pushed branches:': '你最近推送的分支：',
    'Your recently pushed tags:': '你最近推送的标签：',
    'Fetch and checkout': '抓取并检出',
    'Pull and checkout': '拉取并检出',
    'Create a new branch and': '创建新分支并',
    'Clone': '克隆',
    'Download': '下载',
    'Download ZIP': '下载 ZIP',

    // 仓库操作按钮
    'Star': '加星',
    'Unstar': '取消加星',
    'Watch': '关注',
    'Unwatch': '取消关注',
    'Fork': '派生',
    'Unfork': '取消派生',
    'Follow': '关注',
    'Following': '正在关注',
    'Unfollow': '取消关注',
    'Sponsor': '赞助',
    'Used by': '被用于',
    'You must be signed in to star a repository': '登录后才能为此仓库加星',
    'You must be signed in to change notification settings': '登录后才能更改关注设置',

    // 通用按钮 / 控件
    'Save': '保存',
    'Save changes': '保存更改',
    'Cancel': '取消',
    'Delete': '删除',
    'Edit': '编辑',
    'Close': '关闭',
    'Open': '打开',
    'Merged': '已合并',
    'Draft': '草稿',
    'Submit': '提交',
    'Confirm': '确认',
    'Continue': '继续',
    'Back': '返回',
    'Next': '下一步',
    'Previous': '上一步',
    'Done': '完成',
    'Finish': '完成',
    'Apply': '应用',
    'Reset': '重置',
    'Retry': '重试',
    'Refresh': '刷新',
    'Reload this page': '重新加载此页面',
    'Undo': '撤销',
    'Redo': '重做',
    'Copy': '复制',
    'Copied': '已复制',
    'Paste': '粘贴',
    'Disable': '禁用',
    'Enable': '启用',
    'Enabled': '已启用',
    'Disabled': '已禁用',
    'Required': '必填',
    'Optional': '可选',
    'None': '无',
    'Other': '其他',
    'All': '全部',
    'Any': '任意',
    'Learn more': '了解更多',
    'Read more': '阅读更多',
    'View details': '查看详情',
    'View all': '查看全部',
    'See all': '查看全部',
    'Show more': '显示更多',
    'Show less': '收起',
    'Get started': '开始使用',
    'Loading': '加载中',
    'Loading...': '加载中…',
    'Nothing to show': '暂无内容',
    'There was an error while loading. Please reload this page.': '加载时出错，请重新加载此页面。',
    'Failed to load': '加载失败',
    'That page could not be found.': '未找到该页面。',
    '404 - Not Found': '404 - 未找到',

    // Issue / PR
    'New issue': '新建问题',
    'Submit new issue': '提交新问题',
    'Close issue': '关闭问题',
    'Reopen issue': '重新打开问题',
    'New pull request': '新建拉取请求',
    'Compare & pull request': '比较并创建拉取请求',
    'Create pull request': '创建拉取请求',
    'Merge pull request': '合并拉取请求',
    'Confirm merge': '确认合并',
    'Squash and merge': '压缩并合并',
    'Rebase and merge': '变基并合并',
    'Merge commit': '合并提交',
    'Approve': '批准',
    'Request changes': '请求更改',
    'Submit review': '提交审查',
    'Comment': '评论',
    'Add your comment': '添加你的评论',
    'Leave a comment': '留下评论',
    'Start review': '开始审查',
    'Convert to draft': '转为草稿',
    'Ready for review': '准备好接受审查',
    'Mark as ready for review': '标记为准备好接受审查',
    'Assign': '指派',
    'Assignees': '指派给',
    'Unassigned': '未指派',
    'Milestone': '里程碑',
    'Labels': '标签',
    'Development': '开发',
    'Reviewers': '审查者',
    'Participants': '参与者',
    'Conversation': '会话',
    'Commits in this pull request': '此拉取请求中的提交',
    'Files changed': '变更文件',
    'Checks': '检查',
    'Closes': '将关闭',
    'Fixes': '将修复',
    'Resolves': '将解决',
    'Open issues': '待处理的问题',
    'Closed issues': '已关闭的问题',
    'View all issues': '查看全部问题',
    'Author': '作者',
    'Label': '标签',
    'Assignee': '指派给',
    'In this repository': '在此仓库中',
    'Saved searches': '已保存的搜索',
    'No saved searches': '暂无已保存的搜索',
    'There aren’t any releases here': '这里还没有发行版',
    "There aren't any releases here": '这里还没有发行版',
    'There aren’t any tags here': '这里还没有标签',
    "There aren't any tags here": '这里还没有标签',
    'No files found at this path.': '此路径下没有文件。',

    // Actions
    'Workflows': '工作流',
    'Runs': '运行记录',
    'Agents': '代理',
    'Usage': '用量',
    'New workflow': '新建工作流',
    'Run workflow': '运行工作流',
    'Re-run jobs': '重新运行任务',
    'Re-run all jobs': '重新运行所有任务',
    'Cancel workflow': '取消工作流',
    'Summary': '摘要',
    'Job': '任务',
    'Jobs': '任务',
    'Artifacts': '构建产物',
    'Success': '成功',
    'Failed': '失败',
    'Failure': '失败',
    'Cancelled': '已取消',
    'Cancelling': '正在取消',
    'Queued': '排队中',
    'In progress': '进行中',
    'Skipped': '已跳过',
    'Needs approval': '需要批准',

    // 设置页
    'Access': '访问',
    'Public profile': '公开资料',
    'Profile': '资料',
    'Account': '账号',
    'Emails': '邮箱',
    'Password': '密码',
    'Two-factor authentication': '双重认证',
    'Account recovery': '账号恢复',
    'Sessions': '会话',
    'Device sessions': '设备会话',
    'Sign-in history': '登录历史',
    'Applications': '应用',
    'Security log': '安全日志',
    'Outside collaborators': '外部协作者',
    'Blocking': '拉黑',
    'Enterprise': '企业',
    'Billing and plans': '账单与套餐',
    'Billing and subscriptions': '账单与订阅',
    'Payment information': '付款信息',
    'Order history': '订单历史',
    'Codes of conduct': '行为准则',
    'Blocks': '屏蔽',
    'Sponsorships': '赞助',
    'Dependencies': '依赖',
    'Pages': 'Pages',
    'Saved replies': '已保存的回复',
    'Archives': '归档',
    'GitHub Apps': 'GitHub 应用',
    'Tokens (classic)': '令牌（经典）',
    'Grants': '授权',
    'Keys and apps': '密钥与应用',
    'Webhooks': 'Webhook',
    'SSH and GPG keys': 'SSH 与 GPG 密钥',
    'Access tokens': '访问令牌',
    'Fine-grained tokens': '精细控制令牌',
    'Appearance': '外观',
    'Accessibility': '辅助功能',
    'Language': '语言',
    'Manage': '管理',

    // Gist
    'All gists': '全部代码片段',
    'Save public gist': '保存公开代码片段',
    'Save private gist': '保存私密代码片段',
    'Public': '公开',
    'Private': '私密',
    'Secret': '隐藏',
    'Standard': '标准',
    'Revisions': '修订',
    'Embed': '嵌入',

    // 页脚
    'Terms': '条款',
    'Privacy': '隐私',
    'Status': '状态',
    'Docs': '文档',
    'Contact': '联系',
    'Manage cookies': '管理 Cookie',
    'Do not share my personal information': '不要分享我的个人信息',

    // Copilot / 搜索
    'Chat': '聊天',
    'Send': '发送',
    'Ask about this code': '询问此代码',
    'Clear topic': '清除此话题',
    'Copilot Free': 'Copilot 免费版'
  };

  const REGEXP = [
    // 计数器
    [/^([\d,.]+[km]?) stars?$/i, '$1 个 Star'],
    [/^([\d,.]+[km]?) forks?$/i, '$1 个派生'],
    [/^([\d,.]+[km]?) watching$/i, '$1 人关注'],
    [/^([\d,.]+[km]?) users? watching$/i, '$1 人关注'],
    [/^([\d,.]+[km]?) issues?$/i, '$1 个问题'],
    [/^([\d,.]+[km]?) pull requests?$/i, '$1 个拉取请求'],
    [/^([\d,.]+[km]?) releases?$/i, '$1 个发行版'],
    [/^([\d,.]+[km]?) tags?$/i, '$1 个标签'],
    [/^([\d,.]+[km]?) comments?$/i, '$1 条评论'],
    [/^([\d,.]+[km]?) commits?$/i, '$1 次提交'],
    [/^([\d,.]+[km]?) (?:changed )?files?$/i, '$1 个文件'],
    [/^([\d,.]+[km]?) files? changed$/i, '$1 个变更文件'],
    [/^(\d+) open \/ (\d+) closed$/i, '$1 个待处理 / $2 个已关闭'],

    // 相对时间
    [/^less than a minute ago$/i, '不到 1 分钟前'],
    [/^(\d+) seconds? ago$/i, '$1 秒前'],
    [/^(\d+) minutes? ago$/i, '$1 分钟前'],
    [/^(\d+) hours? ago$/i, '$1 小时前'],
    [/^(\d+) days? ago$/i, '$1 天前'],
    [/^(\d+) weeks? ago$/i, '$1 周前'],
    [/^(\d+) months? ago$/i, '$1 个月前'],
    [/^(\d+) years? ago$/i, '$1 年前'],
    [/^about (\d+) minutes? ago$/i, '约 $1 分钟前'],
    [/^about (\d+) hours? ago$/i, '约 $1 小时前'],
    [/^about (\d+) days? ago$/i, '约 $1 天前'],

    // 常见句式
    [/^(?:Signed in|Logged in) as (.+)$/i, '登录身份：$1'],
    [/^Showing ([\d,.]+[km]?) of ([\d,.]+[km]?) results?$/i, '显示 $1 / $2 条结果'],
    [/^Showing ([\d,.]+[km]?) of ([\d,.]+[km]?) (.+)$/i, '显示 $1 / $2 项'],
    [/^View (?:all |more )?([\d,.]+[km]?) (?:more|older) (?:commits?|revisions?)$/i, '查看更多历史记录'],
    [/^Browse (?:all|other) (.+)$/i, '浏览$1'],
    [/^(?:View|See) all (.+)$/i, '查看全部$1'],
    [/^Compare (.+) with (.+)$/i, '比较 $1 与 $2'],
    [/^You also have access to this repository via (.+)$/i, '你也通过 $1 拥有此仓库的访问权限'],
    [/^([\w.-]+) commented on this (?:issue|pull request)$/i, '$1 评论道'],
    [/^([\w.-]+) commented$/i, '$1 评论道'],
    [/^([\w.-]+) opened this (?:issue|pull request)$/i, '$1 创建'],
    [/^([\w.-]+) (?:closed|merged) this (?:issue|pull request)$/i, '$1 已关闭']
  ];

  const TITLE_RULES = [
    [/^Issues? · (.+)$/, '问题 · $1'],
    [/^(?:Pull requests?|Pull Request) · (.+)$/, '拉取请求 · $1'],
    [/^Conversations? · (.+)$/, '会话 · $1'],
    [/^Commits? · (.+)$/, '提交 · $1'],
    [/^Actions? · (.+)$/, '动作 · $1'],
    [/^Code · (.+)$/, '代码 · $1'],
    [/^Wiki · (.+)$/, '维基 · $1'],
    [/^(?:Security & analysis|Security) · (.+)$/, '安全 · $1'],
    [/^Insights · (.+)$/, '洞察 · $1'],
    [/^Releases? · (.+)$/, '发行版 · $1'],
    [/^Settings? · GitHub$/, '设置 · GitHub'],
    [/^(?:New issue|Submit new issue) · (.+)$/, '新建问题 · $1'],
    [/^New pull request · (.+)$/, '新建拉取请求 · $1'],
    [/^(\d+) Issues? · GitHub$/, '$1 个问题 · GitHub'],
    [/^\((\d+) Notifications?\) · GitHub$/, '（$1）通知 · GitHub']
  ];

  /* ===== 引擎 ===== */

  const SKIP_TAGS = new Set([
    'CODE', 'PRE', 'KBD', 'SAMP', 'VAR', 'SCRIPT', 'STYLE', 'NOSCRIPT',
    'TEXTAREA', 'TITLE', 'SVG', 'CANVAS', 'TEMPLATE', 'HEAD'
  ]);

  const SKIP_SELECTOR = [
    '[contenteditable="true"]',
    '.markdown-body',
    '.blob-code',
    '.blob-code-inner',
    '.commit-hash',
    '.commit-ref',
    '.cm-content',
    '.Highlight',
    '[data-no-translate]'
  ].join(', ');

  const ATTRS = ['title', 'aria-label', 'placeholder', 'data-confirm', 'data-disable-with', 'data-content'];
  const VALUE_TYPES = new Set(['button', 'submit', 'reset']);
  const MAX_TEXT_LENGTH = 300;

  const hanRe = /\p{Script=Han}/u;

  function translate(raw) {
    if (typeof raw !== 'string' || !raw) return null;
    if (raw.length > MAX_TEXT_LENGTH) return null;

    const key = raw.trim().replace(/\u00a0|[\s\u200b]+/g, ' ');
    if (!key || hanRe.test(key) || !/[A-Za-z]/.test(key)) return null;

    let value = Object.prototype.hasOwnProperty.call(STATIC, key) ? STATIC[key] : null;
    if (value === undefined) value = null;

    if (value === null) {
      for (const [pattern, replacement] of REGEXP) {
        const replaced = key.replace(pattern, replacement);
        if (replaced !== key) {
          value = replaced;
          break;
        }
      }
    }

    if (!value || value === key) return null;

    const parts = /^(\s*)([\s\S]*?)(\s*)$/.exec(raw);
    return parts[1] + value + parts[3];
  }

  function skipElement(element) {
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      if (SKIP_TAGS.has(current.nodeName.toUpperCase())) return true;
      if (current.matches && current.matches(SKIP_SELECTOR)) return true;
      current = current.parentElement;
    }
    return false;
  }

  function translateAttributes(element) {
    for (const name of ATTRS) {
      const value = element.getAttribute(name);
      const translated = translate(value);
      if (translated !== null && translated !== value) {
        element.setAttribute(name, translated);
      }
    }

    if (element.nodeName === 'INPUT' && VALUE_TYPES.has(element.type)) {
      const value = element.getAttribute('value');
      const translated = translate(value);
      if (translated !== null && translated !== value) {
        element.setAttribute('value', translated);
      }
    }
  }

  function walk(root) {
    if (!root || root.nodeType === Node.TEXT_NODE) return;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node === root) return NodeFilter.FILTER_ACCEPT;
        return skipElement(node.nodeType === Node.TEXT_NODE ? node.parentElement : node)
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT;
      }
    });

    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.TEXT_NODE) {
        const translated = translate(node.data);
        if (translated !== null && translated !== node.data) node.data = translated;
      } else {
        translateAttributes(node);
      }
    }
  }

  function translateTitle() {
    const key = String(document.title || '').trim().replace(/\s+/g, ' ');
    if (!key || hanRe.test(key)) return;

    const value = Object.prototype.hasOwnProperty.call(STATIC, key) ? STATIC[key] : null;
    if (typeof value === 'string' && value !== key) {
      document.title = value;
      return;
    }

    for (const [pattern, replacement] of TITLE_RULES) {
      const replaced = key.replace(pattern, replacement);
      if (replaced !== key) {
        document.title = replaced;
        return;
      }
    }
  }

  const dirty = new Set();
  let flushTimer = null;

  function flush() {
    flushTimer = null;
    const roots = Array.from(dirty);
    dirty.clear();
    for (const root of roots) {
      if (root.isConnected) walk(root);
    }
    translateTitle();
  }

  function markDirty(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return;
    dirty.add(element);
    if (!flushTimer) flushTimer = setTimeout(flush, 120);
  }

  let lastURL = typeof location === 'undefined' ? '' : location.href;

  function onRoute() {
    lastURL = location.href;
    translateTitle();
    markDirty(document.body);
  }

  function startObserver() {
    const observer = new MutationObserver(mutations => {
      if (location.href !== lastURL) onRoute();

      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          if (mutation.target.nodeType === Node.ELEMENT_NODE && !skipElement(mutation.target)) {
            translateAttributes(mutation.target);
          }
        } else if (mutation.type === 'characterData') {
          markDirty(mutation.target.parentElement);
        } else {
          mutation.addedNodes.forEach(markDirty);
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributeFilter: ATTRS.concat(['value'])
    });

    // 保持中文 lang 属性，避免被页面脚本改回 en 后时间/日期格式回退
    const langObserver = new MutationObserver(() => {
      if (document.documentElement.lang === 'en') document.documentElement.lang = 'zh-CN';
    });
    langObserver.observe(document.documentElement, { attributeFilter: ['lang'] });

    window.addEventListener('turbo:load', onRoute);
    window.addEventListener('popstate', onRoute);
    document.addEventListener('urlchange', onRoute);
  }

  // @run-at document-start 时 body 还不存在，等 DOMContentLoaded 再动手
  const boot = () => {
    if (!document.body) return;
    document.documentElement.lang = 'zh-CN';
    translateTitle();
    walk(document.body);
    startObserver();
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
