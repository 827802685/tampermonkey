const fs = require('fs');
const vm = require('vm');
const code = fs.readFileSync('F:/work/github-proxy.user.js', 'utf8');

const KEY = 'gh-proxy-state-v2';

function mkAnchor(href) {
  const a = { nodeType: 1, tagName: 'A', href, getAttribute: () => a.href };
  a.closest = (sel) => (sel === 'a[href]' ? a : null);
  a.querySelectorAll = (sel) => (sel.startsWith('a[') ? [a] : []);
  return a;
}

async function run(startUrl, {
  ghOk = true, proxyOk = true, ghMs = 0, proxyMs = 0, seed = {}, anchors = [], test = {}, hang = false, preset = {},
} = {}) {
  const ls = {}; const ss = {};
  if (Object.keys(seed).length) ls[KEY] = JSON.stringify(seed);
  Object.assign(ls, preset);
  const nav = []; const listeners = []; const observers = []; const menus = []; const alerts = [];
  const domPushed = [];

  const mkNode = (tag) => {
    const n = { nodeType: 1, tagName: String(tag).toUpperCase(), children: [], textContent: '' };
    n.setAttribute = (k, v) => { n[k] = v; };
    n.appendChild = (c) => { n.children.push(c); return c; };
    n.addEventListener = (t, fn) => { (n.handlers ||= {})[t] = fn; };
    n.remove = () => { n.removed = true; };
    return n;
  };

  const docEl = {
    nodeType: 1, tagName: 'HTML',
    querySelectorAll: (sel) => anchors.filter((a) => /^https?:|^\/\//.test(a.href)),
    appendChild: (c) => { domPushed.push(c); return c; },
  };
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, Date, JSON,
    Object, Set, Map, Array, Math, URL, Promise, Error, AbortController, Headers, Response,
    location: {
      href: startUrl,
      hostname: new URL(startUrl).hostname,
      protocol: 'https:',
      pathname: new URL(startUrl).pathname,
      search: new URL(startUrl).search,
      replace: (u) => nav.push(u),
    },
    localStorage: { getItem: (k) => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); } },
    sessionStorage: { getItem: (k) => (k in ss ? ss[k] : null), setItem: (k, v) => { ss[k] = String(v); } },
    document: {
      documentElement: docEl, nodeType: 9, activeElement: null, readyState: 'complete',
      createElement: mkNode,
    },
    addEventListener: (type, fn, cap) => listeners.push({ type, fn, cap }),
    MutationObserver: class { constructor(cb) { this.cb = cb; observers.push(this); } observe() {} },
    requestIdleCallback: (fn) => fn(),
    alert: (m) => alerts.push(m),
    GM_registerMenuCommand: (label, fn) => menus.push({ label, fn }),
    __ghProxyTest: test,
    XMLHttpRequest: class {
      constructor() { this.listeners = {}; }
      addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
      open(m, u) { this.url = u; }
      send() { if (!hang) for (const fn of this.listeners.loadend || []) fn(); }
    },
    fetch: async (u) => {
      // 黑洞挂起：页面里的请求永远不返回（实测 github.com 有 12 秒连 TCP 都没建上的时候）
      if (hang && String(u).includes('hangme')) return new Promise(() => {});
      const host = new URL(u).hostname;
      const isGh = host === 'github.com';
      const ok = isGh ? ghOk : proxyOk;
      await new Promise((x) => setTimeout(x, isGh ? ghMs : proxyMs));
      if (!ok) throw new TypeError('Failed to fetch');
      return {};
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  const wait = ghMs + proxyMs + 60;
  await new Promise((r) => setTimeout(r, wait));
  await new Promise((r) => setTimeout(r, wait));
  const getState = () => JSON.parse(ls[KEY] || '{}');
  const fireResourceError = (src) => {
    const l = listeners.find((x) => x.type === 'error');
    if (!l) throw new Error('未注册 error 监听');
    l.fn({ target: { src, nodeType: 1 } });
  };
  const fireClick = (a) => {
    const l = listeners.find((x) => x.type === 'pointerdown');
    if (!l) throw new Error('未注册 pointerdown');
    l.fn({ target: a });
  };
  return { sandbox, nav, ls, ss, menus, alerts, getState, fireResourceError, fireClick, observers, domPushed };
}

const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log('   got :', JSON.stringify(got), '\n   want:', JSON.stringify(want));
  return ok;
};

(async () => {
  let all = true;

  // 1. 主站探测不通 -> 整页跳代理 + 改写本页链接
  let a1 = mkAnchor('https://github.com/foo/bar');
  let r = await run('https://github.com/torvalds/linux', { ghOk: false, anchors: [a1] });
  all &= eq('不通 -> 整页跳 gh.', r.nav, ['https://gh.zjkl0330.dpdns.org/torvalds/linux']);
  all &= eq('不通 -> 同时改写本页链接', a1.href, 'https://gh.zjkl0330.dpdns.org/foo/bar');
  all &= eq('不通 -> 记录 blocked', r.getState().blocked, true);

  // 2. 都通 -> 什么都不做
  a1 = mkAnchor('https://github.com/foo/bar');
  r = await run('https://github.com/torvalds/linux', { anchors: [a1] });
  all &= eq('都通 -> 不跳转', r.nav, []);
  all &= eq('都通 -> 不改写链接', a1.href, 'https://github.com/foo/bar');

  // 3. 关键用例：页面已加载、探测当时是通的，随后资源被 reset -> 立即粘性 + 改写链接，但不打断当前页
  a1 = mkAnchor('https://github.com/octocat/Hello-World');
  r = await run('https://github.com/settings/stars', { anchors: [a1] });
  r.fireResourceError('https://github.githubassets.com/assets/x-deadbeef.js');
  const s3 = r.getState();
  all &= eq('资源失败 -> 标记粘性', s3.blocked === true && s3.stickyUntil > Date.now(), true);
  all &= eq('资源失败 -> 改写 star 列表链接', a1.href, 'https://gh.zjkl0330.dpdns.org/octocat/Hello-World');
  all &= eq('资源失败 -> 当前页不被踢走', r.nav, []);

  // 4. MutationObserver 处理动态插入的节点
  a1 = mkAnchor('https://github.com/foo/bar');
  const obs = r.observers[0];
  const late = mkAnchor('https://github.com/new/repo');
  obs.cb([{ type: 'childList', addedNodes: [{ nodeType: 1, tagName: 'DIV', querySelectorAll: () => [late], closest: () => null }] }]);
  await new Promise((x) => setTimeout(x, 5));
  all &= eq('动态插入的链接也被改写', late.href, 'https://gh.zjkl0330.dpdns.org/new/repo');

  // 5. 粘性期内新开的 github 页：即使探测恢复也只改链接
  a1 = mkAnchor('https://github.com/foo/bar');
  r = await run('https://github.com/other/repo', {
    ghOk: true, anchors: [a1], seed: { blocked: false, proxyOk: true, ts: Date.now(), stickyUntil: Date.now() + 5 * 60e3 },
  });
  all &= eq('粘性 -> 改写链接', a1.href.startsWith('https://gh.'), true);
  all &= eq('粘性但主站已通 -> 不整页跳', r.nav, []);

  // 6. 代理自己不通 -> 绝不切，避免越切越坏
  a1 = mkAnchor('https://github.com/foo/bar');
  r = await run('https://github.com/torvalds/linux', { ghOk: false, proxyOk: false, anchors: [a1] });
  all &= eq('代理不通 -> 不跳转', r.nav, []);
  all &= eq('代理不通 -> 不改写', a1.href, 'https://github.com/foo/bar');

  // 7. 已在代理页 + 代理探测不通 -> 退回直连
  r = await run('https://gh.zjkl0330.dpdns.org/a/b', { proxyOk: false, seed: { proxyOk: false } });
  all &= eq('代理挂了 -> 退回 github.com', r.nav, ['https://github.com/a/b']);

  // 8. 已在代理页 + 强制直连 -> 退回
  r = await run('https://gh.zjkl0330.dpdns.org/a/b', { seed: { mode: 'direct' } });
  all &= eq('强制直连 -> 退回 github.com', r.nav, ['https://github.com/a/b']);

  // 9. 优先代理模式：主站通也走代理，但不踢当前页
  a1 = mkAnchor('https://github.com/foo/bar');
  r = await run('https://github.com/x/y', { anchors: [a1], seed: { mode: 'proxy', proxyOk: true } });
  all &= eq('优先代理 -> 改写链接', a1.href, 'https://gh.zjkl0330.dpdns.org/foo/bar');
  all &= eq('优先代理 -> 不整页跳（blocked 未知）', r.nav, []);

  // 10. 同 URL 20s 内不重复跳
  r = await run('https://github.com/torvalds/linux', { ghOk: false, seed: {} });
  all &= eq('单次运行只跳一次', r.nav.length, 1);

  // 10b. 能连但慢（1.5s）—— 按「快断了」处理：改写链接，但不整页跳
  a1 = mkAnchor('https://github.com/foo/bar');
  r = await run('https://github.com/torvalds/linux', { ghOk: true, ghMs: 1500, anchors: [a1] });
  all &= eq('慢链路 -> 记为粘性', r.getState().stickyUntil > Date.now(), true);
  all &= eq('慢链路 -> 改写本页链接', a1.href, 'https://gh.zjkl0330.dpdns.org/foo/bar');
  all &= eq('慢链路 -> 不整页跳（还活着）', r.nav, []);

  // 11. raw / assets / avatars 映射
  r = await run('https://raw.githubusercontent.com/a/b/main/x.js', { ghOk: false });
  all &= eq('raw -> -gh', r.nav, ['https://raw-githubusercontent-com-gh.zjkl0330.dpdns.org/a/b/main/x.js']);
  r = await run('https://github.githubassets.com/assets/a.js', { ghOk: false });
  all &= eq('assets -> -gh', r.nav, ['https://github-githubassets-com-gh.zjkl0330.dpdns.org/assets/a.js']);

  // 12. api.github.com 保持直连（本部署 522）
  r = await run('https://api.github.com/repos/a/b', { ghOk: false });
  all &= eq('api.github.com 不动', r.nav, []);

  // 13. 第三方页面点击 github 链接 -> 改写后再导航
  r = await run('https://example.com/q', { ghOk: false });
  const link = mkAnchor('https://github.com/some/repo');
  r.fireClick(link);
  all &= eq('第三方页点击 -> 链接换成代理', link.href, 'https://gh.zjkl0330.dpdns.org/some/repo');

  // 14. 菜单精简为 3 条 + 状态文案含不可代理域名清单
  r = await run('https://example.com/');
  all &= eq('3 个菜单项', r.menus.map((m) => m.label), [
    '状态 / 为什么没生效',
    '切换模式（自动 → 优先代理 → 强制直连）',
    '本页在 直连 ↔ 代理 之间互跳',
  ]);
  r.menus.find((m) => /状态 \/ 为什么/.test(m.label)).fn();
  all &= eq('状态里列出直连保留域名', /api\.github\.com/.test(r.alerts[0]), true);

  // 14c. 注入范围收窄：不能有全局 @match
  const header = code.slice(0, code.indexOf('// ==/UserScript=='));
  all &= eq('@match 条数 = 6', (header.match(/@match/g) || []).length, 6);
  all &= eq('没有全局 *://*/* 注入', /@match\s+\*:\/\/\*\/\*/.test(header), false);
  all &= eq('覆盖 github.com 与代理域', /@match\s+\*:\/\/github\.com\/\*/.test(header)
    && /@match\s+\*:\/\/\*\.zjkl0330\.dpdns\.org\/\*/.test(header), true);
  // 14b. 模式循环：自动 -> 优先代理 -> 强制直连 -> 自动
  r = await run('https://github.com/foo/bar');
  const cycle = r.menus.find((m) => /切换模式/.test(m.label));
  cycle.fn();
  all &= eq('循环一次 -> 优先代理', r.getState().mode, 'proxy');
  cycle.fn();
  all &= eq('再循环 -> 强制直连', r.getState().mode, 'direct');
  cycle.fn();
  all &= eq('再循环 -> 自动', r.getState().mode, 'auto');

  // 24. 自检命令：把「为什么没动」说清楚，并带上两个必开开关
  r = await run('https://github.com/foo/bar', { ghOk: true, seed: {} });
  r.menus.find((m) => /为什么没生效/.test(m.label)).fn();
  all &= eq('自检文案含「允许用户脚本」', /允许用户脚本/.test(r.alerts[0]), true);
  all &= eq('自检文案含「允许访问文件 URL」', /允许访问文件 URL/.test(r.alerts[0]), true);
  all &= eq('自检说明网络好时按兵不动', /按兵不动/.test(r.alerts[0]), true);

  r = await run('https://github.com/foo/bar', { seed: { mode: 'direct' } });
  r.menus.find((m) => /为什么没生效/.test(m.label)).fn();
  all &= eq('强制直连时自检点名原因', /强制直连/.test(r.alerts[0]), true);

  // 25. 首次运行在 github 页弹一次开关提醒
  r = await run('https://github.com/foo/bar');
  all &= eq('github 页首次弹层', r.domPushed.length, 1);
  all &= eq('弹层文案是开关指引', /允许用户脚本/.test(r.domPushed[0].textContent), true);
  all &= eq('弹层记下已提示', r.ls['gh-proxy-notice-v1'], '1');
  const btn = r.domPushed[0].children[0];
  btn.handlers.click();
  all &= eq('点「知道了」可关掉', r.domPushed[0].removed, true);

  // 26. 提示过就不再弹；非 github 页永远不弹
  r = await run('https://github.com/foo/bar', { preset: { 'gh-proxy-notice-v1': '1' } });
  all &= eq('已提示过 -> 不再弹', r.domPushed.length, 0);
  r = await run('https://example.com/q');
  all &= eq('第三方页不弹层', r.domPushed.length, 0);

  // 21. 粘性期内点「互跳」：既要改链接，也要把这一页搬走（旧版在 github 页只改链接）
  a1 = mkAnchor('https://github.com/foo/bar');
  r = await run('https://github.com/torvalds/linux', {
    ghOk: true, anchors: [a1],
    seed: { blocked: false, proxyOk: true, ts: Date.now(), stickyUntil: Date.now() + 60e3 },
  });
  all &= eq('粘性但主站已通 -> 启动时不搬页', r.nav, []);
  const recheck = r.menus.find((m) => /互跳/.test(m.label));
  recheck.fn();
  all &= eq('互跳命令 -> 改写本页链接', a1.href, 'https://gh.zjkl0330.dpdns.org/foo/bar');
  all &= eq('互跳命令 -> 把本页搬到代理', r.nav, ['https://gh.zjkl0330.dpdns.org/torvalds/linux']);

  // 22. 网络明明测着是通的，主动点「互跳」也必须搬
  r = await run('https://github.com/foo/bar', { ghOk: true, seed: {} });
  r.menus.find((m) => /互跳/.test(m.label)).fn();
  all &= eq('手动搬运 -> 立刻换成代理域', r.nav, ['https://gh.zjkl0330.dpdns.org/foo/bar']);
  all &= eq('手动搬运 -> 记下优先代理模式', r.getState().mode, 'proxy');

  // 22b. 反向：在代理域点「互跳」要跳回 github.com，并定成强制直连，否则下一页又被搬回来
  r = await run('https://gh.zjkl0330.dpdns.org/foo/bar', { seed: { proxyOk: true, mode: 'proxy' } });
  r.menus.find((m) => /互跳/.test(m.label)).fn();
  all &= eq('代理页 -> 跳回原站', r.nav, ['https://github.com/foo/bar']);
  all &= eq('代理页 -> 跳回后设为强制直连', r.getState().mode, 'direct');
  all &= eq('代理页 -> 跳回后清掉粘性', r.getState().stickyUntil, 0);
  // 跳回 github.com 后，直连模式必须让脚本彻底收手（不再改链接、不再搬页）
  a1 = mkAnchor('https://github.com/foo/bar');
  r = await run('https://github.com/foo/bar', { ghOk: false, anchors: [a1], seed: { mode: 'direct' } });
  all &= eq('强制直连 -> github 页不搬页', r.nav, []);
  all &= eq('强制直连 -> github 页不改链接', a1.href, 'https://github.com/foo/bar');

  // 23. 搬不动的域名要如实说，不要假装成功
  r = await run('https://api.github.com/repos/a/b');
  r.menus.find((m) => /互跳/.test(m.label)).fn();
  all &= eq('api.github.com -> 不跳', r.nav, []);
  all &= eq('api.github.com -> 说清楚搬不了', /搬不了/.test(r.alerts[0]), true);

  // 15. 黑洞挂起：请求卡住不会触发资源 error 事件，只能自己计时把整页搬到代理域
  a1 = mkAnchor('https://github.com/foo/bar');
  r = await run('https://github.com/torvalds/linux', { ghOk: true, anchors: [a1], hang: true, test: { stallMs: 300, recheckMs: 600000 } });
  r.sandbox.fetch('https://github.com/torvalds/linux/hangme');
  await new Promise((x) => setTimeout(x, 1200));
  all &= eq('请求挂住 -> 整页跳代理', r.nav, ['https://gh.zjkl0330.dpdns.org/torvalds/linux']);
  all &= eq('请求挂住 -> 记为粘性', r.getState().blocked === true && r.getState().stickyUntil > Date.now(), true);
  all &= eq('请求挂住 -> 顺手改写本页链接', a1.href, 'https://gh.zjkl0330.dpdns.org/foo/bar');

  // 16. 正在输入框里打字时不要换页（没提交的内容会丢），只改写链接交给下次点击
  a1 = mkAnchor('https://github.com/foo/bar');
  r = await run('https://github.com/torvalds/linux', { anchors: [a1], hang: true, test: { stallMs: 300, recheckMs: 600000 } });
  r.sandbox.document.activeElement = { tagName: 'TEXTAREA', value: '写到一半的 issue' };
  r.sandbox.fetch('https://github.com/torvalds/linux/hangme');
  await new Promise((x) => setTimeout(x, 1200));
  all &= eq('打字中 -> 不整页跳', r.nav, []);
  all &= eq('打字中 -> 照样改写链接', a1.href, 'https://gh.zjkl0330.dpdns.org/foo/bar');

  // 17. XHR 挂住同样算信号（GitHub 老代码还在用 XHR）
  r = await run('https://github.com/torvalds/linux', { hang: true, test: { stallMs: 300, recheckMs: 600000 } });
  const xhr = new r.sandbox.XMLHttpRequest();
  xhr.open('GET', 'https://github.com/x/hangme');
  xhr.send();
  await new Promise((x) => setTimeout(x, 1200));
  all &= eq('XHR 挂住 -> 整页跳代理', r.nav.length, 1);

  // 18. 探针自己的请求（带 _p=）不算卡住信号，否则是我们自己把自己踢走
  r = await run('https://github.com/torvalds/linux', { hang: true, test: { stallMs: 300, recheckMs: 600000 } });
  const n0 = r.nav.length;
  r.sandbox.fetch('https://github.com/favicon.ico?_p=1&hangme=1');
  await new Promise((x) => setTimeout(x, 1200));
  all &= eq('探针请求不触发跳转', r.nav.length, n0);

  // 19. 第三方页拦截器常驻：判定发生在点击那一刻（旧版只在「打开时已判不稳」才装，网络后坏就永远不装）
  r = await run('https://example.com/q', { ghOk: true });
  r.ls[KEY] = JSON.stringify({ blocked: true, proxyOk: true, ts: Date.now(), stickyUntil: Date.now() + 60e3 });
  const link2 = mkAnchor('https://github.com/some/repo');
  r.fireClick(link2);
  all &= eq('先好后坏 -> 点击仍改写', link2.href, 'https://gh.zjkl0330.dpdns.org/some/repo');

  // 20. 网络好好的时候不改写第三方页链接（无谓换域会丢登录态）
  r = await run('https://example.com/q', { ghOk: true });
  const link3 = mkAnchor('https://github.com/some/repo');
  r.fireClick(link3);
  all &= eq('网络好 -> 不改写', link3.href, 'https://github.com/some/repo');

  console.log(all ? '\nALL PASS' : '\nHAS FAILURES');
})();
