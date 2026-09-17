/**
 * Demo 冒烟测试（V0.2：简历保存与生成分离）
 * 运行方式：node --test tests/demo.smoke.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const HTML_PATH = path.join(__dirname, '..', '直聘打招呼助手_Demo_V0.2.html');

function makeClassList() {
  const set = new Set();
  return {
    add(c) { set.add(c); },
    remove(c) { set.delete(c); },
    contains(c) { return set.has(c); },
    toggle(c, on) {
      if (on === undefined) { set.has(c) ? set.delete(c) : set.add(c); }
      else if (on) { set.add(c); }
      else { set.delete(c); }
    }
  };
}

function createEl() {
  return {
    value: '', textContent: '', innerText: '', innerHTML: '',
    hidden: false, disabled: false, dataset: {}, style: {},
    classList: makeClassList(),
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
    match[1] + '\n;({buildResult, state, saveResume, generate, setCollapsed, resumeEditor, jdEl, jd2El, parseResume, buildResumeSuggestions, composeCustomResume, saveCustom, SAMPLE_RESUME, SAMPLE_JD})'
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
  demo.state.jd = demo.SAMPLE_JD;
  assert.ok(demo.buildResult().matched.includes('Java'), '应仍基于已保存的简历生成');
});

test('没有保存简历时不允许生成', () => {
  const demo = loadDemo();
  demo.state.jd = demo.SAMPLE_JD;
  demo.generate();
  assert.strictEqual(demo.state.stats.gen, 0, '缺简历时不应发起生成');
});

test('示例简历生成 3 条话术，命中关键要求且数据可溯源', () => {
  const demo = saveAs();
  demo.state.jd = demo.SAMPLE_JD;

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
  demo.state.jd = demo.SAMPLE_JD;

  const result = demo.buildResult();
  const joined = result.messages.map((m) => m.text).join(' ');

  assert.strictEqual(result.lowMatch, true, '应标记为低匹配');
  assert.strictEqual(result.matched.length, 0, '不应产生命中技能');
  assert.ok(!/(熟练|熟悉|掌握).{0,4}Java/.test(joined), '不应声称掌握简历中没有的技能');
  assert.ok(!/正好是我一直在做的方向/.test(joined), '不匹配时不应套用匹配话术');
});

test('JD 中简历未覆盖的要求被标记为未覆盖', () => {
  const demo = saveAs();
  demo.state.jd = '岗位要求：\n1. 3 年以上 Golang 开发经验，熟悉微服务\n2. 熟悉 Kubernetes 容器编排\n3. 熟悉 MySQL';
  assert.ok(demo.buildResult().missing.includes('Go'), 'Golang 应被识别为未覆盖要求');
});


test('侧边栏可以收起与展开', () => {
  const demo = loadDemo();
  const sidebar = demo.els.get('sidebar');

  demo.setCollapsed(true);
  assert.ok(sidebar.classList.contains('collapsed'), '应收起侧边栏');

  demo.setCollapsed(false);
  assert.ok(!sidebar.classList.contains('collapsed'), '应展开侧边栏');
});


test('简历分区：指定区块可改写，个人信息与教育经历锁定', () => {
  const demo = loadDemo();
  const blocks = demo.parseResume(demo.SAMPLE_RESUME);
  const editable = blocks.filter((b) => b.kind === 'editable').map((b) => b.title);
  const locked = blocks.filter((b) => b.kind === 'locked').map((b) => b.title);

  assert.ok(editable.includes('工作经历'), '工作经历应可改写');
  assert.ok(editable.includes('专业技能'), '专业技能应可改写');
  assert.ok(locked.includes('（简历开头）'), '开头个人信息应锁定');
  assert.ok(locked.includes('教育背景'), '教育背景应锁定');
});

test('改写建议只落在可改写区块内', () => {
  const demo = saveAs();
  demo.state.jd = demo.SAMPLE_JD;
  const result = demo.buildResumeSuggestions();

  assert.ok(result.suggestions.length > 0, '应给出改写建议');
  result.suggestions.forEach((s) => {
    assert.ok(['项目经历', '工作经历', '实习经历', '自我评价', '专业技能'].includes(s.section),
      '建议不应落在锁定区块：' + s.section);
  });
});

test('采纳建议后，个人信息与教育经历保持原文', () => {
  const demo = saveAs();
  demo.state.jd = demo.SAMPLE_JD;
  demo.state.suggestions = demo.buildResumeSuggestions().suggestions
    .map((s) => Object.assign({}, s, {adopted: true}));

  const composed = demo.composeCustomResume();
  const before = demo.parseResume(demo.state.resume).filter((b) => b.kind === 'locked');
  const after = demo.parseResume(composed).filter((b) => b.kind === 'locked');

  assert.strictEqual(after.length, before.length, '锁定区块数量不应变化');
  before.forEach((b, i) => {
    assert.deepStrictEqual(after[i].lines, b.lines, '锁定区块内容不应改动：' + b.title);
  });
});

test('没有采纳任何建议时，定制简历与原件一致', () => {
  const demo = saveAs();
  demo.state.jd = demo.SAMPLE_JD;
  demo.state.suggestions = demo.buildResumeSuggestions().suggestions;

  assert.strictEqual(demo.composeCustomResume(), demo.state.resume.trim());
});

test('保存定制版本不会覆盖原始简历', () => {
  const demo = saveAs();
  const original = demo.state.resume;
  demo.state.jd = demo.SAMPLE_JD;
  demo.state.suggestions = demo.buildResumeSuggestions().suggestions
    .map((s) => Object.assign({}, s, {adopted: true}));

  demo.saveCustom();

  assert.strictEqual(demo.state.resume, original, '原始简历不应被改动');
  assert.strictEqual(demo.state.customs.length, 1, '应留下一条定制版本记录');
  assert.ok(demo.state.customs[0].text.includes('教育背景'), '定制版本应包含完整简历');
});


test('定制简历单独存档，并记录对应岗位 JD', () => {
  const demo = saveAs();
  demo.state.jd = demo.SAMPLE_JD;
  demo.state.suggestions = demo.buildResumeSuggestions().suggestions
    .map((s) => Object.assign({}, s, {adopted: true}));

  demo.saveCustom();

  assert.strictEqual(demo.state.customs.length, 1, '应存下一份定制简历');
  assert.ok(demo.state.customs[0].jd.includes('Java'), '应记录对应的岗位 JD');
  assert.ok(demo.state.customs[0].text.includes('教育背景'), '定制简历应包含完整内容');
});

test('多份定制简历互不影响，原始简历始终不变', () => {
  const demo = saveAs();
  const original = demo.state.resume;

  demo.state.jd = demo.SAMPLE_JD;
  demo.state.suggestions = demo.buildResumeSuggestions().suggestions
    .map((s) => Object.assign({}, s, {adopted: true}));
  demo.saveCustom();

  demo.state.jd = '岗位：数据平台开发工程师\n任职要求：熟悉 Python、数据分析、指标体系';
  demo.state.suggestions = demo.buildResumeSuggestions().suggestions
    .map((s) => Object.assign({}, s, {adopted: true}));
  demo.saveCustom();

  assert.strictEqual(demo.state.customs.length, 2, '应存下两份定制简历');
  assert.notStrictEqual(demo.state.customs[0].jd, demo.state.customs[1].jd, '两份应各自绑定不同 JD');
  assert.strictEqual(demo.state.resume, original, '原始简历不应被改动');
});
