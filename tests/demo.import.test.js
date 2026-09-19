/**
 * Demo V0.3 导入流程冒烟测试：解析与识别均为本地模拟，不发网络请求。
 * 运行方式：node --test tests/demo.import.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const HTML_PATH = path.join(__dirname, '..', '直聘打招呼助手_Demo_V0.3.html');

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
    value: '', textContent: '', innerText: '', innerHTML: '', className: '',
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
    match[1] + '\n;({state, resumeEditor, jdEl, jd2El, parseResume, syncJd, MOCK_FILE_RESUME, simulateResumeImport, applyImportedResume, renderBlockPreview, simulateJdImageImport, applyJdImageImport, undoJdImport, runModalConfirm})'
  );
  const flush = () => {
    let guard = 0;
    while (timers.length && guard++ < 20) timers.shift()();
  };
  return Object.assign({ els, flush, html }, exported);
}

const barOf = (demo, id) => demo.els.get(id);

test('Demo 全程本地模拟，不引入真实请求', () => {
  const demo = loadDemo();
  const script = demo.html.match(/<script>([\s\S]*?)<\/script>/)[1];

  assert.ok(!/\bfetch\(/.test(script), '页面脚本不应发起 fetch 请求');
  assert.ok(!/XMLHttpRequest|sendBeacon|axios/.test(script), '页面脚本不应包含其它网络调用');
  assert.ok(demo.html.includes('本地模拟'), '页面应标明解析与识别为本地模拟');
});

test('简历导入只写草稿，不会自动保存', () => {
  const demo = loadDemo();
  demo.applyImportedResume('张三-Java后端-简历.pdf', demo.MOCK_FILE_RESUME);

  assert.strictEqual(demo.resumeEditor.value, demo.MOCK_FILE_RESUME, '解析结果应填入草稿');
  assert.strictEqual(demo.state.resume, '', '导入不应改写已保存的简历');
  assert.strictEqual(barOf(demo, 'blockPreview').hidden, false, '应展示区块识别预览');
  assert.ok(barOf(demo, 'resumeImportBar').innerHTML.includes('请检查后保存'));
});

test('区块识别预览点出可改写与锁定区块，无小标题时给出引导', () => {
  const demo = loadDemo();

  const normal = demo.renderBlockPreview(demo.MOCK_FILE_RESUME);
  assert.strictEqual(normal.editable, 3, '应识别出工作经历、项目经历、专业技能');
  assert.strictEqual(normal.locked, 2, '简历开头与教育背景应锁定');

  const flat = demo.renderBlockPreview('张某某  Java 后端  3 年经验\n负责订单系统开发，熟悉 Redis 与 Kafka。');
  assert.strictEqual(flat.editable, 0, '没有小标题时不应识别出可改写区块');
  assert.ok(
    barOf(demo, 'blockPreview').innerHTML.includes('没有识别到可改写的小标题'),
    '应提示补充小标题'
  );
});

test('格式不支持时直接拒绝，草稿保持原样', () => {
  const demo = loadDemo();
  demo.resumeEditor.value = '';
  demo.simulateResumeImport('张三-简历.doc');

  const bar = barOf(demo, 'resumeImportBar');
  assert.ok(bar.className.includes('warn'), '应以警示样式提示');
  assert.ok(bar.innerHTML.includes('暂不支持该文件格式'));
  assert.strictEqual(demo.resumeEditor.value, '', '草稿不应被写入');
});

test('扫描件 PDF 走兜底提示，不写入草稿', () => {
  const demo = loadDemo();
  demo.simulateResumeImport('张三-简历-扫描件.pdf');
  demo.flush();

  assert.ok(barOf(demo, 'resumeImportBar').innerHTML.includes('没有可提取的文字'));
  assert.strictEqual(demo.resumeEditor.value, '');
});

test('草稿非空时先二次确认，确认后才覆盖', () => {
  const demo = loadDemo();
  demo.resumeEditor.value = '原有的草稿内容';
  demo.simulateResumeImport('张三-简历.docx');
  demo.flush();

  assert.strictEqual(barOf(demo, 'modal').hidden, false, '应弹出覆盖确认');
  assert.ok(barOf(demo, 'modalTitle').textContent.includes('覆盖'));
  assert.strictEqual(demo.resumeEditor.value, '原有的草稿内容', '未确认前不应覆盖草稿');

  demo.runModalConfirm();
  assert.strictEqual(barOf(demo, 'modal').hidden, true, '确认后应关闭弹窗');
  assert.strictEqual(demo.resumeEditor.value, demo.MOCK_FILE_RESUME, '确认后才写入草稿');
  assert.strictEqual(demo.state.resume, '', '确认导入仍不等于保存简历');
});

test('JD 图片识别追加不覆盖，撤销可回退', () => {
  const demo = loadDemo();
  demo.jdEl.value = '原有的 JD 内容';
  demo.applyJdImageImport(demo.jdEl, 'jdImportBar', '识别出的 JD 文本');

  assert.ok(demo.jdEl.value.startsWith('原有的 JD 内容'), '应保留已有 JD');
  assert.ok(demo.jdEl.value.includes('识别出的 JD 文本'), '应追加识别结果');
  assert.strictEqual(demo.jd2El.value, demo.jdEl.value, '两页 JD 应同步');
  assert.strictEqual(demo.state.jd, demo.jdEl.value);
  assert.ok(barOf(demo, 'jdImportBar').innerHTML.includes('请核对公司名称'));

  demo.undoJdImport('jdImportBar');
  assert.strictEqual(demo.jdEl.value, '原有的 JD 内容', '撤销应回到导入前的内容');
  assert.strictEqual(demo.state.jd, '原有的 JD 内容');
  assert.strictEqual(barOf(demo, 'jdImportBar').hidden, true, '撤销后应收起提示');
});

test('JD 为空时识别结果直接填入', () => {
  const demo = loadDemo();
  demo.applyJdImageImport(demo.jdEl, 'jdImportBar', '识别出的 JD 文本');
  assert.strictEqual(demo.jdEl.value, '识别出的 JD 文本');
});

test('识别失败只提示，不动用户已输入的 JD', () => {
  const demo = loadDemo();
  demo.jdEl.value = '原有的 JD 内容';
  demo.simulateJdImageImport(demo.jdEl, 'jdImportBar', '识别失败.png');
  demo.flush();

  assert.ok(barOf(demo, 'jdImportBar').innerHTML.includes('图片识别失败'));
  assert.strictEqual(demo.jdEl.value, '原有的 JD 内容');
});

test('两个页面都提供导入入口，导入元素齐备', () => {
  const demo = loadDemo();
  ['id="importResume"', 'id="resumeFile"', 'id="blockPreview"', 'id="importJdImage"', 'id="importJdImage2"', 'id="jdImportBar"', 'id="jdImportBar2"', 'id="modal"'].forEach((marker) => {
    assert.ok(demo.html.includes(marker), '页面应包含：' + marker);
  });
});
