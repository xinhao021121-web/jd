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

test('七个部分齐全，按问题 → 判断 → 取舍 → 验证 → 结果 → 定位 → 复盘组织', () => {
  [
    '一、问题与目标用户',
    '二、四条关键判断',
    '三、被放弃的方案',
    '四、评测体系',
    '五、结果',
    '六、定位与边界',
    '七、复盘'
  ].forEach((heading) => {
    assert.ok(page.includes(heading), '页面应保留小节：' + heading);
  });
});

test('主动回应「加重招聘方负担」的质疑，而不是等面试官提出来', () => {
  assert.ok(page.includes('这个质疑有一半成立'), '应承认质疑的合理部分');
  assert.ok(page.includes('不自动发送'), '应给出硬约束');
  assert.ok(page.includes('技能匹配型写一条仍要 1–2 分钟用于审核') || page.includes('这不是零成本群发'), '应给出使用成本层面的观察');
  assert.ok(page.includes('没有验证的部分'), '应标注哪部分还没有数据');
});

test('证据边界做成独立区块，紧跟数字条之后', () => {
  assert.ok(page.includes('证据边界'), '应有证据边界区块');
  assert.ok(page.includes('不计入用户证据'), '应写明自访谈不计入用户证据');
  assert.ok(page.includes('目前仍是推演'), '应明说用户需求这一层仍是推演');
  assert.ok(page.includes('补齐计划'), '应写明补齐计划');

  // 位置：数字条之后、正文第一节之前
  const facts = page.indexOf('class="facts"');
  const evidence = page.indexOf('class="evidence"');
  const firstSection = page.indexOf('一、问题与目标用户');
  assert.ok(facts > 0 && evidence > facts, '证据边界应排在数字条之后');
  assert.ok(firstSection > evidence, '证据边界应排在正文第一节之前');
});

test('原依据强度标注仍然保留在第一节', () => {
  assert.ok(page.includes('依据强度'), '第一节应保留依据强度标注');
  assert.ok(page.includes('第三方用户证据仍为零'), '应写明第三方用户证据为零');
});

test('「我的角色」显示认领进度：已认领四条 + 仍待补全四项', () => {
  assert.ok(page.includes('八、我的角色'), '应有我的角色一节');
  assert.ok(page.includes('已由本人认领的四条'), '应列出已认领的取舍');
  assert.ok(page.includes('仍待补全的四件事'), '应写明还没补的部分，而不是假装完整');
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
