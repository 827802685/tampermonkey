// ==UserScript==
// @name         GitHub 不通自动切 gh 代理
// @namespace    zjkl.ghproxy
// @version      1.2.3
// @description  【安装后必做】给篡改猴打开「允许用户脚本」和「允许访问文件 URL」两个开关，否则脚本不会执行。功能：github.com 网络不稳时自动改用 gh.zjkl0330.dpdns.org —— 主动探测 + 资源加载失败 + 请求挂起（黑洞超时）三种信号，判定不稳后改写本页链接，正在卡住的页面整页搬到代理域
// @author       zjkl
// @match        *://github.com/*
// @match        *://www.github.com/*
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
// 范围：@match 只覆盖 github 系域名和代理域名，不会在每个网站注入。
//       如果你希望「在别的网站（搜索页、博客）点 github 链接也自动改写」，在上面 @match 区补一行：
//           // @match *://*/*
//       代价是脚本注入所有页面、篡改猴图标常亮。

(() => {
  'use strict';

  const BASE = 'zjkl0330.dpdns.org';

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
