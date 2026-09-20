/**
 * 导出能力技术方案检查：回填算法的关键决策、被否决方案与变更分级必须自洽，
 * 且不推翻 V0.1 / V0.2 / V0.3 的既有结论。
 * 运行方式：node --test tests/tech.export.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');
const V04 = path.join(ROOT, 'docs', '技术方案_V0.4_增补.md');
const V01 = path.join(ROOT, 'docs', '技术方案_V0.1.md');
const PRD = path.join(ROOT, '直聘打招呼助手_PRD_V0.4_增补.md');

const tech = fs.readFileSync(V04, 'utf8');

const section = (start, end) => {
  const rest = tech.split(start)[1];
  return end ? rest.split(end)[0] : rest;
};

test('增补文档只写增量，关联既有版本与 PRD 增补', () => {
  assert.ok(tech.includes('版本号：V0.4（增补）'), '应标注版本');
  assert.ok(tech.includes('技术方案_V0.1.md'), '应关联技术方案 V0.1');
  assert.ok(tech.includes('技术方案_V0.3_增补.md'), '应关联技术方案 V0.3 增补');
  assert.ok(tech.includes('直聘打招呼助手_PRD_V0.4_增补.md'), '应关联 PRD 增补');
  assert.ok(tech.includes('不重复已有内容'), '应声明只写增量');

  ['## 一、方案目标', '## 二、技术选型', '## 三、仓库结构', '## 四、总体架构', '## 五、核心模块设计'].forEach(
    (heading) => {
      assert.ok(!tech.includes(heading), '不应复制 V0.1 的完整章节：' + heading);
    }
  );
  assert.ok(fs.readFileSync(V01, 'utf8').includes('版本号：V0.1'), 'V0.1 历史文档不应被改写');
});

test('不新增依赖、接口、密钥与部署形态', () => {
  const scope = section('## 一、结论与范围', '## 二、模块与落点');

  assert.ok(scope.includes('不新增任何依赖、不新增接口、不新增密钥、不新增部署形态'), '应写明不新增形态');
  assert.ok(scope.includes('fflate'), '应说明打包复用既有依赖');
  assert.ok(scope.includes('字符串处理'), '应说明回填是纯字符串处理');
});

test('模块落点区分纯逻辑与浏览器适配层', () => {
  const modules = section('## 二、模块与落点', '## 三、回填算法');

  ['normalizeLineWithSpans(raw)', 'fillDocxTemplate(documentXml, adopted)', 'suggestionLengthLimit(before)'].forEach(
    (fn) => {
      assert.ok(modules.includes(fn), 'core 应新增：' + fn);
    }
  );
  assert.ok(modules.includes('packages/core'), '应说明纯逻辑下沉 core');
  assert.ok(modules.includes('utils/export/docx.ts'), '应说明浏览器适配层位置');
  assert.ok(modules.includes('downloadBlob'), '应新增下载函数');
  assert.ok(modules.includes('不进 localStorage'), '模板不得持久化');
});

test('回填算法写清了四项关键决策', () => {
  const algorithm = section('## 三、回填算法', '## 四、被否决的方案');

  assert.ok(algorithm.includes('XMLSerializer'), '应说明为什么不用 DOMParser 往返');
  assert.ok(algorithm.includes('没有 `DOMParser`'), '应写明 Node 测试环境的限制');
  assert.ok(algorithm.includes('命名空间前缀探测'), '应说明前缀探测');
  assert.ok(algorithm.includes('最内层'), '应说明嵌套段落按最内层归属');
  assert.ok(algorithm.includes('来源区间'), '应说明规整坐标映射');
  assert.ok(algorithm.includes('从后往前'), '应说明编辑的应用顺序');
  assert.ok(algorithm.includes('数字字符引用'), '应说明实体编解码覆盖范围');

  ['applied', 'skipped', 'fallback'].forEach((field) => {
    assert.ok(algorithm.includes(field), '返回值应包含：' + field);
  });
});

test('被否决方案保留了 PDF 两条路线的判断依据', () => {
  const rejected = section('## 四、被否决的方案', '## 五、前端集成要点');

  ['PDF → docx', '版面重建', 'Adobe PDF Services', '另存为 PDF'].forEach((point) => {
    assert.ok(rejected.includes(point), '被否决方案应包含：' + point);
  });
  assert.ok(rejected.includes('中文绘制必须嵌入字体'), '应写明 PDF 覆盖层的字体约束');
  assert.ok(rejected.includes('溢出'), '应写明 PDF 覆盖层的溢出风险');
  assert.ok(rejected.includes('本期只做 Word 路线'), '应给出结论');
});

test('前端集成要点与 PRD 口径一致', () => {
  const web = section('## 五、前端集成要点', '## 六、测试策略');

  assert.ok(web.includes('resumeTemplate'), '应说明模板的 store 字段');
  assert.ok(web.includes('原文件名_定制.docx'), '应与 PRD 的命名一致');
  assert.ok(web.includes('不要求先采纳建议'), '应与 PRD 的可用条件一致');
  assert.ok(web.includes('checkSuggestionText'), '应说明长度自检的落点');
});

test('测试策略覆盖往返一致性与端到端导出', () => {
  const testing = section('## 六、测试策略', '## 七、变更分级与风险');

  assert.ok(testing.includes('tests/samples/import/resume-sample.docx'), '应复用既有样本');
  assert.ok(testing.includes('逐字一致'), '应有往返一致性断言');
  assert.ok(testing.includes('端到端（Playwright）'), '应有端到端覆盖');
  assert.ok(testing.includes('体积回归'), '应保持体积回归断言');
  assert.ok(testing.includes('100%'), 'core 覆盖率要求不变');
});

test('变更分级落到 A 类与必跑项', () => {
  const risk = section('## 七、变更分级与风险', '## 八、落地顺序');

  assert.ok(risk.includes('A 类'), '应给出变更分级');
  assert.ok(risk.includes('pnpm quality:samples'), 'A 类必跑真实模型回归');
  assert.ok(risk.includes('docs/质量回归_V0.2.md'), '应说明结论留档位置');
});

test('PRD 增补与本文档的关键结论一致', () => {
  const prd = fs.readFileSync(PRD, 'utf8');

  ['Word 保真导出', '原文件名_定制.docx', '不要求先采纳建议'].forEach((keyword) => {
    assert.ok(prd.includes(keyword), 'PRD 应包含：' + keyword);
    assert.ok(tech.includes(keyword), '技术方案应保持同一结论：' + keyword);
  });

  assert.ok(prd.includes('custom_export'), 'PRD 应登记导出埋点事件');
  assert.ok(tech.includes('suggestionLengthLimit'), '技术方案应给出长度上限的实现落点');
});
