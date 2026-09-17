/**
 * 技术方案文档检查：选型、工程约束与 PRD 已确认结论必须一致
 * 运行方式：node --test tests/tech-design.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');
const TECH_PATH = path.join(ROOT, 'docs', '技术方案_V0.1.md');
const PRD_PATH = path.join(ROOT, '直聘打招呼助手_PRD_V0.2.md');

const tech = fs.readFileSync(TECH_PATH, 'utf8');
const prd = fs.readFileSync(PRD_PATH, 'utf8');

test('技术方案文档存在并标注版本与关联文档', () => {
  assert.ok(tech.includes('版本号：V0.1'), '技术方案应标注版本号');
  assert.ok(tech.includes('直聘打招呼助手_PRD_V0.2.md'), '技术方案应关联 PRD');
});

test('技术选型覆盖已确认方案', () => {
  ['Vite', 'React', 'TypeScript', 'Tailwind', 'Zustand', 'Zod', 'localStorage', 'Hono', 'pnpm', 'Playwright'].forEach((item) => {
    assert.ok(tech.includes(item), '技术方案应包含选型：' + item);
  });
});

test('仓库结构包含前后端与共享包', () => {
  ['apps/web', 'apps/api', 'packages/core', 'packages/llm', 'packages/shared'].forEach((dir) => {
    assert.ok(tech.includes(dir), '技术方案应描述目录：' + dir);
  });
});

test('服务端只暴露一个路由并负责密钥与限流', () => {
  assert.ok(tech.includes('POST /api/llm'), '应定义 /api/llm 路由');
  assert.ok(tech.includes('密钥不出服务端'), '应写明密钥边界');
  assert.ok(tech.includes('不落盘'), '应写明服务端不落盘');
  assert.ok(tech.includes('429'), '应定义限流错误码');
});

test('产品规则由本地确定性代码承担，不交给模型', () => {
  ['applySuggestions', 'composeCustomResume', '锚点', '锁定区块'].forEach((keyword) => {
    assert.ok(tech.includes(keyword), '技术方案应说明：' + keyword);
  });
});

test('技术方案与 PRD 的已确认结论一致', () => {
  ['首字 ≤5 秒', '完整结果 ≤30 秒', '每 IP 每分钟 10 次', '每日 100 次', '部署在境外', 'DeepSeek'].forEach((keyword) => {
    assert.ok(prd.includes(keyword), 'PRD 应包含已确认结论：' + keyword);
    assert.ok(tech.includes(keyword), '技术方案应保持同一结论：' + keyword);
  });
});
