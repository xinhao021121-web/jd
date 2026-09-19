/**
 * 技术方案增补一致性检查：导入能力的选型、模块落点、接口契约与 DeepSeek
 * 视觉约束必须自洽，且不推翻 V0.1 的既有结论。
 * 运行方式：node --test tests/tech.import.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');
const V02 = path.join(ROOT, 'docs', '技术方案_V0.2_增补.md');
const V01 = path.join(ROOT, 'docs', '技术方案_V0.1.md');
const PRD = path.join(ROOT, '直聘打招呼助手_PRD_V0.3_增补.md');

const tech = fs.readFileSync(V02, 'utf8');

const section = (start, end) => {
  const rest = tech.split(start)[1];
  return end ? rest.split(end)[0] : rest;
};

test('增补文档只写增量，关联 V0.1 与 PRD 增补，V0.1 保持原样', () => {
  assert.ok(tech.includes('版本号：V0.2（增补）'), '应标注版本');
  assert.ok(tech.includes('技术方案_V0.1.md'), '应关联技术方案 V0.1');
  assert.ok(tech.includes('直聘打招呼助手_PRD_V0.3_增补.md'), '应关联 PRD 增补');
  assert.ok(tech.includes('不重复 V0.1 已有内容'), '应声明只写增量');

  ['## 一、方案目标', '## 二、技术选型', '## 三、仓库结构', '## 四、总体架构', '## 五、核心模块设计'].forEach(
    (heading) => {
      assert.ok(!tech.includes(heading), '不应复制 V0.1 的完整章节：' + heading);
    }
  );
  assert.ok(
    fs.readFileSync(V01, 'utf8').includes('版本号：V0.1'),
    'V0.1 历史文档不应被改写'
  );
});

test('选型新增落到浏览器内置能力，不新增服务端依赖与密钥', () => {
  const picking = section('## 一、选型新增', '## 二、模块与落点');

  ['pdfjs-dist', 'fflate', 'DOMParser', 'createImageBitmap', 'TextDecoder'].forEach((item) => {
    assert.ok(picking.includes(item), '选型应包含：' + item);
  });
  assert.ok(picking.includes('不新增服务端依赖、不新增 API Key、不新增部署形态'), '应写明不新增服务端形态');
  const mammoth = picking.split('\n').find((line) => line.includes('mammoth')) ?? '';
  assert.ok(
    mammoth.includes('体积大'),
    'mammoth 只应作为被否决的备选出现，不能成为选型结论'
  );
});

test('模块落点区分纯逻辑与浏览器适配层', () => {
  const modules = section('## 二、模块与落点', '## 三、接口契约');

  ['sniffFileType(bytes)', 'decodeTextFile(bytes)', 'rebuildPdfText(items, opts)', 'assembleDocxParagraphs(paragraphs)', 'sanitizeOcrText(text)'].forEach(
    (fn) => {
      assert.ok(modules.includes(fn), 'core 应新增：' + fn);
    }
  );
  assert.ok(modules.includes('packages/core'), '应说明纯逻辑下沉 core');
  assert.ok(modules.includes('utils/import/'), '应说明浏览器适配层位置');
  assert.ok(modules.includes('DEEPSEEK_VISION_MODEL'), '应新增视觉模型环境变量');
  assert.ok(modules.includes('不进 localStorage'), '导入瞬时状态不应持久化');
});

test('接口契约给出单张、非流式、超时与错误码', () => {
  const api = section('## 三、接口契约', '## 四、DeepSeek 视觉调用');

  assert.ok(api.includes('POST /api/vision'), '应定义 /api/vision 路由');
  assert.ok(api.includes('非流式'), '应说明非流式返回');
  assert.ok(api.includes('前端逐张调用'), '应说明逐张调用便于单张重试');
  assert.ok(api.includes('15 秒上限'), '应给出服务端超时');

  ['UNSUPPORTED_FILE', 'FILE_TOO_LARGE', 'NO_TEXT_LAYER', 'PARSE_EMPTY', 'VISION_FAILED', 'VISION_EMPTY'].forEach(
    (code) => {
      assert.ok(api.includes(code), '应定义错误码：' + code);
    }
  );
  assert.ok(api.includes('不记图片内容与识别文本'), '日志口径应说明不记内容');
});

test('DeepSeek 视觉约束与官方一致，并据此推翻旧配额', () => {
  const vision = section('## 四、DeepSeek 视觉调用', '## 五、前端解析要点');

  [
    'deepseek-flash',
    '`deepseek-v4-pro` 不支持',
    '同一把 `DEEPSEEK_API_KEY`',
    '只能放在 user 消息',
    '按文件实际内容嗅探',
    '48 MiB',
    '32 MiB',
    '8192 px',
    '每张上限 1024 tokens',
    '必须用默认的 original'
  ].forEach((fact) => {
    assert.ok(vision.includes(fact), '视觉约束应包含：' + fact);
  });
  assert.ok(vision.includes('取消 PRD 增补里的「图片识别单独计数'), '应写明取消单独配额');
});

test('PRD 增补已同步取消图片的单独计数', () => {
  const prd = fs.readFileSync(PRD, 'utf8');

  assert.ok(prd.includes('沿用现有 IP 限流与每日配额，不单独计数'), 'PRD 应改为沿用现有配额');
  assert.ok(!prd.includes('每 IP 每日 20 次，单独计数'), 'PRD 不应保留旧的独立额度');
  assert.ok(!prd.includes('超出每日识别次数'), 'PRD 不应保留按日单独计数的异常分支');
});

test('前端解析要点覆盖乱码、双栏与懒加载', () => {
  const web = section('## 五、前端解析要点', '## 六、测试策略');

  ['pdf.worker.mjs', 'U+FFFD', '页宽 15%', 'word/document.xml', '动态 `import()`'].forEach((point) => {
    assert.ok(web.includes(point), '解析要点应包含：' + point);
  });
  assert.ok(web.includes('image/jpeg'), '应统一压缩输出 JPEG');
});

test('测试策略与变更分级落到可执行的门槛', () => {
  const testing = section('## 六、测试策略', '## 七、变更分级与风险');
  const risk = section('## 七、变更分级与风险', '## 八、落地顺序');

  assert.ok(testing.includes('tests/samples/import/'), '应新增样本目录');
  assert.ok(testing.includes('setInputFiles'), '端到端应覆盖文件导入');
  assert.ok(testing.includes('100%'), 'core 覆盖率要求不变');
  assert.ok(testing.includes('首屏产物中不含 pdf.js'), '应有体积回归断言');
  assert.ok(risk.includes('B 类'), '应给出变更分级');
  assert.ok(risk.includes('deepseek-chat'), '应留下模型名待验证项');
});
