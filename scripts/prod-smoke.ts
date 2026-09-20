/**
 * 线上冒烟（项目评审标准六「发布前检查单」里的线上实测证据）。
 *
 * 检查四件事，全部打真实域名、不注入任何密钥：
 * 1. 首页静态产物可达，且返回的 HTML 引用了构建产物；
 * 2. /healthz 正常；
 * 3. /api/llm 用真实模型跑一次话术生成（会计入当日额度，默认每天最多 300 次）；
 * 4. /api/vision 用一张现场渲染的 JD 截图跑一次识别，确认 Worker Secret 里的视觉模型确实可用。
 *
 * 运行：pnpm smoke:prod               # 全部四项
 *      pnpm smoke:prod -- --static-only  # 只做 1、2，不消耗模型额度
 */
import { chromium } from '@playwright/test';
import { SAMPLE_JD, SAMPLE_RESUME } from '../tests/fixtures';

const BASE_URL = process.env.PROD_BASE_URL ?? 'https://zhipin.xinhao02.ccwu.cc';
const staticOnly = process.argv.includes('--static-only');

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const checks: Check[] = [];
const record = (name: string, ok: boolean, detail: string): void => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}：${detail}`);
};

async function checkStatic(): Promise<void> {
  const response = await fetch(`${BASE_URL}/`);
  const html = await response.text();
  const asset = html.match(/\/assets\/index-[\w-]+\.js/)?.[0] ?? '';

  record(
    '首页静态产物',
    response.status === 200 && Boolean(asset),
    `HTTP ${response.status}${asset ? `，引用 ${asset}` : '，但没找到构建产物引用'}`
  );
}

async function checkHealth(): Promise<void> {
  const response = await fetch(`${BASE_URL}/healthz`);
  const body = (await response.json()) as { ok?: boolean };

  record('健康检查', response.status === 200 && body.ok === true, `HTTP ${response.status} ${JSON.stringify(body)}`);
}

async function checkGreeting(): Promise<void> {
  const startedAt = Date.now();
  const response = await fetch(`${BASE_URL}/api/llm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task: 'greeting', resume: SAMPLE_RESUME, jd: SAMPLE_JD })
  });

  if (!response.ok || !response.body) {
    record('真实模型生成', false, `HTTP ${response.status} ${await response.text()}`);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let firstTokenMs: number | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    if (firstTokenMs === null && buffer.includes('data:')) firstTokenMs = Date.now() - startedAt;
  }

  const events = buffer
    .split('\n\n')
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const line = block.split('\n').find((item) => item.startsWith('data:'));
      return line ? (JSON.parse(line.slice(5).trim()) as { type: string; kind?: string }) : null;
    })
    .filter((event): event is { type: string; kind?: string } => event !== null);

  const greetings = events.filter((event) => event.type === 'item' && event.kind === 'greeting');
  const elapsedMs = Date.now() - startedAt;

  record(
    '真实模型生成',
    greetings.length === 3,
    `3 条话术${greetings.length === 3 ? '' : `（实际 ${greetings.length} 条）`} · 首字 ${firstTokenMs ?? '—'}ms · 完整 ${elapsedMs}ms`
  );
}

async function checkVision(): Promise<void> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    await page.setContent(
      `<body style="font:16px/1.7 -apple-system,'Microsoft YaHei',sans-serif;padding:24px;white-space:pre-wrap">${SAMPLE_JD}</body>`
    );
    const png = await page.screenshot({ type: 'png' });
    const startedAt = Date.now();

    const response = await fetch(`${BASE_URL}/api/vision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: `data:image/png;base64,${png.toString('base64')}` })
    });

    if (!response.ok) {
      record('真实图片识别', false, `HTTP ${response.status} ${await response.text()}`);
      return;
    }

    const body = (await response.json()) as { text?: string };
    const text = body.text ?? '';
    record(
      '真实图片识别',
      text.includes('Java'),
      `${Date.now() - startedAt}ms · 识别 ${text.length} 字${text.includes('Java') ? '，含「Java」' : '，未识别出「Java」'}`
    );
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  console.log(`线上冒烟：${BASE_URL}\n`);
  await checkStatic();
  await checkHealth();

  if (!staticOnly) {
    await checkGreeting();
    await checkVision();
  } else {
    console.log('（--static-only：跳过两项真实模型调用）');
  }

  const failed = checks.filter((check) => !check.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} 项通过`);
  process.exit(failed.length ? 1 : 0);
}

void main();
