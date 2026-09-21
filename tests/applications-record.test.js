/**
 * 投递纵向记录（N2 的第 ② 条替代证据）的检查。
 *
 * 这份文档 V1.0 起有真实数据了，因此检查的重点从「口径先定死」转到三件事：
 * 匿名化（仓库里不得出现公司名）、分母必须跟着百分比走、以及不确定项必须如实标注。
 *
 * 运行方式：node --test tests/applications-record.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const DOC_PATH = path.join(DOCS_DIR, '投递纵向记录_V1.0.md');
const doc = fs.readFileSync(DOC_PATH, 'utf8');

/** 表格行：拆成单元格（去掉首尾空串与分隔行） */
function tableRows(section) {
  return section
    .split('\n')
    .filter((line) => /^\|/.test(line.trim()))
    .map((line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()))
    .filter((cells) => !cells.every((cell) => /^-+$/.test(cell)));
}

test('标注版本与状态，且声明它是自身场景而不是用户调研', () => {
  assert.ok(/版本号：V1\.0/.test(doc), '应标注版本号 V1.0');
  assert.ok(doc.includes('数据已回填'), '状态栏应写明数据已回填');
  assert.ok(doc.includes('本人行为数据的纵向记录，不是用户调研'), '应声明它不是用户调研');
  assert.ok(doc.includes('不得被写成「访谈」'), '应禁止把它写成访谈');
});

test('采集方式与来源可追溯，原始数据不入库', () => {
  const section = doc.split('## 一、采集方式与来源')[1]?.split('## 二、')[0] ?? '';
  assert.ok(section.includes('截图'), '应写明数据来自截图');
  assert.ok(section.includes('reports/'), '应指向未脱敏的原始数据位置');
  assert.ok(section.includes('.gitignore'), '应说明报告目录不进仓库');
  assert.ok(section.includes('30天'), '应写明列表是 30 天窗口');
});

test('口径先定死：五项定义齐全，「已读」不算回复，猎头计入排除项', () => {
  assert.ok(doc.includes('## 二、口径'), '应有口径一节');
  ['一次投递', '有回复', '有效回复', '排除项', '合并口径'].forEach((key) => {
    assert.ok(doc.includes(key), '口径定义应包含：' + key);
  });
  assert.ok(doc.includes('猎头'), '排除项应写明猎头');
  assert.ok(doc.includes('[送达]') || doc.includes('已读'), '应给出判定谁发的依据');
});

test('逐行记录：17 条齐全，匿名化且不出现公司名', () => {
  const section = doc.split('## 三、逐行记录')[1]?.split('## 四、')[0] ?? '';
  const rows = tableRows(section);

  assert.equal(rows.length, 18, '应是表头 + 17 行数据，实际 ' + rows.length + ' 行');
  assert.equal(rows[0][0], '#', '第一列应是序号');
  rows.slice(1).forEach((cells) => {
    assert.ok(/^\d+$/.test(cells[0]), '数据行首列应是序号，实际「' + cells[0] + '」');
    assert.ok(cells[1] && cells[1].length >= 4, '应写明日期');
    assert.ok(cells[2] && cells[2].length >= 4, '应写明对方角色与公司类型');
  });

  // 匿名化：仓库里不出现任何具体公司名
  ['阅文', '英雄游戏', '猿辅导', '游族', '波克', '新开普', '云客数智', '香贝儿', '职达人力'].forEach((name) => {
    assert.ok(!doc.includes(name), '逐行记录必须匿名化，不应出现公司名：' + name);
  });
  assert.ok(doc.includes('公司类型') || doc.includes('行业'), '应说明用行业替代公司名');
});

test('聚合带分母，且不确定项被如实标注而不是硬凑', () => {
  const section = doc.split('## 四、聚合')[1]?.split('## 五、')[0] ?? '';
  ['17', '52.9%', '11.8%', '有效回复', '无法判断'].forEach((key) => {
    assert.ok(section.includes(key), '聚合应包含：' + key);
  });
  assert.ok(section.includes('分母'), '聚合要求应写明必须连分母一起引用');
  assert.ok(section.includes('下限') && section.includes('上限'), '应同时给出回复率的下限与上限');
  assert.ok(doc.includes('不确定'), '推断不出的行必须标不确定');
});

test('边界声明齐全，并给出引用时必须带上的那句局限', () => {
  assert.ok(doc.includes('## 六、这份记录能支撑什么、不能支撑什么'), '应有边界一节');
  ['不能推广到其他求职者', '不能当因果证据', '不能替代用户调研'].forEach((line) => {
    assert.ok(doc.includes(line), '边界应写明：' + line);
  });
  assert.ok(doc.includes('样本 1 人、无对照组'), '应给出可直接照抄的局限句');
  assert.ok(doc.includes('不能说成「投递 100+ 的回复率」'), '应禁止把 17 说成 100+');
});
