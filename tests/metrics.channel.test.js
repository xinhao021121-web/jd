/**
 * 指标回收决策材料检查：它是差距诊断 G2 的决策材料，不是实现方案，
 * 因此钉住三件事——路径齐全可比、数据边界写清、待拍板的问题显式留给本人。
 * 运行方式：node --test tests/metrics.channel.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const DOC_PATH = path.join(DOCS_DIR, '指标回收决策_V1.0.md');
const doc = fs.readFileSync(DOC_PATH, 'utf8');

test('标注版本，并指向差距诊断 G2', () => {
  assert.ok(/版本号：V1\.\d/.test(doc), '应标注版本号');
  assert.ok(doc.includes('2026/09/21'), '应记录制作时间');
  assert.ok(doc.includes('G2'), '应指向差距诊断的 G2');
  assert.ok(doc.includes('无法执行'), '应写清现有行动项为何执行不了');
});

test('声明它不是方案，选定路径前不照着实现', () => {
  assert.ok(doc.includes('它不是方案'), '应声明这不是实现方案');
  assert.ok(doc.includes('不要照着实现'), '应要求选定路径前不要实现');
});

test('三条路径齐全，且各自写明结论强度', () => {
  ['A 内测邀请制', 'B 匿名事件计数', 'C 结果卡片分享'].forEach((name) => {
    assert.ok(doc.includes(name), '应包含路径：' + name);
  });

  const rows = doc.split('\n').filter((line) => /^\|\s*\*\*[ABC] /.test(line));
  assert.equal(rows.length, 3, '路径对比表应有 3 行，实际 ' + rows.length + ' 行');

  rows.forEach((row) => {
    const cells = row.split('|').map((cell) => cell.trim());
    const [name, approach, changes, volume, strength, cost] = cells.slice(1);

    assert.ok(approach.length >= 10, name + ' 应写明做法');
    assert.ok(changes.length >= 4, name + ' 应写明代码改动量');
    assert.ok(volume.length >= 8, name + ' 应写明能拿到的数据量');
    assert.ok(strength.length >= 8, name + ' 应写明结论强度');
    assert.ok(cost.length >= 4, name + ' 应写明主要代价');
  });
});

test('数据边界写清：不含正文，也不触碰一票否决第 4 条', () => {
  assert.ok(doc.includes('不含简历、JD、话术正文'), '应写死不采集正文');
  assert.ok(doc.includes('也不含公司名与岗位名'), '应写死不采集岗位信息');
  assert.ok(doc.includes('不触碰该条的字面边界'), '应说明与一票否决第 4 条的关系');
  assert.ok(doc.includes('ipHash'), '应指出服务端既有的匿名日志，说明并非新开一类数据');
});

test('待拍板的问题显式留给本人，而不是替其决定', () => {
  const section = doc.split('## 五、需要你拍板的三件事')[1]?.split('## 六、')[0] ?? '';
  const rows = section.split('\n').filter((line) => /^\|\s*\d\s*\|/.test(line));

  assert.equal(rows.length, 3, '待拍板问题应有 3 条，实际 ' + rows.length + ' 条');
  assert.ok(section.includes('你的决定'), '应保留待填的决定列');
  assert.ok(section.includes('评审标准第六维度降为观察项'), '应为「不加回流」给出对应后果');
});

test('引用的仓库路径都真实存在', () => {
  const targets = [...doc.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1]);

  assert.ok(targets.length >= 3, '应引用差距诊断、评审记录与指标实现，实际 ' + targets.length + ' 条');
  targets.forEach((target) => {
    assert.ok(
      fs.existsSync(path.resolve(DOCS_DIR, target)),
      '引用路径应存在（相对 docs/）：' + target
    );
  });
});
