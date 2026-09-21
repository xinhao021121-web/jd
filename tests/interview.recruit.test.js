/**
 * 访谈招募与执行物料检查。
 *
 * 这份物料解决的是执行障碍（找不到人、不知道怎么开口、聊完不会归纳），
 * 所以测试钉的是——门槛降到位、文案可直接用、归纳口径不含糊、与盲测的隔离检查在。
 * 运行方式：node --test tests/interview.recruit.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const DOCS_DIR = path.join(__dirname, '..', 'docs');
const doc = fs.readFileSync(path.join(DOCS_DIR, '访谈招募与执行_V1.0.md'), 'utf8');

test('标注版本，并说明它解决的是执行障碍而不是证据', () => {
  assert.ok(/版本号：V1\.\d/.test(doc), '应标注版本号');
  assert.ok(doc.includes('2026/09/21'), '应记录日期');
  assert.ok(doc.includes('解决的是**执行障碍**'), '应说明这份文件的定位');
  assert.ok(doc.includes('找不到人、不知道怎么开口、聊完不知道怎么归纳'), '应点明三个执行障碍');
});

test('给了一个真的能起步的口径，而不是只有完整标准', () => {
  assert.ok(doc.includes('先做 1 人'), '应给出最小起步量');
  assert.ok(doc.includes('压到 10 分钟'), '应给出时间不够时的降级方案');
  assert.ok(doc.includes('文字聊天也算'), '应允许降级沟通方式');
  assert.ok(doc.includes('别等凑齐 3 个人再开始'), '应鼓励先开始');
});

test('招募文案两版齐全，且可直接复制', () => {
  assert.ok(doc.includes('熟人私信版'), '应有熟人版文案');
  assert.ok(doc.includes('公开帖子版'), '应有公开帖版文案');
  assert.ok(doc.includes('30 元红包'), '应写明酬谢');
  assert.ok(doc.includes('不要提产品名与链接'), '应给出发帖禁忌');
});

test('筛选含渠道题，并说明不通过就结束', () => {
  assert.ok(doc.includes('在平台上**文字沟通**'), '应含渠道筛选题');
  assert.ok(doc.includes('礼貌结束'), '应说明渠道不符就结束');
  assert.ok(doc.includes('会把结论带偏'), '应说明为什么要筛渠道');
});

test('开场五项知情同意齐全，且禁止评价对方', () => {
  ['来意', '时长', '记录', '降低压力', '不评价'].forEach((item) => {
    assert.ok(doc.includes('**' + item + '**'), '开场应包含：' + item);
  });
  assert.ok(doc.includes('不要附和'), '应禁止附和');
});

test('意外处理表覆盖真实会发生的六种情况', () => {
  ['对方回答很短', '对方跑题', '对方反过来夸产品', '对方问产品细节', '对方明显赶时间', '对方从没用过 AI 工具'].forEach(
    (item) => {
      assert.ok(doc.includes(item), '意外处理应覆盖：' + item);
    }
  );
});

test('归纳口径可判定，且要求保留冲突与反例', () => {
  assert.ok(doc.includes('≥3 人'), '应给出支持判定线');
  assert.ok(doc.includes('证据不足（照实写，不要凑成支持）'), '应禁止把 1 人凑成支持');
  assert.ok(doc.includes('冲突必须单独记录'), '应要求保留冲突');
  assert.ok(doc.includes('反例优先'), '应要求主动找反例');
  assert.ok(doc.includes('当天填完'), '应要求当天记录');
});

test('与盲测的隔离检查在物料里，且可勾选', () => {
  assert.ok(doc.includes('不能是同一批人'), '应声明访谈对象与盲测评分者不能重合');
  assert.ok(doc.includes('P 系列'), '应给出代号区分方式');
  assert.ok(doc.includes('- [ ]'), '应有可勾选的检查项');
});

test('完成标准指向核销路径，且提纲指向这份物料', () => {
  assert.ok(doc.includes('## 九、完成标准'), '应有完成标准一节');
  assert.ok(doc.includes('G1 状态改为「已核销」'), '应给出核销路径');

  const outline = fs.readFileSync(path.join(DOCS_DIR, '用户访谈提纲_V1.1.md'), 'utf8');
  assert.ok(outline.includes('访谈招募与执行_V1.0.md'), '提纲应指向招募与执行物料');
});

test('引用的仓库路径都真实存在', () => {
  const targets = [...doc.matchAll(/\]\(([^)\s]+\.md)\)/g)].map((match) => match[1]);

  assert.ok(targets.length >= 2, '应引用提纲与差距诊断，实际 ' + targets.length + ' 条');
  targets.forEach((target) => {
    assert.ok(
      fs.existsSync(path.resolve(DOCS_DIR, target)),
      '引用路径应存在（相对 docs/）：' + target
    );
  });
});
