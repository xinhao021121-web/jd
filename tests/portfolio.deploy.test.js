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
