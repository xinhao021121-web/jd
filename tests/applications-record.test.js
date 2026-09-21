/**
 * 投递纵向记录（N2 的第 ② 条替代证据）的检查。
 *
 * 这份文档的价值全在「口径先定死」和「边界先写明」两件事上——
 * 数据回填之后没人会再回头补口径，所以口径与边界必须在空表阶段就钉住。
 * 另外钉一条最容易出事的：文档里不得出现任何看似真实、实则编造的投递数据。
 *
 * 运行方式：node --test tests/applications-record.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const doc = fs.readFileSync(path.join(DOCS_DIR, '投递纵向记录_V0.1.md'), 'utf8');

/** 表格行：拆成单元格（去掉首尾空串） */
function tableRows(section) {
  return section
    .split('\n')
    .filter((line) => /^\|/.test(line.trim()))
    .map((line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()))
    .filter((cells) => !cells.every((cell) => /^-+$/.test(cell)));
}

test('标注版本与状态，且声明它是自身场景而不是用户调研', () => {
  assert.ok(/版本号：V0\.1/.test(doc), '应标注版本号');
  assert.ok(doc.includes('2026/09/21'), '应记录时间');
  assert.ok(doc.includes('数据待本人回填'), '状态栏应写明数据还没回填');
  assert.ok(doc.includes('本人行为数据的纵向记录，不是用户调研'), '应声明它不是用户调研');
  assert.ok(doc.includes('不得被写成「访谈」'), '应禁止把它写成访谈');
});

test('口径先定死：五项定义齐全，且排除项与合并口径都写明', () => {
  assert.ok(doc.includes('## 四、口径定义'), '应有口径定义一节');

  ['一次投递', '有回复', '有效回复', '排除项', '合并口径'].forEach((key) => {
    assert.ok(doc.includes(key), '口径定义应包含：' + key);
  });

  // 「有回复」与「有效回复」必须分开，否则回复率会被礼貌性拒绝撑高
  assert.ok(doc.includes('已读') && doc.includes('不算'), '应写明「已读」不算回复');
  assert.ok(doc.includes('猎头') && doc.includes('中介'), '排除项应写明猎头与中介');
});

test('八个字段齐全，且每个字段都给了去哪找', () => {
  const section = doc.split('## 三、需要回填的字段')[1]?.split('**回填路径')[0] ?? '';
  const rows = tableRows(section).slice(1); // 去掉表头

  assert.equal(rows.length, 8, '字段表应有 8 行，实际 ' + rows.length + ' 行');
  rows.forEach((cells) => {
    assert.ok(cells[0] && cells[0].length >= 2, '字段应有名字');
    assert.ok(cells[1] && cells[1].length >= 2, cells[0] + ' 应写明取值');
    // 「同上」也是有效的指路，但不能是空白
    assert.ok(
      cells[2] && (cells[2].length >= 4 || cells[2].includes('同上')),
      cells[0] + ' 应写明去哪找'
    );
  });

  ['日期', '公司', '岗位', '渠道', '打招呼方式', '是否改简历', '对方是否回复', '是否有效回复'].forEach(
    (field) => {
      assert.ok(doc.includes(field), '字段表应包含：' + field);
    }
  );
});

test('采集表可解析，且没有任何编造的数据行', () => {
  const section = doc.split('## 五、采集表（待填）')[1]?.split('## 六、')[0] ?? '';
  const rows = tableRows(section);

  // 表头 + 一行格式示例
  assert.equal(rows.length, 2, '采集表应只有表头与一行示例，实际 ' + rows.length + ' 行');
  assert.equal(rows[0][0], '#', '第一列应是序号');
  assert.equal(rows[0].length, 10, '采集表应有 10 列，实际 ' + rows[0].length + ' 列');

  // 示例行必须是占位：一旦有人往里填真实公司名，这里会拦住
  const sample = rows[1].join(' ');
  assert.ok(sample.includes('示例'), '示例行应标明「示例」');
  assert.ok(sample.includes('占位'), '示例行应标明「占位」');
  assert.ok(doc.includes('格式示例，请删除'), '应提示回填时删掉示例行');
});

test('边界声明齐全，并给出引用时必须带上的那句局限', () => {
  assert.ok(doc.includes('## 七、这份记录能支撑什么、不能支撑什么'), '应有边界一节');

  [
    '不能推广到其他求职者',
    '不能当因果证据',
    '不能替代用户调研'
  ].forEach((line) => {
    assert.ok(doc.includes(line), '边界应写明：' + line);
  });

  assert.ok(doc.includes('样本为 1 人、无对照组'), '应给出可直接照抄的局限句');
});

test('汇总会带分母，并说明要交叉观察哪两组关系', () => {
  const section = doc.split('## 六、汇总要算什么')[1]?.split('## 七、')[0] ?? '';
  assert.ok(section.includes('分母'), '汇总要求应写明必须带分母');

  ['有回复率', '有效回复率', '打招呼方式分布'].forEach((key) => {
    assert.ok(section.includes(key), '汇总指标应包含：' + key);
  });
  assert.ok(section.includes('不下因果结论'), '交叉观察应写明不下因果结论');
});
