/**
 * 评审标准一致性检查：评审阈值必须与 PRD、技术方案保持同一口径
 * 运行方式：node --test tests/review.standard.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');
const review = fs.readFileSync(path.join(ROOT, 'docs', '项目评审标准_V0.1.md'), 'utf8');
const prd = fs.readFileSync(path.join(ROOT, '直聘打招呼助手_PRD_V0.2.md'), 'utf8');
const tech = fs.readFileSync(path.join(ROOT, 'docs', '技术方案_V0.1.md'), 'utf8');

test('评审标准标注版本并关联 PRD', () => {
  assert.ok(review.includes('版本号：V0.1'), '评审标准应标注版本号');
  assert.ok(review.includes('直聘打招呼助手_PRD_V0.2.md'), '评审标准应关联 PRD');
});

test('性能与限流阈值与 PRD、技术方案同源', () => {
  ['首字 ≤5 秒', '完整结果 ≤30 秒'].forEach((keyword) => {
    assert.ok(prd.includes(keyword), 'PRD 应包含：' + keyword);
    assert.ok(review.includes(keyword), '评审标准应包含：' + keyword);
  });
  ['每 IP 每分钟 10 次', '每日 100 次'].forEach((keyword) => {
    assert.ok(tech.includes(keyword), '技术方案应包含：' + keyword);
    assert.ok(review.includes(keyword), '评审标准应包含：' + keyword);
  });
});

test('体验指标沿用 PRD 的目标值，不另立口径', () => {
  ['≥50%', '≥60%', '≤30 秒', '≥3.5/5'].forEach((keyword) => {
    assert.ok(review.includes(keyword), '评审标准应包含：' + keyword);
  });
  assert.ok(prd.includes('≥ 50%'), 'PRD 应保留零修改直接复制率目标');
  assert.ok(prd.includes('≥ 60%'), 'PRD 应保留改写建议采纳率目标');
});

test('判定规则为门槛制，且覆盖三类硬边界的一票否决', () => {
  ['P0 一票否决', '有条件通过', '不通过'].forEach((keyword) => {
    assert.ok(review.includes(keyword), '评审标准应包含：' + keyword);
  });
  ['编造', '锁定区块', '密钥'].forEach((keyword) => {
    assert.ok(review.includes(keyword), '一票否决清单应覆盖：' + keyword);
  });
});

test('每个维度都有证据形式与层级，避免主观判定', () => {
  ['证据形式', 'P0', 'P1', 'P2'].forEach((keyword) => {
    assert.ok(review.includes(keyword), '评审标准应包含：' + keyword);
  });
  assert.ok(review.includes('行动项'), '评审结论应要求行动项有负责人与截止时间');
});
