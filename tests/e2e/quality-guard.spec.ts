import { expect, test, type Page } from '@playwright/test';
import { SAMPLE_JD, SAMPLE_RESUME } from '../fixtures';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

const nav = (page: Page, view: 'resume' | 'custom' | 'archive' | 'generate') =>
  page.locator(`[data-view="${view}"]`);

test('话术命中本地自检时逐条提示，且不阻断编辑与复制', async ({ page }) => {
  // 主流程用例会故意打满 127.0.0.1 的每分钟配额；这里给自己的 IP 单独开一份配额，
  // 避免用例之间靠执行顺序互相影响
  await page.route('**/api/llm', (route) =>
    route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': '10.1.1.1' } })
  );

  await nav(page, 'resume').click();
  await page.locator('#resumeEditor').fill(SAMPLE_RESUME);
  await page.locator('#saveResume').click();
  await expect(page.getByText('已保存 ·')).toBeVisible();

  await nav(page, 'generate').click();
  // mock 模型识别到这个标记后，会故意产出一句带套话与不可溯源数字的话术
  await page.locator('#jd').fill(`${SAMPLE_JD}\nMOCK_BAD_FACT`);
  await page.locator('#generate').click();

  const issues = page.getByTestId('greeting-issues');
  await expect(issues).toHaveCount(3);
  await expect(issues.first()).toContainText('本地自检');
  await expect(issues.first()).toContainText('贵公司');
  await expect(issues.first()).toContainText('9999万');
  await expect(page.getByText('需核对').first()).toBeVisible();

  // 只是提示：话术仍可编辑与复制，不阻断主流程
  await page.getByTestId('greeting-body').first().fill('改成我自己写的一句介绍。');
  await expect(page.getByText('已编辑')).toBeVisible();
  await page.getByRole('button', { name: '复制话术' }).first().click();
  await expect(page.getByText('已复制')).toBeVisible();
});
