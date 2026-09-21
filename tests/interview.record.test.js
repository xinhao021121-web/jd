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

test('标注版本与进度，并声明样本未达标', () => {
  assert.ok(/版本号：V1\.\d/.test(doc), '应标注版本号');
  assert.ok(doc.includes('进度：1 / 3 人'), '应写出当前进度');
  assert.ok(doc.includes('样本未达标'), '应显式声明样本量未达验收口径');
  assert.ok(doc.includes('不得在对外材料里当作结论使用'), '应限制未达标样本的使用方式');
});

test('记录受访者画像与筛选结论', () => {
  assert.ok(doc.includes('| P1 |'), '应记录受访者代号');
  assert.ok(doc.includes('100+'), '应记录投递规模');
  assert.ok(doc.includes('是否符合筛选'), '应给出筛选结论');
});

test('六条假设逐条判定，且允许「不成立」', () => {
  for (let index = 1; index <= 6; index += 1) {
    assert.ok(doc.includes('| H' + index + ' |'), '应包含假设 H' + index);
  }
  assert.ok(doc.includes('不成立'), '应保留证伪结果，而不是只记录成立的部分');
  assert.ok(doc.includes('原因猜错了'), '应显式写出被推翻的假设');
});

test('与既有文档的冲突单独成节，不悄悄改掉', () => {
  assert.ok(doc.includes('与既有文档冲突的地方'), '应有冲突小节');
  assert.ok(doc.includes('5–10 分钟'), '应记下被修正的旧数字');
  assert.ok(doc.includes('已按实测改写'), '应写明旧表述的处置方式');
});

test('带出的产品线索标注为待验证', () => {
  assert.ok(doc.includes('待验证'), '产品线索应标注为待验证');
  assert.ok(doc.includes('未覆盖'), '应记录与核心机制相关的线索');
  assert.ok(doc.includes('都还没有验证，不属于结论'), '应声明线索不是结论');
});

test('专家访谈与下一步都在文档里', () => {
  assert.ok(doc.includes('样本局限'), '应写明样本局限');
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
