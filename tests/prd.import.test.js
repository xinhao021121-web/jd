/**
 * 导入能力增补文档检查：PRD V0.3 增补只写增量、不重复 V0.2，
 * 且两条导入通道的边界、规则与兜底必须自洽。
 * 运行方式：node --test tests/prd.import.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');
const V03 = path.join(ROOT, '直聘打招呼助手_PRD_V0.3_增补.md');
const V02 = path.join(ROOT, '直聘打招呼助手_PRD_V0.2.md');

const doc = fs.readFileSync(V03, 'utf8');

const section = (start, end) => {
  const rest = doc.split(start)[1];
  return end ? rest.split(end)[0] : rest;
};

test('增补文档只写增量，V0.2 保持原样', () => {
  assert.ok(doc.includes('版本号：V0.3（增补）'), '增补文档应标注版本');
  assert.ok(doc.includes('直聘打招呼助手_PRD_V0.2.md'), '增补文档应关联 V0.2');
  assert.ok(doc.includes('不重复 V0.2 已有内容'), '增补文档应声明只写增量');

  ['## 一、背景与概述', '### 1.1 产品概述及目标', '## 二、产品方案', '### 2.6 功能清单'].forEach(
    (heading) => {
      assert.ok(!doc.includes(heading), '增补文档不应复制 V0.2 的完整章节：' + heading);
    }
  );

  assert.ok(fs.existsSync(V02), 'V0.2 应保留');
  assert.ok(
    fs.readFileSync(V02, 'utf8').includes('版本号：V0.2'),
    'V0.2 历史文档不应被改写'
  );
});

test('范围调整收窄了不做清单，并保留既有硬边界', () => {
  const scope = section('## 一、范围调整', '## 二、简历文件导入');

  const removed =
    scope.split('\n').find((line) => line.includes('简历文件（PDF / Word / 图片）解析')) ?? '';
  assert.ok(removed.startsWith('| 移除 |'), '应把整体排除文件解析标记为移除，而非继续不做');
  ['扫描件 / 图片型 PDF 的简历解析', '简历图片（截图、拍照）导入', '旧版 .doc、加密或带密码的文件'].forEach(
    (item) => {
      assert.ok(scope.includes(item), '不做清单应新增：' + item);
    }
  );
  assert.ok(scope.includes('自动覆盖原始简历'), '应声明既有不做项保持不变');
  assert.ok(scope.includes('导入不得静默覆盖'), '约束应写明导入不静默覆盖');
  assert.ok(scope.includes('粘贴文本的路径必须始终可用'), '约束应写明粘贴为兜底路径');
});

test('简历文件导入写清了本地解析、草稿落点与覆盖确认', () => {
  const resumeImport = section('## 二、简历文件导入', '## 三、JD 图片导入');

  ['浏览器本地，不触网、不消耗模型额度', '只写入简历草稿', '草稿非空时先二次确认'].forEach((rule) => {
    assert.ok(resumeImport.includes(rule), '简历导入规则应包含：' + rule);
  });
  assert.ok(resumeImport.includes('区块识别预览'), '应包含区块识别预览');
  assert.ok(resumeImport.includes('不写入本地存储与行为记录'), '应说明文件名不持久化');
  assert.ok(resumeImport.includes('单文件 ≤ 10MB'), '应写明体积上限');

  ['格式不支持', '超过 10MB', 'PDF 无文本层', '解析结果少于 20 字', '无可改写区块'].forEach((item) => {
    assert.ok(resumeImport.includes(item), '简历导入异常应覆盖：' + item);
  });
});

test('JD 图片导入写清了识别范围、追加落点与校对态', () => {
  const jdImport = section('## 三、JD 图片导入', '## 四、其他章节的改动');

  [
    '只做图片转文本',
    '不覆盖既有内容',
    '识别校对态',
    '不阻断生成',
    '识别单独计数与限流',
    '不落盘、不写日志、不进缓存'
  ].forEach((rule) => {
    assert.ok(jdImport.includes(rule), 'JD 图片导入规则应包含：' + rule);
  });
  assert.ok(jdImport.includes('长边 1600px'), '应写明压缩口径');
  assert.ok(jdImport.includes('单张 ≤ 5MB'), '应写明体积上限');

  ['识别失败', '服务不可用或超时', '识别结果为空', '超出每日识别次数', '用户中途取消'].forEach(
    (item) => {
      assert.ok(jdImport.includes(item), 'JD 图片异常应覆盖：' + item);
    }
  );
});

test('差异清单指明了落点，并登记 V0.4 功能项', () => {
  const diff = section('## 四、其他章节的改动', '## 五、待确认项');

  ['2.2 产品整体流程', '2.3.1 全局异常处理', '2.5 产品框架', '2.7 产品版本规划', '4.1 安全与合规', '4.2 统计需求'].forEach(
    (target) => {
      assert.ok(diff.includes(target), '差异清单应包含落点：' + target);
    }
  );

  [
    '| 我的简历 | 简历文件导入 | P0 | V0.4 |',
    '| 我的简历 | 导入后区块识别预览 | P0 | V0.4 |',
    '| 生成打招呼 | JD 图片导入 | P0 | V0.4 |',
    '| 按 JD 改简历 | JD 图片导入 | P0 | V0.4 |'
  ].forEach((row) => {
    assert.ok(diff.includes(row), '功能清单应新增：' + row);
  });
  assert.ok(diff.includes('resume_import') && diff.includes('jd_image_import'), '应登记导入埋点事件');
});

test('待确认项只提单通道未定的事，不重复 V0.2 已确认结论', () => {
  const pending = section('## 五、待确认项', '');

  ['图片识别模型选型', '图片识别每日额度', '单张图片体积上限', '简历文件体积上限', '导入效率目标'].forEach(
    (item) => {
      assert.ok(pending.includes(item), '待确认项应包含：' + item);
    }
  );
  assert.ok(!pending.includes('DeepSeek（OpenAI 兼容接口'), '不应重复 V0.2 已确认的模型选型');
});
