/**
 * 评审标准一致性检查：评审阈值必须与 PRD、技术方案保持同一口径
 * 运行方式：node --test tests/review.standard.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');
const review = fs.readFileSync(path.join(ROOT, 'docs', '项目评审标准_V0.2.md'), 'utf8');
const prd = fs.readFileSync(path.join(ROOT, '直聘打招呼助手_PRD_V0.2.md'), 'utf8');
const tech = fs.readFileSync(path.join(ROOT, 'docs', '技术方案_V0.1.md'), 'utf8');

test('评审标准标注版本并关联 PRD', () => {
  assert.ok(review.includes('版本号：V0.2'), '评审标准应标注版本号');
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
  ['≥ 80%', '≥ 40%', '≥ 70%', '≤30 秒', '≥ 3.5/5'].forEach((keyword) => {
    assert.ok(review.includes(keyword), '评审标准应包含：' + keyword);
  });
  assert.ok(prd.includes('≥ 80%'), 'PRD 应确认会话级零修改直接复制率目标');
  assert.ok(prd.includes('≥ 40%'), 'PRD 应确认条级辅助指标');
  assert.ok(prd.includes('≥ 70%'), 'PRD 应确认至少采纳 1 条建议的比例');
  assert.ok(!prd.includes('≥ 50% [待确认]'), 'PRD 不应保留旧的待确认阈值');
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
  ['证据形式', 'P0', 'P1', 'P2', '外部盲测'].forEach((keyword) => {
    assert.ok(review.includes(keyword), '评审标准应包含：' + keyword);
  });
  assert.ok(review.includes('行动项'), '评审结论应要求行动项有负责人与截止时间');
});

test('单人项目必备：两层评审、变更分级与独立视角', () => {
  ['上线前项目评审', '日常变更门槛'].forEach((keyword) => {
    assert.ok(review.includes(keyword), '评审标准应包含：' + keyword);
  });
  ['A 类', 'B 类', 'C 类'].forEach((keyword) => {
    assert.ok(review.includes(keyword), '变更分级应包含：' + keyword);
  });
  assert.ok(review.includes('结论不能只由自评支撑'), '单人评审应要求至少一项外部证据');
});
