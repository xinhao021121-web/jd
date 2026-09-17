/**
 * PRD 非功能需求检查：已敲定的技术形态与性能指标必须体现在文档中
 * 运行方式：node --test tests/prd.nfr.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const PRD_PATH = path.join(__dirname, '..', '直聘打招呼助手_PRD_V0.2.md');
const prd = fs.readFileSync(PRD_PATH, 'utf8');

const countOf = (text, keyword) => text.split(keyword).length - 1;
const section = (start, end) => {
  const rest = prd.split(start)[1];
  return end ? rest.split(end)[0] : rest;
};

test('性能指标采用流式口径：首字 ≤5 秒、完整结果 ≤30 秒', () => {
  const perf = section('### 4.3 性能需求', '### 4.4 系统集成');

  assert.strictEqual(countOf(perf, '≤ 5 秒'), 2, '话术与改写建议都应标注首字 ≤5 秒');
  assert.strictEqual(countOf(perf, '≤ 30 秒'), 2, '话术与改写建议都应标注完整结果 ≤30 秒');
  assert.ok(!perf.includes('≤ 15 秒'), '不应保留旧的 15 秒口径');
  assert.ok(!perf.includes('≤ 20 秒'), '不应保留旧的 20 秒口径');
  assert.ok(perf.includes('流式'), '4.3 应说明输出方式为流式');
});

test('生成方式为单次调用 + 流式返回', () => {
  assert.ok(prd.includes('单次调用'), 'PRD 应说明生成由单次调用完成');
  assert.ok(prd.includes('流式'), 'PRD 应说明结果流式返回');
  assert.ok(prd.includes('首字到达即开始渲染'), 'PRD 应说明首字到达即渲染');
});

test('4.1 覆盖服务端代理下的隐私与密钥边界', () => {
  const security = section('### 4.1 安全与合规', '### 4.2 统计需求');

  ['不落盘', '数据流向提示', '不弹窗', '不要求确认', '服务端环境变量', '限流', '每日配额', '成本'].forEach((keyword) => {
    assert.ok(security.includes(keyword), '4.1 应包含：' + keyword);
  });
  assert.ok(!security.includes('API Key 保存在本地'), '密钥不应再由前端本地保存');
  assert.ok(!security.includes('并需使用者确认'), '数据流向不应改为强制确认弹窗');
});

test('部署地域与模型选型已确认为境外部署 + DeepSeek', () => {
  assert.ok(prd.includes('部署在境外'), 'PRD 应说明部署在境外');
  assert.ok(prd.includes('DeepSeek'), 'PRD 应写明使用 DeepSeek');
  assert.ok(prd.includes('无需域名备案'), 'PRD 应说明无需备案');
});

test('5.1 中已敲定的决策标记为已确认', () => {
  const pending = section('### 5.1 待确认项清单', '### 5.2 验收标准');

  [
    '静态单页应用 + 轻量服务端代理',
    'DeepSeek（OpenAI 兼容接口，流式返回）',
    '单次调用完成，流式返回，不拆分多次请求',
    '部署在境外，无需备案',
    '每 IP 每分钟 10 次、每日 100 次'
  ].forEach((item) => {
    assert.ok(pending.includes(item), '5.1 应记录已确认项：' + item);
  });
});

test('验收标准覆盖流式呈现与接口防护', () => {
  const acceptance = section('### 5.2 验收标准', '');

  assert.ok(acceptance.includes('流式呈现'), '验收标准应包含流式呈现');
  assert.ok(acceptance.includes('接口防护'), '验收标准应包含接口防护');
  assert.ok(acceptance.includes('不消耗模型调用'), '限流验收应说明不消耗模型调用');
});
