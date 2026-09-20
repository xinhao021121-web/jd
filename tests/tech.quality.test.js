/**
 * 技术方案 V0.3 增补一致性检查：本地自检、提示词收缩与协议变更必须自洽，
 * 且不推翻 V0.1 与 V0.2 增补的既有结论。
 * 运行方式：node --test tests/tech.quality.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');
const V03 = path.join(ROOT, 'docs', '技术方案_V0.3_增补.md');
const V01 = path.join(ROOT, 'docs', '技术方案_V0.1.md');
const V02 = path.join(ROOT, 'docs', '技术方案_V0.2_增补.md');

const doc = fs.readFileSync(V03, 'utf8');

const section = (start, end) => {
  const rest = doc.split(start)[1];
  return end ? rest.split(end)[0] : rest;
};

test('增补文档只写增量，关联 V0.1 与 V0.2 增补，历史文档保持原样', () => {
  assert.ok(doc.includes('版本号：V0.3（增补）'), '应标注版本');
  assert.ok(doc.includes('技术方案_V0.1.md'), '应关联技术方案 V0.1');
  assert.ok(doc.includes('技术方案_V0.2_增补.md'), '应关联技术方案 V0.2 增补');
  assert.ok(doc.includes('不重复已有内容'), '应声明只写增量');

  ['## 二、技术选型', '## 三、仓库结构', '## 四、总体架构', '## 五、核心模块设计'].forEach(
    (heading) => {
      assert.ok(!doc.includes(heading), '不应复制 V0.1 的完整章节：' + heading);
    }
  );
  assert.ok(fs.readFileSync(V01, 'utf8').includes('版本号：V0.1'), 'V0.1 不应被改写');
  assert.ok(
    fs.readFileSync(V02, 'utf8').includes('版本号：V0.2（增补）'),
    'V0.2 增补不应被改写'
  );
});

test('本地自检落到 core，并由服务端逐条执行、只标注不丢弃', () => {
  const guard = section('## 二、本地自检的落点与偏差处理', '## 三、提示词收缩');

  ['packages/core/src/quality.ts', 'checkGreetingText', 'checkSuggestionText', 'checkGreetings', 'checkSuggestions'].forEach(
    (item) => {
      assert.ok(guard.includes(item), '自检实现应包含：' + item);
    }
  );
  assert.ok(guard.includes('POST /api/llm'), '应说明服务端调用位置');
  assert.ok(guard.includes('命中只标注不丢弃'), '应说明偏差处理是标注而非丢弃');
  assert.ok(guard.includes('锚点落在锁定区块的建议继续直接丢弃'), '既有硬约束不能被放松');
  assert.ok(guard.includes('不含长度与条数'), '应说明自检范围不含长度与条数，避免重复报警');
  assert.ok(guard.includes('同一份函数'), '线上与离线必须共用同一实现');
});

test('提示词不再让模型自检，也不再要求输出本地已知字段', () => {
  const prompts = section('## 三、提示词收缩', '## 四、协议变更');

  assert.ok(doc.includes('提示词不再让模型自检'), '结论里应写明删掉模型自检');
  assert.ok(prompts.includes('输出前逐条自检'), '应指出现状是让模型自检');
  assert.ok(prompts.includes('`index` / `style` 由本地赋值'), '应写明本地赋值');
  assert.ok(prompts.includes('只发可改写区块原文 + 锁定区块标题'), '建议任务应去掉全文重复投喂');
  assert.ok(prompts.includes('锁定区块正文不再进入请求体'), '应写明锁定内容不再发送');
});

test('协议变更给出 issues 与服务端覆盖规则', () => {
  const protocol = section('## 四、协议变更', '## 五、成本与风险');

  assert.ok(protocol.includes('issues'), '应定义 issues 字段');
  assert.ok(protocol.includes('改为可选'), 'index / style 应改为可选');
  assert.ok(protocol.includes('GREETING_STYLES[序号]'), '应说明 style 的本地取值规则');
  assert.ok(protocol.includes('用本地计算结果覆盖'), '模型自带的 issues 必须被覆盖，不能伪造通过');
});

test('量化口径可核对：提示词与建议任务的降幅写在同一张表里', () => {
  const prompts = section('## 三、提示词收缩', '## 四、协议变更');

  ['797 字', '740 字', '2030 字', '1640 字', '2 次', '1 次'].forEach((value) => {
    assert.ok(prompts.includes(value), '量化表应包含：' + value);
  });
  assert.ok(prompts.includes('tests/fixtures.ts'), '应写明样本来源，便于复核');
  assert.ok(prompts.includes('长度越界'), '应记录删掉目标字数后复现的长度越界');
  assert.ok(prompts.includes('它是写作要求'), '应说明只删自检、不删写作要求');
});

test('边界写明词典级判定与不使用审核模型', () => {
  const risk = section('## 五、成本与风险', '## 六、测试策略');
  const limits = section('## 七、已知边界', '');

  assert.ok(risk.includes('词典级自检存在漏检'), '风险表应承认漏检');
  assert.ok(risk.includes('不阻断复制与采纳'), '提示不应阻断主流程');
  assert.ok(limits.includes('规则式'), '应说明自检是规则式的');
  assert.ok(limits.includes('不引入第二个模型做审核'), '不应把审核交给第二个模型');
  assert.ok(limits.includes('改写建议永远改不到锁定区块'), '应写明唯一硬保证');
});
