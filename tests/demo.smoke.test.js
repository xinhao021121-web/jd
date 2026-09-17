/**
 * Demo 冒烟测试：验证 HTML 原型里的话术生成逻辑
 * 运行方式：node --test tests
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const HTML_PATH = path.join(__dirname, '..', '直聘打招呼助手_Demo_V0.1.html');

function createEl() {
  return {
    value: '',
    textContent: '',
    innerHTML: '',
    hidden: false,
    disabled: false,
    dataset: {},
    style: {},
    classList: {add() {}, remove() {}, contains() { return false; }},
    addEventListener() {},
    focus() {},
    remove() {},
    select() {},
    appendChild() {},
    querySelector() { return createEl(); },
    querySelectorAll() { return []; },
    closest() { return null; }
  };
}

/** 从 HTML 中抽出脚本，在最小 DOM 桩环境中执行，拿到被测函数 */
function loadDemo() {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match, 'Demo 页面中未找到 script 块');

  const els = new Map();
  const document = {
    getElementById(id) {
      if (!els.has(id)) els.set(id, createEl());
      return els.get(id);
    },
    querySelector() { return createEl(); },
    querySelectorAll() { return []; },
    createElement() { return createEl(); },
    execCommand() { return true; },
    body: {appendChild() {}}
  };
  const window = {setTimeout() { return 0; }};
  const localStorage = {getItem() { return null; }, setItem() {}};
  const navigator = {clipboard: {writeText: async () => {}}};

  const exported = eval(
    match[1] + '\n;({buildResult, resumeEl, jdEl, SAMPLE_RESUME, SAMPLE_JD})'
  );
  return exported;
}

test('示例简历 + 示例 JD：输出 3 条话术并命中关键要求', () => {
  const demo = loadDemo();
  demo.resumeEl.value = demo.SAMPLE_RESUME;
  demo.jdEl.value = demo.SAMPLE_JD;

  const result = demo.buildResult();

  assert.strictEqual(result.messages.length, 3, '应输出 3 条候选话术');
  result.messages.forEach((m) => {
    assert.ok(m.text.trim().length > 20, m.style + ' 生成内容过短');
  });
  assert.ok(result.matched.includes('Java'), '应命中 Java');
  assert.ok(result.matched.includes('Redis'), '应命中 Redis');
  assert.strictEqual(result.lowMatch, false, '示例数据不应判定为低匹配');
});

test('事实溯源：话术中的量化成果来自简历原文', () => {
  const demo = loadDemo();
  demo.resumeEl.value = demo.SAMPLE_RESUME;
  demo.jdEl.value = demo.SAMPLE_JD;

  const joined = demo.buildResult().messages.map((m) => m.text).join(' ');

  assert.ok(joined.includes('800ms'), '应引用简历中的性能数据');
  ['800ms', '180ms'].forEach((num) => {
    assert.ok(demo.SAMPLE_RESUME.includes(num), '引用的数据必须存在于简历原文：' + num);
  });
});

test('简历缺少量化成果时，话术不虚构数据', () => {
  const demo = loadDemo();
  demo.resumeEl.value = '王某某 后端开发工程师 2 年经验\n负责订单系统开发，使用 Java 与 Redis 完成需求。';
  demo.jdEl.value = demo.SAMPLE_JD;

  const joined = demo.buildResult().messages.map((m) => m.text).join(' ');

  assert.ok(!/\d+\s*ms/.test(joined), '不应凭空出现响应时间等数据');
  assert.ok(!/\d+\s*%/.test(joined), '不应凭空出现百分比数据');
});

test('简历与岗位不匹配时降级话术，不冒认技能', () => {
  const demo = loadDemo();
  demo.resumeEl.value = '某某 平面设计师 4 年经验\n负责品牌视觉设计、海报与包装设计，熟练使用 Photoshop 与 Illustrator。';
  demo.jdEl.value = demo.SAMPLE_JD;

  const result = demo.buildResult();
  const joined = result.messages.map((m) => m.text).join(' ');

  assert.strictEqual(result.lowMatch, true, '应标记为低匹配');
  assert.strictEqual(result.matched.length, 0, '不应产生命中技能');
  assert.ok(!/(熟练|熟悉|掌握).{0,4}Java/.test(joined), '不应声称掌握简历中没有的技能');
  assert.ok(!/正好是我一直在做的方向/.test(joined), '不匹配时不应套用匹配话术');
});

test('JD 中简历未覆盖的要求被标记为未覆盖', () => {
  const demo = loadDemo();
  demo.resumeEl.value = demo.SAMPLE_RESUME;
  demo.jdEl.value = '岗位要求：\n1. 3 年以上 Golang 开发经验，熟悉微服务\n2. 熟悉 Kubernetes 容器编排\n3. 熟悉 MySQL';

  const result = demo.buildResult();

  assert.ok(result.missing.includes('Go'), 'Golang 应被识别为简历未覆盖的要求');
});
