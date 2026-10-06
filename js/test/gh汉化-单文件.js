// ==UserScript==
// @name         GitHub 中文化（单文件版，无需词库脚本）
// @namespace    local
// @description  自带内联词库的 GitHub 界面中文化脚本，不依赖 @require，可直接粘贴进 Tampermonkey/暴力猫。
// @author       local
// @version      1.0.0
// @license      MIT
// @match        https://github.com/*
// @match        https://gist.github.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

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
    const key = document.title.trim().replace(/\s+/g, ' ');
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

  function init() {
    if (!document.body) {
      setTimeout(init, 50);
      return;
    }

    document.documentElement.lang = 'zh-CN';
    translateTitle();
    walk(document.body);
    startObserver();
  }

  init();
})();
