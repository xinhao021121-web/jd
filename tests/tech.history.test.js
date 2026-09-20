/**
 * 话术历史技术方案检查：数据切片、写入去重、容错粒度与视图接入必须自洽，
 * 且不推翻既有技术方案的结论。
 * 运行方式：node --test tests/tech.history.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');
const V05 = path.join(ROOT, 'docs', '技术方案_V0.5_增补.md');
const V01 = path.join(ROOT, 'docs', '技术方案_V0.1.md');
const PRD = path.join(ROOT, '直聘打招呼助手_PRD_V0.5_增补.md');

const tech = fs.readFileSync(V05, 'utf8');

const section = (start, end) => {
  const rest = tech.split(start)[1];
  return end ? rest.split(end)[0] : rest;
};

test('增补文档只写增量，关联既有版本与 PRD 增补', () => {
  assert.ok(tech.includes('版本号：V0.5（增补）'), '应标注版本');
  assert.ok(tech.includes('技术方案_V0.1.md'), '应关联技术方案 V0.1');
  assert.ok(tech.includes('V0.2～V0.4 三份增补'), '应关联 V0.2～V0.4 增补');
  assert.ok(tech.includes('直聘打招呼助手_PRD_V0.5_增补.md'), '应关联 PRD 增补');
  assert.ok(tech.includes('不重复已有内容'), '应声明只写增量');

  ['## 一、方案目标', '## 二、技术选型', '## 四、总体架构', '## 五、核心模块设计'].forEach(
    (heading) => {
      assert.ok(!tech.includes(heading), '不应复制 V0.1 的完整章节：' + heading);
    }
  );
  assert.ok(fs.readFileSync(V01, 'utf8').includes('版本号：V0.1'), 'V0.1 历史文档不应被改写');
});

test('在既有持久化层上加切片，不新增依赖与接口', () => {
  const scope = section('## 一、结论与范围', '## 二、数据模型与落点');

  assert.ok(scope.includes('不新增依赖、不新增接口、不新增密钥'), '应写明不新增形态');
  assert.ok(scope.includes('复制成功之后'), '应写明写入时机');
  assert.ok(scope.includes('sessionId'), '应说明复用会话标识去重');
});

test('数据模型与落点写清记录结构与各层职责', () => {
  const model = section('## 二、数据模型与落点', '## 三、写入与去重');

  ['MAX_GREETING_HISTORY = 20', 'STORAGE_KEYS.greetingHistory', 'GreetingHistoryRecordSchema', 'partialize'].forEach(
    (item) => {
      assert.ok(model.includes(item), '落点应包含：' + item);
    }
  );

  ['sessionId', 'jdText', 'copiedIndexes', 'createdAt', 'elapsedMs'].forEach((field) => {
    assert.ok(model.includes(field), '记录结构应包含字段：' + field);
  });
  assert.ok(model.includes('展示名由 `extractJdTitle` 现场解析'), '不应冗余存储展示名');
  assert.ok(model.includes('不存 `issues`'), '应说明不记录自检结果的理由');
});

test('写入与去重给出完整规则与失败隔离', () => {
  const writing = section('## 三、写入与去重', '## 四、容错');

  assert.ok(writing.includes('触发点') && writing.includes('成功之后'), '应写明触发点');
  assert.ok(writing.includes('剪贴板被拒绝时不写'), '应写明复制失败不入历史');
  assert.ok(writing.includes('greeting.sessionId'), '应写明去重键');
  assert.ok(writing.includes('更新而非新增'), '应说明同批再次复制只合并');
  assert.ok(writing.includes('重新生成'), '应说明重新生成的归属');
  assert.ok(writing.includes('插在最前'), '应说明排序与淘汰方向');
  assert.ok(writing.includes('try/catch'), '应说明失败隔离');
});

test('容错说明为什么按单条校验', () => {
  const tolerant = section('## 四、容错', '## 五、界面接入');

  assert.ok(tolerant.includes('整切片'), '应说明既有 readKey 的粒度');
  assert.ok(tolerant.includes('可丢弃的旁路数据'), '应说明历史为何需要不同粒度');
  assert.ok(tolerant.includes('safeParse'), '应给出逐条校验的实现');
  assert.ok(tolerant.includes('内存退化'), '应说明存储不可用时的行为');
});

test('界面接入覆盖导航、视图、列表、详情与清理', () => {
  const web = section('## 五、界面接入', '## 六、测试策略');

  ['data-view="history"', 'HistoryView', '左列表 + 右详情', 'extractJdTitle', 'data-del'].forEach(
    (item) => {
      assert.ok(web.includes(item), '界面接入应包含：' + item);
    }
  );
  assert.ok(web.includes('后续规划'), '应说明占位项转为正式入口');
});

test('测试策略与 B 类分级落到可执行项', () => {
  const testing = section('## 六、测试策略', '## 七、变更分级与风险');
  const risk = section('## 七、变更分级与风险', '## 八、落地顺序');

  ['同一次生成再次复制只合并不新增', '超 20 条移除最早的', '单条损坏只丢那一条', '刷新后历史仍在'].forEach(
    (item) => {
      assert.ok(testing.includes(item), '测试策略应覆盖：' + item);
    }
  );

  assert.ok(risk.includes('B 类'), '应给出变更分级');
  assert.ok(risk.includes('pnpm test:all'), 'B 类必跑项应包含 test:all');
  assert.ok(risk.includes('pnpm test:e2e'), 'B 类必跑项应包含 test:e2e');
});

test('PRD 增补与本文档的关键结论一致', () => {
  const prd = fs.readFileSync(PRD, 'utf8');

  ['复制即入历史', '20 条', 'sessionId', '不新增埋点事件'].forEach((keyword) => {
    assert.ok(tech.includes(keyword) || prd.includes(keyword), '关键词应至少在一份文档里出现：' + keyword);
  });

  ['复制即入历史', '一次生成一条'].forEach((keyword) => {
    assert.ok(prd.includes(keyword), 'PRD 应包含：' + keyword);
  });
  assert.ok(tech.includes('MAX_GREETING_HISTORY = 20'), '技术方案应给出容量常量的落点');
});
