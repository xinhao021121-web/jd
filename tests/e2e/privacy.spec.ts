/** 数据与隐私（差距诊断 G8）：数据流向说明、一键清除、首次生成前的授权告知 */
import { expect, test } from '@playwright/test';
import { SAMPLE_JD, SAMPLE_RESUME } from '../fixtures';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('数据流向写在页面上：去哪、存哪、怎么删', async ({ page }) => {
  await page.locator('[data-view="privacy"]').click();

  await expect(page.locator('#dataFlow')).toBeVisible();
  await expect(page.locator('#dataFlow')).toContainText('简历与岗位 JD');
  await expect(page.locator('#dataFlow')).toContainText('只转发');
  await expect(page.locator('#dataFlow')).toContainText('不上报');
  await expect(page.getByText('简历与 JD 可能被用于训练')).toBeVisible();
  await expect(page.getByText('本产品无法替你关闭')).toBeVisible();
});

test('首次生成前先问授权，答过之后不再问', async ({ page }) => {
  await page.locator('[data-view="resume"]').click();
  await page.locator('#resumeEditor').fill(SAMPLE_RESUME);
  await page.locator('#saveResume').click();

  await page.locator('[data-view="generate"]').click();
  await page.locator('#jd').fill(SAMPLE_JD);

  // 第一次点生成：先出授权条，不开始生成
  await page.locator('#generate').click();
  await expect(page.locator('#consentBar')).toBeVisible();
  await expect(page.locator('#consentBar')).toContainText('发送给模型服务商');
  await expect(page.getByTestId('greeting-card')).toHaveCount(0);

  // 确认后授权条消失、授权记在本机。
  // 这里不验生成结果：main-flow 的限流用例会把每分钟配额打满，
  // 而这批用例排在它后面，真实生成会拿到 429——生成能力由其它用例覆盖。
  await page.locator('#acceptConsent').click();
  await expect(page.locator('#consentBar')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('zhipin-assistant:v1:consent'))).toBe(
    'granted'
  );

  // 重新加载后不再问
  await page.reload();
  await page.locator('[data-view="generate"]').click();
  await page.locator('#jd').fill(SAMPLE_JD);
  await page.locator('#generate').click();
  await expect(page.locator('#consentBar')).toHaveCount(0);
});

test('一键清除：二次确认后本机数据清空，刷新回到初始状态', async ({ page }) => {
  // 先制造一些本机数据
  await page.locator('[data-view="resume"]').click();
  await page.locator('#resumeEditor').fill(SAMPLE_RESUME);
  await page.locator('#saveResume').click();
  await page.locator('[data-view="generate"]').click();
  await page.locator('#jd').fill(SAMPLE_JD);

  const keysBefore = await page.evaluate(() => Object.keys(localStorage).length);
  expect(keysBefore).toBeGreaterThan(0);

  // 取消时什么都不删
  page.once('dialog', (dialog) => void dialog.dismiss());
  await page.locator('[data-view="privacy"]').click();
  await page.locator('#clearLocalData').click();
  const keysAfterCancel = await page.evaluate(() => Object.keys(localStorage).length);
  expect(keysAfterCancel).toBe(keysBefore);

  // 确认后清空
  page.once('dialog', (dialog) => void dialog.accept());
  await page.locator('#clearLocalData').click();
  await page.waitForLoadState('load');

  const keysAfterClear = await page.evaluate(() => Object.keys(localStorage).length);
  expect(keysAfterClear).toBe(0);

  await page.locator('[data-view="resume"]').click();
  await expect(page.locator('#resumeEditor')).toHaveValue('');
});
