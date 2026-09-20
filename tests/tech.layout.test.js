/**
 * 界面收口技术方案检查：断点选择、导出入口落点与测试口径必须自洽，
 * 且不推翻既有技术方案的结论。
 * 运行方式：node --test tests/tech.layout.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');
const V06 = path.join(ROOT, 'docs', '技术方案_V0.6_增补.md');
const V01 = path.join(ROOT, 'docs', '技术方案_V0.1.md');
const PRD = path.join(ROOT, '直聘打招呼助手_PRD_V0.6_增补.md');

const tech = fs.readFileSync(V06, 'utf8');

const section = (start, end) => {
  const rest = tech.split(start)[1];
  return end ? rest.split(end)[0] : rest;
};

test('增补文档只写增量，关联既有版本与 PRD 增补', () => {
  assert.ok(tech.includes('版本号：V0.6（增补）'), '应标注版本');
  assert.ok(tech.includes('技术方案_V0.1.md'), '应关联技术方案 V0.1');
  assert.ok(tech.includes('V0.2～V0.5 四份增补'), '应关联 V0.2～V0.5 增补');
  assert.ok(tech.includes('直聘打招呼助手_PRD_V0.6_增补.md'), '应关联 PRD 增补');
  assert.ok(tech.includes('不重复已有内容'), '应声明只写增量');

  ['## 一、方案目标', '## 二、技术选型', '## 四、总体架构', '## 五、核心模块设计'].forEach(
    (heading) => {
      assert.ok(!tech.includes(heading), '不应复制 V0.1 的完整章节：' + heading);
    }
  );
  assert.ok(fs.readFileSync(V01, 'utf8').includes('版本号：V0.1'), 'V0.1 历史文档不应被改写');
});

test('范围写明只改界面，不动数据与接口', () => {
  const scope = section('## 一、结论与范围', '## 二、断点选择');

  assert.ok(scope.includes('不动数据、接口与服务端'), '应写明改动边界');
  assert.ok(scope.includes('lg'), '应写明改动前的断点');
  assert.ok(scope.includes('md'), '应写明改动后的断点');
  assert.ok(scope.includes('不新增实现'), '存档导出应复用既有路径');
});

test('断点选择给出了两侧边界与理由', () => {
  const breakpoints = section('## 二、断点选择', '## 三、导出入口的落点');

  assert.ok(breakpoints.includes('笔记本分屏与未最大化的浏览器窗口多在 900~1020px'), '应写明问题区间');
  assert.ok(breakpoints.includes('640~768px 区间两列各不足 320px'), '应写明为什么不下探到更小断点');
  assert.ok(breakpoints.includes('同一断点'), '粘性定位应与列数同断点');
  assert.ok(breakpoints.includes('定制简历'), '应说明存档页为什么不复用这个断点');
});

test('导出入口的两处落点与复用关系写明', () => {
  const entries = section('## 三、导出入口的落点', '## 四、测试策略');

  assert.ok(entries.includes('按 JD 改简历'), '应写明改写页入口');
  assert.ok(entries.includes('定制简历'), '应写明存档页入口');
  assert.ok(entries.includes('diffResumeLines'), '应说明存档页靠反推');
  assert.ok(entries.includes('技术方案 V0.4 增补 3.8'), '应指向既有实现');
  assert.ok(entries.includes('共用 `exportDocx`'), '应说明两处共用实现');
});

test('测试策略钉住 1000px 这个回归区间', () => {
  const testing = section('## 四、测试策略', '## 五、变更分级与风险');

  assert.ok(testing.includes('1440px 与 1000px'), '应在两个宽度断言');
  assert.ok(testing.includes('修复前会退化成单列'), '应说明为什么选这两个宽度');
});

test('变更分级落到 B 类与必跑项', () => {
  const risk = section('## 五、变更分级与风险', '## 六、待确认');

  assert.ok(risk.includes('B 类'), '应给出变更分级');
  assert.ok(risk.includes('pnpm test:all'), 'B 类必跑项应包含 test:all');
  assert.ok(risk.includes('pnpm test:e2e'), 'B 类必跑项应包含 test:e2e');
});

test('PRD 增补与本文档的关键结论一致', () => {
  const prd = fs.readFileSync(PRD, 'utf8');

  ['768px', '左右分列', '上下堆叠'].forEach((keyword) => {
    assert.ok(prd.includes(keyword), 'PRD 应包含：' + keyword);
    assert.ok(tech.includes(keyword), '技术方案应保持同一结论：' + keyword);
  });
  assert.ok(tech.includes('`md`（768px）'), '技术方案应给出断点常量');
});
