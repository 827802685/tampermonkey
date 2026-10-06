import fs from 'node:fs';

const src = fs.readFileSync('F:/work/gh汉化-单文件.js', 'utf8');

const dictStart = src.indexOf('/* ===== 词库（内联） ===== */');
const dictEnd = src.indexOf('/* ===== 引擎 ===== */');
if (dictStart < 0 || dictEnd < 0) throw new Error('找不到分隔标记');

const dataBlock = src.slice(dictStart, dictEnd);
const { STATIC, REGEXP, TITLE_RULES } = new Function(
  dataBlock + '\nreturn { STATIC, REGEXP, TITLE_RULES };'
)();

// 1) 重复键检测
const keyRe = /^\s{4}'((?:[^'\\]|\\.)+)':\s/g;
const seen = new Map();
const dupes = [];
let m;
while ((m = keyRe.exec(dataBlock))) {
  seen.set(m[1], (seen.get(m[1]) || 0) + 1);
  if (seen.get(m[1]) === 2) dupes.push(m[1]);
}

// 2) 危险键：含正则元字符 / 纯数字 / 空
const badKeys = Object.keys(STATIC).filter(k => !k.trim() || !/[A-Za-z]/.test(k));

// 3) 引擎翻译函数（抽出真实实现，不重写）
const trStart = src.indexOf('const ATTRS');
const trEnd = src.indexOf('function skipElement');
const translate = new Function('STATIC', 'REGEXP',
  src.slice(trStart, trEnd) + '\nreturn translate;'
)(STATIC, REGEXP);

const samples = [
  'Pull requests', 'Notifications', 'New repository', 'Settings',
  'Star', 'Unstar', 'Compare & pull request', 'Files changed',
  '1.2k stars', '3 forks', '2 hours ago', 'Showing 12 of 148 results',
  'Signed in as octocat', 'Search or jump to…',
  '  Code  ', 'README.md', 'main', 'a91f3c2', 'this is a sentence about the repo',
  'Issue #42: login broken on Safari', '已加星', 'Add a third-party extension',
  'Workflows', 'There aren’t any releases here', 'No results'
];

const results = samples.map(s => [s, translate(s)]);

console.log('静态词条数:', Object.keys(STATIC).length);
console.log('正则条数:', REGEXP.length, '/ 标题规则条数:', TITLE_RULES.length);
console.log('重复键:', dupes.length ? dupes : '无');
console.log('异常键:', badKeys.length ? badKeys : '无');
console.log('\n抽样:');
for (const [input, out] of results) {
  console.log(JSON.stringify(input).padEnd(46), '->', out === null ? '(不翻译)' : JSON.stringify(out));
}
