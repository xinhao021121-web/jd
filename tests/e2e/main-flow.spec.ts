import { expect, test, type Page } from '@playwright/test';
import { SAMPLE_JD, SAMPLE_RESUME } from '../fixtures';

test.beforeEach(async ({ page }) => {
  // 每个用例从干净的本地存储开始
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

/** 侧边栏收起时导航按钮只剩图标，统一用 data-view 定位 */
const nav = (page: Page, view: 'resume' | 'custom' | 'archive' | 'generate') =>
  page.locator(`[data-view="${view}"]`);

async function saveResume(page: Page): Promise<void> {
  await nav(page, 'resume').click();
  await page.locator('#resumeEditor').fill(SAMPLE_RESUME);
  await page.locator('#saveResume').click();
  await expect(page.getByText('已保存 ·')).toBeVisible();
}

async function fillJd(page: Page, selector = '#jd'): Promise<void> {
  await page.locator(selector).fill(SAMPLE_JD);
}

test('主流程：保存简历 → 生成话术 → 采纳建议 → 合成定制简历 → 存档 → 删除隔离', async ({
  page
}) => {
  // 1. 保存简历
  await saveResume(page);

  // 2. 生成 3 条话术，先出匹配分析
  await nav(page, 'generate').click();
  await fillJd(page);
  await page.locator('#generate').click();

  await expect(page.getByText('匹配分析')).toBeVisible();
  await expect(page.getByText('简历已命中')).toBeVisible();
  await expect(page.getByTestId('greeting-card')).toHaveCount(3);
  await expect(page.getByTestId('greeting-body').first()).not.toBeEmpty();

  // 3. 复制话术
  await page.getByRole('button', { name: '复制话术' }).first().click();
  await expect(page.getByText('已复制')).toBeVisible();

  // 复制行为计入本机使用数据：这一次生成拿到了不用改就能发的话（会话级 1/1）
  const metrics = page.getByTestId('metrics');
  await expect(metrics).toBeVisible();
  await expect(metrics).toContainText('会话级零修改复制率');
  await expect(metrics).toContainText('100%（1/1）');

  // 4. 改简历：JD 在两页之间共享
  await nav(page, 'custom').click();
  await expect(page.locator('#jd2')).toHaveValue(SAMPLE_JD);

  await page.locator('#makeSuggest').click();
  const firstSuggestion = page.getByTestId('suggestion-card').first();
  await expect(firstSuggestion).toBeVisible();

  // 采纳一条建议后预览实时合成，锁定区块保持原文
  await firstSuggestion.getByRole('checkbox').check();
  await expect(page.locator('#customPreview')).toContainText('（');
  await expect(page.locator('#customPreview')).toContainText('教育背景');
  await expect(page.locator('#customPreview')).toContainText(
    '某某大学  计算机科学与技术  本科  2021 届'
  );

  // 5. 保存为定制版本
  await page.locator('#saveCustom').click();

  // 6. 存档：名称取自 JD、绑定 JD 原文、内容与原始简历隔离
  await nav(page, 'archive').click();
  const archiveItem = page.getByTestId('archive-item').first();
  await expect(page.getByTestId('archive-item')).toHaveCount(1);
  await expect(archiveItem).toContainText('某电商科技有限公司 · Java 后端开发工程师');
  await expect(page.locator('#archiveJd')).toHaveValue(SAMPLE_JD);
  await expect(page.locator('#archiveText')).toContainText('教育背景');

  // 改名：留空回退到解析出的名称
  await page.locator('#archiveTitle').fill('我的目标岗位');
  await expect(archiveItem).toContainText('我的目标岗位');
  await page.locator('#archiveTitle').fill('');
  await expect(archiveItem).toContainText('Java 后端开发工程师');

  // 7. 删除：二次确认后存档清空，原始简历不受影响
  page.on('dialog', (dialog) => void dialog.accept());
  await page.locator('#deleteArchive').click();
  await expect(page.getByText('还没有定制简历')).toBeVisible();

  await nav(page, 'resume').click();
  await expect(page.locator('#resumeEditor')).toHaveValue(SAMPLE_RESUME);
});

test('未保存简历时不能生成，JD 过短时按钮置灰', async ({ page }) => {
  await nav(page, 'generate').click();
  await page.locator('#jd').fill('太短的 JD');

  await expect(page.locator('#generate')).toBeDisabled();
  await expect(page.getByText('还没有保存简历').first()).toBeVisible();
});

test('页面刷新后简历、JD 与侧边栏收起状态都保留', async ({ page }) => {
  await saveResume(page);
  await nav(page, 'generate').click();
  await fillJd(page);

  await page.locator('#collapseBtn').click();
  await expect(page.locator('#sidebar')).toHaveAttribute('data-collapsed', 'true');

  await page.reload();

  await expect(page.locator('#sidebar')).toHaveAttribute('data-collapsed', 'true');
  await nav(page, 'generate').click();
  await expect(page.locator('#jd')).toHaveValue(SAMPLE_JD);
  await nav(page, 'resume').click();
  await expect(page.locator('#resumeEditor')).toHaveValue(SAMPLE_RESUME);
});

test('服务端限流时页面提示且保留输入', async ({ page }) => {
  await saveResume(page);
  await nav(page, 'generate').click();
  await fillJd(page);

  // 直接把接口打满每分钟配额（默认 10 次），页面上的下一次生成会拿到 429
  await page.evaluate(async (jdText) => {
    const raw = localStorage.getItem('zhipin-assistant:v1:resume') ?? '{}';
    const resumeText = (JSON.parse(raw) as { text?: string }).text ?? '';
    for (let i = 0; i < 10; i += 1) {
      await fetch('/api/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: 'greeting', resume: resumeText, jd: jdText })
      });
    }
  }, SAMPLE_JD);

  await page.locator('#generate').click();

  await expect(page.getByText('请求过于频繁，请稍后再试')).toBeVisible();
  await expect(page.locator('#jd')).toHaveValue(SAMPLE_JD);
});
