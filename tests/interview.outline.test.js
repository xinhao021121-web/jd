/**
 * 用户访谈提纲检查：它是差距诊断 G1 的执行物料，
 * 因此只钉住三件会直接影响取证质量的事——假设可证伪、题目问行为、偏差已规避。
 * 运行方式：node --test tests/interview.outline.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const DOC_PATH = path.join(DOCS_DIR, '用户访谈提纲_V1.0.md');
const doc = fs.readFileSync(DOC_PATH, 'utf8');

test('标注版本，并指向差距诊断 G1', () => {
  assert.ok(/版本号：V1\.\d/.test(doc), '应标注版本号');
  assert.ok(doc.includes('2026/09/21'), '应记录制作时间');
  assert.ok(doc.includes('G1'), '应指向差距诊断的 G1');
  assert.ok(doc.includes('定性证据'), '应声明这是定性证据，不是统计结论');
});

test('六条假设齐全，每条都有对应题目与可判定的标准', () => {
  // 只看第二节的假设清单，附录 B 的判定汇总表也是 H 开头的行
  const section = doc.split('## 二、假设清单')[1]?.split('## 三、')[0] ?? '';
  const rows = section.split('\n').filter((line) => /^\|\s*H\d\s*\|/.test(line));

  assert.equal(rows.length, 6, '假设清单应有 6 行，实际 ' + rows.length + ' 行');
  for (let index = 1; index <= 6; index += 1) {
    assert.ok(doc.includes('| H' + index + ' |'), '应包含假设 H' + index);
  }

  rows.forEach((row) => {
    const cells = row.split('|').map((cell) => cell.trim());
    const [id, assumption, questions, criteria] = cells.slice(1);

    assert.ok(assumption.length >= 8, id + ' 应写明假设内容');
    assert.ok(/Q\d/.test(questions), id + ' 应给出对应题目编号');
    assert.ok(criteria.length >= 10, id + ' 的判定标准应可判定');
  });
});

test('十道题齐全，行为事实题与观点题的边界写清', () => {
  for (let index = 1; index <= 10; index += 1) {
    assert.ok(doc.includes('### Q' + index + ' '), '应包含第 ' + index + ' 题');
  }

  const followUps = doc.match(/\*\*对应\*\*/g) ?? [];
  assert.equal(followUps.length, 10, '每道题都应有对应假设与设计意图，实际 ' + followUps.length + ' 处');

  assert.ok(doc.includes('全程问行为，不问观点'), '应写明行为优先的原则');
  assert.ok(doc.includes('筛选题'), '应保留用于过滤非目标人群的筛选题');
});

test('偏差审查覆盖四类高危偏差，并给出规避写法', () => {
  ['诱导题', '双重问题', '社会期望', '回忆偏差'].forEach((label) => {
    assert.ok(doc.includes(label), '偏差审查应覆盖：' + label);
  });
  assert.ok(doc.includes('不评价、不附和'), '应写明访谈中的中立原则');
});

test('样本约束与主文档口径一致，且不承诺统计结论', () => {
  assert.ok(doc.includes('不要与外部盲测'), '应要求访谈对象与盲测对象相互独立');
  assert.ok(doc.includes('3–5 人'), '应写明样本量');
  assert.ok(doc.includes('成立 / 不成立 / 证据不足'), '应允许假设被证伪');
  assert.ok(doc.includes('不成立的假设要留在文档里'), '应要求保留证伪结果');

  const portfolio = fs.readFileSync(path.join(DOCS_DIR, '作品集主文档_V1.3.md'), 'utf8');
  assert.ok(portfolio.includes('用户访谈记录_V1.0.md'), '主文档应指向访谈记录');
  assert.ok(doc.includes('尚无访谈或问卷'), '提纲应写明要替换的那句话');
});

test('引用的仓库路径都真实存在', () => {
  const targets = [...doc.matchAll(/\]\(([^)\s]+\.md)\)/g)].map((match) => match[1]);

  assert.ok(targets.length >= 2, '应引用差距诊断与主文档，实际 ' + targets.length + ' 条');
  targets.forEach((target) => {
    assert.ok(
      fs.existsSync(path.resolve(DOCS_DIR, target)),
      '引用路径应存在（相对 docs/）：' + target
    );
  });
});
