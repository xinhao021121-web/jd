/**
 * 话术历史的端到端链路。
 *
 * 注意：端到端全程共用同一套「每分钟 10 次」的服务端限流（PRD 4.1，且有用例专门验证它生效），
 * 因此这里刻意让多个断言复用同一次生成，只有验证「没复制就不入历史」时才多花一次模型调用。
 */
import { expect, test, type Page } from '@playwright/test';
import { SAMPLE_JD, SAMPLE_RESUME } from '../fixtures';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('zhipin-assistant:v1:consent', 'granted');
  });
  await page.reload();
});

const nav = (page: Page, view: 'resume' | 'custom' | 'archive' | 'generate' | 'history') =>
  page.locator(`[data-view="${view}"]`);

async function saveResume(page: Page): Promise<void> {
  await nav(page, 'resume').click();
  await page.locator('#resumeEditor').fill(SAMPLE_RESUME);
  await page.locator('#saveResume').click();
  await expect(page.getByText('已保存 ·')).toBeVisible();
}

async function generateGreetings(page: Page): Promise<void> {
  await nav(page, 'generate').click();
  await page.locator('#jd').fill(SAMPLE_JD);
  await page.locator('#generate').click();
  await expect(page.getByTestId('greeting-card')).toHaveCount(3);
}

/**
 * 监听一次确认弹窗并接受。
 * 必须先注册处理器再触发：window.confirm 会阻塞点击的事件处理，
 * 若先 await 动作再等弹窗，两边会互相等到超时。
 */
async function acceptDialog(page: Page, action: () => Promise<void>): Promise<string> {
  let message = '';
  const handled = new Promise<void>((resolve) => {
    page.once('dialog', (dialog) => {
      message = dialog.message();
      void dialog.accept().then(resolve);
    });
  });
  await action();
  await handled;
  return message;
}

test('复制即入历史：同批再次复制不新增、刷新后仍在、可清空', async ({ page }) => {
  await saveResume(page);
  await generateGreetings(page);

  // 复制第一条：入历史并给出提示，导航出现条数
  await page.getByRole('button', { name: '复制话术' }).first().click();
  await expect(page.getByText('已复制，并保存到话术历史')).toBeVisible();
  await expect(nav(page, 'history')).toContainText('1');

  // 一次生成 = 一条记录：保留三条候选、匹配分析与对应 JD，名称取自 JD 解析
  await nav(page, 'history').click();
  await expect(page.getByTestId('history-item')).toHaveCount(1);
  await expect(page.getByTestId('history-item').first()).toContainText('某电商科技有限公司');
  await expect(page.getByTestId('history-body')).toHaveCount(3);
  await expect(page.getByText(/这次生成里你复制过第 1 条/)).toBeVisible();
  await expect(page.locator('#historyJd')).toHaveValue(/某电商科技有限公司/);
  await expect(page.getByText('当时的匹配分析')).toBeVisible();

  // 回到生成页复制第二条：同一次生成只更新那一条记录
  await nav(page, 'generate').click();
  await page.getByRole('button', { name: '复制话术' }).nth(1).click();

  await nav(page, 'history').click();
  await expect(page.getByTestId('history-item')).toHaveCount(1);
  await expect(page.getByText(/这次生成里你复制过第 1、2 条/)).toBeVisible();

  // 刷新后历史仍在；生成结果本身不持久化，所以生成页回到未生成状态
  await page.reload();
  await nav(page, 'history').click();
  await expect(page.getByTestId('history-item')).toHaveCount(1);
  await expect(page.getByTestId('history-body')).toHaveCount(3);
  await nav(page, 'generate').click();
  await expect(page.getByTestId('greeting-card')).toHaveCount(0);

  // 清空全部需二次确认
  await nav(page, 'history').click();
  const message = await acceptDialog(page, () =>
    page.getByRole('button', { name: '清空全部' }).click()
  );
  expect(message).toContain('清空全部 1 条话术历史');
  await expect(page.getByText('还没有历史记录')).toBeVisible();
});

test('没有复制过的生成不入历史，空态给出生成入口', async ({ page }) => {
  // 还没生成过：空态可以直接回到生成页
  await nav(page, 'history').click();
  await expect(page.getByText('还没有历史记录')).toBeVisible();
  await page.getByRole('button', { name: '去生成话术' }).click();
  await expect(page.locator('#generate')).toBeVisible();

  // 生成了但不复制：历史仍然为空（复制才是采用的信号）
  await saveResume(page);
  await generateGreetings(page);
  await nav(page, 'history').click();
  await expect(page.getByTestId('history-item')).toHaveCount(0);
  await expect(page.getByText('还没有历史记录')).toBeVisible();
});

test('历史可再次复制，也可删除单条', async ({ page }) => {
  await saveResume(page);
  await generateGreetings(page);
  await page.getByRole('button', { name: '复制话术' }).first().click();

  await nav(page, 'history').click();
  await page.getByTestId('history-item').first().click();

  // 从历史复制不计入本次生成的复制指标，只提示复制成功
  await page.locator('[data-copy]').first().click();
  await expect(page.getByText('已复制', { exact: true })).toBeVisible();

  // 删除单条需二次确认
  const message = await acceptDialog(page, () => page.locator('#deleteHistory').click());
  expect(message).toContain('删除后无法恢复');
  await expect(page.getByText('还没有历史记录')).toBeVisible();
});
