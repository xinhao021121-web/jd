import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// Playwright 把用例转成 CommonJS 执行，这里用 __dirname 定位仓库内的样本与产物
const SAMPLE_DIR = path.join(__dirname, '..', 'samples', 'import');
const DIST_DIR = path.join(__dirname, '..', '..', 'apps', 'web', 'dist');
const sample = (name: string): string => path.join(SAMPLE_DIR, name);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

const nav = (page: Page, view: 'resume' | 'custom' | 'archive' | 'generate') =>
  page.locator(`[data-view="${view}"]`);

async function importResume(page: Page, fileName: string): Promise<void> {
  await nav(page, 'resume').click();
  await page.setInputFiles('#resumeFile', sample(fileName));
}

test('导入 txt 简历：只写草稿并展示区块识别预览，保存后才成为原始简历', async ({ page }) => {
  await importResume(page, 'resume-sample.txt');

  const editor = page.locator('#resumeEditor');
  await expect(editor).toHaveValue(/工作经历/);
  await expect(editor).toHaveValue(/主导订单查询接口性能优化/);

  const preview = page.getByTestId('block-preview');
  await expect(preview).toContainText('已从「resume-sample.txt」导入');
  await expect(preview).toContainText('工作经历 · 可改写');
  await expect(preview).toContainText('教育背景 · 锁定');

  // 未保存前生成读不到内容：保存后预览收起，生成链路才可用
  await page.locator('#saveResume').click();
  await expect(page.getByText('已保存 ·')).toBeVisible();
  await expect(preview).toHaveCount(0);

  await nav(page, 'generate').click();
  await page.locator('#jd').fill('公司：某电商科技\n岗位：Java 后端开发工程师（高级）\n任职要求：3 年以上 Java 开发经验');
  await expect(page.locator('#generate')).toBeEnabled();
});

test('导入 Word 简历：段落与编号规整后进草稿，覆盖前二次确认可取消', async ({ page }) => {
  await nav(page, 'resume').click();
  const draft = '草稿里已有的内容，长度足够触发覆盖确认提示';
  await page.locator('#resumeEditor').fill(draft);

  // 取消覆盖：草稿保持原样
  const cancelled = await runWithDialog(
    page,
    () => page.setInputFiles('#resumeFile', sample('resume-sample.docx')),
    'dismiss'
  );
  expect(cancelled).toContain('会覆盖草稿里已有的内容');
  await expect(page.locator('#resumeEditor')).toHaveValue(draft);

  // 确认覆盖：解析结果写入草稿
  await runWithDialog(
    page,
    () => page.setInputFiles('#resumeFile', sample('resume-sample.docx')),
    'accept'
  );

  const editor = page.locator('#resumeEditor');
  await expect(editor).toHaveValue(/1\. 主导订单查询接口性能优化/);
  await expect(editor).toHaveValue(/\n- 负责订单中心核心链路开发/);
  await expect(editor).toHaveValue(/第二行\n第三行/);
  await expect(page.getByTestId('block-preview')).toContainText('专业技能 · 可改写');
});

/** 导入时可能弹出覆盖确认：先挂监听再触发，避免与自动处理抢同一个对话框 */
async function runWithDialog(
  page: Page,
  action: () => Promise<void>,
  decision: 'accept' | 'dismiss'
): Promise<string> {
  const dialogPromise = page.waitForEvent('dialog');
  await action();
  const dialog = await dialogPromise;
  const message = dialog.message();
  if (decision === 'accept') await dialog.accept();
  else await dialog.dismiss();
  return message;
}

test('导入 PDF 简历：文本层提取后按小标题切块，扫描件走兜底提示', async ({ page }) => {
  await importResume(page, 'resume-sample.pdf');

  const editor = page.locator('#resumeEditor');
  await expect(editor).toHaveValue(/工作经历/);
  await expect(editor).toHaveValue(/专业技能/);
  await expect(page.getByTestId('block-preview')).toContainText('工作经历 · 可改写');

  // 不是 PDF 的文件按格式拒绝，草稿保持原样
  await page.setInputFiles('#resumeFile', sample('jd-sample.png'));
  await expect(page.getByTestId('resume-import-error')).toContainText('暂不支持该文件格式');
  await expect(editor).toHaveValue(/工作经历/);
});

test('导入 JD 截图：结果追加不覆盖，进入校对态且可撤销', async ({ page }) => {
  await importResume(page, 'resume-sample.txt');
  await page.locator('#saveResume').click();

  await nav(page, 'generate').click();
  const jdText = '公司：某个手工粘贴的公司\n岗位：手工粘贴的岗位';
  await page.locator('#jd').fill(jdText);

  const importError = page.getByTestId('jd-import-error');
  await page.setInputFiles('#jdImageFile', sample('jd-sample.png'));

  const review = page.getByTestId('jd-review');
  await expect(review).toContainText('请核对公司名称、岗位名称与技术名词');
  await expect(page.locator('#jd')).toHaveValue(new RegExp(jdText.split('\n')[0]!));
  await expect(page.locator('#jd')).toHaveValue(/某出行科技有限公司/);
  await expect(importError).toHaveCount(0);

  // 两个视图共用同一份 JD：导入结果在「按 JD 改简历」页同样可见
  await nav(page, 'custom').click();
  await expect(page.locator('#jd2')).toHaveValue(/某出行科技有限公司/);

  // 撤销后回到导入前的手工内容
  await page.getByRole('button', { name: '撤销本次导入' }).click();
  await expect(page.locator('#jd2')).toHaveValue(jdText);
  await expect(page.getByTestId('jd-review')).toHaveCount(0);

  // 用户一改 JD，校对提示自行消失
  await page.setInputFiles('#jd2ImageFile', sample('jd-sample.png'));
  await expect(page.getByTestId('jd-review')).toBeVisible();
  await page.locator('#jd2').press('End');
  await page.locator('#jd2').pressSequentially('！');
  await expect(page.getByTestId('jd-review')).toHaveCount(0);
});

test('体积回归：首屏产物不含 pdf.js 与 fflate，两者只在按需加载的 chunk 里', () => {
  const assetsDir = path.join(DIST_DIR, 'assets');
  const html = readFileSync(path.join(DIST_DIR, 'index.html'), 'utf8');
  const entryFiles = [...html.matchAll(/(?:src|href)="\/assets\/([^"]+)"/g)].map(
    (match) => match[1] as string
  );
  const assets = readdirSync(assetsDir);
  const read = (file: string): string => readFileSync(path.join(assetsDir, file), 'utf8');

  const firstScreen = entryFiles.map(read).join('\n');
  const lazy = assets
    .filter((file) => !entryFiles.includes(file))
    .map(read)
    .join('\n');

  expect(lastScreenMarkers(firstScreen)).toEqual([]);
  expect(lastScreenMarkers(lazy).sort()).toEqual(['fflate', 'pdfjs']);
});

/** pdf.js 与 fflate 的库内字符串：只可能出现在各自的 chunk 里 */
function lastScreenMarkers(source: string): string[] {
  return [
    source.includes('PDFDocumentLoadingTask') ? 'pdfjs' : '',
    source.includes('invalid zip data') ? 'fflate' : ''
  ].filter(Boolean);
}
