# 直聘打招呼助手

面向求职者的轻量工具：维护一份长期简历，针对具体岗位 JD 生成可直接发送的打招呼话术，以及逐条可采纳的简历改写建议。

产品口径见 [直聘打招呼助手_PRD_V0.2.md](直聘打招呼助手_PRD_V0.2.md)，实现口径见 [docs/技术方案_V0.1.md](docs/技术方案_V0.1.md)。V0.2 的交互原型保留在 `直聘打招呼助手_Demo_V0.2.html`，仅用于对照，不是运行入口。

## 仓库结构

```
apps/web          Vite + React + Tailwind 单页应用（四个视图 + 可收起侧边栏）
apps/api          单路由 Node 服务（POST /api/llm，含限流、超时与脱敏日志）
apps/api/src/mock-model.ts  仅本地联调/端到端用的 OpenAI 兼容 mock 模型
packages/core     纯逻辑：区块切分、锁定判定、建议绑定与锚点替换、合成、命名解析、指标
packages/llm      DeepSeek（OpenAI 兼容）客户端、提示词、NDJSON 输出协议
packages/shared   前后端共用的类型、错误码与文案常量
tests             Vitest 单测与集成测试、node:test 文档一致性测试、Playwright 端到端
```

## 本地开发

```bash
pnpm install

# 终端 1：本地 mock 模型（没有 DeepSeek Key 时用它联调）
pnpm mock:model

# 终端 2：服务端，指向 mock
# PowerShell: $env:DEEPSEEK_API_KEY="sk-local"; $env:DEEPSEEK_BASE_URL="http://127.0.0.1:8788/v1"
pnpm dev:api

# 终端 3：前端（/api 已代理到 127.0.0.1:8787）
pnpm dev:web
```

接入真实模型时，把 `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL` 配好即可，前端与代码都不需要改（可参考 `.env.example`）。

## 测试

```bash
pnpm test         # Vitest：core 纯逻辑、模型协议、服务端集成、前端 store
pnpm test:docs    # node:test：PRD / 原型 / 技术方案一致性
pnpm test:all     # 上面两项
pnpm test:e2e     # Playwright：构建前端 + 启动 mock 模型与真实服务端，跑主流程
pnpm typecheck    # tsc --noEmit
```

首次跑端到端需要安装浏览器：`pnpm exec playwright install chromium`。

## 质量回归（需要真实模型）

`tests/samples/quality-samples.json` 里是 8 组简历 + JD 样本。配好真实密钥后运行：

```bash
# PowerShell
$env:DEEPSEEK_API_KEY="sk-..."; pnpm quality:samples
```

脚本会把每组样本分别跑话术与改写建议，断言：话术 3 条且长度落在 100–160 字、数字与技能可溯源、无套话黑名单词、改写建议不越界且不引入新事实，并把逐条结论写到 `reports/质量回归_<时间>.md`（该目录默认不入库，需要留档时用 `git add -f`）。

指向本地 mock 也能跑（`DEEPSEEK_BASE_URL=http://127.0.0.1:8788/v1`），用于验证脚本自身；mock 的模板话术偏短，会如实报出长度违规。

## 边界说明

- 密钥只存在于服务端环境变量，前端代码与响应体里都不会出现；
- 服务端不落盘：请求内容只用于转发，日志只记录任务类型、耗时与 IP 哈希；
- 服务端有两层用量控制：按 IP 每分钟 10 次 / 每日 100 次，以及全局单日用量告警阈值与硬上限（`DAILY_CALL_ALERT` / `DAILY_CALL_CAP`）；
- 简历、JD、定制简历存档与行为记录都保存在使用者浏览器本地，键名前缀 `zhipin-assistant:v1:`；
- 锁定区块（个人信息、教育经历、未识别小标题）在服务端与前端各校验一次，任何模型输出都无法绕过。
