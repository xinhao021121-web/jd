/**
 * 界面收口增补文档检查：PRD V0.6 增补只记录界面与交互增量，
 * 且必须把每处调整的业务口径指向对应增补，避免口径分散。
 * 运行方式：node --test tests/prd.layout.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');
const V06 = path.join(ROOT, '直聘打招呼助手_PRD_V0.6_增补.md');
const V05 = path.join(ROOT, '直聘打招呼助手_PRD_V0.5_增补.md');
const V02 = path.join(ROOT, '直聘打招呼助手_PRD_V0.2.md');

const doc = fs.readFileSync(V06, 'utf8');

const section = (start, end) => {
  const rest = doc.split(start)[1];
  return end ? rest.split(end)[0] : rest;
};

test('增补文档只写增量，历史文档保持原样', () => {
  assert.ok(doc.includes('版本号：V0.6（增补）'), '增补文档应标注版本');
  assert.ok(doc.includes('直聘打招呼助手_PRD_V0.5_增补.md'), '应关联 V0.5 增补');
  assert.ok(doc.includes('不重复各功能的业务口径'), '应声明只写界面增量');

  ['## 一、背景与概述', '## 二、产品方案', '### 2.6 功能清单'].forEach((heading) => {
    assert.ok(!doc.includes(heading), '不应复制 V0.2 的完整章节：' + heading);
  });
  ['## 二、话术历史（新增 3.9）', '## 二、Word 保真导出（新增 3.8）'].forEach((heading) => {
    assert.ok(!doc.includes(heading), '不应复制前序增补的章节：' + heading);
  });

  assert.ok(fs.readFileSync(V05, 'utf8').includes('版本号：V0.5（增补）'), 'V0.5 应保留');
  assert.ok(fs.readFileSync(V02, 'utf8').includes('版本号：V0.2'), 'V0.2 历史文档不应被改写');
});

test('范围调整写清了本次不新增功能，并给出每处调整的口径所在', () => {
  const scope = section('## 一、范围调整', '## 二、改简历页的布局口径');

  assert.ok(scope.includes('不新增功能'), '应写明本次只调整界面');
  ['改简历页布局', '存档页导出入口', '侧边栏导航'].forEach((item) => {
    assert.ok(scope.includes(item), '范围调整应包含：' + item);
  });

  ['V0.4 增补 3.8', 'V0.5 增补 3.9'].forEach((pointer) => {
    assert.ok(scope.includes(pointer), '应把业务口径指向：' + pointer);
  });
});

test('布局口径写清了分列条件、窄屏行为与理由', () => {
  const layout = section('## 二、改简历页的布局口径', '## 三、其他章节的改动');

  assert.ok(layout.includes('≥ 768px 时保持左右分列'), '应写明分列条件');
  assert.ok(layout.includes('右列定制简历预览'), '应写明左右各放什么');
  assert.ok(layout.includes('900~1020px'), '应写明问题场景的宽度区间');
  assert.ok(layout.includes('上下堆叠'), '应写明窄屏行为');
  assert.ok(layout.includes('跟随滚动'), '应写明粘性定位');
  assert.ok(layout.includes('不改变已生成的内容'), '应写明宽度变化不影响状态');
});

test('差异清单与待确认项落到具体章节', () => {
  const diff = section('## 三、其他章节的改动', '## 四、待确认项');

  ['2.3.2 全局交互', '2.4 信息架构与页面', '2.6 功能清单'].forEach((target) => {
    assert.ok(diff.includes(target), '差异清单应包含落点：' + target);
  });
  assert.ok(diff.includes('不新增功能项'), '应写明功能清单不变');
  assert.ok(diff.includes('两处'), '应说明导出入口从一处扩展为两处');

  const pending = section('## 四、待确认项', '');
  assert.ok(pending.includes('窄屏（<768px）是否也要左右分列'), '待确认项应记录窄屏口径');
  assert.ok(pending.includes('可折叠'), '待确认项应记录预览折叠的取舍');
  assert.ok(!pending.includes('历史容量上限'), '不应重复 V0.5 增补已列的待确认项');
});
