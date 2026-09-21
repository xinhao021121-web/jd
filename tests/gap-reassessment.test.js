/**
 * 作品集差距诊断 V2.0（对标应届生 AI 产品经理）的检查。
 *
 * V1.0 的检查只钉「清单完整、路径可核销」；V2.0 多钉一类东西：
 * 它是对着仓库与线上站点的实际状态下的判断，所以文档里的数字必须能被代码数出来。
 * 第八节的留白处数是最典型的一处：填完之后本文档不改，测试就要响。
 *
 * 运行方式：node --test tests/gap-reassessment.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const DOC_PATH = path.join(DOCS_DIR, '作品集差距诊断_V2.0.md');
const PORTFOLIO_PATH = path.join(DOCS_DIR, '作品集主文档_V1.3.md');
const PAGE_PATH = path.join(ROOT, '作品集_CaseStudy_V1.0.html');
const doc = fs.readFileSync(DOC_PATH, 'utf8');
const portfolio = fs.readFileSync(PORTFOLIO_PATH, 'utf8');
const page = fs.readFileSync(PAGE_PATH, 'utf8');

/** 差距清单的行：以 | N<数字> | 开头 */
const gapRows = doc
  .split('\n')
  .filter((line) => /^\|\s*N\d+\s*\|/.test(line))
  .map((line) => line.split('|').map((cell) => cell.trim()));

/**
 * 主文档第八节的实际留白处数 = 8.1 / 8.2 表格里「你的确认」列为空的行数
 * + 8.3 未勾选的复选框个数。这是 N1 的核心证据，必须由代码数出来，不靠人记。
 */
function countBlankSlots() {
  const section = portfolio.split('### 8.1')[1]?.split('### 8.3')[0] ?? '';
  const tableRows = section
    .split('\n')
    .filter((line) => /^\|\s*\d+\s*\|/.test(line))
    .map((line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()));
  const blankCells = tableRows.filter((cells) => cells[cells.length - 1] === '').length;
  const unchecked = (portfolio.match(/^\s*-\s*\[ \]/gm) ?? []).length;
  return { blankCells, unchecked, total: blankCells + unchecked };
}

test('标注版本，并声明结论需本人确认后才生效', () => {
  assert.ok(/版本号：V2\.0/.test(doc), '应标注版本号 V2.0');
  assert.ok(doc.includes('2026/09/21'), '应记录盘点时间');
  assert.ok(doc.includes('需本人逐条确认'), '应声明结论需本人确认');
  assert.ok(doc.includes('内部工作文档'), '应声明它是内部文档，不是对外物料');
  assert.ok(doc.includes('## 八、结论如何生效'), '应有让结论生效的认领章节');
  assert.ok(doc.includes('作品集差距诊断_V1.0.md'), '应指向 V1.0，说明两版的关系');
});

test('7 条新增差距齐全，每条都有证据、校招视角、验收标准与优先级', () => {
  const ids = gapRows.map((cells) => cells[1]);
  assert.equal(gapRows.length, 7, '差距清单应有 7 行，实际 ' + gapRows.length + ' 行');

  for (let index = 1; index <= 7; index += 1) {
    assert.ok(ids.includes('N' + index), '差距清单应包含 N' + index);
  }

  gapRows.forEach((cells) => {
    // 列序：# | 差距 | 现状证据 | 为什么校招才暴露 | 验收标准 | 优先级
    const [id, gap, evidence, reason, criteria, priority] = cells.slice(1);
    assert.ok(gap && gap.length >= 4, id + ' 应写明差距');
    assert.ok(evidence && evidence.length >= 20, id + ' 应给出可核对的现状证据');
    assert.ok(reason && reason.length >= 20, id + ' 应说明为什么这条在校招基准下才暴露');
    assert.ok(criteria && criteria.length >= 20, id + ' 的验收标准应可判定，不能是一句话带过');
    assert.ok(['P0', 'P1', 'P2', 'P3'].includes(priority), id + ' 的优先级应取 P0 / P1 / P2 / P3');
  });
});

test('复核了 V1.0 的核销结论，并写明声明不做不等于核销', () => {
  const section = doc.split('## 四、复核 V1.0 的核销结论')[1]?.split('## 五、')[0] ?? '';
  assert.ok(section.length > 0, '应有复核 V1.0 核销结论的小节');

  ['G1', 'G2', 'G3', 'G4', 'G5', 'G9'].forEach((id) => {
    assert.ok(section.includes(id), '复核表应覆盖 ' + id);
  });
  assert.ok(section.includes('维持'), '应保留「维持」这一结论（G2）');
  assert.ok(section.includes('重开'), 'G1 应给出需要重开的结论');
  assert.ok(doc.includes('只降低严重度，不改变状态'), '应写明「声明不做」的复核口径');
});

test('八节留白处数与主文档、作品集页的实际状态一致（填完必须回改两份物料）', () => {
  const { blankCells, unchecked, total: pending } = countBlankSlots();
  const n1 = gapRows.find((cells) => cells[1] === 'N1');
  assert.ok(n1, '差距清单应有 N1');

  assert.ok(
    n1[3].includes(pending + ' 处留白'),
    'N1 的现状证据应写「' + pending + ' 处留白」，实际是表格空 ' + blankCells + ' 行 + 未勾选 ' + unchecked + ' 项'
  );

  // 作品集页把进度写给读者看，这里的说法同样不能自己走样：
  // 还有留白就报数字，清零了就明说清零
  if (pending === 0) {
    assert.ok(page.includes('认领完毕'), '留白清零后，作品集页应写明已认领完毕');
  } else {
    assert.ok(
      page.includes(blankCells + ' 行未认领'),
      '作品集页应写「' + blankCells + ' 行未认领」，与实际不符'
    );
    assert.ok(
      page.includes(unchecked + ' 栏未勾选'),
      '作品集页应写「' + unchecked + ' 栏未勾选」，与实际不符'
    );
  }
});

test('补齐路径按投入产出排序，每步都有完成标志', () => {
  const steps = doc.match(/### 第 \d 步/g) ?? [];
  assert.equal(steps.length, 5, '应有第 0–4 步共 5 步，实际 ' + steps.length + ' 步');

  const markers = doc.match(/\*\*完成标志\*\*/g) ?? [];
  assert.equal(markers.length, 5, '每步各应有一个完成标志，实际 ' + markers.length + ' 个');

  // 第 0 步是「纯填写」的那一步：投入产出比最高，且不需要等任何人
  const first = doc.split('### 第 0 步')[1]?.split('### 第 1 步')[0] ?? '';
  assert.ok(first.includes('留白'), '第 0 步应是把第八节留白填完');
  assert.ok(
    first.includes('已完成') || first.includes('半天'),
    '第 0 步应写明它是已完成，还是仍在待办'
  );
});

test('校招版追问预演保留 6 条，且与差距编号挂钩', () => {
  const section = doc.split('## 七、面试追问预演（校招版）')[1]?.split('## 八、')[0] ?? '';
  const rows = section.split('\n').filter((line) => /^\|\s*\d+\s*\|/.test(line));

  assert.equal(rows.length, 6, '校招版追问预演应保留 6 条，实际 ' + rows.length + ' 条');
  ['N1', 'N2', 'N4', 'N5', 'N6'].forEach((id) => {
    assert.ok(section.includes(id), '追问预演应指向差距编号：' + id);
  });
  assert.ok(section.includes('100+'), '应预演「投递经历为什么不做成数据」这一问');
  assert.ok(section.includes('挂掉'), '应预演「模型挂掉时产品怎么办」这一问');
});

test('文档里引用的 Markdown 链接都真实存在', () => {
  const targets = [...doc.matchAll(/\]\(([^)\s]+\.md)\)/g)].map((match) => match[1]);

  assert.ok(targets.length >= 4, '应引用 V1.0、主文档、评审标准与公开讨论调研，实际 ' + targets.length + ' 条');
  targets.forEach((target) => {
    assert.ok(
      fs.existsSync(path.resolve(DOCS_DIR, target)),
      '引用路径应存在（相对 docs/）：' + target
    );
  });
});
