/**
 * 导出能力增补文档检查：PRD V0.4 增补只写增量、不重复 V0.3，
 * 保真口径、可用条件与异常兜底必须与技术方案 V0.4 增补一致。
 * 运行方式：node --test tests/prd.export.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');
const V04 = path.join(ROOT, '直聘打招呼助手_PRD_V0.4_增补.md');
const V03 = path.join(ROOT, '直聘打招呼助手_PRD_V0.3_增补.md');
const V02 = path.join(ROOT, '直聘打招呼助手_PRD_V0.2.md');

const doc = fs.readFileSync(V04, 'utf8');

const section = (start, end) => {
  const rest = doc.split(start)[1];
  return end ? rest.split(end)[0] : rest;
};

test('增补文档只写增量，V0.2 与 V0.3 保持原样', () => {
  assert.ok(doc.includes('版本号：V0.4（增补）'), '增补文档应标注版本');
  assert.ok(doc.includes('直聘打招呼助手_PRD_V0.3_增补.md'), '应关联 V0.3 增补');
  assert.ok(doc.includes('不重复 V0.2 与 V0.3 增补已有内容'), '应声明只写增量');

  ['## 一、背景与概述', '### 1.1 产品概述及目标', '## 二、产品方案', '### 2.6 功能清单'].forEach(
    (heading) => {
      assert.ok(!doc.includes(heading), '不应复制 V0.2 的完整章节：' + heading);
    }
  );
  ['## 二、简历文件导入（新增 3.6）', '## 三、JD 图片导入（新增 3.7）'].forEach((heading) => {
    assert.ok(!doc.includes(heading), '不应复制 V0.3 增补的章节：' + heading);
  });

  assert.ok(fs.readFileSync(V03, 'utf8').includes('版本号：V0.3（增补）'), 'V0.3 应保留');
  assert.ok(fs.readFileSync(V02, 'utf8').includes('版本号：V0.2'), 'V0.2 历史文档不应被改写');
});

test('范围调整写清了新增、不做清单与数据边界', () => {
  const scope = section('## 一、范围调整', '## 二、Word 保真导出');

  assert.ok(scope.includes('Word 保真导出'), '新增要做应包含 Word 保真导出');
  assert.ok(scope.includes('改写长度约束'), '新增要做应包含改写长度约束');

  [
    'PDF / TXT / 粘贴来源的保真导出',
    'PDF 先转 Word 再导出',
    '直接导出 PDF',
    '原始文件持久化'
  ].forEach((item) => {
    assert.ok(scope.includes(item), '不做清单应新增：' + item);
  });

  ['不上传、不写本地存储、不写行为记录', '断网状态下仍可导出', '逐字不变'].forEach((rule) => {
    assert.ok(scope.includes(rule), '新增约束应包含：' + rule);
  });
});

test('保真导出写清了保真口径、可用条件与异常兜底', () => {
  const exportSection = section('## 二、Word 保真导出', '## 三、改写长度约束');

  [
    '字体、字号、页边距、表格、图片、页眉页脚与样式全部保留',
    '导出结果必须与导入的原文件内容一致',
    '只改可改写区块',
    '单条跳过，不写入任何内容'
  ].forEach((rule) => {
    assert.ok(exportSection.includes(rule), '保真口径应包含：' + rule);
  });

  assert.ok(exportSection.includes('格式继承'), '应说明改写后的格式继承取舍');
  assert.ok(exportSection.includes('最近一次导入的是 .docx'), '应写明导出按钮的可用条件');
  assert.ok(exportSection.includes('不要求先采纳建议'), '应写明未采纳建议也可导出');
  assert.ok(exportSection.includes('原文件名_定制.docx'), '应写明导出文件命名');
  assert.ok(exportSection.includes('不触网'), '应写明导出不触网');

  [
    '未导入 Word',
    '刷新后原文件已失效',
    '建议在模板中定位不到',
    '模板结构无法识别',
    '导出过程出错'
  ].forEach((item) => {
    assert.ok(exportSection.includes(item), '导出异常应覆盖：' + item);
  });
});

test('长度约束写清了双口径、实测依据与处置方式', () => {
  const length = section('## 三、改写长度约束', '## 四、其他章节的改动');

  assert.ok(length.includes('最多留 20% 的余量'), '应写明提示词的目标口径');
  assert.ok(length.includes('本地自检按 40% 判定'), '应写明自检红线');
  assert.ok(length.includes('为什么两套口径'), '应解释双口径的理由');
  assert.ok(length.includes('只标注不丢弃'), '应写明超长不丢弃');
  assert.ok(length.includes('行变长会让 Word 重新折行'), '应说明为什么放在生成环节');
  assert.ok(length.includes('实测记录'), '应留下实测依据');
});

test('差异清单指明了落点，并登记 V0.5 功能项', () => {
  const diff = section('## 四、其他章节的改动', '## 五、待确认项');

  ['2.2 产品整体流程', '2.3.1 全局异常处理', '2.5 产品框架', '2.7 产品版本规划', '3.3 改写规则', '4.1 安全与合规', '4.2 统计需求'].forEach(
    (target) => {
      assert.ok(diff.includes(target), '差异清单应包含落点：' + target);
    }
  );

  [
    '| 按 JD 改简历 | Word 保真导出 | P0 | V0.5 |',
    '| 按 JD 改简历 | 改写长度约束 | P1 | V0.5 |',
    '| 通用 | 导出降级与引导 | P1 | V0.5 |'
  ].forEach((row) => {
    assert.ok(diff.includes(row), '功能清单应新增：' + row);
  });
  assert.ok(diff.includes('custom_export'), '应登记导出埋点事件');
  assert.ok(diff.includes('不新增任何接口、密钥与部署形态'), '应说明不新增服务端形态');
});

test('待确认项只提本次未定的事', () => {
  const pending = section('## 五、待确认项', '');

  ['改写长度上限口径', '导出文件的命名', '是否直接导出 PDF', '原文件是否跨会话保留'].forEach(
    (item) => {
      assert.ok(pending.includes(item), '待确认项应包含：' + item);
    }
  );
  assert.ok(!pending.includes('简历文件体积上限'), '不应重复 V0.3 增补已列的待确认项');
});
