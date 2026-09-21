/**
 * 模型选型对比文档检查：它是差距诊断 G6 / G7 的证据层，
 * 因此钉住三件事——实测数字来自可复现的命令、结论不超出证据、单价不被当成已知事实。
 * 运行方式：node --test tests/model-selection.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const DOC_PATH = path.join(DOCS_DIR, '模型选型对比_V1.0.md');
const doc = fs.readFileSync(DOC_PATH, 'utf8');

test('标注版本，并指向差距诊断的 G6 与 G7', () => {
  assert.ok(/版本号：V1\.\d/.test(doc), '应标注版本号');
  assert.ok(doc.includes('2026/09/21'), '应记录实测时间');
  assert.ok(doc.includes('G6'), '应指向 G6（模型选型无对比）');
  assert.ok(doc.includes('G7'), '应指向 G7（单位经济性）');
});

test('三个候选模型都在，且给出一次完整生成的 token 口径', () => {
  ['deepseek-chat', 'deepseek-flash', 'deepseek-v4-pro'].forEach((model) => {
    assert.ok(doc.includes(model), '应包含候选模型：' + model);
  });

  assert.ok(doc.includes('一次完整生成'), '应给出一次完整生成的合计口径');
  assert.ok(doc.includes('1443'), '应写明 deepseek-chat 的输入 token 实测值');
  assert.ok(doc.includes('596'), '应写明 deepseek-chat 的输出 token 实测值');
  assert.ok(doc.includes('include_usage'), '应写明用量是怎么拿到的');
});

test('结论不超出证据：写明倍率、性能门槛与 pro 的样本量限制', () => {
  ['5.6×', '30×', '20.9×'].forEach((ratio) => {
    assert.ok(doc.includes(ratio), '应给出倍率：' + ratio);
  });

  assert.ok(doc.includes('不满足'), '应写明 pro 未满足 PRD 的完整耗时承诺');
  assert.ok(doc.includes('只跑了 2 组'), '应写明 pro 的样本量不足以支撑质量结论');
  assert.ok(doc.includes('未做跨供应商对比'), '应声明没有跨供应商对比');
  assert.ok(doc.includes('判不了「像不像真人写的」'), '应声明自检不覆盖主观质量');
});

test('单价来源与边界都写清：公开价可查，账单价为准', () => {
  assert.ok(doc.includes('官方公开价'), '应写明用的是官方公开价而不是自拟价格');
  assert.ok(doc.includes('api-docs.deepseek.com'), '应给出定价页出处，便于复核');
  assert.ok(doc.includes('必须以账单为准'), '应写明真实单价以账单为准');
  assert.ok(doc.includes('不是账单核对值'), '按公开价折算的数字必须标注为非核对值');
  assert.ok(doc.includes('--price-in='), '应给出带单价折算的复现命令');
  assert.ok(doc.includes('DAILY_CALL_CAP'), '应把成本硬顶与既有配额口径挂钩');
});

test('复现命令与单测都在文档里可追溯', () => {
  assert.ok(doc.includes('pnpm model:compare'), '应给出复现命令');
  assert.ok(doc.includes('tests/model-compare.test.ts'), '应指向汇总逻辑的单测');
  assert.ok(doc.includes('不进 CI'), '应说明真实调用不在 CI 里跑');
});

test('引用的仓库路径都真实存在', () => {
  const targets = [...doc.matchAll(/\]\(([^)\s]+\.md)\)/g)].map((match) => match[1]);

  assert.ok(targets.length >= 2, '应引用差距诊断与质量回归，实际 ' + targets.length + ' 条');
  targets.forEach((target) => {
    assert.ok(
      fs.existsSync(path.resolve(DOCS_DIR, target)),
      '引用路径应存在（相对 docs/）：' + target
    );
  });
});
