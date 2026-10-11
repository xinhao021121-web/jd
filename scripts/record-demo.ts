/**
 * 录屏（差距诊断 G9 的物料之一）：把主流程录成一段可以直接放进作品集的视频。
 *
 * 运行：
 *   pnpm record:demo
 *   pnpm record:demo -- --url=http://127.0.0.1:4173 --out=reports/demo-flow.webm
 *
 * 默认打线上地址，所以会消耗当日模型额度（一次录制两次生成）。
 * 节奏是刻意放慢的：视频要给人看「输入什么、出来什么」，不是追求操作速度。
 */
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from '@playwright/test';

interface Sample {
  id: string;
  note: string;
  resume: string;
  jd: string;
}

function argValue(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

async function main(): Promise<void> {
  const url = argValue('url', 'https://zhipin.rainylli02xin11hao21.dpdns.org');
  const out = argValue('out', 'docs/assets/demo-flow.webm');
  const samplesPath = argValue(
    'samples',
    fileURLToPath(new URL('../tests/samples/quality-samples.json', import.meta.url))
  );
  const tmpDir = fileURLToPath(new URL('../reports/demo-video-tmp/', import.meta.url));
  const frameDir = fileURLToPath(new URL('../reports/demo-frames/', import.meta.url));

  const samples = JSON.parse(readFileSync(samplesPath, 'utf8')) as Sample[];
  const sample = samples[0];
  if (!sample) throw new Error('样本文件里没有可用的样本');

  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
  rmSync(frameDir, { recursive: true, force: true });
  mkdirSync(frameDir, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: tmpDir, size: { width: 1440, height: 900 } },
    permissions: ['clipboard-read', 'clipboard-write']
  });
  const page = await context.newPage();
  const video = page.video();
  const beat = (ms: number) => page.waitForTimeout(ms);
  const nav = (view: string) => page.locator(`[data-view="${view}"]`);

  console.log(`打开 ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await beat(4000);

  console.log('1/5 保存简历');
  await nav('resume').click();
  await beat(2500);
  await page.locator('#resumeEditor').fill(sample.resume);
  await beat(5000);
  await page.locator('#saveResume').click();
  await beat(3000);

  console.log('2/5 生成打招呼话术');
  await nav('generate').click();
  await beat(2500);
  await page.locator('#jd').fill(sample.jd);
  await beat(4000);
  await page.locator('#generate').click();
  await waitForCount(page, '[data-testid="greeting-card"]', 3, 40_000);
  await beat(6500);
  await page.screenshot({ path: `${frameDir}1-话术.png` });

  console.log('3/5 复制一条话术');
  await page.getByRole('button', { name: '复制话术' }).first().click();
  await beat(4000);

  console.log('4/5 按 JD 改简历');
  await nav('custom').click();
  await beat(2500);
  await page.locator('#makeSuggest').click();
  await waitForCount(page, '[data-testid="suggestion-card"]', 1, 40_000);
  await beat(5000);
  await page.getByTestId('suggestion-card').first().getByRole('checkbox').check();
  await beat(6000);
  await page.screenshot({ path: `${frameDir}2-定制简历.png` });

  console.log('5/5 存为定制简历并查看话术历史');
  await page.locator('#saveCustom').click();
  await beat(3000);
  await nav('history').click();
  await beat(5000);
  await nav('archive').click();
  await beat(5000);
  await page.screenshot({ path: `${frameDir}3-存档.png` });

  await context.close();
  await browser.close();

  const produced = readdirSync(tmpDir).filter((name) => name.endsWith('.webm'));
  if (!produced.length) throw new Error('没有生成视频文件');

  const source = `${tmpDir}${produced[0]}`;
  const target = fileURLToPath(new URL(`../${out}`, import.meta.url));
  mkdirSync(fileURLToPath(new URL('../docs/assets/', import.meta.url)), { recursive: true });
  copyFileSync(source, target);
  rmSync(tmpDir, { recursive: true, force: true });

  const sizeMb = (statSync(target).size / 1024 / 1024).toFixed(1);
  console.log(`\n视频已写入：${target}（${sizeMb} MB）`);
}

async function waitForCount(
  page: Page,
  selector: string,
  count: number,
  timeout: number
): Promise<void> {
  const started = Date.now();
  for (;;) {
    if ((await page.locator(selector).count()) >= count) return;
    if (Date.now() - started > timeout) {
      throw new Error(`等待 ${selector} 出现 ${count} 个超时（${timeout} ms）`);
    }
    await page.waitForTimeout(400);
  }
}

void main();
