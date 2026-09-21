/**
 * 访谈记录检查：访谈记录是 G1 的一手证据，
 * 因此钉住三件事——样本状态写明、假设允许被证伪、与既有文档的冲突必须留在纸面上。
 * 运行方式：node --test tests/interview.record.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const doc = fs.readFileSync(path.join(DOCS_DIR, '用户访谈记录_V1.0.md'), 'utf8');

test('标注版本与进度，并声明这是自访谈、不计入第三方人数', () => {
  assert.ok(/版本号：V1\.\d/.test(doc), '应标注版本号');
  assert.ok(doc.includes('第三方访谈 0 / 3 人'), '应写出第三方访谈进度');
  assert.ok(doc.includes('自访谈 1 份'), '应写明另有 1 份自访谈');
  assert.ok(doc.includes('不计入这个人数'), '应声明自访谈不计入 G1 人数');
  assert.ok(doc.includes('自证偏差'), '应点明自访谈的自证偏差');
  assert.ok(doc.includes('只对作者本人成立'), '应限制结论的适用范围');
  assert.ok(doc.includes('不是用户证据'), '应明确自访谈不是用户证据');
});

test('记录受访者画像与筛选结论', () => {
  assert.ok(doc.includes('| P1 |'), '应记录受访者代号');
  assert.ok(doc.includes('100+'), '应记录投递规模');
  assert.ok(doc.includes('是否符合筛选'), '应给出筛选结论');
});

test('六条假设逐条判定，且不把口径差异写成「被推翻」', () => {
  for (let index = 1; index <= 6; index += 1) {
    assert.ok(doc.includes('| H' + index + ' |'), '应包含假设 H' + index);
  }
  assert.ok(doc.includes('成立，并补上一类原因'), 'H4 应记录「原有原因成立 + 补一层」，不是替换');
  assert.ok(doc.includes('口径不同、不矛盾'), '耗时口径应写成两个口径，而不是冲突');
  assert.ok(!doc.includes('原因猜错了'), '不应把口径差异写成「猜错了」');
});

test('口径澄清单独成节，并保留初稿误读的更正痕迹', () => {
  assert.ok(doc.includes('与既有文档的口径澄清'), '应有口径澄清小节');
  assert.ok(doc.includes('5–10 分钟'), '应保留「从零撰写」这个口径');
  assert.ok(doc.includes('更正记录留在这里'), '应保留更正痕迹，不悄悄抹掉');
  assert.ok(doc.includes('没有推翻主文档的任何判断'), '应写明本次访谈与既有判断的关系');
});

test('带出的产品线索标注为待验证', () => {
  assert.ok(doc.includes('待验证'), '产品线索应标注为待验证');
  assert.ok(doc.includes('未覆盖'), '应记录与核心机制相关的线索');
  assert.ok(doc.includes('都还没有验证，不属于结论'), '应声明线索不是结论');
});

test('专家访谈与下一步都在文档里', () => {
  assert.ok(doc.includes('样本局限'), '应写明样本局限');
  assert.ok(doc.includes('**本人**'), '应记录受访者就是项目作者本人');
  assert.ok(doc.includes('再找 2–4 人'), '应给出下一步');
  assert.ok(doc.includes('不要与外部盲测的 3–5 人重合'), '应保持两组证据的独立性');
});

test('引用的仓库路径都真实存在', () => {
  const targets = [...doc.matchAll(/\]\(([^)\s]+\.md)\)/g)].map((match) => match[1]);

  assert.ok(targets.length >= 2, '应引用差距诊断与访谈提纲，实际 ' + targets.length + ' 条');
  targets.forEach((target) => {
    assert.ok(
      fs.existsSync(path.resolve(DOCS_DIR, target)),
      '引用路径应存在（相对 docs/）：' + target
    );
  });
});
