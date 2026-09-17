/**
 * 文档一致性检查：PRD 描述的能力必须在 Demo 中有对应实现
 * 运行方式：node --test tests/prd.sync.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');
const PRD_PATH = path.join(ROOT, '直聘打招呼助手_PRD_V0.2.md');
const DEMO_PATH = path.join(ROOT, '直聘打招呼助手_Demo_V0.2.html');

const prd = fs.readFileSync(PRD_PATH, 'utf8');
const demo = fs.readFileSync(DEMO_PATH, 'utf8');

test('PRD 与 Demo 使用同一版本号', () => {
  assert.ok(prd.includes('版本号：V0.2'), 'PRD 应标注 V0.2');
  assert.ok(DEMO_PATH.endsWith('V0.2.html'), 'Demo 文件名应带 V0.2');
});

test('PRD 描述的四个页面在 Demo 中都有对应视图', () => {
  ['我的简历', '按 JD 改简历', '定制简历', '生成打招呼'].forEach((name) => {
    assert.ok(prd.includes(name), 'PRD 应描述页面：' + name);
  });
  ['view-resume', 'view-custom', 'view-archive', 'view-generate'].forEach((id) => {
    assert.ok(demo.includes('id="' + id + '"'), 'Demo 应存在页面容器：' + id);
  });
});

test('PRD 描述的能力在 Demo 中都有实现', () => {
  const pairs = [
    ['改写建议', 'function buildResumeSuggestions'],
    ['合成', 'function composeCustomResume'],
    ['记录名称', 'function extractJdTitle'],
    ['删除', 'function removeArchive'],
    ['简历区块', 'function parseResume']
  ];
  pairs.forEach(([keyword, impl]) => {
    assert.ok(prd.includes(keyword), 'PRD 应提到：' + keyword);
    assert.ok(demo.includes(impl), 'Demo 应实现：' + impl);
  });
});

test('PRD 的区块锁定规则与 Demo 实现一致', () => {
  ['项目经历', '工作经历', '实习经历', '自我评价', '专业技能'].forEach((title) => {
    assert.ok(demo.includes("'" + title + "'"), 'Demo 可改写清单应包含：' + title);
  });
  assert.ok(demo.includes('个人信息'), 'Demo 应体现个人信息锁定');
  assert.ok(demo.includes('教育经历'), 'Demo 应体现教育经历锁定');
});
