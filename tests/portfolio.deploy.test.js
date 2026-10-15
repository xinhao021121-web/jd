/**
 * 作品集部署物料检查（差距诊断 G9）。
 *
 * 部署链路上最容易出两种错：源页面引用了不存在的素材（部署后才 404），
 * 或者有人把源文件里的路径改成了部署形态（本地就打不开了）。
 * 运行方式：node --test tests/portfolio.deploy.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, '作品集_CaseStudy_V1.0.html'), 'utf8');
const home = fs.readFileSync(path.join(ROOT, '作品集_首页_V1.0.html'), 'utf8');

test('首页承担入口职责：自我介绍 + 求职方向 + 项目索引 + 联系方式', () => {
  assert.ok(home.includes('求职方向：AI 产品经理'), '首页要点明求职方向');
  assert.ok(home.includes('我是谁'), '首页要有自我介绍，读者才知道这人是谁');
  assert.ok(home.includes('作品'), '首页要有项目索引');
  assert.ok(home.includes('portfolio.html'), '首页要能进到完整案例');
  assert.ok(home.includes('mailto:') || home.includes('github.com'), '首页要给出联系方式');
});

test('产品入口链接指向境内可直连的地址，不再使用已被阻断的 ccwu.cc', () => {
  const links = [...home.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((match) => match[1]);
  assert.ok(links.length > 0, '首页应有对外链接');

  // ccwu.cc 在境内被整体阻断（TCP 通、TLS 阶段被重置），不能作为给招聘方的入口
  const blocked = links.filter((url) => new URL(url).host.endsWith('ccwu.cc'));
  assert.deepEqual(blocked, [], 'ccwu.cc 不应作为首页入口：' + blocked.join('、'));

  assert.ok(
    links.some((url) => new URL(url).host === 'xinhao021121-web.github.io'),
    '问需的产品入口应指向境内实测可达的 GitHub Pages 地址'
  );
});
test('入口命名统一：只用词表里约定的几种叫法', () => {
  const labels = [...home.matchAll(/<a href="[^"]+"[^>]*>([^<]+)<\/a>/g)].map((match) => match[1].trim());
  const entryLabels = labels.filter((label) => label.endsWith('→'));

  // 米家那一条是分析型项目：没有线上产品页、没有源码，只有竞品分析与 PRD 两份文档
  const allowed = new Set([
    '产品页入口 →',
    '案例 →',
    '源码 →',
    '研究结论 →',
    '竞品分析 →',
    'PRD →'
  ]);
  const unknown = entryLabels.filter((label) => !allowed.has(label));
  assert.deepEqual(unknown, [], '入口只能使用统一词表，多余的叫法：' + unknown.join('、'));

  assert.equal(
    labels.filter((label) => label === '产品页入口 →').length,
    3,
    '三个项目卡片都要有「产品页入口」'
  );
  assert.ok(labels.includes('案例 →'), '直聘项目要有「案例」入口');
  assert.ok(labels.includes('研究结论 →'), '问需项目要有「研究结论」入口');
  assert.equal(
    labels.filter((label) => label === '源码 →').length,
    3,
    '三个项目都应有「源码」入口'
  );

  ['打开产品入口页', '直接体验', '打开演示工作台', '读完整案例', '访谈结论'].forEach((legacy) => {
    assert.ok(!home.includes(legacy), '旧的入口文案应已统一：' + legacy);
  });
});
test('源页面引用的素材全部存在', () => {
  const referenced = [
    ...new Set([...source.matchAll(/docs\/assets\/([^"'\s)]+)/g)].map((match) => match[1]))
  ];

  assert.ok(referenced.length >= 3, '应引用图片、录屏与 PDF，实际 ' + referenced.length + ' 条');
  referenced.forEach((name) => {
    assert.ok(
      fs.existsSync(path.join(ROOT, 'docs/assets', name)),
      '素材应存在（部署后 404 就是这里漏了）：' + name
    );
  });
});

test('源页面用本地路径，部署用的路径由同步脚本生成', () => {
  assert.ok(source.includes('docs/assets/'), '源文件应使用 docs/assets/ 前缀，本地才能直接打开');
  assert.ok(!source.includes('portfolio-assets/'), '源文件不应出现部署形态的路径');
});

test('同步脚本已挂进构建流程，产物目录被忽略', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');

  assert.ok(pkg.scripts['portfolio:sync'], '应有 portfolio:sync 脚本');
  assert.ok(pkg.scripts.build.includes('portfolio:sync'), 'pnpm build 应先跑同步');
  assert.ok(ignore.includes('apps/web/public/'), '同步产物不应进仓库');
});

test('PDF 版可从页面下载，且页面在 print 下保留录屏提示', () => {
  assert.ok(source.includes('作品集_CaseStudy_V1.0.pdf'), '页面应提供 PDF 下载入口');
  assert.ok(source.includes('video-note'), 'print 版本应说明录屏在哪，而不是留一块空白');
});
