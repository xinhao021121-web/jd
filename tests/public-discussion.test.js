/**
 * 公开讨论调研方案检查（差距诊断 G1 的一条补齐路径）。
 *
 * 这类材料最容易出两种错：被当成访谈用（抬高证据强度），或者抓不到就编（伪造数据）。
 * 所以测试钉的是——证据层级写清、实测可访问性如实记录、引用规范禁止越界。
 * 运行方式：node --test tests/public-discussion.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const DOCS_DIR = path.join(__dirname, '..', 'docs');
const doc = fs.readFileSync(path.join(DOCS_DIR, '公开讨论调研_V0.1.md'), 'utf8');
const materials = fs.readFileSync(path.join(DOCS_DIR, '公开讨论材料_V1.0.md'), 'utf8');

test('标注版本与对应差距，并写明证据层级', () => {
  assert.ok(/版本号：V0\.\d/.test(doc), '应标注版本号');
  assert.ok(doc.includes('2026/09/21'), '应记录日期');
  assert.ok(doc.includes('G1'), '应指向差距诊断的 G1');
  assert.ok(doc.includes('强于推演与模拟推演，弱于第三方访谈'), '应写明证据层级');
  assert.ok(doc.includes('不得被写成「访谈」'), '应禁止抬高成访谈');
});

test('如实记录实测可访问性，包括抓不到的渠道', () => {
  ['知乎', '小红书', '牛客网', '百度贴吧', 'V2EX'].forEach((platform) => {
    assert.ok(doc.includes(platform), '应记录渠道：' + platform);
  });
  assert.ok(doc.includes('403'), '应写明被拒的状态码');
  assert.ok(doc.includes('JS 渲染'), '应写明抓不到的原因');
  assert.ok(doc.includes('复测更正'), '浏览器自动化的结论若被推翻，应写明是复测更正而不是悄悄改掉');
  assert.ok(doc.includes('公开讨论材料_V1.0.md'), '应指向实际回收的材料');
  assert.ok(doc.includes('内容富矿在小红书与牛客'), '应指出真正的内容来源');
});

test('给出的样本是实抓的，带链接与检索时间，且说清它不解决问题', () => {
  assert.ok(doc.includes('https://www.v2ex.com/t/1243593'), '样本应带可核对的链接');
  assert.ok(doc.includes('检索时间：2026/09/21'), '应写明检索时间');
  assert.ok(doc.includes('公开 API，无需登录'), '应写明取数方式，便于复现');
  assert.ok(doc.includes('V2EX 不解决问题'), '应如实说明该渠道的相关性局限');
});

test('检索清单按优先级排列，且带筛选标准', () => {
  assert.ok(doc.includes('牛客网') && doc.includes('优先级'), '应给出优先级');
  assert.ok(doc.includes('近 12 个月内'), '应给出时间筛选标准');
  assert.ok(doc.includes('具体行为或数字'), '应给出内容质量筛选标准');
  assert.ok(doc.includes('每个待验证假设收集 5 条以上'), '应给出样本量要求');
});

test('引用规范禁止越界，并强制写局限', () => {
  assert.ok(doc.includes('只能写「公开讨论材料」'), '应限定措辞');
  assert.ok(doc.includes('不能写「访谈」'), '应禁止写成访谈');
  assert.ok(doc.includes('不写用户名'), '应要求匿名化');
  assert.ok(doc.includes('不整段复制'), '应限制摘录长度');
  assert.ok(doc.includes('必须写局限'), '应强制写自选择偏差');

  // 执行版（材料表）同样要守规矩，否则规范只停在纸面上
  assert.ok(materials.includes('2026/09/21'), '材料表应逐条带检索时间');
  assert.ok(materials.includes('不得被写成「访谈」'), '材料表应重申它不是访谈');
  assert.ok(materials.includes('样本自选'), '材料表应写明样本自选的局限');
  assert.ok(materials.includes('不记用户名'), '材料表应写明已匿名化处理');
  assert.ok(!/牛客\d{6,}号/.test(materials), '材料表不得出现用户名（含平台默认昵称）');
  assert.ok(materials.includes('未找到'), '找不到材料的假设要如实记「未找到」，不凑数');
});

test('材料到假设的映射覆盖高风险假设', () => {
  ['H1', 'H3', 'H4', 'H7', 'H11'].forEach((id) => {
    assert.ok(doc.includes('| ' + id), '映射表应覆盖假设 ' + id);
  });
  assert.ok(doc.includes('找到什么算反驳'), '应同时定义反驳条件，避免只找支持的证据');
});

test('完成标准可核销，且不把公开讨论等同于访谈', () => {
  assert.ok(doc.includes('## 七、完成标准'), '应有完成标准一节');
  assert.ok(doc.includes('替代不了第三方访谈'), '应声明它替代不了访谈');
});

test('假设库把公开讨论列为第三种来源', () => {
  const pool = fs.readFileSync(path.join(DOCS_DIR, '待验证假设_V0.1.md'), 'utf8');

  assert.ok(pool.includes('公开讨论材料'), '假设库应收录该来源');
  assert.ok(pool.includes('不得写成「访谈」'), '假设库应沿用同一条措辞约束');
});

test('引用的仓库路径都真实存在', () => {
  const targets = [...doc.matchAll(/\]\(([^)\s]+\.md)\)/g)].map((match) => match[1]);

  assert.ok(targets.length >= 1, '应引用差距诊断，实际 ' + targets.length + ' 条');
  targets.forEach((target) => {
    assert.ok(
      fs.existsSync(path.resolve(DOCS_DIR, target)),
      '引用路径应存在（相对 docs/）：' + target
    );
  });
});
