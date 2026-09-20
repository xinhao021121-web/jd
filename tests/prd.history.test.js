/**
 * 话术历史增补文档检查：PRD V0.5 增补只写增量、不重复 V0.4，
 * 写入时机、记录粒度、容量与「与既有不持久化口径的关系」必须自洽。
 * 运行方式：node --test tests/prd.history.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');
const V05 = path.join(ROOT, '直聘打招呼助手_PRD_V0.5_增补.md');
const V04 = path.join(ROOT, '直聘打招呼助手_PRD_V0.4_增补.md');
const V02 = path.join(ROOT, '直聘打招呼助手_PRD_V0.2.md');

const doc = fs.readFileSync(V05, 'utf8');

const section = (start, end) => {
  const rest = doc.split(start)[1];
  return end ? rest.split(end)[0] : rest;
};

test('增补文档只写增量，历史文档保持原样', () => {
  assert.ok(doc.includes('版本号：V0.5（增补）'), '增补文档应标注版本');
  assert.ok(doc.includes('直聘打招呼助手_PRD_V0.4_增补.md'), '应关联 V0.4 增补');
  assert.ok(doc.includes('不重复 V0.2 与 V0.3、V0.4 增补已有内容'), '应声明只写增量');

  ['## 一、背景与概述', '## 二、产品方案', '### 2.6 功能清单'].forEach((heading) => {
    assert.ok(!doc.includes(heading), '不应复制 V0.2 的完整章节：' + heading);
  });
  ['## 二、Word 保真导出（新增 3.8）', '## 三、改写长度约束'].forEach((heading) => {
    assert.ok(!doc.includes(heading), '不应复制 V0.4 增补的章节：' + heading);
  });

  assert.ok(fs.readFileSync(V04, 'utf8').includes('版本号：V0.4（增补）'), 'V0.4 应保留');
  assert.ok(fs.readFileSync(V02, 'utf8').includes('版本号：V0.2'), 'V0.2 历史文档不应被改写');
});

test('写清了与既有「生成结果不持久化」口径的关系', () => {
  const scope = section('## 一、范围调整', '## 二、话术历史');

  assert.ok(scope.includes('生成结果仍不自动持久化'), '应保留不自动持久化的口径');
  assert.ok(scope.includes('被复制过的那次生成'), '应写明只有被复制的生成入库');
  assert.ok(scope.includes('生成 → 不满意 → 重新生成'), '应说明不保留未采用结果的理由');
  assert.ok(scope.includes('侧边栏'), '应写明侧边栏占位改为正式入口');
});

test('不做清单与数据边界写明', () => {
  const scope = section('## 一、范围调整', '## 二、话术历史');

  ['重命名历史记录', '「用这个岗位的 JD 重新生成」', '历史的上传、同步与跨设备', '按公司与岗位去重'].forEach(
    (item) => {
      assert.ok(scope.includes(item), '不做清单应新增：' + item);
    }
  );

  ['只有复制成功的话术才入历史', '不上传、不参与生成请求', '不能阻断复制与生成'].forEach((rule) => {
    assert.ok(scope.includes(rule), '新增约束应包含：' + rule);
  });
});

test('话术历史写清了触发点、粒度与容量', () => {
  const history = section('## 二、话术历史', '## 三、其他章节的改动');

  assert.ok(history.includes('复制即入历史'), '应写明触发点');
  assert.ok(history.includes('一次生成（3 条候选话术 + 当时的 JD + 匹配分析）'), '应写明记录粒度');
  assert.ok(history.includes('同一次生成只有一条记录'), '应写明去重口径');
  assert.ok(history.includes('重新生成后再复制'), '应写明重新生成后的归属');
  assert.ok(history.includes('复制过哪几条'), '应记录已复制标记');
  assert.ok(history.includes('沿用 3.4 的命名规则'), '应沿用既有命名规则');
  assert.ok(history.includes('最多保留') || history.includes('20 条'), '应写明容量上限');
});

test('界面规则与异常兜底覆盖关键分支', () => {
  const history = section('## 二、话术历史', '## 三、其他章节的改动');

  ['侧边栏「话术历史」', '记录详情', '删除单条', '清空全部', '空态'].forEach((item) => {
    assert.ok(history.includes(item), '界面规则应包含：' + item);
  });

  ['复制被浏览器拒绝', '同一次生成再次复制', '本地存储不可用', '历史记录损坏'].forEach((item) => {
    assert.ok(history.includes(item), '异常兜底应覆盖：' + item);
  });
  assert.ok(history.includes('其余记录保留'), '损坏时应只丢弃坏记录');
});

test('差异清单指明了落点，并登记 V0.6 功能项', () => {
  const diff = section('## 三、其他章节的改动', '## 四、待确认项');

  [
    '2.2 产品整体流程',
    '2.3.1 全局异常处理',
    '2.3.2 全局交互',
    '2.4 信息架构与页面',
    '2.7 产品版本规划',
    '3.2 生成打招呼话术',
    '4.1 安全与合规'
  ].forEach((target) => {
    assert.ok(diff.includes(target), '差异清单应包含落点：' + target);
  });

  [
    '| 生成打招呼 | 话术历史自动归档 | P0 | V0.6 |',
    '| 话术历史 | 历史回看与复制 | P1 | V0.6 |',
    '| 话术历史 | 历史清理 | P1 | V0.6 |'
  ].forEach((row) => {
    assert.ok(diff.includes(row), '功能清单应新增：' + row);
  });

  assert.ok(diff.includes('不新增埋点事件'), '应说明不新增埋点');
  assert.ok(diff.includes('不新增任何接口、密钥与部署形态'), '应说明不新增服务端形态');
  assert.ok(diff.includes('刷新保留项'), '应更新刷新保留清单');
});

test('待确认项只提本次未定的事', () => {
  const pending = section('## 四、待确认项', '');

  ['历史容量上限', '是否需要手动改名', '是否记录未复制的生成', '投递记录'].forEach((item) => {
    assert.ok(pending.includes(item), '待确认项应包含：' + item);
  });
  assert.ok(!pending.includes('导出文件的命名'), '不应重复 V0.4 增补已列的待确认项');
});
