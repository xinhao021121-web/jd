/**
 * Demo 冒烟测试（V0.2：简历保存与生成分离）
 * 运行方式：node --test tests/demo.smoke.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const HTML_PATH = path.join(__dirname, '..', '直聘打招呼助手_Demo_V0.2.html');

function createEl() {
  return {
    value: '', textContent: '', innerText: '', innerHTML: '',
    hidden: false, disabled: false, dataset: {}, style: {},
    classList: {add() {}, remove() {}, contains() { return false; }, toggle() {}},
    addEventListener() {}, focus() {}, remove() {}, select() {}, appendChild() {},
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
  const window = {setTimeout() { return 0; }, clearTimeout() {}};
  const localStorage = {getItem() { return null; }, setItem() {}};
  const navigator = {clipboard: {writeText: async () => {}}};

  const exported = eval(
    match[1] + '\n;({buildResult, state, saveResume, generate, resumeEditor, jdEl, SAMPLE_RESUME, SAMPLE_JD})'
  );
  return Object.assign({els}, exported);
}

/** 在简历页写入内容并保存，返回 demo 实例 */
function saveAs(resume) {
  const demo = loadDemo();
  demo.resumeEditor.value = resume === undefined ? demo.SAMPLE_RESUME : resume;
  demo.saveResume();
  return demo;
}

const DESIGNER = '某某 平面设计师 4 年经验\n负责品牌视觉设计、海报与包装设计，熟练使用 Photoshop 与 Illustrator。';

test('保存简历：记录内容与保存时间', () => {
  const demo = loadDemo();
  assert.strictEqual(demo.state.resume, '', '初始应没有已保存简历');
  demo.resumeEditor.value = demo.SAMPLE_RESUME;
  demo.saveResume();
  assert.strictEqual(demo.state.resume, demo.SAMPLE_RESUME.trim());
  assert.ok(demo.state.savedAt > 0, '应记录保存时间');
});

test('内容过短时拒绝保存', () => {
  const demo = saveAs('太短了');
  assert.strictEqual(demo.state.resume, '', '过短内容不应被保存');
});

test('生成只读取已保存简历，未保存的编辑不生效', () => {
  const demo = saveAs();
  demo.resumeEditor.value = DESIGNER;
  demo.jdEl.value = demo.SAMPLE_JD;
  assert.ok(demo.buildResult().matched.includes('Java'), '应仍基于已保存的简历生成');
});

test('没有保存简历时不允许生成', () => {
  const demo = loadDemo();
  demo.jdEl.value = demo.SAMPLE_JD;
  demo.generate();
  assert.strictEqual(demo.state.stats.gen, 0, '缺简历时不应发起生成');
});

test('示例简历生成 3 条话术，命中关键要求且数据可溯源', () => {
  const demo = saveAs();
  demo.jdEl.value = demo.SAMPLE_JD;

  const result = demo.buildResult();
  const joined = result.messages.map((m) => m.text).join(' ');

  assert.strictEqual(result.messages.length, 3, '应输出 3 条候选话术');
  result.messages.forEach((m) => {
    assert.ok(m.text.trim().length > 20, m.style + ' 生成内容过短');
  });
  assert.ok(result.matched.includes('Java'), '应命中 Java');
  assert.ok(result.matched.includes('Redis'), '应命中 Redis');
  assert.strictEqual(result.lowMatch, false, '示例数据不应判定为低匹配');
  assert.ok(joined.includes('800ms'), '应引用简历原文中的性能数据');
  assert.ok(demo.SAMPLE_RESUME.includes('800ms'), '引用的数据必须存在于简历原文');
});

test('简历与岗位不匹配时降级话术，不冒认技能', () => {
  const demo = saveAs(DESIGNER);
  demo.jdEl.value = demo.SAMPLE_JD;

  const result = demo.buildResult();
  const joined = result.messages.map((m) => m.text).join(' ');

  assert.strictEqual(result.lowMatch, true, '应标记为低匹配');
  assert.strictEqual(result.matched.length, 0, '不应产生命中技能');
  assert.ok(!/(熟练|熟悉|掌握).{0,4}Java/.test(joined), '不应声称掌握简历中没有的技能');
  assert.ok(!/正好是我一直在做的方向/.test(joined), '不匹配时不应套用匹配话术');
});

test('JD 中简历未覆盖的要求被标记为未覆盖', () => {
  const demo = saveAs();
  demo.jdEl.value = '岗位要求：\n1. 3 年以上 Golang 开发经验，熟悉微服务\n2. 熟悉 Kubernetes 容器编排\n3. 熟悉 MySQL';
  assert.ok(demo.buildResult().missing.includes('Go'), 'Golang 应被识别为未覆盖要求');
});
