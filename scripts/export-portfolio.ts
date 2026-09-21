/**
 * 导出作品集 PDF（差距诊断 G9 的物料）：页面已经写了 print 样式，这里只负责渲染与分页。
 * 运行：pnpm portfolio:pdf
 */
import { mkdirSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

async function main(): Promise<void> {
  const source = fileURLToPath(new URL('../作品集_CaseStudy_V1.0.html', import.meta.url));
  const outDir = fileURLToPath(new URL('../docs/assets/', import.meta.url));
  const target = `${outDir}作品集_CaseStudy_V1.0.pdf`;

  mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(pathToFileURL(source).href, { waitUntil: 'load' });
  // 等图片与字体就位，否则 PDF 里可能出现空白图位
  await page.waitForTimeout(800);

  await page.pdf({
    path: target,
    format: 'A4',
    printBackground: true,
    margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' }
  });

  await browser.close();
  const mb = (statSync(target).size / 1024 / 1024).toFixed(1);
  console.log(`PDF 已写入：${target}（${mb} MB）`);
}

void main();
