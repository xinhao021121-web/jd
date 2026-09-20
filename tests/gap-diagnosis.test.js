/**
 * 作品集差距诊断检查：它是一份「还差什么」的工作清单，
 * 因此只钉住两类容易失真的东西——差距条目必须完整可核销、引用的仓库路径必须真实存在。
 * 运行方式：node --test tests/gap-diagnosis.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const DOC_PATH = path.join(DOCS_DIR, '作品集差距诊断_V1.0.md');
const doc = fs.readFileSync(DOC_PATH, 'utf8');

/** 差距清单的行：以 | G<数字> | 开头 */
const gapRows = doc
  .split('\n')
  .filter((line) => /^\|\s*G\d+\s*\|/.test(line))
  .map((line) => line.split('|').map((cell) => cell.trim()));

test('标注版本，并声明结论需要本人确认后才生效', () => {
  assert.ok(/版本号：V1\.\d/.test(doc), '应标注版本号');
  assert.ok(doc.includes('2026/09/21'), '应记录盘点时间');
  assert.ok(doc.includes('需本人逐条确认'), '应声明结论需本人确认');
  assert.ok(doc.includes('内部工作文档'), '应声明它是内部文档，不是对外物料');
  assert.ok(doc.includes('## 六、结论如何生效'), '应有让结论生效的认领章节');
});

test('12 条差距齐全，每条都有验收标准、优先级与状态列', () => {
  const ids = gapRows.map((cells) => cells[1]);
  assert.equal(gapRows.length, 12, '差距清单应有 12 行，实际 ' + gapRows.length + ' 行');

  for (let index = 1; index <= 12; index += 1) {
    const id = 'G' + index;
    assert.ok(ids.includes(id), '差距清单应包含 ' + id);
  }

  gapRows.forEach((cells) => {
    // 列序：# | 差距 | 现状证据 | 验收标准 | 优先级 | 状态
    const [id, gap, evidence, criteria, priority, status] = cells.slice(1);
    assert.ok(gap && gap.length >= 4, id + ' 应写明差距');
    assert.ok(evidence && evidence.length >= 10, id + ' 应给出可核对的现状证据');
    assert.ok(criteria && criteria.length >= 20, id + ' 的验收标准应可判定，不能是一句话带过');
    assert.ok(['P0', 'P1', 'P2'].includes(priority), id + ' 的优先级应取 P0 / P1 / P2');
    assert.ok(['待办', '进行中', '已核销'].includes(status), id + ' 的状态应取待办 / 进行中 / 已核销');
  });
});

test('优先级分层合理：P0 覆盖证据缺失与文档无主两类致命项', () => {
  // 列序：# | 差距 | 现状证据 | 验收标准 | 优先级 | 状态，分割后首位是空串
  const p0 = gapRows.filter((cells) => cells[5] === 'P0').map((cells) => cells[1]);
  const p1 = gapRows.filter((cells) => cells[5] === 'P1').map((cells) => cells[1]);
  const p2 = gapRows.filter((cells) => cells[5] === 'P2').map((cells) => cells[1]);

  assert.deepEqual(p0, ['G1', 'G2', 'G3', 'G4'], 'P0 应是 G1–G4：用户证据、指标回流、外部盲测、个人贡献');
  assert.ok(p1.length >= 5, 'P1 应覆盖模型选型、成本、合规、呈现物料与定位风险，实际 ' + p1.length + ' 条');
  assert.ok(p2.length >= 2, 'P2 应保留方法论升级类条目，实际 ' + p2.length + ' 条');
});

test('三阶段计划齐全，每阶段都有完成标志', () => {
  ['### 阶段一：可对外投递的最小集（G1 / G2 / G3 / G4）', '### 阶段二：补齐 PM 的核心证据', '### 阶段三：方法论升级与收口'].forEach(
    (heading) => {
      assert.ok(doc.includes(heading), '应保留小节：' + heading);
    }
  );

  const markers = doc.match(/\*\*完成标志\*\*/g) ?? [];
  assert.equal(markers.length, 3, '三个阶段各应有一个完成标志，实际 ' + markers.length + ' 个');
});

test('面试追问预演覆盖 5 个关键问题，且与差距编号挂钩', () => {
  const section = doc.split('## 四、面试追问预演')[1]?.split('## 五、')[0] ?? '';
  const rows = section.split('\n').filter((line) => /^\|\s*\d+\s*\|/.test(line));

  assert.equal(rows.length, 5, '追问预演应保留 5 条，实际 ' + rows.length + ' 条');
  ['G1', 'G2', 'G11', 'G6', 'G4'].forEach((id) => {
    assert.ok(section.includes(id), '追问预演应指向差距编号：' + id);
  });
  assert.ok(section.includes('DeepSeek'), '应预演模型选型的追问');
  assert.ok(section.includes('模板加槽位'), '应预演「去掉 AI 能不能做」的追问');
});

test('文档里引用的 Markdown 链接都真实存在', () => {
  const targets = [...doc.matchAll(/\]\(([^)\s]+\.md)\)/g)].map((match) => match[1]);

  assert.ok(targets.length >= 2, '应引用主文档与盲测物料，实际 ' + targets.length + ' 条');
  targets.forEach((target) => {
    assert.ok(
      fs.existsSync(path.resolve(DOCS_DIR, target)),
      '引用路径应存在（相对 docs/）：' + target
    );
  });
});

test('与作品集主文档的已知不足保持同一口径', () => {
  const portfolio = fs.readFileSync(path.join(DOCS_DIR, '作品集主文档_V1.2.md'), 'utf8');

  ['尚无访谈或问卷', '外部盲测', '单位经济性'].forEach((keyword) => {
    assert.ok(portfolio.includes(keyword), '主文档应保留已知不足：' + keyword);
    assert.ok(doc.includes(keyword), '差距诊断应沿用同一口径：' + keyword);
  });

  assert.ok(doc.includes('reports/blind-test/results/'), '应指出外部盲测结果为空');
  assert.ok(doc.includes('packages/core/src/metrics.ts'), '应指出指标口径的落点');
  assert.ok(doc.includes('pnpm test:counts'), '应给出核对命令');
});
