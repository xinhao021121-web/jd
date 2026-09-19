/**
 * 导入功能的产品口径检查：PRD V0.3 定义的简历文件导入与 JD 图片导入，
 * 必须在边界、错误文案、性能与验收标准上自洽，且不推翻 V0.2 的硬边界。
 * 运行方式：node --test tests/prd.import.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');
const V03 = path.join(ROOT, '直聘打招呼助手_PRD_V0.3.md');
const V02 = path.join(ROOT, '直聘打招呼助手_PRD_V0.2.md');

const prd = fs.readFileSync(V03, 'utf8');

const section = (start, end) => {
  const rest = prd.split(start)[1];
  return end ? rest.split(end)[0] : rest;
};

test('V0.3 标注版本并说明与 V0.2 的增量关系', () => {
  assert.ok(prd.includes('版本号：V0.3'), 'PRD 应标注 V0.3');
  assert.ok(prd.includes('| V0.3 |'), '版本记录应包含 V0.3 行');
  assert.ok(prd.includes('直聘打招呼助手_PRD_V0.2.md'), 'V0.3 应说明 V0.2 保留用于对照');
  assert.ok(fs.existsSync(V02), 'V0.2 应保留为历史版本');
  assert.ok(
    fs.readFileSync(V02, 'utf8').includes('版本号：V0.2'),
    'V0.2 历史文档不应被改写'
  );
});

test('2.1 收窄了不做清单，并明确本期支持范围', () => {
  const scope = section('### 2.1 产品需求描述', '### 2.2 产品整体流程');

  assert.ok(
    !scope.includes('| 简历文件（PDF / Word / 图片）解析 |'),
    '不应再整体排除文件解析'
  );
  ['扫描件 / 图片型 PDF 的简历解析', '简历图片（截图、拍照）导入', '旧版 .doc、加密或带密码的文件'].forEach(
    (item) => {
      assert.ok(scope.includes(item), '不做清单应保留：' + item);
    }
  );
  assert.ok(scope.includes('本地解析'), '本期要做应说明简历文件为本地解析');
  assert.ok(scope.includes('视觉模型'), '本期要做应说明 JD 图片走视觉模型识别');
});

test('2.1 的硬边界不被导入功能放宽', () => {
  const scope = section('### 2.1 产品需求描述', '### 2.2 产品整体流程');

  ['自动覆盖或改写原始简历', '向简历中新增不存在的经历、技能或数字'].forEach((rule) => {
    assert.ok(scope.includes(rule), '不做清单应保留既有硬边界：' + rule);
  });
  assert.ok(scope.includes('导入不得静默覆盖'), '约束条件应写明导入不静默覆盖');
  assert.ok(scope.includes('粘贴文本的路径必须始终可用'), '约束条件应写明粘贴文本为兜底路径');
});

test('2.2 为两条导入通道补充了子流程', () => {
  assert.ok(prd.includes('#### 2.2.5 简历文件导入子流程'), '应新增简历导入子流程');
  assert.ok(prd.includes('#### 2.2.6 JD 图片导入子流程'), '应新增 JD 图片导入子流程');

  const resumeFlow = section('#### 2.2.5 简历文件导入子流程', '#### 2.2.6 JD 图片导入子流程');
  const jdFlow = section('#### 2.2.6 JD 图片导入子流程', '### 2.3 全局说明');

  ['浏览器本地解析 不上传', '二次确认是否覆盖草稿', '展示区块识别预览'].forEach((step) => {
    assert.ok(resumeFlow.includes(step), '简历导入流程应包含：' + step);
  });
  ['前端压缩', '服务端转发视觉模型', '识别校对态'].forEach((step) => {
    assert.ok(jdFlow.includes(step), 'JD 图片流程应包含：' + step);
  });
});

test('2.3.1 覆盖导入失败的全部出口，且每个出口都有替代路径', () => {
  const errors = section('#### 2.3.1 全局异常处理', '#### 2.3.2 全局交互');

  [
    '暂不支持该文件格式',
    '文件超过 10MB',
    '没有可提取的文字',
    '没有从文件里读到内容',
    '草稿里已有内容',
    '没有识别到可改写的小标题',
    '图片识别失败',
    '图片超过 5MB',
    '图片识别暂不可用',
    '今日图片识别次数已达上限'
  ].forEach((message) => {
    assert.ok(errors.includes(message), '全局异常表应包含导入文案：' + message);
  });
  assert.ok(errors.includes('保留草稿原内容'), '解析类失败应说明不影响草稿');
  assert.ok(errors.includes('粘贴 JD 文本'), '识别类失败应给出粘贴兜底');
});

test('2.6 功能清单登记了 V0.4 的导入能力', () => {
  const list = section('### 2.6 功能清单', '### 2.7 产品版本规划');

  [
    ['| 我的简历 | 简历文件导入 | P0 | V0.4 |', '简历文件导入'],
    ['| 我的简历 | 导入后区块识别预览 | P0 | V0.4 |', '区块识别预览'],
    ['| 生成打招呼 | JD 图片导入 | P0 | V0.4 |', 'JD 图片导入（生成页）'],
    ['| 按 JD 改简历 | JD 图片导入 | P0 | V0.4 |', 'JD 图片导入（改简历页）'],
    ['| 通用 | 导入错误码与降级提示 | P1 | V0.4 |', '导入错误码']
  ].forEach(([row, name]) => {
    assert.ok(list.includes(row), '功能清单应登记：' + name);
  });
  assert.ok(
    list.includes('浏览器本地解析，不消耗模型额度'),
    '简历导入应写明不消耗模型额度'
  );
});

test('2.7 版本规划把导入放进 V0.4，扫描件顺延到 V0.5', () => {
  const plan = section('### 2.7 产品版本规划', '## 三、功能性需求');
  const v04 = plan.split('\n').find((line) => line.startsWith('| V0.4 ')) ?? '';
  const v05 = plan.split('\n').find((line) => line.startsWith('| V0.5 ')) ?? '';

  ['简历文件导入', 'JD 图片导入', '区块识别预览'].forEach((item) => {
    assert.ok(v04.includes(item), 'V0.4 范围应包含：' + item);
  });
  assert.ok(v05.includes('扫描件与图片型简历导入'), 'V0.5 应承接扫描件与图片简历');
});

test('3.6 / 3.7 两节具备可评审的完整结构', () => {
  const resumeImport = section('### 3.6 简历文件导入', '### 3.7 JD 图片导入');
  const jdImport = section('### 3.7 JD 图片导入', '## 四、非功能需求');

  ['**描述**', '**用户故事**', '**支持范围**', '**界面及交互**', '**关键规则**', '**异常/分支流程**', '**数据字典**'].forEach(
    (part) => {
      assert.ok(resumeImport.includes(part), '3.6 应包含：' + part);
      assert.ok(jdImport.includes(part), '3.7 应包含：' + part);
    }
  );
  ['TXT / Markdown', 'Word（.docx）', 'PDF（含文本层）'].forEach((format) => {
    assert.ok(resumeImport.includes(format), '3.6 支持范围应包含：' + format);
  });
  ['PNG / JPG / JPEG / WebP', '长边 1600px', '单张 ≤ 5MB'].forEach((rule) => {
    assert.ok(jdImport.includes(rule), '3.7 支持范围应包含：' + rule);
  });
  assert.ok(resumeImport.includes('| result | 枚举 | 是 |'), '3.6 数据字典应包含结果枚举');
  assert.ok(jdImport.includes('| result | 枚举 | 是 |'), '3.7 数据字典应包含结果枚举');
});

test('两条导入通道的关键规则写入正文，而不只停留在流程图', () => {
  const resumeImport = section('### 3.6 简历文件导入', '### 3.7 JD 图片导入');
  const jdImport = section('### 3.7 JD 图片导入', '## 四、非功能需求');

  ['文件只在浏览器内解析', '只写入简历草稿', '不记文件名'].forEach((rule) => {
    assert.ok(resumeImport.includes(rule), '3.6 关键规则应包含：' + rule);
  });
  ['只做图片转文本', '不做强制拦截', '追加不覆盖', '单独计数'].forEach((rule) => {
    assert.ok(jdImport.includes(rule), '3.7 关键规则应包含：' + rule);
  });
});

test('4.1 与 4.2 划清导入的数据边界与埋点口径', () => {
  const security = section('### 4.1 安全与合规', '### 4.2 统计需求');
  const telemetry = section('### 4.2 统计需求（埋点）', '### 4.3 性能需求');

  ['不产生任何网络请求', '图片不落盘、不写日志、不进入缓存与数据库', '文件名可能包含真实姓名'].forEach(
    (rule) => {
      assert.ok(security.includes(rule), '4.1 应包含：' + rule);
    }
  );
  ['resume_import', 'jd_image_import'].forEach((event) => {
    assert.ok(telemetry.includes(event), '4.2 应登记事件：' + event);
  });
  assert.ok(
    telemetry.includes('不记录文件内容、文件名、图片内容与识别出的文本'),
    '埋点口径应明确不记录正文与文件名'
  );
});

test('4.3 / 4.4 给出导入的性能目标与依赖降级', () => {
  const perf = section('### 4.3 性能需求', '### 4.4 系统集成');
  const integration = section('### 4.4 系统集成', '## 五、附录');

  ['简历文件解析耗时', 'JD 图片识别耗时', '图片压缩耗时'].forEach((metric) => {
    assert.ok(perf.includes(metric), '4.3 应包含指标：' + metric);
  });
  assert.ok(integration.includes('视觉模型 API'), '4.4 应登记视觉模型对接');
  assert.ok(
    integration.includes('文本生成链路完全不受影响'),
    '4.4 应写明识别不可用时的降级'
  );
});

test('5.1 与 5.2 收口待确认项与验收标准', () => {
  const pending = section('### 5.1 待确认项清单', '### 5.2 验收标准');
  const acceptance = section('### 5.2 验收标准', '');

  assert.ok(pending.includes('V0.4 支持简历文件导入'), '待确认项应记录导入范围已确认');
  assert.ok(pending.includes('图片识别模型选型'), '待确认项应留下模型选型问题');
  assert.ok(pending.includes('图片识别每日额度'), '待确认项应留下识别额度问题');

  ['导入不出本机', '导入不覆盖', '扫描件兜底', '识别校对提示', '识别额度独立'].forEach((item) => {
    assert.ok(acceptance.includes(item), '验收标准应包含：' + item);
  });
  assert.ok(acceptance.includes('导入效率'), '用户验收应包含导入效率');
});
