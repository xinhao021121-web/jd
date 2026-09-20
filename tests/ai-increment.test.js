/**
 * 规则基线文档检查（差距诊断 G11）：它要回答「去掉 AI 能不能做」，
 * 因此钉住三件事——基线口径写得足够清楚（不是稻草人）、关键数字与实测一致、
 * 结论的强度按「基线可以做得更好」打了折。
 * 运行方式：node --test tests/ai-increment.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const doc = fs.readFileSync(path.join(DOCS_DIR, '规则基线与AI增量_V1.0.md'), 'utf8');

test('标注版本，并指向差距诊断 G11', () => {
  assert.ok(/版本号：V1\.\d/.test(doc), '应标注版本号');
  assert.ok(doc.includes('2026/09/21'), '应记录实测时间');
  assert.ok(doc.includes('G11'), '应指向差距诊断的 G11');
  assert.ok(doc.includes('去掉 AI'), '应写明要回答的追问');
});

test('基线口径写清，且声明它不是稻草人', () => {
  assert.ok(doc.includes('只填简历原文里存在的技能与数字'), '应写清规则版的数据来源');
  assert.ok(doc.includes('基线是刻意做认真的'), '应声明基线不是故意做坏的');
  assert.ok(doc.includes('同一组函数') || doc.includes('规则完全一致'), '应写明两侧判定规则一致');
});

test('关键实测数字齐全', () => {
  ['22', '6', '0.514', '0.03', '0.018'].forEach((value) => {
    assert.ok(doc.includes(value), '应包含实测值：' + value);
  });
  assert.ok(doc.includes('1443 输入 + 610 输出'), '应写出模型版的 token 实测值');
  assert.ok(doc.includes('12 处'), '应给出规则版话术长度违规的条数');
});

test('结论点明方向层面的问题，而不只是效果好坏', () => {
  assert.ok(doc.includes('方向不成立'), '应给出方向层面的判断');
  assert.ok(doc.includes('模板方案去解决模板问题'), '应写出论证的闭环');
  assert.ok(doc.includes('唯一的优势是成本与延迟'), '应如实写明规则版的优势');
});

test('边界声明包含「基线可以做得更好」与主观质量未测', () => {
  assert.ok(doc.includes('基线可以做得更好'), '应承认基线有改进空间，给结论打折');
  assert.ok(doc.includes('主观质量仍未测量'), '应声明主观质量没有量化');
  assert.ok(doc.includes('没有测「用户能不能察觉」'), '应声明察觉阈值没有数据');
});

test('复现命令与单测都在文档里可追溯', () => {
  assert.ok(doc.includes('pnpm baseline:compare'), '应给出复现命令');
  assert.ok(doc.includes('--skip-model'), '应给出零成本验证方式');
  assert.ok(doc.includes('tests/baseline.test.ts'), '应指向基线逻辑的单测');
});

test('作品集主文档引用了这条结论', () => {
  const master = fs.readFileSync(path.join(DOCS_DIR, '作品集主文档_V1.3.md'), 'utf8');

  assert.ok(master.includes('规则基线'), '主文档应提到规则基线对比');
  assert.ok(master.includes('规则基线与AI增量_V1.0.md'), '主文档应指向本文档');
});

test('引用的仓库路径都真实存在', () => {
  const targets = [...doc.matchAll(/\]\(([^)\s]+\.md)\)/g)].map((match) => match[1]);

  assert.ok(targets.length >= 1, '应引用差距诊断，实际 ' + targets.length + ' 条');
  targets.forEach((target) => {
    assert.ok(
      fs.existsSync(path.resolve(DOCS_DIR, target)),
      '引用路径应存在（相对 docs/）：' + target
    );
  });
});
