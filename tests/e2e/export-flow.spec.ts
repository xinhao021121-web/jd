import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { SAMPLE_JD } from '../fixtures';

// Playwright 把用例转成 CommonJS 执行，这里用 __dirname 定位仓库内的样本
const SAMPLE_DIR = path.join(__dirname, '..', 'samples', 'import');
const sample = (name: string): string => path.join(SAMPLE_DIR, name);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

const nav = (page: Page, view: 'resume' | 'custom' | 'archive' | 'generate') =>
  page.locator(`[data-view="${view}"]`);

/** 草稿非空时导入会弹出覆盖确认：先挂监听再触发，避免与自动处理抢同一个对话框 */
async function importWithDialog(page: Page, file: string): Promise<void> {
  const dialogPromise = page.waitForEvent('dialog');
  await page.setInputFiles('#resumeFile', file);
  const dialog = await dialogPromise;
  await dialog.accept();
}

test('导入 Word 后导出：文件名正确，导出的文件能被重新导入且含改写结果', async ({
  page
}, testInfo) => {
  // 1. 导入 Word 简历并保存
  await nav(page, 'resume').click();
  await page.setInputFiles('#resumeFile', sample('resume-sample.docx'));
  await page.locator('#saveResume').click();
  await expect(page.getByText('已保存 ·')).toBeVisible();

  // 2. 生成改写建议并采纳第一条
  await nav(page, 'custom').click();
  await page.locator('#jd2').fill(SAMPLE_JD);
  await page.locator('#makeSuggest').click();

  const firstCard = page.getByTestId('suggestion-card').first();
  await expect(firstCard).toBeVisible();
  const after = (await firstCard.getByTestId('suggestion-after').innerText()).trim();
  expect(after.length).toBeGreaterThan(0);
  await firstCard.locator('input[type="checkbox"]').check();
  await expect(page.getByText('已采纳 1 条')).toBeVisible();

  // 3. 导出并使用原文件名
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#exportDocx').click()
  ]);
  expect(download.suggestedFilename()).toBe('resume-sample_定制.docx');
  await expect(page.getByText('已导出与原文件排版一致的 Word')).toBeVisible();

  const exported = testInfo.outputPath('exported.docx');
  await download.saveAs(exported);

  // 4. 导出的文件是有效的 docx：能被自己的导入通道解析出来，且含改写后的文字
  await nav(page, 'resume').click();
  await importWithDialog(page, exported);

  const editor = page.locator('#resumeEditor');
  await expect(editor).toHaveValue(new RegExp(escapeForRegExp(after)));
  // 未被改写的锁定区块仍逐字保留
  await expect(editor).toHaveValue(/教育背景/);
  await expect(editor).toHaveValue(/某某大学/);
});

test('未导入 Word 时导出入口置灰并给出导入原件的引导', async ({ page }) => {
  await nav(page, 'resume').click();
  await page.locator('#resumeEditor').fill('李某某 | Java 后端开发工程师\n\n工作经历\n- 负责订单中心核心链路开发\n- 主导订单查询接口性能优化');
  await page.locator('#saveResume').click();
  await expect(page.getByText('已保存 ·')).toBeVisible();

  await nav(page, 'custom').click();
  await page.locator('#jd2').fill(SAMPLE_JD);

  await expect(page.locator('#exportDocx')).toBeDisabled();
  await expect(page.getByTestId('export-notice')).toContainText('导入它就能拿到与原文件一致的格式');
});

test('定制简历存档也能导出 Word：文件名用记录名，导出件含改写结果', async ({
  page
}, testInfo) => {
  // 1. 导入 Word 简历 → 生成建议 → 采纳一条 → 存成定制简历
  await nav(page, 'resume').click();
  await page.setInputFiles('#resumeFile', sample('resume-sample.docx'));
  await page.locator('#saveResume').click();
  await expect(page.getByText('已保存 ·')).toBeVisible();

  await nav(page, 'custom').click();
  await page.locator('#jd2').fill(SAMPLE_JD);
  await page.locator('#makeSuggest').click();

  const firstCard = page.getByTestId('suggestion-card').first();
  await expect(firstCard).toBeVisible();
  const after = (await firstCard.getByTestId('suggestion-after').innerText()).trim();
  await firstCard.locator('input[type="checkbox"]').check();
  await page.locator('#saveCustom').click();

  // 2. 存档页导出：存档没有保存建议列表，导出时靠行级比对反推改动的行
  await nav(page, 'archive').click();
  await expect(page.locator('#exportArchive')).toBeEnabled();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#exportArchive').click()
  ]);
  expect(download.suggestedFilename()).toContain('Java 后端开发工程师_定制.docx');
  await expect(page.getByText('已导出与原文件排版一致的 Word')).toBeVisible();

  const exported = testInfo.outputPath('archive-exported.docx');
  await download.saveAs(exported);

  // 3. 导出件能被重新导入，且含改写后的文字
  await nav(page, 'resume').click();
  await importWithDialog(page, exported);
  await expect(page.locator('#resumeEditor')).toHaveValue(new RegExp(escapeForRegExp(after)));
});

test('导出后重新导入其它格式，模板随之失效', async ({ page }) => {
  await nav(page, 'resume').click();
  await page.setInputFiles('#resumeFile', sample('resume-sample.docx'));
  await page.locator('#saveResume').click();

  await nav(page, 'custom').click();
  await expect(page.locator('#exportDocx')).toBeEnabled();

  // 换成 txt 导入：模板跟着最近一次导入，导出入口重新置灰
  await nav(page, 'resume').click();
  await importWithDialog(page, sample('resume-sample.txt'));
  await nav(page, 'custom').click();
  await expect(page.locator('#exportDocx')).toBeDisabled();
});

/** innerText 里可能含正则元字符，转义后再用于断言 */
function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
