/**
 * 作品集页面检查（差距诊断 G9）：它是给前台读者看的那一页，
 * 因此钉住三件事——六个部分齐全、引用的素材真实存在、页面上的数字与主文档同源。
 * 数字同源这条最重要：页面上写死的数字最容易在后续迭代里过期，而它恰好是说服力的来源。
 * 运行方式：node --test tests/portfolio.page.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const page = fs.readFileSync(path.join(ROOT, '作品集_CaseStudy_V1.0.html'), 'utf8');
const master = fs.readFileSync(path.join(DOCS_DIR, '作品集主文档_V1.3.md'), 'utf8');

test('六个部分齐全，按问题 → 判断 → 取舍 → 验证 → 结果 → 复盘组织', () => {
  [
    '一、问题与目标用户',
    '二、四条关键判断',
    '三、被放弃的方案',
    '四、评测体系',
    '五、结果',
    '六、复盘'
  ].forEach((heading) => {
    assert.ok(page.includes(heading), '页面应保留小节：' + heading);
  });
});

test('标注依据强度，不把推演写成已验证的事实', () => {
  assert.ok(page.includes('尚无访谈或问卷的一手数据'), '应写明用户证据缺失');
  assert.ok(page.includes('依据强度'), '应标注依据强度');
});

test('保留「我的角色」待认领提示，避免读者默认全文由 AI 产出', () => {
  assert.ok(page.includes('七、我的角色'), '应有我的角色一节');
  assert.ok(page.includes('待本人认领后填写'), '应显式标注待认领');
});

test('引用的图片与视频都真实存在', () => {
  const assets = [...page.matchAll(/src="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((value) => !value.startsWith('http'));

  assert.ok(assets.length >= 3, '应引用录屏与两张界面图，实际 ' + assets.length + ' 条');
  assets.forEach((asset) => {
    assert.ok(fs.existsSync(path.join(ROOT, asset)), '素材应存在：' + asset);
  });

  assert.ok(page.includes('demo-flow.webm'), '应嵌入主流程录屏');
});

test('页面上的测试条数与覆盖率与主文档同源', () => {
  const total = master.match(/(\d+) 项（单测与集成/);
  const coverage = master.match(/整体 ([\d.]+)%/);

  assert.ok(total, '主文档应写出测试总条数');
  assert.ok(coverage, '主文档应写出整体覆盖率');
  assert.ok(page.includes(`${total[1]} 项`), `页面应写出与主文档一致的测试条数 ${total[1]} 项`);
  assert.ok(page.includes(`${coverage[1]}%`), `页面应写出与主文档一致的覆盖率 ${coverage[1]}%`);
});

test('评测体系如实标注外部盲测尚未回收', () => {
  assert.ok(page.includes('待回收'), '应标注盲测待回收');
  assert.ok(page.includes('合规率'), '应使用合规率而不是合格率');
  assert.ok(!page.includes('合格率'), '页面不应再出现「合格率」');
});
