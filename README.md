# 直聘打招呼助手

面向求职者的轻量工具：维护一份长期简历，针对具体岗位 JD 生成可直接发送的打招呼话术，以及逐条可采纳的简历改写建议。

只看一份文档的话，看 [docs/作品集主文档_V1.0.md](docs/作品集主文档_V1.0.md)：三分钟读完产品判断、评测体系与已知不足。

产品口径见 [直聘打招呼助手_PRD_V0.3.md](直聘打招呼助手_PRD_V0.3.md)：V0.3 定义产品 V0.4 的范围（简历文件导入与 JD 图片导入，文档先行、尚未实现），已实现范围以 [直聘打招呼助手_PRD_V0.2.md](直聘打招呼助手_PRD_V0.2.md) 为准；实现口径见 [docs/技术方案_V0.1.md](docs/技术方案_V0.1.md)。V0.2 的交互原型保留在 `直聘打招呼助手_Demo_V0.2.html`，仅用于对照，不是运行入口。

## 界面

| 生成打招呼 | 按 JD 改简历 |
|-----------|-------------|
| ![生成打招呼](docs/assets/02-generate.png) | ![按 JD 改简历](docs/assets/03-customize.png) |

左边是生成页：先给本地计算的匹配分析（JD 关键要求 / 已命中 / 未覆盖），再流式出现 3 条话术，可编辑、可复制。右边是改简历页：建议逐条出现，勾选后右侧实时合成定制简历，个人信息与教育经历永远保持原文。

<details>
<summary>另外两个视图</summary>

| 我的简历 | 定制简历 |
|---------|---------|
| ![我的简历](docs/assets/01-resume.png) | ![定制简历](docs/assets/04-archive.png) |

</details>

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

CI（[.github/workflows/ci.yml](.github/workflows/ci.yml)）在 push 与 PR 时跑：类型检查 → 单测 → 文档一致性 → 前端构建，然后跑端到端主流程。端到端全程使用本地 mock 模型，**不需要在仓库或 Actions 里配置任何密钥**。

## 质量回归（需要真实模型）

`tests/samples/quality-samples.json` 里是 8 组简历 + JD 样本。配好真实密钥后运行：

```bash
# PowerShell
$env:DEEPSEEK_API_KEY="sk-..."; pnpm quality:samples
```

脚本会把每组样本分别跑话术与改写建议，断言：话术 3 条且长度落在 100–160 字、数字与技能可溯源、无套话黑名单词、改写建议不越界且不引入新事实，并把逐条结论写到 `reports/质量回归_<时间>.md`（该目录默认不入库，需要留档时用 `git add -f`）。

指向本地 mock 也能跑（`DEEPSEEK_BASE_URL=http://127.0.0.1:8788/v1`），用于验证脚本自身；mock 的模板话术偏短，会如实报出长度违规。

结论留档见 [docs/质量回归_V0.2.md](docs/质量回归_V0.2.md)。

## 外部盲测

评审标准六要求 3–5 人外部盲测（不告知作者身份，1–5 分评三项，均分 ≥ 3.5）：

```bash
pnpm blind-test:kit      # 生成 reports/blind-test/ 下的评分表与邀请话术
# 发给 3–5 位测试者，把回收的 JSON 存进 reports/blind-test/results/
pnpm blind-test:report   # 汇总并输出 reports/盲测报告_<时间>.md
```

评分表是自包含的 HTML，测试者打开就能用，不需要注册任何服务，也不需要你部署评分页。样本默认取 `tests/samples/quality-samples.json` 的前 3 组，换真实简历用 `--samples=<路径>`。

## 部署（可选）

前端是纯静态产物，服务端只有一个路由，两者都建议部署在境外（技术方案第十节）：

```bash
pnpm build                       # 前端产物在 apps/web/dist
pnpm --filter @zhipin/api start  # 服务端常驻进程，读取环境变量
```

- 前端：任意静态托管（Cloudflare Pages / Vercel），构建命令 `pnpm --filter @zhipin/web build`，输出目录 `apps/web/dist`；
- 服务端：Node 常驻进程或 Cloudflare Workers（Hono 换 adapter 即可，限流存储换成 KV / Redis）；
- 前端与 API 建议同域，把 `/api/*` 反代到服务端，可省掉 CORS 配置；
- 密钥只放部署平台的环境变量里，不要写进仓库，也不要用 `VITE_` 前缀（会被打进前端产物）。

### Cloudflare Workers（推荐）

一个 Worker 同时托管前端静态产物与 `/api/llm`：前端与 API 同域，密钥存 Worker Secret，限流与每日配额由 Durable Object 保存，跨请求、跨重新部署都不会重置。

```bash
pnpm deploy:cf                            # 构建前端 + 部署
npx wrangler secret put DEEPSEEK_API_KEY  # 首次部署后写入密钥，不进仓库
```

[apps/api/wrangler.toml](apps/api/wrangler.toml) 里的关键配置：

- `[assets]` + `run_worker_first = true`：把 `apps/web/dist` 作为静态资源，Worker 先接请求，只有 `/api/*` 与 `/healthz` 交给服务端；
- `[[durable_objects.bindings]]` 与 `new_sqlite_classes`：限流与每日配额的共享计数器，免费计划的 Durable Object 必须用 SQLite 存储后端；
- `DAILY_CALL_CAP`：公开部署取 300，比本地的 1500 保守，链接外传时先看这一项；
- `[[routes]]`：自定义域名，不需要可以删掉，只留 `workers.dev`。

**国内访问的注意事项**：`*.workers.dev` 在国内会被 DNS 污染且 TLS 连接被重置，直连打不开，必须挂自有域名。实测同一账号下不同 Cloudflare 出口 IP 的可达性并不一致（`104.16.x` 可直连，`104.21.x` / `172.67.x` 被重置），自定义域名也可能只有 IPv6 能直连，发布前应实测。

### 临时公网地址（隧道预览）

还没选好托管平台时，可以让本机先对外提供一个 HTTPS 地址：API 用真实密钥跑在本机，前端走 `vite preview`（已配置 `/api` 反代，前后端同域），再用隧道把预览端口暴露出去。

```bash
pnpm build                       # 产物交给 preview 托管
pnpm --filter @zhipin/api start  # 终端 1：服务端，读取根目录 .env

# 终端 2：隧道域名在启动时才确定，先跑一次拿到域名，再注入白名单重启
# PowerShell
$env:PREVIEW_ALLOWED_HOSTS="<隧道域名>"; pnpm --filter @zhipin/web preview

# 终端 3
cloudflared tunnel --url http://127.0.0.1:4173
```

Vite 默认只接受本机 Host，未注入 `PREVIEW_ALLOWED_HOSTS`（逗号分隔）时外部访问会返回 403，自定义域名部署同理。

这条路径有三点限制，仅适合临时演示：进程停止或机器休眠后地址即失效；公网地址会消耗服务端密钥的额度，暴露前应把 `DAILY_CALL_CAP` 调低；本机同时承担了服务端角色。

## 边界说明

- 密钥只存在于服务端环境变量，前端代码与响应体里都不会出现；
- 服务端不落盘：请求内容只用于转发，日志只记录任务类型、耗时与 IP 哈希；
- 服务端有两层用量控制：按 IP 每分钟 10 次 / 每日 100 次，以及全局单日用量告警阈值与硬上限（`DAILY_CALL_ALERT` / `DAILY_CALL_CAP`）；
- 简历、JD、定制简历存档与行为记录都保存在使用者浏览器本地，键名前缀 `zhipin-assistant:v1:`；
- 锁定区块（个人信息、教育经历、未识别小标题）在服务端与前端各校验一次，任何模型输出都无法绕过。
