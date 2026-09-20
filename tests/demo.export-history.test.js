/**
 * Demo V0.4 的话术历史与导出入口冒烟测试：全程本地模拟，不发网络请求。
 * 运行方式：node --test tests/demo.export-history.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const HTML_PATH = path.join(__dirname, '..', '直聘打招呼助手_Demo_V0.4.html');

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
    value: '', textContent: '', innerText: '', innerHTML: '', className: '', title: '',
    hidden: false, disabled: false, dataset: {}, style: {},
    classList: makeClassList(),
    addEventListener() {}, focus() {}, remove() {}, select() {}, click() {},
    appendChild() {}, querySelector() { return createEl(); }, querySelectorAll() { return []; },
    closest() { return null; }
  };
}

/** 抽出页面脚本，在最小 DOM 桩里执行；setTimeout 收进队列，由 flush 手动推进 */
function loadDemo() {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match, 'Demo 页面中未找到 script 块');

  const els = new Map();
  const timers = [];
  const document = {
    getElementById(id) {
      if (!els.has(id)) els.set(id, createEl());
      return els.get(id);
    },
    querySelector() { return createEl(); },
    querySelectorAll() { return []; },
    createElement() { return createEl(); },
    execCommand() { return true; },
    body: { appendChild() {} }
  };
  const window = { setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {} };
  const localStorage = { getItem() { return null; }, setItem() {} };
  const navigator = { clipboard: { writeText: async () => {} } };

  const exported = eval(
    match[1]
    + '\n;({state, HISTORY_MAX, saveGreetingToHistory, renderHistory, removeHistory,'
    + ' clearHistory, refreshExportState, applyImportedResume, MOCK_FILE_RESUME})'
  );
  const flush = () => {
    let guard = 0;
    while (timers.length && guard++ < 20) timers.shift()();
  };
  return Object.assign({ els, flush, html }, exported);
}

const SAMPLE_JD = '公司：某电商科技有限公司\n岗位：Java 后端开发工程师（高级）';

/** 摆出一次生成完成后的状态，模拟「用户已经拿到 3 条话术」 */
function finishGeneration(demo, sessionId, texts) {
  demo.state.jd = SAMPLE_JD;
  demo.state.sessionId = sessionId;
  demo.state.edited = {};
  demo.state.lastResult = {
    matched: ['Java', 'Redis'],
    missing: ['Kubernetes'],
    lowMatch: false,
    messages: texts.map((text, index) => ({
      style: ['技能匹配型', '经历相关型', '简短直接型'][index],
      text
    }))
  };
}

const TEXTS = ['第一条话术正文内容', '第二条话术正文内容', '第三条话术正文内容'];

test('Demo V0.4 全程本地模拟，不引入真实请求', () => {
  const demo = loadDemo();
  const script = demo.html.match(/<script>([\s\S]*?)<\/script>/)[1];

  assert.ok(!/\bfetch\(/.test(script), '页面脚本不应发起 fetch 请求');
  assert.ok(!/XMLHttpRequest|sendBeacon|axios/.test(script), '页面脚本不应包含其它网络调用');
  assert.ok(demo.html.includes('全部为本地模拟'), '页面应标明全部为本地模拟');
});

test('侧边栏的「话术历史」已从规划占位转为正式入口', () => {
  const demo = loadDemo();

  const navLine = demo.html.split('\n').find((line) => line.includes('data-view="history"')) ?? '';
  assert.ok(navLine.includes('<button'), '话术历史应是可点击按钮');
  assert.ok(!navLine.includes('disabled'), '话术历史不应再是规划中占位');
  assert.ok(navLine.includes('historyBadge'), '导航项应带条数徽标');

  assert.ok(demo.html.includes('id="view-history"'), '应有话术历史视图容器');
  const planned = demo.html.split('side-group">后续规划')[1].split('</nav>')[0];
  assert.ok(!planned.includes('话术历史'), '后续规划分组不应再列话术历史');
  assert.ok(planned.includes('设置'), '后续规划分组应保留设置占位');
});

test('复制即入历史：一次生成一条，含三条候选、匹配分析与对应 JD', () => {
  const demo = loadDemo();
  finishGeneration(demo, 'g1', TEXTS);

  const record = demo.saveGreetingToHistory(0);

  assert.ok(record, '应写入一条记录');
  assert.strictEqual(demo.state.history.length, 1);
  assert.strictEqual(record.sessionId, 'g1');
  assert.strictEqual(record.jd, SAMPLE_JD);
  assert.strictEqual(record.items.length, 3);
  assert.deepStrictEqual(record.copied, [0]);
  assert.ok(record.title.includes('某电商科技有限公司'), '记录名应取自 JD 解析');
  assert.deepStrictEqual(record.matched, ['Java', 'Redis']);
});

test('同一次生成再次复制只合并标记与内容，不新增记录', () => {
  const demo = loadDemo();
  finishGeneration(demo, 'g1', TEXTS);
  demo.saveGreetingToHistory(0);

  // 用户先改了第二条再复制：历史里存的应是改后的文本
  demo.state.lastResult.messages[1].text = '编辑过的第二条';
  demo.state.edited[1] = true;
  demo.saveGreetingToHistory(1);

  assert.strictEqual(demo.state.history.length, 1);
  assert.deepStrictEqual(demo.state.history[0].copied, [0, 1]);
  assert.strictEqual(demo.state.history[0].items[1].text, '编辑过的第二条');
  assert.strictEqual(demo.state.history[0].items[1].edited, true);
});

test('重新生成后复制属于新的一次生成，记为新记录并插在最前', () => {
  const demo = loadDemo();
  finishGeneration(demo, 'g1', TEXTS);
  demo.saveGreetingToHistory(0);
  finishGeneration(demo, 'g2', ['新的第一条', '新的第二条', '新的第三条']);
  demo.saveGreetingToHistory(2);

  assert.strictEqual(demo.state.history.length, 2);
  assert.deepStrictEqual(demo.state.history.map((h) => h.sessionId), ['g2', 'g1']);
});

test('没有生成结果时不写空记录', () => {
  const demo = loadDemo();

  assert.strictEqual(demo.saveGreetingToHistory(0), null);
  assert.strictEqual(demo.state.history.length, 0);

  // 有结果但没有会话标识（异常路径）同样不写
  finishGeneration(demo, 'g1', TEXTS);
  demo.state.sessionId = '';
  assert.strictEqual(demo.saveGreetingToHistory(0), null);
  assert.strictEqual(demo.state.history.length, 0);
});

test('超过上限时移除最早的一条', () => {
  const demo = loadDemo();

  for (let i = 0; i < demo.HISTORY_MAX + 2; i += 1) {
    finishGeneration(demo, 'g' + i, TEXTS);
    demo.saveGreetingToHistory(0);
  }

  assert.strictEqual(demo.state.history.length, demo.HISTORY_MAX);
  assert.strictEqual(demo.state.history[0].sessionId, 'g' + (demo.HISTORY_MAX + 1));
});

test('删除单条与清空全部都会同步导航徽标', () => {
  const demo = loadDemo();
  finishGeneration(demo, 'g1', TEXTS);
  const first = demo.saveGreetingToHistory(0);
  finishGeneration(demo, 'g2', TEXTS);
  demo.saveGreetingToHistory(0);

  assert.strictEqual(demo.els.get('historyBadge').textContent, '2');
  assert.strictEqual(demo.removeHistory(first.id), true);
  assert.strictEqual(demo.state.history.length, 1);
  assert.strictEqual(demo.els.get('historyBadge').textContent, '1');

  assert.strictEqual(demo.clearHistory(), 1);
  assert.strictEqual(demo.state.history.length, 0);
  assert.strictEqual(demo.els.get('historyBadge').hidden, true, '空历史应隐藏徽标');
  assert.strictEqual(demo.els.get('historyEmpty').hidden, false, '应显示空态');
});

test('导出入口只在导入过 Word 时可用，其它来源给出引导', () => {
  const demo = loadDemo();

  demo.refreshExportState();
  assert.strictEqual(demo.els.get('exportDocx').disabled, true, '默认应置灰');
  assert.ok(
    demo.els.get('exportHint').textContent.includes('只有') ||
    demo.els.get('exportHint').textContent.includes('只在'),
    '置灰时应说明原因'
  );

  // 导入 Word：保留模板，导出可用
  demo.applyImportedResume('张三-简历.docx', demo.MOCK_FILE_RESUME);
  assert.strictEqual(demo.els.get('exportDocx').disabled, false, '导入 Word 后应可用');
  assert.ok(
    demo.els.get('resumeImportBar').innerHTML.includes('可导出同版式 Word'),
    '导入成功时应提示模板已保留'
  );

  // 换成 PDF 导入：模板随之失效
  demo.applyImportedResume('张三-简历.pdf', demo.MOCK_FILE_RESUME);
  assert.strictEqual(demo.els.get('exportDocx').disabled, true, '换成 PDF 后应重新置灰');
});

test('历史详情渲染三条话术并标出复制与编辑状态', () => {
  const demo = loadDemo();
  finishGeneration(demo, 'g1', TEXTS);
  demo.state.edited[2] = true;
  demo.saveGreetingToHistory(0);
  demo.saveGreetingToHistory(2);

  demo.renderHistory();
  const html = demo.els.get('historyItems').innerHTML;

  assert.ok(html.includes('第 0 条') === false, '不应把内部序号写进文案');
  TEXTS.forEach((text) => {
    assert.ok(html.includes(text), '详情应渲染话术：' + text);
  });
  assert.ok(html.includes('已复制'), '应标出复制过的话术');
  assert.ok(html.includes('已编辑'), '应标出编辑过的话术');
  assert.ok(demo.els.get('historyJd').textContent.includes('某电商科技有限公司'), '应展示对应 JD');
  assert.ok(
    demo.els.get('historyMeta').textContent.includes('复制过第 1、3 条'),
    '应列出复制过哪几条'
  );
});
